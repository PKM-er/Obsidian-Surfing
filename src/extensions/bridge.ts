/* Chrome extensions for Surfing (formerly the Chrome Extensions Bridge plugin).
 * Loads Chrome extensions into the session of the browser tabs they act in —
 * Obsidian's core Web Viewer while it is enabled, Surfing's own view otherwise
 * — and fills the Chrome APIs Electron lacks. Never claims complete Chrome
 * APIs; no main-process patches. Uses Obsidian's @electron/remote bridge to
 * reach the session.
 */
import { App, Component, FileSystemAdapter, Menu, Notice, Plugin, View, WorkspaceLeaf } from 'obsidian';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import bridgeAssets from 'bridge-assets';
import { localizedField } from './i18n/extension-i18n';
import { tr } from './i18n/strings';
import { unpackArchive } from './install/archive';
import { STORE_ID, STORE_URL, crxDownloadUrl, downloadCrx, getStoreId } from './install/store';
import { status as wrapStatus, wrapExtension, WRAPPER_VERSION } from './extension/wrapper';
import { CompatRuntime } from './extension/compat-runtime';
import { ChannelHost, ChannelManager, ExtensionChannel } from './host/channels';
import { canSeeTab, capabilitiesOf, hasHostAccess, netRuleAllowed, redirectTargetAllowed } from './host/grants';
import { NotificationCenter } from './host/notifications';
import { getAllCookies, getCookie, removeCookie, setCookie, canAccessCookie, toChromeCookie } from './host/cookies';
import { ActionView } from './ui/action-button';
import { BrowserTabTracker } from './host/browser-tabs';
import { BrowserTarget, surfingTarget, webViewerEnabled, webViewerTarget } from './host/targets';
import { framesOfWebContents } from './host/navigation';
import { installPageExec, pageExecEvent, uninstallPageExec } from './host/page-exec';
import { clickInfo, ContextParams, menuTitle, MenuNode, MenuSource, visibleTree } from './host/context-menu';
import { evaluate as evaluateNetRules, NetDecision } from './shared/net-request';
import { ExtensionPopover } from './ui/popover';
import { ExtensionsPanel } from './ui/extensions-panel';
import { ExtensionPageView, EXTENSION_PAGE_VIEW } from './ui/extension-page-view';
import { ManagerModal } from './ui/manager-modal';
import { ConfirmInstallModal, ConfirmModal, InputModal } from './ui/modals';
import type { Anchor } from './ui/anchored';
import { USER_SCRIPT_DIR } from './shared/protocol';
import type { HostMethod, MenuItem, OpenReason, TabEvent, TabFields, WebNavigationEvent } from './shared/protocol';
import {
  AppInternals, BridgeSettings, ChromeManifest, DEFAULT_PINNED_COUNT, DEFAULT_SETTINGS, ExtensionRecord, Remote, WebviewTag
} from './types';
import {
  extensionIcon, isManagedFolder, notify, optionsPage, popupPage,
  readManifest, shortError, showPermissions
} from './util';
import { text } from './shared/text';
import type * as Electron from 'electron';

const UPDATE_INTERVAL = 6 * 3600 * 1000;
/**
 * Oldest Electron the extension runtime was verified on (39.8.3, Obsidian
 * 1.12; also 43.x, Obsidian 1.13.4+). Electron comes with Obsidian's
 * installer, which app updates do not replace, so minAppVersion alone
 * cannot guarantee it.
 */
const MIN_ELECTRON_MAJOR = 39;
type CookieListener = (event: Electron.Event, cookie: Electron.Cookie, cause: string, removed: boolean) => void;
const TAB_ID_TIMEOUT = 4000;
const USER_SCRIPT_FILE_MAX = 16 * 1024 * 1024;
const USER_SCRIPT_DIR_MAX = 256 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
/** Tabs an extension may open per window of time (stops tab floods from a looping background). */
const OPEN_LIMIT = { count: 10, windowMs: 10_000 };
/** Chrome's MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND. */
const CAPTURE_PER_SECOND = 2;
/** Obsidian command IDs for extension manifest commands: ext:<record key>:<command>. */
const COMMAND_PREFIX = 'ext:';

/**
 * Links inside an unpacked extension folder could expose files outside it once
 * copied into the managed folder (and served as chrome-extension:// URLs).
 */
async function rejectLinks(folder: string): Promise<void> {
  let files = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(tr('error.folderSymlink', { path: full }));
      if (++files > 20000) throw new Error(tr('error.folderTooManyFiles'));
      if (entry.isDirectory()) await walk(full);
      // Junctions on Windows report as directories; compare the real path.
      else if (!entry.isFile()) throw new Error(tr('error.folderUnsupportedFile', { path: full }));
    }
    const real = await fs.promises.realpath(dir);
    const root = await fs.promises.realpath(folder);
    if (real !== root && !real.startsWith(root + path.sep)) throw new Error(tr('error.folderExternalLink', { path: dir }));
  };
  await walk(folder);
}

function loadRemote(): Remote | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional host module: Obsidian provides it at runtime, and a static import would fail the whole plugin where it is missing
    return require('@electron/remote') as Remote;
  } catch { /* best effort */ }
  const windowRequire = (window as Window & { require?: (id: string) => unknown }).require;
  try { return (windowRequire?.('@electron/remote') as Remote | undefined) ?? null; } catch { return null; }
}

/** What the bridge needs from the plugin that hosts it. */
export interface BridgeHost {
  plugin: Plugin;
  /** The persisted bridge settings, changed in place. */
  settings: BridgeSettings;
  save(): Promise<void>;
  /** Surfing's per-tab sessions, which extensions cannot be loaded into. */
  sessionIsolation(): boolean;
  /** Show the extensions page of the host's settings. */
  openSettings(): void;
}

/** Why extensions are not running, if they are not. */
export type BridgeState = 'running' | 'starting' | 'old-electron' | 'no-remote' | 'conflict' | 'isolated';

/** Plugin ID of the standalone plugin this module came from. */
export const LEGACY_PLUGIN_ID = 'obsidian-chrome-bridge';
const TARGET_CHECK_INTERVAL = 2000;

export default class ChromeExtensionsBridge extends Component implements ChannelHost {
  root!: string;
  remote: Remote | null = null;
  state: BridgeState = 'starting';
  /** Where extensions run now; null until started (or while they cannot run). */
  target: BrowserTarget | null = null;
  restorePromise: Promise<void> = Promise.resolve();
  compatRuntime: CompatRuntime | null = null;
  private compatPartition: string | null = null;
  /** Event name of the session preload that runs inline user-script code; null if not installed. */
  private pageExec: string | null = null;
  private probeId: string | null = null;
  private installing = new Set<string>();
  /** Recent tabs.open times per extension, for OPEN_LIMIT. */
  private opened = new Map<string, number[]>();
  private notifications!: NotificationCenter;
  private actionRefresh: number | null = null;
  private captures = new Map<string, number[]>();
  /** Obsidian command IDs registered for extension manifest commands. */
  private extensionCommands = new Set<string>();
  private cookieWatch: { cookies: Electron.Cookies; listener: CookieListener } | null = null;
  /** Random per Obsidian session: a leaked event name stops working at the next start. */
  private readonly pageExecSecret = crypto.randomBytes(16).toString('hex');
  private tracker: BrowserTabTracker | null = null;
  private channels!: ChannelManager;
  private activePopover: ExtensionPopover | null = null;
  private activePanel: ExtensionsPanel | null = null;
  private manifestCache = new Map<string, ChromeManifest | null>();
  private nameCache = new Map<string, string>();
  private iconCache = new Map<string, string | null>();

  constructor(private host: BridgeHost) { super(); }

  get app(): App { return this.host.plugin.app; }
  get settings(): BridgeSettings { return this.host.settings; }

  /** Starts the bridge; the host adds it as a child component, so it unloads with the host. */
  onload(): void {
    const settings = this.host.settings;
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if ((settings as unknown as Record<string, unknown>)[key] === undefined) (settings as unknown as Record<string, unknown>)[key] = value;
    }
    if (!Array.isArray(settings.extensions)) settings.extensions = [];
    const electron = this.electronVersion();
    if (!(Number(electron?.split('.')[0]) >= MIN_ELECTRON_MAJOR)) { this.state = 'old-electron'; return; }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) { this.state = 'no-remote'; return; }
    const pluginDir = this.host.plugin.manifest.dir ?? path.posix.join(this.app.vault.configDir, 'plugins', this.host.plugin.manifest.id);
    this.root = path.join(adapter.getBasePath(), ...pluginDir.split('/'), 'chrome-extensions');
    fs.mkdirSync(path.join(this.root, 'extensions'), { recursive: true });
    this.writeAssets();
    this.remote = loadRemote();
    if (!this.remote) { this.state = 'no-remote'; return; }
    this.channels = new ChannelManager(this);
    this.notifications = new NotificationCenter((id, event) => void this.channels.get(id)?.send({ type: 'notifications.event', ...event }));

    // Web Viewer can be switched on or off at any time; follow it.
    this.app.workspace.onLayoutReady(() => {
      this.retarget();
      this.registerEvent(this.app.workspace.on('layout-change', () => this.retarget()));
      this.registerInterval(window.setInterval(() => this.retarget(), TARGET_CHECK_INTERVAL));
    });
    this.registerInterval(window.setInterval(() => { if (this.settings.autoUpdate && this.target) void this.checkUpdates(true); }, UPDATE_INTERVAL));
  }

  private registered = false;

  /**
   * Views and commands, registered once nothing else provides them: the
   * standalone plugin registers the same view type, and Obsidian refuses a
   * second registration (which would fail Surfing's whole onload).
   */
  private registerUI(): void {
    if (this.registered) return;
    this.registered = true;
    const plugin = this.host.plugin;
    plugin.registerView(EXTENSION_PAGE_VIEW, leaf => new ExtensionPageView(leaf, this));
    plugin.addCommand({ id: 'manage-chrome-extensions', name: tr('command.manage'), callback: () => this.openManager() });
    plugin.addCommand({ id: 'open-chrome-web-store', name: tr('command.openStore'), callback: () => void this.openStore() });
    plugin.addCommand({ id: 'install-chrome-extension-url', name: tr('command.installFromUrl'), callback: () => this.askStoreUrl() });
    plugin.addCommand({ id: 'install-chrome-extension-local', name: tr('command.installLocal'), callback: () => this.askLocalPath() });
    plugin.addCommand({
      id: 'show-extensions-menu', name: tr('command.showMenu'),
      checkCallback: checking => {
        const webview = this.tracker?.activeWebview() ?? null;
        const button = this.tracker?.puzzleButton(webview);
        if (!button) return false;
        if (!checking) this.togglePanel(button, webview);
        return true;
      }
    });
    plugin.addCommand({ id: 'reload-webview-after-extension', name: tr('command.reloadPages'), callback: () => this.reloadGuestPages() });
  }

  /** Is the standalone Chrome Extensions Bridge plugin enabled too (both would load the same extensions)? */
  legacyPluginEnabled(): boolean {
    const plugins = (this.app as App & { plugins?: { plugins?: Record<string, unknown> } }).plugins;
    return !!plugins?.plugins?.[LEGACY_PLUGIN_ID];
  }

  /** The browser extensions should run in now, or null (with the reason in `state`). */
  private wantedTarget(): BrowserTarget | null {
    if (this.legacyPluginEnabled()) { this.state = 'conflict'; return null; }
    if (webViewerEnabled(this.app)) return webViewerTarget(this.app);
    const target = surfingTarget(this.app, { sessionIsolation: this.host.sessionIsolation() });
    if (!target.partition) { this.state = 'isolated'; return null; }
    return target;
  }

  /**
   * Move extensions to the browser they should run in: unload them from the
   * previous session and load them into the new one. Each session keeps its
   * own extension data (storage, cookies), like separate Chrome profiles.
   */
  retarget(): void {
    if (!this.remote) return;
    const wanted = this.wantedTarget();
    const current = this.target;
    if (wanted && current && wanted.kind === current.kind && wanted.partition === current.partition) return;
    if (!wanted && !current) return;
    if (current) this.stopTarget();
    if (!wanted) { this.refreshUI(); return; }
    this.registerUI();
    this.target = wanted;
    this.state = 'running';
    this.tracker = this.addChild(new BrowserTabTracker(this, wanted));
    console.debug(`[Surfing] Chrome extensions run in ${wanted.label} (${wanted.partition})`);
    this.restorePromise = this.restore();
  }

  /** Unload extensions and everything attached to the current browser. */
  private stopTarget(): void {
    this.activePopover?.close();
    this.activePanel?.close();
    this.unwatchCookies();
    this.channels?.sync([]);
    if (this.tracker) this.removeChild(this.tracker);
    this.tracker = null;
    try {
      const ses = this.session();
      if (this.probeId && ses.extensions.getExtension(this.probeId)) ses.extensions.removeExtension(this.probeId);
      for (const rec of this.settings.extensions) {
        if (rec.id && ses.extensions.getExtension(rec.id)) ses.extensions.removeExtension(rec.id);
      }
      if (this.pageExec) uninstallPageExec(ses);
    } catch (e) { console.warn('[Surfing] 卸载扩展失败', e); }
    this.probeId = null;
    this.pageExec = null;
    this.compatRuntime?.close();
    this.compatRuntime = null;
    this.compatPartition = null;
    this.target = null;
  }

  /**
   * A community-plugin install has only main.js, manifest.json and
   * styles.css: write out the files extensions load and the compat probe,
   * which main.js carries (unchanged files are left alone).
   */
  private writeAssets(): void {
    for (const [relative, content] of Object.entries(bridgeAssets)) {
      const file = path.join(this.root, ...relative.split('/'));
      try {
        if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) continue;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
      } catch (e) { console.error('[Surfing] 写入插件文件失败', relative, e); }
    }
  }

  onunload(): void {
    // Never started (e.g. Electron too old): nothing was loaded into a session.
    if (this.target) this.stopTarget();
    this.notifications?.dispose();
    this.channels?.dispose();
    for (const id of this.extensionCommands) this.internals.commands?.removeCommand(`${this.host.plugin.manifest.id}:${id}`);
    this.extensionCommands.clear();
  }

  /** Obsidian's undocumented App internals (settings window, command and hotkey registries). */
  private get internals(): AppInternals { return this.app as App & AppInternals; }

  /** The Electron this Obsidian runs on (from its installer). */
  electronVersion(): string | undefined { return process.versions.electron; }

  /** Obsidian's UI language, for extension _locales. */
  locale(): string { return window.navigator?.language || 'en'; }

  async saveSettings(): Promise<void> { await this.host.save(); }

  // ---- Session -----------------------------------------------------------

  partition(): string {
    const p = this.target?.partition;
    if (!p || !/^persist:[a-zA-Z0-9_-]+$/.test(p)) throw new Error(this.unavailableReason());
    return p;
  }

  /** Why extensions cannot be used right now, for error messages. */
  unavailableReason(): string {
    switch (this.state) {
      case 'old-electron': return tr('unavailable.oldElectron', { min: MIN_ELECTRON_MAJOR, current: this.electronVersion() ?? tr('unavailable.unknownVersion') });
      case 'no-remote': return tr('unavailable.noRemote');
      case 'conflict': return tr('unavailable.conflict');
      case 'isolated': return tr('unavailable.isolated');
      default: return tr('unavailable.notStarted');
    }
  }

  session(): Electron.Session {
    const remote = this.remote;
    if (typeof remote?.session?.fromPartition !== 'function') throw new Error(tr('error.noRemoteSession'));
    const partition = this.partition();
    const ses = remote.session.fromPartition(partition);
    if (this.compatPartition !== partition) {
      this.compatRuntime?.close();
      this.compatPartition = partition;
      try {
        this.compatRuntime = new CompatRuntime(ses, () => [...this.settings.extensions.map(r => r.id), this.probeId].filter(Boolean) as string[]);
      } catch (err) {
        console.warn('[Surfing] Service Worker 诊断不可用', err);
        this.compatRuntime = null;
      }
      this.installPageExec(ses);
    }
    return ses;
  }

  /** Session preload that runs user scripts' inline <script>s despite the page CSP (host/page-exec). */
  private installPageExec(ses: Electron.Session): void {
    this.pageExec = null;
    try {
      const event = pageExecEvent(this.pageExecSecret);
      if (installPageExec(ses, path.join(this.root, 'page-exec-preload.js'), event)) this.pageExec = event;
    } catch (e) { console.warn('[Surfing] page exec preload:', e); }
  }

  // ---- Records -----------------------------------------------------------

  private dirOf(rec: ExtensionRecord): string { return path.join(this.root, 'extensions', rec.key); }

  getManifest(rec: ExtensionRecord): ChromeManifest | null {
    const key = `${rec.key}@${rec.version}`;
    if (!this.manifestCache.has(key)) {
      let manifest: ChromeManifest | null = null;
      try { manifest = readManifest(this.dirOf(rec)); } catch { /* best effort */ }
      this.manifestCache.set(key, manifest);
    }
    return this.manifestCache.get(key) ?? null;
  }

  getDisplayName(rec: ExtensionRecord): string {
    const key = `${rec.key}@${rec.version}`;
    const cached = this.nameCache.get(key);
    if (cached) return cached;
    const m = this.getManifest(rec);
    const name = m ? String(localizedField(this.dirOf(rec), m, m.name, this.locale()) || rec.name) : rec.name || 'Unnamed extension';
    this.nameCache.set(key, name);
    return name;
  }

  iconFor(rec: ExtensionRecord, size: number): string | null {
    const key = `${rec.key}@${rec.version}:${size}`;
    if (!this.iconCache.has(key)) {
      const m = this.getManifest(rec);
      this.iconCache.set(key, m ? extensionIcon(this.dirOf(rec), m, size) : null);
    }
    return this.iconCache.get(key) ?? null;
  }

  popupPageOf(rec: ExtensionRecord): string | null { return popupPage(this.getManifest(rec)); }
  optionsPageOf(rec: ExtensionRecord): string | null { return optionsPage(this.getManifest(rec)); }

  /** Managed, enabled, loaded extension owning a chrome-extension:// URL. */
  recordForUrl(url: string): ExtensionRecord | null {
    let host: string;
    try {
      const u = new URL(url);
      if (u.protocol !== 'chrome-extension:') return null;
      host = u.hostname;
    } catch { return null; }
    const rec = this.settings.extensions.find(r => r.id === host && r.enabled);
    if (!rec) return null;
    try { return this.session().extensions.getExtension(rec.id) ? rec : null; } catch { return null; }
  }

  extensionCompatStatus(rec: ExtensionRecord): ReturnType<typeof wrapStatus> & { error?: string } {
    try { return wrapStatus(this.dirOf(rec)); }
    catch (e) { return { applied: false, error: shortError(e) }; }
  }

  prepareExtensionFolder(dir: string) {
    // Disabled mode restores original background and HTML entrypoints.
    return wrapExtension(dir, {
      enabled: this.settings.compatibilityEnabled !== false,
      locale: this.locale(),
      compatSource: path.join(this.root, 'compat-api.js'),
      hostSource: path.join(this.root, 'bridge-host.js')
    });
  }

  // ---- Pinning -----------------------------------------------------------

  private canActivate(rec: ExtensionRecord): boolean {
    return rec.enabled && !!(this.popupPageOf(rec) || this.optionsPageOf(rec) || this.hasAction(rec));
  }

  /** Has a toolbar action (Chrome shows a button even without a popup). */
  hasAction(rec: ExtensionRecord): boolean {
    const m = this.getManifest(rec);
    return !!(m?.action || m?.browser_action || m?.page_action);
  }

  /** The popup for a tab: chrome.action.setPopup state, else the manifest's. */
  popupFor(rec: ExtensionRecord, tabId: number | null): string | null {
    const state = this.channels?.get(rec.id)?.action.resolve(tabId);
    if (state?.popup !== undefined) return state.popup || null;
    return this.popupPageOf(rec);
  }

  /** What the extension's toolbar button shows in a tab. */
  actionView(rec: ExtensionRecord, tabId: number | null): ActionView {
    const name = this.getDisplayName(rec);
    const m = this.getManifest(rec);
    const state = (rec.enabled ? this.channels?.get(rec.id)?.action.resolve(tabId) : undefined) ?? {};
    const declaredTitle = m?.action?.default_title ?? m?.browser_action?.default_title;
    return {
      name,
      title: state.title ?? (typeof declaredTitle === 'string' ? localizedField(this.dirOf(rec), m!, declaredTitle, this.locale()) : name),
      icon: state.icon ?? this.iconFor(rec, 32),
      badgeText: state.badgeText ?? '',
      badgeBackgroundColor: state.badgeBackgroundColor,
      badgeTextColor: state.badgeTextColor,
      enabled: state.enabled !== false
    };
  }

  actionChanged(id: string): void {
    // Coalesce bursts (a badge per tab per page load).
    if (this.actionRefresh !== null) return;
    this.actionRefresh = window.setTimeout(() => {
      this.actionRefresh = null;
      this.tracker?.refreshActionVisuals();
      this.activePanel?.render();
    }, 50);
    void id;
  }

  /** A Web Viewer tab closed: tab-specific action state goes with it. */
  forgetTab(tabId: number): void {
    for (const channel of this.channels?.all() ?? []) channel.action.forgetTab(tabId);
  }

  /** The tab an extension acts on, with what it may see of it (activeTab is granted by the user's click). */
  private tabFor(webview: WebviewTag | null, channel: ExtensionChannel, userGesture: boolean): TabFields | null {
    if (!webview) return null;
    let id: number, url = '', title = '';
    try { id = webview.getWebContentsId(); url = webview.getURL(); title = webview.getTitle(); } catch { return null; }
    if (!Number.isSafeInteger(id)) return null;
    const visible = canSeeTab(channel.capabilities, url) || (userGesture && channel.capabilities.activeTab);
    return visible ? { id, url, title, active: true, status: 'complete' } : { id, active: true, status: 'complete' };
  }

  private pinnedKeys(): string[] {
    if (Array.isArray(this.settings.pinned)) return this.settings.pinned;
    return this.settings.extensions.filter(r => this.canActivate(r)).slice(0, DEFAULT_PINNED_COUNT).map(r => r.key);
  }

  pinnedRecords(): ExtensionRecord[] {
    return this.pinnedKeys().map(key => this.settings.extensions.find(r => r.key === key))
      .filter((r): r is ExtensionRecord => !!r && this.canActivate(r));
  }

  isPinned(rec: ExtensionRecord): boolean { return this.pinnedRecords().includes(rec); }

  async togglePinned(rec: ExtensionRecord): Promise<void> {
    const keys = this.pinnedKeys().filter(k => this.settings.extensions.some(r => r.key === k));
    this.settings.pinned = keys.includes(rec.key) ? keys.filter(k => k !== rec.key) : [...keys, rec.key];
    await this.saveSettings();
    this.refreshUI();
  }

  async resetPinned(): Promise<void> {
    this.settings.pinned = null;
    await this.saveSettings();
    this.refreshUI();
  }

  // ---- UI surfaces -------------------------------------------------------

  /** Rebuild everything derived from the extension list. */
  refreshUI(): void {
    this.manifestCache.clear();
    this.nameCache.clear();
    this.iconCache.clear();
    this.tracker?.refreshActions();
    this.activePanel?.render();
    this.syncChannels();
    this.syncCommands();
    for (const leaf of this.app.workspace.getLeavesOfType(EXTENSION_PAGE_VIEW)) {
      if (leaf.view instanceof ExtensionPageView) leaf.view.refreshIfStale();
    }
  }

  openManager(): void { new ManagerModal(this.app, this).open(); }

  openSettings(): void {
    this.host.openSettings();
  }

  togglePanel(anchor: HTMLElement, webview: WebviewTag | null): void {
    if (this.activePanel?.isAnchoredTo(anchor)) { this.activePanel.close(); return; }
    this.activePanel?.close();
    this.activePopover?.close();
    this.activePanel = new ExtensionsPanel(this, anchor, webview).open();
  }

  panelClosed(panel: ExtensionsPanel): void { if (this.activePanel === panel) this.activePanel = null; }
  popoverClosed(popover: ExtensionPopover): void { if (this.activePopover === popover) this.activePopover = null; }
  closePopover(): void { this.activePopover?.close(); }

  activateExtension(rec: ExtensionRecord, anchor: Anchor, webview: WebviewTag | null): void {
    const guest = webview ?? this.activeWebview();
    let tabId: number | null = null;
    try { tabId = guest?.getWebContentsId() ?? null; } catch { /* best effort */ }
    const channel = this.channels.get(rec.id);
    // chrome.action.disable(tabId): the button does nothing in that tab.
    if (rec.enabled && channel?.action.resolve(tabId).enabled === false) return;
    if (this.popupFor(rec, tabId)) this.openPopup(rec, anchor, webview);
    else if (rec.enabled && this.hasAction(rec) && channel) {
      // No popup: Chrome dispatches action.onClicked with the current tab.
      const tab = this.tabFor(guest, channel, true);
      if (tab) void channel.send({ type: 'action.clicked', tab });
      else notify(tr('notice.needsWebTab', { name: this.getDisplayName(rec) }));
    }
    else if (this.optionsPageOf(rec)) void this.openOptions(rec, anchor);
    else notify(tr('notice.noPanel', { name: this.getDisplayName(rec) }));
  }

  private ensureLoaded(rec: ExtensionRecord): void {
    if (!rec.enabled || !this.session().extensions.getExtension(rec.id)) throw new Error(tr('error.notLoaded', { target: this.target?.label ?? 'Web Viewer' }));
  }

  openPopup(rec: ExtensionRecord, anchor: Anchor, webview: WebviewTag | null): void {
    try {
      // Clicking the same button again closes the popup, like a browser.
      if (anchor instanceof HTMLElement && this.activePopover?.isAnchoredTo(anchor)) { this.activePopover.close(); return; }
      this.ensureLoaded(rec);
      let tabId: number | null = null;
      try { tabId = (webview ?? this.activeWebview())?.getWebContentsId() ?? null; } catch { /* best effort */ }
      const page = this.popupFor(rec, tabId) ?? this.popupPageOf(rec);
      if (!page) throw new Error(tr('error.noPopup'));
      this.activePanel?.close();
      this.activePopover?.close();
      this.activePopover = new ExtensionPopover(this, rec, page, anchor, 'popup', webview).open();
    } catch (e) { notify(shortError(e)); }
  }

  /** Options in a tab when the manifest asks for it (or MV2 options_page), else as a popup. */
  async openOptions(rec: ExtensionRecord, anchor: Anchor): Promise<number | null> {
    try {
      this.ensureLoaded(rec);
      const m = this.getManifest(rec);
      const page = this.optionsPageOf(rec);
      if (!page) throw new Error(tr('error.noOptions'));
      const inTab = m?.options_ui ? m.options_ui.open_in_tab === true : !!m?.options_page;
      this.activePanel?.close();
      this.activePopover?.close();
      if (inTab) return await this.openExtensionTab(ExtensionPopover.resolveUrl(rec.id, page), true);
      this.activePopover = new ExtensionPopover(this, rec, page, anchor, 'options').open();
      return null;
    } catch (e) { notify(shortError(e)); return null; }
  }

  private async waitForTabId(leaf: WorkspaceLeaf): Promise<number | null> {
    const deadline = Date.now() + TAB_ID_TIMEOUT;
    while (Date.now() < deadline) {
      const view = leaf.view as View & { webview?: WebviewTag };
      const webview = view.webview ?? view.containerEl.querySelector<WebviewTag>('webview');
      try {
        const id = webview?.getWebContentsId();
        if (Number.isSafeInteger(id) && (id as number) > 0) return id as number;
      } catch { /* best effort */ }
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }
    return null;
  }

  /** Open a web page in a new tab of the browser extensions run in. */
  async openBrowserTab(url: string, active: boolean): Promise<number | null> {
    if (!this.target) throw new Error(this.unavailableReason());
    return this.waitForTabId(await this.target.open(url, active));
  }

  /** The <webview> of the browser tab the user was last on. */
  activeWebview(): WebviewTag | null { return this.tracker?.activeWebview() ?? null; }

  /** Where a popup for an extension opens: its pinned button in the tab header, else the puzzle button. */
  private actionAnchor(extensionId: string, webview: WebviewTag | null): HTMLElement | null {
    return this.tracker?.actionAnchor(extensionId, webview) ?? null;
  }

  async openExtensionTab(url: string, active: boolean): Promise<number | null> {
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: EXTENSION_PAGE_VIEW, state: { url }, active });
    if (active) void this.app.workspace.revealLeaf(leaf);
    return this.waitForTabId(leaf);
  }

  /** Right-click / ⋮ menu for one extension. */
  showExtensionMenu(rec: ExtensionRecord, evt: MouseEvent, webview: WebviewTag | null, onChange?: () => void): void {
    const menu = new Menu();
    const anchor = (evt.currentTarget instanceof HTMLElement ? evt.currentTarget : null) ?? new DOMRect(evt.clientX, evt.clientY, 0, 0);
    const done = () => { onChange?.(); this.activePanel?.render(); };
    // The extension's own items for its toolbar button (contexts: action).
    const channel = this.channels.get(rec.id);
    if (rec.enabled && channel?.menuItems.length) {
      let tabId: number | null = null, pageURL = '';
      const guest = webview ?? this.activeWebview();
      try { tabId = guest?.getWebContentsId() ?? null; pageURL = guest?.getURL() ?? ''; } catch { /* best effort */ }
      const flat: Array<{ item: MenuItem; depth: number }> = [];
      const walk = (nodes: ReturnType<typeof visibleTree>, depth: number) => {
        for (const node of nodes) { flat.push({ item: node.item, depth }); walk(node.children, depth + 1); }
      };
      walk(visibleTree(channel.menuItems, { pageURL }, true), 0);
      for (const { item, depth } of flat) {
        if (item.type === 'separator') { menu.addSeparator(); continue; }
        menu.addItem(mi => {
          mi.setSection('extension').setTitle('　'.repeat(depth) + String(item.title ?? ''))
            .setDisabled(item.enabled === false)
            .onClick(() => void channel.send({ type: 'contextMenus.clicked', tabId,
              info: { menuItemId: item.id, editable: false, pageUrl: pageURL || undefined,
                ...(item.type === 'checkbox' || item.type === 'radio' ? { wasChecked: !!item.checked, checked: item.type === 'radio' ? true : !item.checked } : {}) } }));
          if (item.type === 'checkbox' || item.type === 'radio') mi.setChecked(!!item.checked);
        });
      }
    }
    if (rec.enabled && this.popupPageOf(rec)) {
      menu.addItem(mi => mi.setSection('open').setTitle(tr('menu.openPanel')).setIcon('panel-top-open')
        .onClick(() => this.openPopup(rec, anchor, webview)));
    }
    if (rec.enabled && this.optionsPageOf(rec)) {
      menu.addItem(mi => mi.setSection('open').setTitle(tr('menu.options')).setIcon('settings').onClick(() => void this.openOptions(rec, anchor)));
    }
    if (rec.enabled && this.canActivate(rec)) {
      const pinned = this.isPinned(rec);
      menu.addItem(mi => mi.setSection('manage').setTitle(pinned ? tr('menu.unpin') : tr('menu.pin')).setIcon(pinned ? 'pin-off' : 'pin')
        .onClick(async () => { await this.togglePinned(rec); done(); }));
    }
    menu.addItem(mi => mi.setSection('manage').setTitle(rec.enabled ? tr('menu.disable') : tr('menu.enable')).setIcon(rec.enabled ? 'power-off' : 'power')
      .onClick(() => this.withNotice(async () => { await this.toggle(rec.key); done(); })));
    if (rec.source === 'store' && rec.storeId) {
      const storeId = rec.storeId;
      menu.addItem(mi => mi.setSection('manage').setTitle(tr('menu.checkUpdate')).setIcon('refresh-cw')
        .onClick(() => void this.installFromStore(storeId).then(done)));
      menu.addItem(mi => mi.setSection('manage').setTitle(tr('menu.viewInStore')).setIcon('external-link')
        .onClick(() => void this.openBrowserTab(`${STORE_URL}detail/${storeId}`, true)));
    }
    if (this.settings.debug && rec.enabled) {
      menu.addItem(mi => mi.setSection('debug').setTitle(tr('menu.diagnoseWorker')).setIcon('bug')
        .onClick(async () => {
          try { console.debug('[Surfing] Worker:', JSON.stringify(await this.startExtensionWorker(rec.id), null, 2)); new Notice(tr('notice.diagnosticsLogged')); }
          catch (e) { notify(shortError(e)); }
        }));
    }
    menu.addItem(mi => mi.setSection('danger').setTitle(tr('menu.uninstall')).setIcon('trash-2').setWarning(true)
      .onClick(async () => {
        const name = this.getDisplayName(rec);
        if (!await new ConfirmModal(this.app, tr('uninstall.title', { name }), tr('uninstall.message'), tr('uninstall.confirm'), true).openAndWait()) return;
        await this.withNotice(async () => { await this.uninstall(rec.key); done(); });
      }));
    menu.showAtMouseEvent(evt);
  }

  // ---- Channels (ChannelHost) -------------------------------------------

  debug(): boolean { return !!this.settings.debug; }

  /** Every enabled, compat-wrapped extension gets a channel to the host. */
  syncChannels(): void {
    if (!this.channels) return;
    let ses: Electron.Session | null = null;
    try { if (this.target && this.remote) ses = this.session(); } catch { /* best effort */ }
    if (!ses || this.settings.compatibilityEnabled === false) { this.channels.sync([]); return; }
    const wanted: Parameters<ChannelManager['sync']>[0] = [];
    for (const rec of this.settings.extensions) {
      if (!rec.enabled || !ses.extensions.getExtension(rec.id)) continue;
      if (!this.extensionCompatStatus(rec).hostPage) continue;
      wanted.push({ id: rec.id, name: this.getDisplayName(rec), capabilities: capabilitiesOf(this.getManifest(rec)) });
    }
    this.channels.sync(wanted);
  }

  async wakeWorker(id: string): Promise<void> {
    const rec = this.settings.extensions.find(r => r.id === id);
    if (!rec || !this.getManifest(rec)?.background?.service_worker) return;
    const workers = this.session().serviceWorkers;
    if (typeof workers?.startWorkerForScope === 'function') await workers.startWorkerForScope(`chrome-extension://${id}/`);
  }

  menusChanged(): void { /* Menus are built on demand from channel state. */ }

  // ---- Manifest commands as Obsidian commands --------------------------------

  /** Each enabled extension's manifest commands, in Obsidian's command palette (bind hotkeys there). */
  private syncCommands(): void {
    const commands = this.internals.commands;
    if (!commands) return;
    const wanted = new Map<string, { rec: ExtensionRecord; name: string; label: string }>();
    for (const rec of this.settings.extensions) {
      const manifest = rec.enabled ? this.getManifest(rec) : null;
      const declared = manifest?.commands;
      if (!manifest || !declared || typeof declared !== 'object') continue;
      const extension = this.getDisplayName(rec);
      for (const [name, value] of Object.entries(declared).slice(0, 50)) {
        if (!/^[\w.-]{1,64}$/.test(name)) continue;
        const declaredDescription = value?.description;
        const description = typeof declaredDescription === 'string'
          ? String(localizedField(this.dirOf(rec), manifest, declaredDescription, this.locale()))
          : '';
        const label = name === '_execute_action' || name === '_execute_browser_action' ? tr('menu.openPanel') : description || name;
        wanted.set(`${COMMAND_PREFIX}${rec.key}:${name}`, { rec, name, label: `${extension}: ${label}` });
      }
    }
    for (const id of [...this.extensionCommands]) {
      if (wanted.has(id)) continue;
      commands.removeCommand(`${this.host.plugin.manifest.id}:${id}`);
      this.extensionCommands.delete(id);
    }
    for (const [id, { rec, name, label }] of wanted) {
      if (this.extensionCommands.has(id)) continue;
      const key = rec.key;
      this.host.plugin.addCommand({ id, name: label, callback: () => this.runExtensionCommand(key, name) });
      this.extensionCommands.add(id);
    }
  }

  private runExtensionCommand(key: string, name: string): void {
    const rec = this.settings.extensions.find(r => r.key === key && r.enabled);
    if (!rec) return;
    const webview = this.activeWebview();
    if (name === '_execute_action' || name === '_execute_browser_action') {
      this.activateExtension(rec, this.actionAnchor(rec.id, webview), webview);
      return;
    }
    const channel = this.channels.get(rec.id);
    if (!channel) { notify(tr('notice.notConnected', { name: this.getDisplayName(rec) })); return; }
    // A keyboard shortcut is a user gesture: activeTab applies.
    void channel.send({ type: 'commands.command', command: name, tab: this.tabFor(webview, channel, true) });
  }

  /** Hotkeys bound in Obsidian to the extension's commands, Chrome-formatted ("Ctrl+Shift+K"). */
  private commandShortcuts(channel: ExtensionChannel): Record<string, string> {
    const rec = this.settings.extensions.find(r => r.id === channel.id);
    const manager = this.internals.hotkeyManager;
    const out: Record<string, string> = {};
    if (!rec || !manager) return out;
    const prefix = `${COMMAND_PREFIX}${rec.key}:`;
    for (const id of this.extensionCommands) {
      if (!id.startsWith(prefix)) continue;
      const full = `${this.host.plugin.manifest.id}:${id}`;
      const hotkey = (manager.getHotkeys(full) ?? manager.getDefaultHotkeys(full) ?? [])[0];
      if (!hotkey) continue;
      const mods = hotkey.modifiers.map(m => m === 'Mod' ? (process.platform === 'darwin' ? 'Command' : 'Ctrl') : m === 'Meta' ? 'Command' : m);
      out[id.slice(prefix.length)] = [...mods, hotkey.key.toUpperCase()].join('+');
    }
    return out;
  }

  // ---- cookies.onChanged ---------------------------------------------------

  cookieListenersChanged(): void {
    const wanted = this.channels?.all().some(c => c.cookieListeners) ?? false;
    if (wanted && !this.cookieWatch) {
      let cookies: Electron.Cookies;
      try { cookies = this.session().cookies; } catch { return; }
      const listener: CookieListener = (_event, cookie, cause, removed) => {
        const details = toChromeCookie(cookie);
        for (const channel of this.channels.all()) {
          if (!channel.cookieListeners || !canAccessCookie(channel.capabilities, details)) continue;
          void channel.send({ type: 'cookies.changed', info: { cookie: details, cause: String(cause), removed: !!removed } }, false);
        }
      };
      cookies.on('changed', listener);
      this.cookieWatch = { cookies, listener };
    } else if (!wanted) this.unwatchCookies();
  }

  private unwatchCookies(): void {
    if (!this.cookieWatch) return;
    try { this.cookieWatch.cookies.removeListener('changed', this.cookieWatch.listener); } catch { /* best effort */ }
    this.cookieWatch = null;
  }

  wantsNavigation(): boolean {
    return this.channels?.all().some(c => c.capabilities.webNavigation && (c.navigationListeners === null || c.navigationListeners.size > 0)) ?? false;
  }

  deliverNavigation(event: WebNavigationEvent, details: Record<string, unknown>): void {
    for (const channel of this.channels.all()) {
      if (!channel.capabilities.webNavigation) continue;
      if (channel.navigationListeners && !channel.navigationListeners.has(event)) continue;
      void channel.send({ type: 'webNavigation.event', event, details });
    }
  }

  /**
   * declarativeNetRequest for a Web Viewer top-level navigation. As in Chrome,
   * a block from any extension wins; otherwise the most recently installed
   * extension's redirect wins. Allow rules only affect their own extension.
   */
  netRequestDecision(url: string, tabId: number): { decision: NetDecision; extension: string } | null {
    let redirect: { decision: NetDecision; extension: string } | null = null;
    for (const channel of [...this.channels.all()].reverse()) {
      if (!channel.netRules.length) continue;
      const decision = evaluateNetRules(channel.netRules, { url, tabId, method: 'get' }, channel.id,
        rule => netRuleAllowed(channel.capabilities, rule, url));
      if (!decision) continue;
      if (decision.kind === 'redirect' && !redirectTargetAllowed(decision.url, channel.id)) {
        console.warn('[Surfing] 已忽略不安全的重定向', channel.name, decision.url.slice(0, 200));
        continue;
      }
      if (decision.kind === 'block') return { decision, extension: channel.name };
      if (decision.kind === 'redirect' && !redirect) redirect = { decision, extension: channel.name };
    }
    return redirect;
  }

  notifyBlocked(extension: string, url: string): void {
    let host = url;
    try { host = new URL(url).host; } catch { /* best effort */ }
    notify(tr('notice.blockedOpen', { extension, host }));
  }

  wantsTabEvents(): boolean {
    return this.channels?.all().some(c => c.tabListeners === null || c.tabListeners.size > 0) ?? false;
  }

  deliverTabEvent(event: TabEvent, tab: TabFields, extra: { changeInfo?: Record<string, unknown>; removeInfo?: { windowId: number; isWindowClosing: boolean } } = {}): void {
    for (const channel of this.channels.all()) {
      if (channel.tabListeners && !channel.tabListeners.has(event)) continue;
      // Every context of the extension can read channel traffic: withhold what Chrome would.
      if (canSeeTab(channel.capabilities, tab.url)) { void channel.send({ type: 'tabs.event', event, tab, ...extra }); continue; }
      const { url: _url, title: _title, favIconUrl: _icon, ...visible } = tab;
      const changeInfo = extra.changeInfo && Object.fromEntries(Object.entries(extra.changeInfo)
        .filter(([key]) => key !== 'url' && key !== 'title' && key !== 'favIconUrl'));
      // An update that only changed hidden fields is not an event for this extension.
      if (event === 'onUpdated' && changeInfo && !Object.keys(changeInfo).length) continue;
      void channel.send({ type: 'tabs.event', event, tab: visible, ...extra, ...(changeInfo ? { changeInfo } : {}) });
    }
  }

  menuSources(tabId: number | null): MenuSource[] {
    return this.channels.all().filter(c => c.capabilities.contextMenus && c.menuItems.length).map(channel => ({
      extensionId: channel.id,
      extensionName: channel.name,
      items: channel.menuItems,
      click: info => void channel.send({ type: 'contextMenus.clicked', info, tabId })
    }));
  }

  /**
   * Extension items for a right-click in a browser tab whose page menu is an
   * Obsidian Menu (Surfing). As in Chrome, an extension with one top-level
   * item shows it directly; with several, they go under its name.
   */
  addPageMenuItems(menu: Menu, params: ContextParams, webview: WebviewTag | null): void {
    if (!this.target || this.target.nativePageMenu || !this.channels) return;
    let tabId: number | null = null;
    try { tabId = webview?.getWebContentsId() ?? null; } catch { /* best effort */ }
    type SubmenuItem = { setSubmenu?(): Menu };
    const add = (target: Menu, node: MenuNode, source: MenuSource, depth: number) => {
      const { item } = node;
      if (item.type === 'separator') { target.addSeparator(); return; }
      let submenu: Menu | null = null;
      target.addItem(mi => {
        mi.setTitle('　'.repeat(depth) + menuTitle(item, params)).setDisabled(item.enabled === false);
        if (node.children.length) submenu = (mi as unknown as SubmenuItem).setSubmenu?.() ?? null;
        else {
          if (item.type === 'checkbox' || item.type === 'radio') mi.setChecked(!!item.checked);
          mi.onClick(() => source.click(clickInfo(item, params)));
        }
      });
      // Without submenus (older Obsidian), children follow their parent, indented.
      for (const child of node.children) add(submenu ?? target, child, source, submenu ? 0 : depth + 1);
    };
    // After the page's own items, as in Chrome.
    let separated = false;
    for (const source of this.menuSources(tabId)) {
      const tree = visibleTree(source.items, params);
      if (!tree.length) continue;
      if (!separated) { menu.addSeparator(); separated = true; }
      if (tree.length === 1) { add(menu, tree[0], source, 0); continue; }
      add(menu, { item: { id: `__extension_${source.extensionId}`, title: source.extensionName }, children: tree }, source, 0);
    }
  }

  // ---- Import from the standalone Chrome Extensions Bridge plugin ----------

  /** Extensions the standalone plugin installed that Surfing does not manage yet. */
  legacyImport(): { dir: string; settings: Partial<BridgeSettings>; records: ExtensionRecord[]; count: number } | null {
    if (!this.root) return null;
    const manifests = (this.app as App & { plugins?: { manifests?: Record<string, { dir?: string }> } }).plugins?.manifests;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return null;
    const relative = manifests?.[LEGACY_PLUGIN_ID]?.dir ?? path.posix.join(this.app.vault.configDir, 'plugins', LEGACY_PLUGIN_ID);
    const dir = path.join(adapter.getBasePath(), ...relative.split('/'));
    let settings: Partial<BridgeSettings>;
    try { settings = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')) as Partial<BridgeSettings>; } catch { return null; }
    const records = (Array.isArray(settings.extensions) ? settings.extensions : []).filter(rec =>
      rec && typeof rec.key === 'string' && /^[a-z0-9_-]{1,64}$/i.test(rec.key) &&
      !this.settings.extensions.some(own => own.key === rec.key) &&
      fs.existsSync(path.join(dir, 'extensions', rec.key, 'manifest.json')));
    return records.length ? { dir, settings, records, count: records.length } : null;
  }

  /** Copy the standalone plugin's extensions (files, enabled state, pins) into Surfing. */
  async importLegacy(): Promise<void> {
    if (this.legacyPluginEnabled()) throw new Error(this.unavailableReason());
    const legacy = this.legacyImport();
    if (!legacy) return;
    for (const rec of legacy.records) {
      const dest = path.join(this.root, 'extensions', rec.key);
      if (!isManagedFolder(this.root, dest)) continue;
      await fs.promises.cp(path.join(legacy.dir, 'extensions', rec.key), dest, { recursive: true, errorOnExist: false, force: false });
      this.settings.extensions.push({ ...rec });
    }
    if (Array.isArray(legacy.settings.pinned)) {
      const keys = legacy.records.map(r => r.key);
      this.settings.pinned = [...(this.settings.pinned ?? []), ...legacy.settings.pinned.filter(k => keys.includes(k))];
    }
    await this.saveSettings();
    if (this.target) await this.restore();
    else this.refreshUI();
    notify(tr('notice.imported', { count: legacy.count }));
  }

  async handleRequest(channel: ExtensionChannel, method: HostMethod, params: unknown): Promise<unknown> {
    const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
    switch (method) {
      case 'webNavigation.getAllFrames': {
        if (!channel.capabilities.webNavigation) throw new Error(tr('error.noPermission', { permission: 'webNavigation' }));
        const contents = this.guestContents(p.tabId);
        return contents ? framesOfWebContents(contents) : null;
      }
      case 'tabs.open': {
        const url = typeof p.url === 'string' && p.url.length <= 8192 ? p.url : '';
        const active = p.active !== false;
        const reason = text(p.reason, 'tabs.create') as OpenReason;
        let parsed: URL;
        try { parsed = new URL(url); } catch { throw new Error(tr('error.invalidUrl')); }
        const now = Date.now();
        const recent = (this.opened.get(channel.id) ?? []).filter(t => now - t < OPEN_LIMIT.windowMs);
        if (recent.length >= OPEN_LIMIT.count) throw new Error(tr('error.openTooOften'));
        recent.push(now);
        this.opened.set(channel.id, recent);
        if (active) { this.activePopover?.close(); this.activePanel?.close(); }
        if (parsed.protocol === 'chrome-extension:') {
          // An extension may only open its own pages.
          if (parsed.hostname !== channel.id) throw new Error(tr('error.openOwnPagesOnly'));
          return { tabId: await this.openExtensionTab(parsed.href, active) };
        }
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.href === 'about:blank') {
          if (this.settings.debug) console.debug('[Surfing] open', reason, parsed.href);
          return { tabId: await this.openBrowserTab(parsed.href, active) };
        }
        throw new Error(tr('error.cannotOpenScheme', { protocol: parsed.protocol }));
      }
      case 'popup.targetTab': {
        const popover = this.activePopover;
        return { tabId: popover && popover.kind === 'popup' && popover.rec.id === channel.id ? popover.targetTab : null };
      }
      case 'tabs.activeTab': {
        // While a popup is open, its page is the one the user is acting on.
        const popupTab = this.activePopover?.kind === 'popup' ? this.activePopover.targetTab : null;
        if (popupTab !== null) return { tabId: popupTab };
        let tabId: number | null = null;
        try { tabId = this.activeWebview()?.getWebContentsId() ?? null; } catch { /* best effort */ }
        return { tabId: Number.isSafeInteger(tabId) ? tabId : null };
      }
      case 'userScripts.syncFiles':
      case 'userScripts.writeFiles': {
        const rec = this.settings.extensions.find(r => r.id === channel.id && r.enabled);
        if (!rec || !this.getManifest(rec)?.permissions?.includes('userScripts')) throw new Error(tr('error.noPermission', { permission: 'userScripts' }));
        return method === 'userScripts.syncFiles' ? this.syncUserScriptFiles(rec, p) : this.writeUserScriptFiles(rec, p);
      }
      case 'userScripts.pageExec': {
        const rec = this.settings.extensions.find(r => r.id === channel.id && r.enabled);
        if (!rec || !this.getManifest(rec)?.permissions?.includes('userScripts')) throw new Error(tr('error.noPermission', { permission: 'userScripts' }));
        return { event: this.pageExec };
      }
      case 'tabs.remove': {
        const ids = (Array.isArray(p.tabIds) ? p.tabIds : []).filter((id): id is number => Number.isSafeInteger(id));
        let removed = 0;
        for (const id of ids) {
          const leaf = this.leafForTab(id, channel.id);
          if (leaf) { leaf.detach(); removed++; }
        }
        return { removed };
      }
      case 'tabs.activate': {
        const leaf = Number.isSafeInteger(p.tabId) ? this.leafForTab(p.tabId as number, channel.id) : null;
        if (leaf) this.app.workspace.setActiveLeaf(leaf, { focus: true });
        return { activated: !!leaf };
      }
      case 'action.openPopup': {
        const rec = this.settings.extensions.find(r => r.id === channel.id && r.enabled);
        const webview = this.activeWebview();
        let tabId: number | null = null;
        try { tabId = webview?.getWebContentsId() ?? null; } catch { /* best effort */ }
        if (!rec || !this.popupFor(rec, tabId)) return { opened: false };
        if (this.activePopover?.rec.id === rec.id && this.activePopover.isOpen) return { opened: true };
        this.openPopup(rec, this.actionAnchor(rec.id, webview), webview);
        return { opened: !!this.activePopover?.isOpen };
      }
      case 'notifications.show':
      case 'notifications.clear':
      case 'notifications.getAll': {
        if (!channel.capabilities.notifications) throw new Error(tr('error.noPermission', { permission: 'notifications' }));
        if (method === 'notifications.getAll') return { ids: this.notifications.ids(channel.id) };
        const id = typeof p.id === 'string' && p.id.length <= 500 ? p.id : null;
        if (id === null) throw new Error('Invalid notification ID.');
        if (method === 'notifications.clear') return { cleared: this.notifications.clear(channel.id, id) };
        return { shown: this.notifications.show(channel.id, channel.name, id, p.options, p.update === true) };
      }
      case 'tabs.history': {
        const tabId = p.tabId === null || p.tabId === undefined ? this.activeTabId() : p.tabId;
        const history = this.guestContents(tabId)?.navigationHistory;
        if (!history) throw new Error(`No tab with id: ${text(tabId, 'none')}.`);
        const back = p.delta === -1;
        if (!history || !(back ? history.canGoBack() : history.canGoForward())) throw new Error('Cannot find a next page in history.');
        if (back) history.goBack(); else history.goForward();
        return { moved: true };
      }
      case 'tabs.capture': {
        const contents = this.guestContents(this.activeTabId());
        if (!contents) throw new Error('No active web page to capture.');
        const url = contents.getURL();
        // Chrome: <all_urls>, or activeTab (granted by invoking the extension).
        const caps = channel.capabilities;
        if (!(caps.hosts.includes('<all_urls>') || caps.activeTab || hasHostAccess(caps, url))) {
          throw new Error("Either the '<all_urls>' or 'activeTab' permission is required.");
        }
        const now = Date.now();
        const recent = (this.captures.get(channel.id) ?? []).filter(t => now - t < 1000);
        if (recent.length >= CAPTURE_PER_SECOND) throw new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.');
        this.captures.set(channel.id, [...recent, now]);
        const image = await contents.capturePage();
        if (p.format === 'png') return { dataUrl: image.toDataURL() };
        const quality = typeof p.quality === 'number' && Number.isInteger(p.quality) && p.quality >= 0 && p.quality <= 100 ? p.quality : 92;
        return { dataUrl: 'data:image/jpeg;base64,' + image.toJPEG(quality).toString('base64') };
      }
      case 'commands.shortcuts':
        return this.commandShortcuts(channel);
      case 'cookies.get':
        return getCookie(this.session().cookies, channel.capabilities, p);
      case 'cookies.getAll':
        return getAllCookies(this.session().cookies, channel.capabilities, p);
      case 'cookies.set':
        return setCookie(this.session().cookies, channel.capabilities, p);
      case 'cookies.remove':
        return removeCookie(this.session().cookies, channel.capabilities, p);
      case 'runtime.openOptionsPage': {
        const rec = this.settings.extensions.find(r => r.id === channel.id);
        if (!rec) throw new Error(tr('error.extensionNotFound'));
        return { tabId: await this.openOptions(rec, null) };
      }
      default:
        throw new Error(tr('error.unsupportedRequest', { method: String(method) }));
    }
  }

  /** The webContents of a Web Viewer tab (never of Obsidian or of extension pages). */
  guestContents(tabId: unknown): Electron.WebContents | null {
    if (typeof tabId !== 'number' || !Number.isSafeInteger(tabId) || !this.tracker?.isBrowserTab(tabId)) return null;
    return this.remote?.webContents.fromId(tabId) ?? null;
  }

  /** The Web Viewer tab the user is on (a popup's target tab while one is open). */
  private activeTabId(): number | null {
    const popupTab = this.activePopover?.kind === 'popup' ? this.activePopover.targetTab : null;
    if (popupTab !== null) return popupTab;
    try {
      const id = this.activeWebview()?.getWebContentsId();
      return Number.isSafeInteger(id) ? id as number : null;
    } catch { return null; }
  }

  /** The Obsidian tab showing a webContents: any Web Viewer, or one of this extension's own pages. */
  private leafForTab(tabId: number, extensionId: string): WorkspaceLeaf | null {
    const id = (webview: WebviewTag | null | undefined) => { try { return webview?.getWebContentsId(); } catch { return undefined; } };
    const target = this.target;
    for (const leaf of target ? this.app.workspace.getLeavesOfType(target.viewType) : []) {
      if (id(target!.webviewOf(leaf.view)) === tabId) return leaf;
    }
    for (const leaf of this.app.workspace.getLeavesOfType(EXTENSION_PAGE_VIEW)) {
      const view = leaf.view as ExtensionPageView;
      if (id(view.webview) === tabId && this.recordForUrl(text(view.getState().url))?.id === extensionId) return leaf;
    }
    return null;
  }

  // ---- Generated user-script files ----------------------------------------
  // Only content-addressed files (SHA-256 of the code) in the extension's own
  // __obsidian_bridge_us/ folder; the extension never chooses a path.

  private userScriptDir(rec: ExtensionRecord): string {
    const dir = path.join(this.dirOf(rec), USER_SCRIPT_DIR);
    if (!isManagedFolder(this.root, dir)) throw new Error(tr('error.invalidExtensionDir'));
    return dir;
  }

  private syncUserScriptFiles(rec: ExtensionRecord, p: Record<string, unknown>): { missing: string[] } {
    const keep = new Set((Array.isArray(p.keep) ? p.keep : []).filter((h): h is string => typeof h === 'string' && SHA256.test(h)));
    const dir = this.userScriptDir(rec);
    fs.mkdirSync(dir, { recursive: true });
    const present = new Set<string>();
    for (const name of fs.readdirSync(dir)) {
      const hash = name.replace(/\.js$/, '');
      if (name.endsWith('.js') && keep.has(hash)) { present.add(hash); continue; }
      if (p.prune === true) fs.rmSync(path.join(dir, name), { force: true });
    }
    return { missing: [...keep].filter(h => !present.has(h)) };
  }

  private async writeUserScriptFiles(rec: ExtensionRecord, p: Record<string, unknown>): Promise<{ written: number }> {
    const dir = this.userScriptDir(rec);
    fs.mkdirSync(dir, { recursive: true });
    let used = 0;
    for (const name of fs.readdirSync(dir)) used += fs.statSync(path.join(dir, name)).size;
    let written = 0;
    for (const file of Array.isArray(p.files) ? p.files as unknown[] : []) {
      const { hash, code } = (file && typeof file === 'object' ? file : {}) as { hash?: unknown; code?: unknown };
      if (typeof hash !== 'string' || !SHA256.test(hash) || typeof code !== 'string') throw new Error(tr('error.invalidUserScript'));
      const bytes = Buffer.byteLength(code, 'utf8');
      if (bytes > USER_SCRIPT_FILE_MAX || used + bytes > USER_SCRIPT_DIR_MAX) throw new Error(tr('error.userScriptTooLarge'));
      if (crypto.createHash('sha256').update(code, 'utf8').digest('hex') !== hash) throw new Error(tr('error.userScriptChecksum'));
      await fs.promises.writeFile(path.join(dir, hash + '.js'), code, 'utf8');
      used += bytes;
      written++;
    }
    return { written };
  }

  // ---- Lifecycle of extensions --------------------------------------------

  async withNotice(fn: () => unknown): Promise<void> {
    try { await fn(); } catch (e) { console.error('[Surfing]', e); notify(shortError(e), 10000); }
  }

  async restore(): Promise<void> {
    if (!this.target || !this.remote) return;
    const ses = this.session();
    for (const rec of this.settings.extensions) {
      if (!rec.enabled) continue;
      const dir = this.dirOf(rec);
      try {
        if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error(tr('error.extensionDirMissing'));
        const currentlyLoaded = ses.extensions.getExtension(rec.id);
        const state = this.extensionCompatStatus(rec);
        const needsMigration = (this.settings.compatibilityEnabled !== false) !== state.applied ||
          (state.applied && state.version !== WRAPPER_VERSION);
        if (currentlyLoaded && needsMigration) ses.extensions.removeExtension(rec.id);
        if (!currentlyLoaded || needsMigration) {
          this.prepareExtensionFolder(dir);
          rec.id = (await ses.extensions.loadExtension(dir)).id;
        }
        rec.name = this.getDisplayName(rec);
      } catch (e) { console.error('[Surfing] 恢复失败：' + rec.name, e); }
    }
    await this.saveSettings();
    this.refreshUI();
  }

  async setCompatibilityEnabled(enabled: boolean): Promise<void> {
    const ses = this.session();
    const previously = this.settings.compatibilityEnabled !== false;
    this.settings.compatibilityEnabled = !!enabled;
    if (previously === !!enabled) return;
    const errors: string[] = [];
    this.channels.sync([]);
    for (const rec of this.settings.extensions) {
      const dir = this.dirOf(rec);
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
      if (rec.id && ses.extensions.getExtension(rec.id)) ses.extensions.removeExtension(rec.id);
      try {
        this.prepareExtensionFolder(dir);
        if (rec.enabled) rec.id = (await ses.extensions.loadExtension(dir)).id;
      } catch (e) {
        errors.push(`${rec.name}: ${shortError(e)}`);
        console.error('[Surfing] 兼容层切换失败', e);
      }
    }
    await this.saveSettings();
    this.refreshUI();
    this.extensionsChanged(errors.length ? tr('changes.compatSwitchedWithErrors') : tr('changes.compatSwitched'));
    if (errors.length) throw new Error(errors.join('; '));
  }

  /** Report an extension change; reload pages automatically or offer to. */
  extensionsChanged(message: string): void {
    if (this.settings.autoReloadPages) {
      this.reloadGuestPages();
      notify(tr('changes.reloaded', { message }));
      return;
    }
    if (typeof window.createFragment !== 'function') { notify(tr('changes.reloadToApply', { message })); return; }
    let notice: Notice | null = null;
    const fragment = createFragment(f => {
      f.createSpan({ text: tr('changes.reloadToApplyNotice', { message }) });
      const button = f.createEl('button', { cls: 'mod-cta chrome-bridge-notice-button', text: tr('command.reloadPages') });
      button.addEventListener('click', () => { this.reloadGuestPages(); notice?.hide(); });
    });
    notice = new Notice(fragment, 10000);
  }

  reloadGuestPages(): void {
    const target = this.target;
    if (!target) return;
    for (const guest of document.querySelectorAll<WebviewTag>(target.webviewSelector)) {
      try { if (guest.getAttribute('partition') === target.partition) guest.reload(); }
      catch (e) { console.warn('[Surfing] 网页刷新失败', e); }
    }
  }

  /** The store opens in the browser extensions run in, whose header then offers "install". */
  async openStore(): Promise<void> {
    await this.withNotice(() => this.openBrowserTab(STORE_URL, true));
  }

  askStoreUrl(onDone?: () => void): void {
    new InputModal(this.app, tr('installUrl.title'), 'https://chromewebstore.google.com/detail/…',
      tr('installUrl.desc'), async value => {
        await this.withNotice(async () => {
          const id = getStoreId(value) || (STORE_ID.test(value) ? value : null);
          if (!id) throw new Error(tr('installUrl.invalid'));
          await this.installFromStore(id);
          onDone?.();
        });
      }).open();
  }

  askLocalPath(onDone?: () => void): void {
    new InputModal(this.app, tr('installLocal.title'), tr('installLocal.placeholder'),
      tr('installLocal.desc'), async value => {
        await this.withNotice(async () => { await this.installLocal(value); onDone?.(); });
      }).open();
  }

  async installFromStore(id: string, options: { force?: boolean; backgroundUpdate?: boolean } = {}): Promise<void> {
    if (this.installing.has(id)) { notify(tr('notice.installBusy')); return; }
    this.installing.add(id);
    try {
      await this.withNotice(async () => {
        if (!STORE_ID.test(id)) throw new Error(tr('error.invalidStoreId'));
        const ses = this.session();
        const version = /Chrome\/(\d+\.\d+\.\d+\.\d+)/.exec(text(ses.getUserAgent()))?.[1] ?? '142.0.0.0';
        const progress = options.backgroundUpdate ? null : new Notice(tr('notice.downloading'), 0);
        let buf: Buffer;
        try { buf = await downloadCrx(crxDownloadUrl(id, version)); } finally { progress?.hide(); }
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-crx-'));
        try {
          const archive = path.join(temp, 'download.crx');
          fs.writeFileSync(archive, buf);
          // Developer signature for this ID plus the store's publisher signature, as Chrome requires.
          const parsed = await unpackArchive({ archive, directory: path.join(temp, 'unpacked'), expectedId: id, requirePublisherProof: true });
          if (parsed.derivedId !== id) throw new Error(tr('error.signedIdMismatch'));
          const current = this.settings.extensions.find(x => x.source === 'store' && x.storeId === id);
          const displayName = String(localizedField(parsed.root, parsed.manifest, parsed.manifest.name, this.locale()));
          if (current && current.version === parsed.manifest.version && !options.force) {
            if (!options.backgroundUpdate) notify(tr('notice.upToDate', { name: displayName, version: current.version }));
            return;
          }
          let consent = true;
          if (current && options.backgroundUpdate) {
            const previous = this.getManifest(current);
            // Updates without permission changes install silently; new permissions need consent.
            if (previous && JSON.stringify(showPermissions(previous)) === JSON.stringify(showPermissions(parsed.manifest))) consent = false;
          }
          if (consent && !await new ConfirmInstallModal(this.app, parsed.manifest, current ? tr('install.updateTo', { version: parsed.manifest.version }) : tr('source.store'), displayName).openAndWait()) return;
          await this.installPrepared(parsed.root, parsed.manifest, { key: id, source: 'store', storeId: id, expectedId: id, previous: current });
          this.extensionsChanged(current ? tr('changes.updated', { name: displayName }) : tr('changes.added', { name: displayName }));
        } finally { fs.rmSync(temp, { recursive: true, force: true }); }
      });
    } finally { this.installing.delete(id); }
  }

  async installLocal(input: string): Promise<void> {
    const source = path.resolve(input.replace(/^"|"$/g, ''));
    if (!fs.existsSync(source)) throw new Error(tr('error.pathNotFound', { path: source }));
    let temporary: string | null = null, folder: string;
    try {
      if (fs.statSync(source).isDirectory()) {
        await rejectLinks(source);
        folder = source;
      } else {
        if (!/\.(zip|crx)$/i.test(source)) throw new Error(tr('error.unsupportedArchive'));
        temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-extension-local-'));
        folder = (await unpackArchive({ archive: source, directory: path.join(temporary, 'unpacked'), expectedId: null })).root;
      }
      const m = readManifest(folder);
      const displayName = String(localizedField(folder, m, m.name, this.locale()));
      if (!await new ConfirmInstallModal(this.app, m, tr('install.localSource', { path: source }), displayName).openAndWait()) return;
      await this.installPrepared(folder, m, { source: 'local', key: crypto.randomUUID() });
      this.extensionsChanged(tr('changes.added', { name: displayName }));
    } finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
  }

  async installPrepared(src: string, manifest: ChromeManifest, options: {
    key: string; source: 'store' | 'local'; storeId?: string; expectedId?: string; previous?: ExtensionRecord;
  }): Promise<void> {
    const ses = this.session();
    const key = options.key;
    if (!/^[a-z0-9_-]{1,64}$/i.test(key)) throw new Error(tr('error.invalidManagedKey'));
    const dest = path.join(this.root, 'extensions', key);
    const backup = dest + '.backup-' + crypto.randomUUID();
    const previous = options.previous || null;
    const previousLoaded = previous ? ses.extensions.getExtension(previous.id) : null;
    let backedUp = false, loaded: Electron.Extension | null = null;
    try {
      // Stop the previous version before loading a different copy with the same extension ID.
      if (previousLoaded) ses.extensions.removeExtension(previous!.id);
      if (fs.existsSync(dest)) { await fs.promises.rename(dest, backup); backedUp = true; }
      await fs.promises.cp(src, dest, { recursive: true, errorOnExist: true, force: false });
      readManifest(dest);
      this.prepareExtensionFolder(dest);
      loaded = await ses.extensions.loadExtension(dest);
      if (options.expectedId && loaded.id !== options.expectedId) {
        throw new Error(tr('error.loadedIdMismatch', { loaded: loaded.id, expected: options.expectedId }));
      }
      const record: ExtensionRecord = {
        key, source: options.source, storeId: options.storeId || null, id: loaded.id,
        name: String(localizedField(dest, manifest, manifest.name, this.locale())),
        version: manifest.version, enabled: true, installedAt: new Date().toISOString()
      };
      if (previous) Object.assign(previous, record);
      else this.settings.extensions.push(record);
      await this.saveSettings();
      if (backedUp) await fs.promises.rm(backup, { recursive: true, force: true });
      this.refreshUI();
      // Do not reload user pages automatically here; reloading can discard unsaved input.
    } catch (e) {
      if (loaded && ses.extensions.getExtension(loaded.id)) ses.extensions.removeExtension(loaded.id);
      if (fs.existsSync(dest)) await fs.promises.rm(dest, { recursive: true, force: true });
      if (backedUp && fs.existsSync(backup)) {
        await fs.promises.rename(backup, dest);
        if (previous?.enabled) {
          try { await ses.extensions.loadExtension(dest); } catch (rollbackError) { console.error('[Surfing] 回滚重新加载失败', rollbackError); }
        }
      }
      throw e;
    }
  }

  async toggle(key: string): Promise<void> {
    const rec = this.settings.extensions.find(x => x.key === key);
    if (!rec) throw new Error(tr('error.extensionNotFound'));
    const ses = this.session();
    if (rec.enabled) {
      if (ses.extensions.getExtension(rec.id)) ses.extensions.removeExtension(rec.id);
      this.notifications.forget(rec.id);
      rec.enabled = false;
    } else {
      const folder = this.dirOf(rec);
      this.prepareExtensionFolder(folder);
      rec.id = (await ses.extensions.loadExtension(folder)).id;
      rec.enabled = true;
    }
    await this.saveSettings();
    this.refreshUI();
    this.extensionsChanged(tr(rec.enabled ? 'changes.enabled' : 'changes.disabled', { name: this.getDisplayName(rec) }));
  }

  async uninstall(key: string): Promise<void> {
    const index = this.settings.extensions.findIndex(x => x.key === key);
    if (index < 0) return;
    const rec = this.settings.extensions[index];
    const ses = this.session();
    if (ses.extensions.getExtension(rec.id)) ses.extensions.removeExtension(rec.id);
    this.notifications.forget(rec.id);
    const target = this.dirOf(rec);
    if (!isManagedFolder(this.root, target)) throw new Error(tr('error.refuseDeleteOutside'));
    const name = this.getDisplayName(rec);
    await fs.promises.rm(target, { recursive: true, force: true });
    this.settings.extensions.splice(index, 1);
    if (Array.isArray(this.settings.pinned)) this.settings.pinned = this.settings.pinned.filter(k => k !== key);
    await this.saveSettings();
    this.refreshUI();
    this.extensionsChanged(tr('changes.uninstalled', { name }));
  }

  async checkUpdates(quiet = false): Promise<void> {
    const sources = this.settings.extensions.filter(x => x.enabled && x.source === 'store' && x.storeId);
    if (!sources.length) { if (!quiet) notify(tr('notice.noStoreExtensions')); return; }
    for (const rec of sources) {
      try { await this.installFromStore(rec.storeId!, { backgroundUpdate: true }); }
      catch (e) { console.error('[Surfing] 更新检查失败', e); }
    }
    if (!quiet) notify(tr('notice.updateCheckDone'));
  }

  // ---- Diagnostics -------------------------------------------------------

  async runProbe(anchor: Anchor = null): Promise<void> {
    const ses = this.session();
    const dir = path.join(this.root, 'compat-probe');
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error(tr('error.probeMissing'));
    let extension = ses.extensions.getAllExtensions().find(x => x.name === 'Bridge MV3 Probe');
    if (!extension) extension = await ses.extensions.loadExtension(dir);
    this.probeId = extension.id;
    const rec: ExtensionRecord = { key: '__probe__', source: 'local', storeId: null, id: extension.id, name: tr('settings.probe'), version: '0', enabled: true };
    this.activePopover?.close();
    this.activePopover = new ExtensionPopover(this, rec, 'popup.html', anchor).open();
  }

  async startExtensionWorker(id: string): Promise<unknown> {
    this.session();
    if (!this.compatRuntime) throw new Error(tr('error.workerRuntimeUnavailable'));
    return await this.compatRuntime.start(id);
  }

  async diagnose(): Promise<unknown> {
    const ses = this.session();
    const running = Object.values(ses.serviceWorkers.getAllRunning());
    return {
      surfingVersion: this.host.plugin.manifest.version,
      state: this.state,
      browser: this.target?.label ?? null,
      electron: process.versions.electron,
      partition: this.partition(),
      compatibilityEnabled: this.settings.compatibilityEnabled !== false,
      tabs: this.target ? document.querySelectorAll(this.target.webviewSelector).length : 0,
      extensions: this.settings.extensions.map(rec => {
        const channel = this.channels.get(rec.id);
        return {
          name: this.getDisplayName(rec), id: rec.id, version: rec.version, enabled: rec.enabled,
          loaded: !!ses.extensions.getExtension(rec.id),
          worker: running.filter(w => w.scope.startsWith(`chrome-extension://${rec.id}/`)),
          wrapper: this.extensionCompatStatus(rec),
          compat: this.compatRuntime?.latestCompatReport(rec.id) ?? null,
          channel: channel ? {
            capabilities: channel.capabilities,
            navigationListeners: channel.navigationListeners ? [...channel.navigationListeners] : null,
            contextMenuItems: channel.menuItems.length
          } : null
        };
      })
    };
  }
}
