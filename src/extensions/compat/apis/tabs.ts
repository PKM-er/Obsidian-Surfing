import type { InstallContext } from '../context';
import { define, emit, event, fillEvents, invoke, isWorker, listenerCount, missingEvent } from '../runtime';
import { ApiFunction, Namespace, callbackOf, fields, fnOf, nsOf } from '../chrome';
import type { ChromeManifest } from '../../types';
import { TAB_EVENTS } from '../../shared/protocol';
import { isBridgePage } from './windows';

// Events Obsidian cannot observe stay registration-only (see TAB_EVENTS for delivered ones).
const OTHER_TAB_EVENTS = ['onAttached', 'onDetached', 'onHighlighted', 'onMoved', 'onReplaced', 'onZoomChange'];
const filtered = Symbol.for('obsidian-bridge.tabs-query-filtered');

/** Rows of a tabs.query result (chrome.tabs.Tab objects from Electron). */
type TabRow = Record<string, unknown>;
const tabRows = (value: unknown): TabRow[] | null => Array.isArray(value) ? (value as unknown[]).map(fields) : null;

export function installTabs(ctx: InstallContext): void {
  const { c, chrome, info, report } = ctx;
  const tabs = nsOf(c, 'tabs');
  if (!tabs) return;
  // Listener registration must not throw where Electron lacks an event.
  // Without a host channel the delivered events can only be registered too.
  const registrationOnly = ctx.shared.bridge.available ? OTHER_TAB_EVENTS : [...OTHER_TAB_EVENTS, ...TAB_EVENTS];
  if (registrationOnly.some(name => missingEvent(tabs, name))) report('tabs.events-registration-only', () => {
    info.modes.otherTabsEvents = 'registration-only: ' + registrationOnly.filter(name => missingEvent(tabs, name)).join(', ');
    fillEvents(tabs, registrationOnly);
  });
  installTabEvents(ctx, tabs);

  // Electron reports every extension page hosted in a <webview> as a tab,
  // including the hidden bridge pages of every extension. Chrome would never
  // show them (and they would reveal which other extensions are installed).
  const nativeQuery = fnOf(tabs, 'query');
  if (nativeQuery && !(filtered in nativeQuery)) report('tabs.hide-bridge-pages', () => {
    const holder = { query: nativeQuery.bind(tabs) };
    const query: ApiFunction = (queryInfo: unknown = {}, callback?: unknown) => {
      const op = invoke(chrome, holder, 'query', queryInfo)
        .then(result => tabRows(result)?.filter(tab => !isBridgePage(tab.url)) ?? result);
      const cb = callbackOf(callback);
      if (!cb) return op;
      op.then(rows => { cb(rows); }, error => { console.warn('[Chrome Bridge] tabs.query:', error); cb([]); });
      return undefined;
    };
    Object.defineProperty(query, filtered, { value: true });
    define(tabs, 'query', query);
  });

  installActiveTab(ctx, tabs);
}

// Obsidian Web Viewer guest webContents are returned by Electron's tabs API,
// but none is ever marked active, so `tabs.query({active: true, ...})` finds
// nothing — extensions then treat every page as unsupported (e.g. Dark
// Reader's "This page is protected"). The host knows which Web Viewer tab the
// user is on: a popup asks which tab it was opened for (popup.targetTab, once),
// every other context asks for the current one (tabs.activeTab, per query).
// The popup URL itself is never altered: some extensions (Dark Reader) only
// answer messages whose sender.url is exactly their popup URL.
const TARGET_TIMEOUT_MS = 2000;
const WINDOW_ID_CURRENT = -2;

function isPopupDocument(manifest: ChromeManifest): boolean {
  if (typeof document !== 'object' || !globalThis.location || isWorker) return false;
  const popup = manifest.action?.default_popup || manifest.browser_action?.default_popup || manifest.page_action?.default_popup;
  if (typeof popup !== 'string') return false;
  return globalThis.location.pathname === '/' + popup.split(/[?#]/)[0].replace(/^\//, '');
}

const validTab = (r: { tabId: number | null } | undefined) => {
  const tabId = r?.tabId;
  return typeof tabId === 'number' && Number.isSafeInteger(tabId) && tabId > 0 ? tabId : null;
};

function installActiveTab({ c, chrome, info, manifest, shared, report }: InstallContext, tabs: Namespace): void {
  const nativeQuery = fnOf(tabs, 'query');
  if (!shared.bridge.available || !nativeQuery) return;
  const popup = isPopupDocument(manifest);
  report(popup ? 'tabs.active-webviewer' : 'tabs.active-from-obsidian', () => {
    let popupTarget: Promise<number | null> | null = null;
    let inFlight: Promise<number | null> | null = null;
    const activeTab = (): Promise<number | null> => {
      if (popup) {
        // Asked once per popup document; null when not opened from a Web Viewer.
        return popupTarget ??= shared.bridge.request('popup.targetTab', {}, TARGET_TIMEOUT_MS)
          .then(validTab, () => null)
          .then(id => { info.targetTabId = id; return id; });
      }
      // Concurrent queries share one round trip to the host.
      return inFlight ??= shared.bridge.request('tabs.activeTab', {}, TARGET_TIMEOUT_MS)
        .then(validTab, () => null).finally(() => { inFlight = null; });
    };
    if (popup) void activeTab();
    const holder = { query: nativeQuery.bind(tabs) };
    const native = (queryInfo: unknown) => invoke(chrome, holder, 'query', queryInfo);
    const ownPage = (tab: TabRow) => {
      // Electron includes the popup's own webview in tabs.query({}); Chrome
      // does not consider action popups normal tabs.
      if (!popup || typeof tab.url !== 'string') return false;
      try {
        const u = new URL(tab.url);
        return u.protocol === 'chrome-extension:' && u.hostname === c.runtime.id && u.pathname === globalThis.location.pathname;
      } catch { return false; }
    };
    const patchedQuery: ApiFunction = (queryInfo: unknown = {}, callback?: unknown) => {
      const requested = fields(queryInfo);
      const has = (k: string) => Object.hasOwn(requested, k);
      // Filters that depend on "the focused window / active tab".
      const active = has('active') ? !!requested.active : has('highlighted') ? !!requested.highlighted : null;
      const current = has('currentWindow') ? !!requested.currentWindow
        : has('lastFocusedWindow') ? !!requested.lastFocusedWindow
        : requested.windowId === WINDOW_ID_CURRENT ? true : null;
      // Every result carries correct active flags, so always ask for the active tab.
      const op = activeTab().then(target => {
        // Electron cannot answer these filters; ask it for the rest only.
        const nativeFilter = { ...requested };
        for (const k of ['active', 'highlighted', 'currentWindow', 'lastFocusedWindow']) delete nativeFilter[k];
        if (nativeFilter.windowId === WINDOW_ID_CURRENT) delete nativeFilter.windowId;
        return native(nativeFilter).then(result => {
          const all = tabRows(result);
          if (!all) return result;
          const rows = all.filter(tab => !ownPage(tab));
          const focused = target === null ? undefined : rows.find(tab => tab.id === target);
          // No known active tab: nothing is active and no window is current,
          // rather than inventing one.
          if (!focused) return rows.filter(() => active !== true && current !== true).map(tab => ({ ...tab, active: false }));
          // `windowId` comes from Chromium; do not manufacture a new ID.
          return rows.filter(tab => {
            if (current === true && tab.windowId !== focused.windowId) return false;
            if (current === false && tab.windowId === focused.windowId) return false;
            if (active !== null && active !== (tab.id === focused.id)) return false;
            return true;
          }).map(tab => ({ ...tab, active: tab.id === focused.id, highlighted: tab.id === focused.id }));
        });
      });
      const cb = callbackOf(callback);
      if (!cb) return op;
      op.then(value => { cb(value); }, error => {
        console.warn('[Chrome Bridge] tabs.query compatibility:', error);
        cb([]);
      });
      return undefined;
    };
    define(tabs, 'query', patchedQuery);
    info.modes.tabsActive = popup
      ? 'the popup\'s active tab is the Web Viewer it was opened from'
      : 'active tab = the Web Viewer tab focused in Obsidian';
  });
}

// Electron never fires chrome.tabs events for Obsidian Web Viewer tabs (its
// native onUpdated/onActivated/onCreated/onRemoved exist but stay silent), yet
// extensions depend on them — Tampermonkey detects its installation page with
// onUpdated(status: 'complete'). The host observes Web Viewer tabs and
// delivers these events; tab objects come from Electron's real tabs.get with
// the live fields the host knows (status, url, title, active).
const tabNamespaces = new Set<Namespace>();
let tabDelivery = false;

export function installTabEvents(ctx: InstallContext, namespace: Namespace): void {
  const { chrome, granted, hosts, info, shared, report } = ctx;
  if (!shared.bridge.available || tabNamespaces.has(namespace)) return;
  report('tabs.events-from-obsidian', () => {
    let pending = false;
    const announce = () => {
      if (!isWorker || pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        const events = TAB_EVENTS.filter(name => [...tabNamespaces].some(ns => listenerCount(ns[name]) > 0));
        shared.bridge.post({ type: 'tabs.listeners', events });
      }, 0);
    };
    for (const name of TAB_EVENTS) define(namespace, name, event({ onChange: announce }));
    tabNamespaces.add(namespace);
    shared.bridge.on('bridge.sync', announce);
    if (isWorker) announce();
    // url/title/favIconUrl need the "tabs" permission or host access, as in Chrome.
    const sensitive = granted.has('tabs') || hosts.size > 0;
    if (!tabDelivery) {
      tabDelivery = true;
      const nativeTabs = nsOf(chrome, 'tabs');
      shared.bridge.on('tabs.event', async message => {
        const name = message.event;
        if (!(TAB_EVENTS as readonly string[]).includes(name) || !Number.isSafeInteger(message.tab?.id)) return;
        const known: Record<string, unknown> = { ...message.tab };
        if (!sensitive) { delete known.url; delete known.title; delete known.favIconUrl; }
        let tab: TabRow = { id: known.id };
        if (name !== 'onRemoved' && fnOf(nativeTabs, 'get')) {
          try { tab = fields(await invoke(chrome, nativeTabs, 'get', known.id)); } catch { /* best effort */ }
        }
        tab = { id: known.id, ...tab, ...known, ...(known.active !== undefined ? { highlighted: known.active } : {}) };
        if (!sensitive) { delete tab.url; delete tab.title; delete tab.favIconUrl; delete tab.pendingUrl; }
        const change: Record<string, unknown> = { ...(message.changeInfo || {}) };
        if (!sensitive) { delete change.url; delete change.title; delete change.favIconUrl; }
        for (const ns of tabNamespaces) {
          if (name === 'onUpdated') emit(ns.onUpdated, tab.id, change, tab);
          else if (name === 'onCreated') emit(ns.onCreated, tab);
          else if (name === 'onActivated') emit(ns.onActivated, { tabId: tab.id, windowId: tab.windowId ?? -1 });
          else if (name === 'onRemoved') emit(ns.onRemoved, tab.id, message.removeInfo || { windowId: -1, isWindowClosing: false });
        }
      });
    }
    info.modes.tabsEvents = 'onActivated/onCreated/onRemoved/onUpdated delivered from Obsidian Web Viewer tabs';
  });
}
