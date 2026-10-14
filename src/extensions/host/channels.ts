// Host end of the extension channel (see shared/protocol.ts). Each extension
// that needs host-delivered events gets one hidden <webview> showing its own
// Bridge-generated page in the Web Viewer session. Messages to the extension
// go through executeJavaScript on that page; messages back arrive as its
// console output. Everything received is untrusted and validated here.
import {
  CONSOLE_PREFIX, ExtensionToHost, HOST_PAGE, HOST_SCRIPT, HostMethod, HostToExtension,
  MenuItem, TAB_EVENTS, TabEvent, WEB_NAVIGATION_EVENTS, WebNavigationEvent
} from '../shared/protocol';
import type { WebviewTag } from '../types';
import type { NetRule } from '../shared/net-request';
import { ChannelCapabilities, sameCapabilities, sanitizeNetRules } from './grants';
import { ActionState, sanitizeActionProps } from './action-state';

export type { ChannelCapabilities } from './grants';

const READY_TIMEOUT_MS = 8000;
const MAX_MENU_ITEMS = 500;
const MAX_NET_RULES = 5000;
const MAX_MENU_TITLE = 300;

export interface ChannelHost {
  partition(): string;
  /** Start (or keep) the extension's service worker so it can receive a message. */
  wakeWorker(id: string): Promise<void>;
  /** Answer an extension request; `params` is untrusted and must be validated. */
  handleRequest(channel: ExtensionChannel, method: HostMethod, params: unknown): Promise<unknown>;
  /** Called when an extension's context menu items change. */
  menusChanged(): void;
  /** Called when an extension's chrome.action state changes. */
  actionChanged(id: string): void;
  /** Called when an extension starts or stops listening to cookies.onChanged. */
  cookieListenersChanged(): void;
  debug(): boolean;
}

export class ExtensionChannel {
  private webview: WebviewTag | null = null;
  private ready: Promise<boolean> | null = null;
  private resolveReady: ((ok: boolean) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  /** Which webNavigation events the worker listens to; null = unknown, send all. */
  navigationListeners: Set<WebNavigationEvent> | null = null;
  /** Which chrome.tabs events the worker listens to; null = unknown, send all. */
  tabListeners: Set<TabEvent> | null = null;
  menuItems: MenuItem[] = [];
  /** declarativeNetRequest rules that can match top-level navigations. */
  netRules: NetRule[] = [];
  /** What the toolbar button shows (chrome.action). */
  readonly action = new ActionState();
  /** Whether cookies.onChanged has listeners. */
  cookieListeners = false;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly capabilities: ChannelCapabilities,
    private host: ChannelHost,
    private container: HTMLElement
  ) {}

  private connect(): Promise<boolean> {
    if (this.ready) return this.ready;
    const webview = document.createElement('webview');
    webview.className = 'chrome-bridge-channel';
    webview.setAttribute('partition', this.host.partition());
    webview.setAttribute('src', `chrome-extension://${this.id}/${HOST_PAGE}`);
    webview.setAttribute('aria-hidden', 'true');
    webview.tabIndex = -1;
    const scriptUrl = `chrome-extension://${this.id}/${HOST_SCRIPT}`;
    webview.addEventListener('console-message', event => {
      const message = event.message || '';
      if (!message.startsWith(CONSOLE_PREFIX)) return;
      // Only the Bridge script prints protocol lines; ignore anything else.
      if (event.sourceId && !event.sourceId.startsWith(scriptUrl)) return;
      let data: unknown;
      try { data = JSON.parse(message.slice(CONSOLE_PREFIX.length)); } catch { return; }
      this.receive(data);
    });
    webview.addEventListener('did-fail-load', event => {
      if (event.errorCode === -3) return;
      console.warn('[Chrome Bridge] 扩展通道页面加载失败', this.name, event.errorCode, event.errorDescription);
      this.resolveReady?.(false);
    });
    // A crashed or destroyed page reconnects on the next send.
    const reset = () => { if (this.webview === webview) { this.webview = null; this.ready = null; webview.remove(); } };
    webview.addEventListener('render-process-gone', reset);
    webview.addEventListener('destroyed', reset);
    this.webview = webview;
    this.ready = new Promise<boolean>(resolve => {
      const timer = window.setTimeout(() => resolve(false), READY_TIMEOUT_MS);
      this.resolveReady = ok => { window.clearTimeout(timer); resolve(ok); };
    });
    this.container.appendChild(webview);
    return this.ready;
  }

  /** Open the channel and ask the worker to announce its listeners and menus. */
  async start(): Promise<void> {
    if (await this.connect()) await this.send({ type: 'bridge.sync' });
  }

  private receive(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const message = data as ExtensionToHost;
    switch (message.type) {
      case 'bridge.ready':
        this.resolveReady?.(true);
        break;
      case 'webNavigation.listeners': {
        if (!Array.isArray(message.events)) return;
        this.navigationListeners = new Set(message.events.filter((e): e is WebNavigationEvent =>
          (WEB_NAVIGATION_EVENTS as readonly string[]).includes(e)));
        break;
      }
      case 'request': {
        const { requestId, method, params } = message;
        if (typeof requestId !== 'string' || requestId.length > 100 || typeof method !== 'string') return;
        // The requester is running and waiting; answering needs no wake.
        this.host.handleRequest(this, method, params).then(
          result => this.send({ type: 'response', requestId, result }, false),
          error => this.send({ type: 'response', requestId, error: error instanceof Error ? error.message : String(error) }, false));
        break;
      }
      case 'tabs.listeners': {
        if (!Array.isArray(message.events)) return;
        this.tabListeners = new Set(message.events.filter((e): e is TabEvent => (TAB_EVENTS as readonly string[]).includes(e)));
        break;
      }
      case 'netRequest.rules': {
        // Without a declarativeNetRequest permission the extension's rules never apply.
        if (!Array.isArray(message.rules) || !(this.capabilities.netRequest || this.capabilities.netRequestWithHostAccess)) return;
        this.netRules = sanitizeNetRules(message.rules, MAX_NET_RULES);
        break;
      }
      case 'action.update': {
        const tabId = message.tabId === null ? null : Number.isSafeInteger(message.tabId) ? message.tabId : undefined;
        if (tabId === undefined) return;
        this.action.update(tabId, sanitizeActionProps(message.props));
        this.host.actionChanged(this.id);
        break;
      }
      case 'action.reset':
        this.action.reset(sanitizeActionProps(message.props));
        this.host.actionChanged(this.id);
        break;
      case 'cookies.listeners':
        this.cookieListeners = message.active === true && this.capabilities.cookies;
        this.host.cookieListenersChanged();
        break;
      case 'contextMenus.items': {
        if (!Array.isArray(message.items) || !this.capabilities.contextMenus) return;
        this.menuItems = message.items.slice(0, MAX_MENU_ITEMS).filter(isMenuItem);
        this.host.menusChanged();
        break;
      }
    }
  }

  /** Deliver a message, in order. Resolves false if the extension is unreachable. */
  send(message: HostToExtension, wake = true): Promise<boolean> {
    const run = async () => {
      if (this.disposed || !(await this.connect()) || !this.webview) return false;
      if (wake) {
        try { await this.host.wakeWorker(this.id); }
        catch (e) { if (this.host.debug()) console.warn('[Chrome Bridge] 唤醒后台失败', this.name, e); }
      }
      try {
        return !!(await this.webview.executeJavaScript(
          `globalThis.__obsidianBridgeHost ? globalThis.__obsidianBridgeHost.send(${JSON.stringify(message)}) : false`));
      } catch (e) {
        if (this.host.debug()) console.warn('[Chrome Bridge] 扩展通道发送失败', this.name, e);
        return false;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  dispose(): void {
    this.disposed = true;
    this.resolveReady?.(false);
    this.webview?.remove();
    this.webview = null;
    this.ready = null;
  }
}

function isMenuItem(value: unknown): value is MenuItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const isId = (v: unknown) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
  const strings = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(x => typeof x === 'string'));
  return isId(item.id) && (item.parentId === undefined || isId(item.parentId)) &&
    (item.title === undefined || (typeof item.title === 'string' && item.title.length <= MAX_MENU_TITLE)) &&
    (item.type === undefined || ['normal', 'checkbox', 'radio', 'separator'].includes(item.type as string)) &&
    strings(item.contexts) && strings(item.documentUrlPatterns) && strings(item.targetUrlPatterns);
}

/** All open channels, keyed by extension ID. */
export class ChannelManager {
  private channels = new Map<string, ExtensionChannel>();
  private container: HTMLElement | null = null;

  constructor(private host: ChannelHost) {}

  private root(): HTMLElement {
    if (!this.container?.isConnected) {
      this.container = document.body.createDiv({ cls: 'chrome-bridge-channels', attr: { 'aria-hidden': 'true' } });
    }
    return this.container;
  }

  /** Reconcile with the wanted set; unchanged channels are kept. */
  sync(wanted: Array<{ id: string; name: string; capabilities: ChannelCapabilities }>): void {
    const keep = new Set(wanted.map(w => w.id));
    for (const [id, channel] of this.channels) {
      if (!keep.has(id)) { channel.dispose(); this.channels.delete(id); }
    }
    let changed = false;
    for (const w of wanted) {
      const current = this.channels.get(w.id);
      if (current && sameCapabilities(current.capabilities, w.capabilities)) continue;
      current?.dispose();
      const channel = new ExtensionChannel(w.id, w.name, w.capabilities, this.host, this.root());
      this.channels.set(w.id, channel);
      changed = true;
      void channel.start();
    }
    if (changed) this.host.menusChanged();
  }

  get(id: string): ExtensionChannel | undefined { return this.channels.get(id); }
  all(): ExtensionChannel[] { return [...this.channels.values()]; }

  dispose(): void {
    for (const channel of this.channels.values()) channel.dispose();
    this.channels.clear();
    this.container?.remove();
    this.container = null;
  }
}
