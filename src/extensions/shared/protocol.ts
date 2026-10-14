// Messages between the Obsidian host and an extension's own contexts.
//
//   host renderer ──executeJavaScript──▶ hidden bridge page ──BroadcastChannel──▶ worker/pages
//   worker/pages ──BroadcastChannel──▶ hidden bridge page ──console-message──▶ host renderer
//
// The bridge page is a Bridge-generated file inside the extension package, so
// the channel never leaves the extension's own origin. Everything received by
// the host is untrusted extension data and is validated before use.

export const CHANNEL_NAME = '__obsidian_bridge_channel_v1';
export const HOST_PAGE = '__obsidian_bridge_host.html';
export const HOST_SCRIPT = '__obsidian_bridge_host.js';
/** Files whose name starts with this belong to Bridge, never to the vendor. */
export const RESERVED_PREFIX = '__obsidian_bridge_';
/** Marks console lines from the bridge page that carry a WorkerToHost message. */
export const CONSOLE_PREFIX = '[obsidian-bridge:v1] ';
/** Storage key under which the contextMenus fallback persists its items. */
export const CONTEXT_MENU_STORAGE_KEY = '__obsidian_bridge_context_menus_v1__';
/** Folder (inside the managed extension copy) holding generated user-script files. */
export const USER_SCRIPT_DIR = '__obsidian_bridge_us';

export const WEB_NAVIGATION_EVENTS = [
  'onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted',
  'onErrorOccurred', 'onCreatedNavigationTarget', 'onReferenceFragmentUpdated',
  'onHistoryStateUpdated', 'onTabReplaced'
] as const;
export type WebNavigationEvent = typeof WEB_NAVIGATION_EVENTS[number];

/** chrome.tabs events Obsidian delivers (Electron never fires them for Web Viewer tabs). */
export const TAB_EVENTS = ['onActivated', 'onCreated', 'onRemoved', 'onUpdated'] as const;
export type TabEvent = typeof TAB_EVENTS[number];

/** Fields of a chrome.tabs.Tab the host knows better than Electron does. */
export interface TabFields { id: number; url?: string; title?: string; favIconUrl?: string; status?: 'loading' | 'complete'; active?: boolean }

export type MenuItemType = 'normal' | 'checkbox' | 'radio' | 'separator';
/** The serializable part of chrome.contextMenus.CreateProperties. */
export interface MenuItem {
  id: string | number;
  parentId?: string | number;
  title?: string;
  type?: MenuItemType;
  contexts?: string[];
  checked?: boolean;
  enabled?: boolean;
  visible?: boolean;
  documentUrlPatterns?: string[];
  targetUrlPatterns?: string[];
}

/** chrome.contextMenus.OnClickData */
export interface MenuClickInfo {
  menuItemId: string | number;
  parentMenuItemId?: string | number;
  mediaType?: 'image' | 'video' | 'audio';
  linkUrl?: string;
  srcUrl?: string;
  pageUrl?: string;
  frameUrl?: string;
  frameId?: number;
  selectionText?: string;
  editable: boolean;
  wasChecked?: boolean;
  checked?: boolean;
}

/** chrome.webNavigation.GetAllFrameResultDetails */
export interface FrameDetails {
  frameId: number;
  parentFrameId: number;
  processId: number;
  url: string;
  errorOccurred: boolean;
  frameType: 'outermost_frame' | 'sub_frame';
  documentLifecycle: 'active';
}

/**
 * chrome.action state the toolbar renders. Colors are CSS colors; `icon` is a
 * data: URL; `popup` is a path inside the extension ('' = no popup).
 */
export interface ActionProps {
  title?: string;
  badgeText?: string;
  badgeBackgroundColor?: string;
  badgeTextColor?: string;
  icon?: string;
  popup?: string;
  enabled?: boolean;
}

/** chrome.notifications.NotificationOptions, as far as Obsidian shows them. */
export interface NotificationOptions {
  type?: string;
  title?: string;
  message?: string;
  contextMessage?: string;
  iconUrl?: string;
  buttons?: Array<{ title: string }>;
  requireInteraction?: boolean;
  silent?: boolean;
  priority?: number;
  progress?: number;
  items?: Array<{ title: string; message: string }>;
}

/** chrome.cookies.Cookie */
export interface CookieDetails {
  name: string; value: string; domain: string; hostOnly: boolean; path: string; secure: boolean;
  httpOnly: boolean; sameSite: 'no_restriction' | 'lax' | 'strict' | 'unspecified'; session: boolean;
  expirationDate?: number; storeId: string;
}

/** How an extension asked to show a page; decides where Obsidian opens it. */
export type OpenReason = 'tabs.create' | 'windows.create' | 'window.open' | 'link' | 'openOptionsPage';

/** Calls an extension context makes on the host, answered by a `response`. */
export interface HostMethods {
  'webNavigation.getAllFrames': { params: { tabId: number }; result: FrameDetails[] | null };
  /** Open a URL in Obsidian; resolves to the new tab's ID (a Web Viewer guest). */
  'tabs.open': { params: { url: string; active: boolean; reason: OpenReason }; result: { tabId: number | null } };
  'runtime.openOptionsPage': { params: Record<string, never>; result: { tabId: number | null } };
  /** Close Obsidian tabs showing these webContents (Web Viewer or the extension's own pages). */
  'tabs.remove': { params: { tabIds: number[] }; result: { removed: number } };
  /** Bring the Obsidian tab showing this webContents to the front. */
  'tabs.activate': { params: { tabId: number }; result: { activated: boolean } };
  /** The Web Viewer tab an extension popup was opened for (its 'active tab'). */
  'popup.targetTab': { params: Record<string, never>; result: { tabId: number | null } };
  /** The Web Viewer tab the user is looking at (Chrome's active tab), or null. */
  'tabs.activeTab': { params: Record<string, never>; result: { tabId: number | null } };
  /**
   * Generated user-script files (named by SHA-256 of their code) in the
   * extension's __obsidian_bridge_us/ folder: delete all not in `keep`,
   * report which of `keep` are missing.
   */
  'userScripts.syncFiles': { params: { keep: string[]; prune?: boolean }; result: { missing: string[] } };
  /** Write generated user-script files; the host verifies each hash. */
  'userScripts.writeFiles': { params: { files: Array<{ hash: string; code: string }> }; result: { written: number } };
  /** The secret event the host's session preload runs inline user-script code for (null: unavailable). */
  'userScripts.pageExec': { params: Record<string, never>; result: { event: string | null } };
  /** chrome.action.openPopup: show the popup for the current Web Viewer tab. */
  'action.openPopup': { params: Record<string, never>; result: { opened: boolean } };
  /** Show or replace an Obsidian notice for chrome.notifications. */
  'notifications.show': { params: { id: string; options: NotificationOptions; update: boolean }; result: { shown: boolean } };
  'notifications.clear': { params: { id: string }; result: { cleared: boolean } };
  'notifications.getAll': { params: Record<string, never>; result: { ids: string[] } };
  /** Go back/forward in a Web Viewer tab's history (null: the active tab). */
  'tabs.history': { params: { tabId: number | null; delta: -1 | 1 }; result: { moved: boolean } };
  /** chrome.tabs.captureVisibleTab of the active Web Viewer tab. */
  'tabs.capture': { params: { format?: 'png' | 'jpeg'; quality?: number }; result: { dataUrl: string } };
  /** Obsidian hotkeys bound to the extension's manifest commands. */
  'commands.shortcuts': { params: Record<string, never>; result: Record<string, string> };
  'cookies.get': { params: { url: string; name: string }; result: CookieDetails | null };
  'cookies.getAll': { params: Record<string, unknown>; result: CookieDetails[] };
  'cookies.set': { params: Record<string, unknown>; result: CookieDetails | null };
  'cookies.remove': { params: { url: string; name: string }; result: { url: string; name: string; storeId: string } | null };
}
export type HostMethod = keyof HostMethods;

export type HostToExtension =
  | { type: 'webNavigation.event'; event: WebNavigationEvent; details: Record<string, unknown> }
  | { type: 'contextMenus.clicked'; info: MenuClickInfo; tabId: number | null }
  | { type: 'tabs.event'; event: TabEvent; tab: TabFields; changeInfo?: Record<string, unknown>; removeInfo?: { windowId: number; isWindowClosing: boolean } }
  | { type: 'response'; requestId: string; result?: unknown; error?: string }
  /** The user clicked the extension's toolbar button and it has no popup. */
  | { type: 'action.clicked'; tab: TabFields }
  /** A manifest command ran (from Obsidian's command palette or its hotkey). */
  | { type: 'commands.command'; command: string; tab: TabFields | null }
  | { type: 'notifications.event'; event: 'onClicked' | 'onClosed' | 'onButtonClicked'; id: string; byUser?: boolean; buttonIndex?: number }
  | { type: 'cookies.changed'; info: { cookie: CookieDetails; cause: string; removed: boolean } }
  /** Ask the worker to re-announce listeners and menu items (host just (re)connected). */
  | { type: 'bridge.sync' };

export type ExtensionToHost =
  | { type: 'bridge.ready' }
  | { type: 'contextMenus.items'; items: MenuItem[] }
  | { type: 'webNavigation.listeners'; events: WebNavigationEvent[] }
  | { type: 'tabs.listeners'; events: TabEvent[] }
  /** chrome.action setter calls (tabId null = global), and a global snapshot on (re)connect. */
  | { type: 'action.update'; tabId: number | null; props: ActionProps }
  | { type: 'action.reset'; props: ActionProps }
  /** Whether cookies.onChanged has listeners. */
  | { type: 'cookies.listeners'; active: boolean }
  /** declarativeNetRequest rules that can match a top-level navigation. */
  | { type: 'netRequest.rules'; rules: import('./net-request').NetRule[] }
  | { type: 'request'; requestId: string; method: HostMethod; params: unknown };

/** Envelope on the BroadcastChannel; `from` prevents a context hearing itself. */
export type Envelope =
  | ({ v: 1; from: 'host' } & HostToExtension)
  | ({ v: 1; from: 'extension' } & ExtensionToHost);
