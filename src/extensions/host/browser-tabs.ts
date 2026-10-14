// Integrates with the browser tabs extensions run in (Web Viewer or Surfing):
//  - header buttons through the view's own addAction (puzzle menu, pinned
//    extensions, and "install" on Chrome Web Store detail pages);
//  - webNavigation events from each tab's <webview>;
//  - extension context menu items merged into Web Viewer's native page
//    context menu (Surfing asks for them while building its own menu).
import { Component, View } from 'obsidian';
import type ChromeExtensionsBridge from '../bridge';
import type { WebviewTag } from '../types';
import type { BrowserTarget } from './targets';
import { NavigationObserver, remoteFrameResolver } from './navigation';
import { onWebview } from './webview-events';
import { TabObserver } from './tab-events';
import { ContextParams, electronTemplate } from './context-menu';
import { getStoreId } from '../install/store';
import { renderActionButton } from '../ui/action-button';
import { tr } from '../i18n/strings';
import type * as Electron from 'electron';

const NAV_EVENTS = ['dom-ready', 'did-navigate', 'did-navigate-in-page'];

interface WebViewerLike extends View {
  addAction(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement;
}

interface ViewState {
  view: WebViewerLike;
  webview: WebviewTag;
  actions: HTMLElement[];
  storeAction: HTMLElement | null;
  storeBusy: boolean;
  navigation: NavigationObserver;
  tabs: TabObserver;
  detach: Array<() => void>;
  /** Recent declarativeNetRequest redirects, to stop redirect loops. */
  redirects: Array<{ from: string; to: string; at: number; cleaned?: boolean }>;
  /** A redirect waiting for its original navigation to commit (then replaced in place). */
  pendingRedirect: { from: string; to: string } | null;
}

export class BrowserTabTracker extends Component {
  private states = new Map<WebViewerLike, ViewState>();
  private scheduled: number | null = null;
  private observer: MutationObserver | null = null;
  /** The tab the user was last on, even after focusing a note. */
  private lastActive: WebViewerLike | null = null;
  /** After the first sync, newly attached views are newly opened tabs (onCreated). */
  private ready = false;
  private disposed = false;

  constructor(private plugin: ChromeExtensionsBridge, readonly target: BrowserTarget) { super(); }

  onload(): void {
    const { workspace } = this.plugin.app;
    const selector = this.target.webviewSelector;
    this.registerEvent(workspace.on('layout-change', () => this.schedule()));
    this.registerEvent(workspace.on('active-leaf-change', leaf => {
      if (leaf?.view?.getViewType?.() === this.target.viewType) {
        this.lastActive = leaf.view as WebViewerLike;
        const tab = this.states.get(this.lastActive)?.tabs.fields();
        if (tab && this.plugin.wantsTabEvents()) this.plugin.deliverTabEvent('onActivated', { ...tab, active: true });
      }
      this.schedule();
    }));
    // Both browsers re-create their <webview> without a layout change (e.g.
    // after a crash or when a deferred tab loads); watch for new webviews too.
    this.observer = new MutationObserver(records => {
      if (records.some(r => [...r.addedNodes].some(n => n.instanceOf(HTMLElement) &&
        (n.matches(selector) || !!n.querySelector?.(selector))))) this.schedule();
    });
    this.observer.observe(workspace.containerEl, { childList: true, subtree: true });
    workspace.onLayoutReady(() => { if (!this.disposed) this.sync(); });
  }

  schedule(): void {
    if (this.scheduled !== null) return;
    this.scheduled = window.setTimeout(() => { this.scheduled = null; this.sync(); }, 60);
  }

  /** Attach to every loaded tab; detach from closed ones. */
  sync(): void {
    const live = new Set<WebViewerLike>();
    for (const leaf of this.plugin.app.workspace.getLeavesOfType(this.target.viewType)) {
      const view = leaf.view as WebViewerLike;
      // Deferred (not yet loaded) tabs have no webview or addAction yet.
      if (typeof view?.addAction !== 'function') continue;
      const webview = this.target.webviewOf(view);
      // Only tabs in the extensions' session (not an isolated Surfing session).
      if (!webview || webview.getAttribute('partition') !== this.target.partition) continue;
      live.add(view);
      const state = this.states.get(view);
      if (state && state.webview === webview && state.actions.every(a => a.isConnected)) continue;
      const previousTab = state?.tabs.tabId ?? null;
      if (state) this.teardown(state);
      const attached = this.attach(view, webview);
      const tab = attached.tabs.fields();
      // A re-created <webview> is a new webContents: report it like a replaced tab.
      if (this.ready && tab && this.plugin.wantsTabEvents() && tab.id !== previousTab) {
        if (previousTab !== null) this.removed(previousTab);
        this.plugin.deliverTabEvent('onCreated', tab);
      }
    }
    for (const [view, state] of this.states) {
      if (live.has(view)) continue;
      const tabId = state.tabs.tabId;
      this.teardown(state);
      this.states.delete(view);
      if (tabId !== null) this.removed(tabId);
    }
    this.ready = true;
  }

  private removed(tabId: number): void {
    this.plugin.forgetTab(tabId);
    if (this.plugin.wantsTabEvents()) this.plugin.deliverTabEvent('onRemoved', { id: tabId }, { removeInfo: { windowId: -1, isWindowClosing: false } });
  }

  /** Rebuild header buttons after extensions or pins change. */
  refreshActions(): void {
    for (const state of this.states.values()) this.buildActions(state);
  }

  /** Redraw pinned buttons (icon, badge, title) after chrome.action changes. */
  refreshActionVisuals(extensionId?: string): void {
    for (const state of this.states.values()) {
      const tabId = this.tabIdOf(state.webview);
      for (const button of state.actions) {
        const id = button.dataset.extensionId;
        if (!id || (extensionId && id !== extensionId)) continue;
        const rec = this.plugin.settings.extensions.find(r => r.id === id);
        if (rec) renderActionButton(button, this.plugin.actionView(rec, tabId));
      }
    }
  }

  private tabIdOf(webview: WebviewTag): number | null {
    try { const id = webview.getWebContentsId(); return Number.isSafeInteger(id) ? id : null; } catch { return null; }
  }

  /** The <webview> of the most recently active tab. */
  activeWebview(): WebviewTag | null {
    const leaf = this.plugin.app.workspace.getMostRecentLeaf();
    const state = (leaf ? this.states.get(leaf.view as WebViewerLike) : undefined) ??
      (this.lastActive ? this.states.get(this.lastActive) : undefined);
    return state?.webview ?? [...this.states.values()][0]?.webview ?? null;
  }

  /** The header puzzle button of a tab, to anchor the panel. */
  puzzleButton(webview: WebviewTag | null): HTMLElement | null {
    for (const state of this.states.values()) if (!webview || state.webview === webview) return state.actions[0] ?? null;
    return null;
  }

  /** The pinned button of an extension in a tab header (else its puzzle button). */
  actionAnchor(extensionId: string, webview: WebviewTag | null): HTMLElement | null {
    for (const state of this.states.values()) {
      if (webview && state.webview !== webview) continue;
      return state.actions.find(a => a.dataset.extensionId === extensionId && a.isConnected) ?? state.actions[0] ?? null;
    }
    return null;
  }

  /** Is this webContents ID one of the browser tabs we track? */
  isBrowserTab(tabId: number): boolean {
    for (const state of this.states.values()) {
      try { if (state.webview.getWebContentsId() === tabId) return true; } catch { /* best effort */ }
    }
    return false;
  }

  private attach(view: WebViewerLike, webview: WebviewTag): ViewState {
    const state: ViewState = {
      view, webview, actions: [], storeAction: null, storeBusy: false, detach: [], redirects: [], pendingRedirect: null,
      tabs: new TabObserver(webview, (event, tab, extra) => this.plugin.deliverTabEvent(event, tab, extra),
        () => this.plugin.wantsTabEvents(), () => this.lastActive === view),
      navigation: new NavigationObserver(webview, remoteFrameResolver(this.plugin.remote),
        (event, details) => this.plugin.deliverNavigation(event, details),
        () => this.plugin.wantsNavigation())
    };
    this.states.set(view, state);
    this.buildActions(state);

    const onNavigate = () => this.updateStoreAction(state);
    for (const name of NAV_EVENTS) webview.addEventListener(name, onNavigate);
    state.detach.push(() => { for (const name of NAV_EVENTS) webview.removeEventListener(name, onNavigate); });
    this.updateStoreAction(state);

    state.detach.push(onWebview(webview, 'did-start-navigation', event => {
      if (!event.isMainFrame || event.isInPlace || typeof event.url !== 'string') return;
      this.applyNetRequest(state, event.url);
    }));
    // Chrome redirects before commit, so the original URL never enters history.
    // Ours may commit first: drop it once the target commits, or history.back()
    // (Tampermonkey after an install) would redirect straight back again.
    let historyLength = 0;
    state.detach.push(onWebview(webview, 'did-navigate', event => {
      const pending = state.pendingRedirect;
      if (pending && event.url === pending.from) {
        // Replace the committed original in place: no extra history entry,
        // and the page's own history.length stays right (unlike removing
        // entries afterwards). A lone blank placeholder before it goes too, so
        // a new tab ends with one entry, like a new Chrome tab.
        state.pendingRedirect = null;
        this.dropPlaceholder(state.webview);
        state.webview.executeJavaScript(`location.replace(${JSON.stringify(pending.to)})`)
          .catch(() => state.webview.loadURL(pending.to).catch(() => undefined));
        return;
      }
      const hit = state.redirects.find(r => r.to === event.url && !r.cleaned);
      if (hit) {
        hit.cleaned = true;
        this.dropHistoryEntry(state.webview, hit.from);
      }
      // Remembered now: when window.close() fires the guest may already be gone.
      try { historyLength = this.plugin.remote?.webContents.fromId(state.webview.getWebContentsId())?.navigationHistory.length() ?? 0; } catch { /* best effort */ }
    }));
    // The original never committed (download, error): navigate to the target.
    state.detach.push(onWebview(webview, 'did-fail-load', event => {
      const pending = state.pendingRedirect;
      if (!pending || !event.isMainFrame || event.validatedURL !== pending.from) return;
      state.pendingRedirect = null;
      void state.webview.loadURL(pending.to).catch(() => undefined);
    }));
    // window.close(): Chrome lets scripts close a tab whose history has a single
    // entry (e.g. Tampermonkey after installing from a new tab).
    const onClose = () => {
      if (historyLength === 1) view.leaf.detach();
    };
    webview.addEventListener('close', onClose);
    state.detach.push(() => webview.removeEventListener('close', onClose));

    // Capture phase on an ancestor runs before Obsidian's own handler on the
    // webview, which builds its menu synchronously from a template.
    if (this.target.nativePageMenu) state.detach.push(onWebview(view.containerEl, 'context-menu', event => {
      if (event.target !== state.webview) return;
      this.extendNextMenu(event.params ?? {}, state.webview);
    }, true));
    return state;
  }

  private teardown(state: ViewState): void {
    state.navigation.dispose();
    state.tabs.dispose();
    for (const off of state.detach.splice(0)) off();
    for (const el of state.actions) el.remove();
    state.actions = [];
    state.storeAction?.remove();
    state.storeAction = null;
  }

  private buildActions(state: ViewState): void {
    for (const el of state.actions) el.remove();
    state.actions = [];
    const { view } = state;
    // addAction prepends, so add right-to-left: puzzle, then pins reversed.
    const puzzle = view.addAction('puzzle', tr('toolbar.extensions'), () => this.plugin.togglePanel(puzzle, state.webview));
    puzzle.addClass('chrome-bridge-action');
    state.actions.push(puzzle);
    for (const rec of [...this.plugin.pinnedRecords()].reverse()) {
      const name = this.plugin.getDisplayName(rec);
      const button = view.addAction('puzzle', name, () => this.plugin.activateExtension(rec, button, state.webview));
      button.addClass('chrome-bridge-action', 'chrome-bridge-pinned');
      button.dataset.extensionId = rec.id;
      renderActionButton(button, this.plugin.actionView(rec, this.tabIdOf(state.webview)));
      button.addEventListener('contextmenu', e => { e.preventDefault(); this.plugin.showExtensionMenu(rec, e, state.webview); });
      state.actions.push(button);
    }
    // Re-add the store button last so it stays leftmost.
    if (state.storeAction && !state.storeBusy) {
      state.storeAction.remove();
      state.storeAction = null;
      this.updateStoreAction(state);
    }
  }

  private currentUrl(webview: WebviewTag): string {
    try { return webview.getURL() || webview.getAttribute('src') || ''; } catch { return webview.getAttribute('src') || ''; }
  }

  private updateStoreAction(state: ViewState): void {
    if (state.storeBusy) return;
    const id = getStoreId(this.currentUrl(state.webview));
    if (!id) { state.storeAction?.remove(); state.storeAction = null; return; }
    const installed = this.plugin.settings.extensions.some(x => x.source === 'store' && x.storeId === id);
    const title = installed ? tr('store.installedCheck') : tr('store.install');
    if (state.storeAction?.isConnected && state.storeAction.dataset.storeId === id && state.storeAction.dataset.installed === String(installed)) return;
    state.storeAction?.remove();
    const action = state.view.addAction(installed ? 'refresh-cw' : 'download', title, async () => {
      if (state.storeBusy) return;
      state.storeBusy = true;
      action.addClass('is-busy');
      action.setAttribute('aria-disabled', 'true');
      try { await this.plugin.installFromStore(id); }
      finally {
        state.storeBusy = false;
        action.removeClass('is-busy');
        action.removeAttribute('aria-disabled');
        state.storeAction?.remove();
        state.storeAction = null;
        this.updateStoreAction(state);
      }
    });
    action.addClass('chrome-bridge-action', 'chrome-bridge-store-action', 'mod-cta');
    action.createSpan({ cls: 'chrome-bridge-store-label', text: installed ? tr('store.installed') : tr('store.install') });
    action.dataset.storeId = id;
    action.dataset.installed = String(installed);
    state.storeAction = action;
  }

  /** Drop Obsidian's blank new-tab placeholder when it is the only earlier entry. */
  private dropPlaceholder(webview: WebviewTag): void {
    try {
      const history = this.plugin.remote?.webContents?.fromId?.(webview.getWebContentsId())?.navigationHistory;
      if (!history || typeof history.removeEntryAtIndex !== 'function' || history.getActiveIndex() !== 1) return;
      const first = history.getEntryAtIndex(0)?.url || '';
      if (first === 'data:text/plain,' || first === 'data:text/plain') history.removeEntryAtIndex(0);
    } catch (e) { console.warn('[Chrome Bridge] history cleanup:', e); }
  }

  private dropHistoryEntry(webview: WebviewTag, url: string): void {
    try {
      const history = this.plugin.remote?.webContents?.fromId?.(webview.getWebContentsId())?.navigationHistory;
      if (!history || typeof history.removeEntryAtIndex !== 'function') return;
      let active = history.getActiveIndex();
      for (let i = active - 1; i >= Math.max(0, active - 2); i--) {
        if (history.getEntryAtIndex(i)?.url === url) { history.removeEntryAtIndex(i); active--; break; }
      }
      // A new Web Viewer tab starts on a blank data: placeholder that pages cannot
      // navigate back to; without it the tab has one entry, as a new Chrome tab
      // would (so history.back()/window.close() logic behaves like Chrome).
      const first = history.getEntryAtIndex(0)?.url || '';
      if (active === 1 && (first === 'data:text/plain,' || first === 'data:text/plain')) history.removeEntryAtIndex(0);
    } catch (e) { console.warn('[Chrome Bridge] history cleanup:', e); }
  }

  /** Extension declarativeNetRequest rules for a top-level navigation. */
  private applyNetRequest(state: ViewState, url: string): void {
    if (!/^(https?|ftp|file):/i.test(url)) return;
    let tabId: number;
    try { tabId = state.webview.getWebContentsId(); } catch { return; }
    const now = Date.now();
    state.redirects = state.redirects.filter(r => now - r.at < 5000);
    const result = this.plugin.netRequestDecision(url, tabId);
    if (!result) return;
    const { decision, extension } = result;
    if (decision.kind === 'block') {
      state.webview.stop();
      this.plugin.notifyBlocked(extension, url);
    } else if (decision.kind === 'redirect' && decision.url !== url) {
      // Never re-redirect our own target, and give up on chains (like Chrome).
      if (state.redirects.some(r => r.to === url) || state.redirects.length >= 3) return;
      state.redirects.push({ from: url, to: decision.url, at: now });
      if (/^https?:/i.test(decision.url)) {
        // A page may navigate itself to a web URL: replace once the original commits.
        state.pendingRedirect = { from: url, to: decision.url };
      } else {
        // Extension pages need a browser-initiated load; history is cleaned on commit.
        state.webview.stop();
        window.setTimeout(() => { void state.webview.loadURL(decision.url).catch(() => undefined); }, 0);
      }
    }
  }

  /** Append extension items to the Electron menu Obsidian is about to build. */
  private extendNextMenu(params: ContextParams, webview: WebviewTag): void {
    let tabId: number | null = null;
    try { tabId = webview.getWebContentsId(); } catch { /* best effort */ }
    const template = electronTemplate(this.plugin.menuSources(tabId), params);
    const Menu = this.plugin.remote?.Menu;
    if (!template.length || !Menu || typeof Menu.buildFromTemplate !== 'function') return;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- put back verbatim after one use; the one call passes Menu as `this`
    const original = Menu.buildFromTemplate;
    let restored = false;
    const restore = () => { if (!restored) { restored = true; Menu.buildFromTemplate = original; } };
    Menu.buildFromTemplate = function (this: unknown, items: Array<Electron.MenuItemConstructorOptions | Electron.MenuItem>) {
      restore();
      const merged = Array.isArray(items) ? [...items, ...(items.length ? [{ type: 'separator' as const }] : []), ...template] : items;
      return original.call(Menu, merged);
    };
    // Obsidian builds the menu synchronously in this same event dispatch.
    window.setTimeout(restore, 0);
  }

  onunload(): void {
    this.disposed = true;
    if (this.scheduled !== null) window.clearTimeout(this.scheduled);
    this.observer?.disconnect();
    for (const state of this.states.values()) this.teardown(state);
    this.states.clear();
  }
}
