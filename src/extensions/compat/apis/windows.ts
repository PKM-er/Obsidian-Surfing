// chrome.windows beyond create (open.ts) and the chrome.tabs members Electron
// lacks. Obsidian is one browser window to extensions: Electron already
// reports every Web Viewer tab with windowId 0, so that is the window here.
import type { InstallContext } from '../context';
import { define, fillEvents, invoke, isWorker, missingFn, settle, type Listener } from '../runtime';
import { callbackOf, fields, nsOf } from '../chrome';
import { RESERVED_PREFIX } from '../../shared/protocol';
import { text } from '../../shared/text';

export const OBSIDIAN_WINDOW_ID = 0;
const WINDOW_ID_NONE = -1;
const WINDOW_ID_CURRENT = -2;

/** Bridge's own hidden pages (of any extension) are never tabs to an extension. */
export const isBridgePage = (url: unknown) => typeof url === 'string' && /^chrome-extension:\/\/[a-p]{32}\//.test(url) &&
  url.slice('chrome-extension://'.length + 33).startsWith(RESERVED_PREFIX);

function windowOf(tabs?: unknown[]): Record<string, unknown> {
  const screen = typeof globalThis.screen === 'object' ? globalThis.screen : undefined;
  const doc = typeof document === 'object' ? document : undefined;
  return {
    id: OBSIDIAN_WINDOW_ID, focused: doc ? doc.hasFocus() : true, alwaysOnTop: false, incognito: false,
    type: 'normal', state: 'normal', top: 0, left: 0,
    width: Number(screen?.availWidth) || 1280, height: Number(screen?.availHeight) || 800,
    ...(tabs ? { tabs } : {})
  };
}

/** (options?, callback?) where the callback may come first. */
const optionsAndCallback = (options: unknown, callback: unknown): [unknown, unknown] =>
  callbackOf(options) ? [undefined, options] : [options, callback];

export function installWindows(ctx: InstallContext): void {
  const { c, chrome, info, report } = ctx;
  const windows = nsOf(c, 'windows');
  if (!windows || !missingFn(windows, 'getCurrent')) return;
  report('windows.obsidian-window', () => {
    const tabs = (populate: unknown) => populate
      ? invoke(chrome, c.tabs, 'query', {}).then(rows => Array.isArray(rows) ? (rows as unknown[]).filter(t => !isBridgePage(fields(t).url)) : []).catch(() => [])
      : Promise.resolve(undefined);
    const lookup = (windowId: unknown, options: unknown) => {
      if (windowId !== OBSIDIAN_WINDOW_ID && windowId !== WINDOW_ID_CURRENT) return Promise.reject(new Error(`No window with id: ${text(windowId)}.`));
      return tabs(fields(options).populate).then(windowOf);
    };
    const api: Record<string, Listener> = {
      get: (windowId: unknown, options?: unknown, callback?: unknown) => {
        const [opts, cb] = optionsAndCallback(options, callback);
        return settle(lookup(windowId, opts), cb);
      },
      getCurrent: (options?: unknown, callback?: unknown) => {
        const [opts, cb] = optionsAndCallback(options, callback);
        return settle(lookup(OBSIDIAN_WINDOW_ID, opts), cb);
      },
      getLastFocused: (options?: unknown, callback?: unknown) => {
        const [opts, cb] = optionsAndCallback(options, callback);
        return settle(lookup(OBSIDIAN_WINDOW_ID, opts), cb);
      },
      getAll: (options?: unknown, callback?: unknown) => {
        const [opts, cb] = optionsAndCallback(options, callback);
        const types = fields(opts).windowTypes;
        const wantsNormal = !Array.isArray(types) || types.includes('normal');
        return settle(wantsNormal ? lookup(OBSIDIAN_WINDOW_ID, opts).then(w => [w]) : Promise.resolve([]), cb);
      },
      // Obsidian's window is not the extension's to move, resize or close.
      update: (windowId: unknown, _info?: unknown, callback?: unknown) => settle(lookup(windowId, {}), callback),
      remove: (windowId: unknown, callback?: unknown) => settle(Promise.reject(new Error(`Window ${text(windowId)} cannot be closed by an extension in Obsidian.`)), callback)
    };
    for (const [key, value] of Object.entries(api)) if (missingFn(windows, key)) define(windows, key, value);
    fillEvents(windows, ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged']);
    if (windows.WINDOW_ID_NONE === undefined) define(windows, 'WINDOW_ID_NONE', WINDOW_ID_NONE);
    if (windows.WINDOW_ID_CURRENT === undefined) define(windows, 'WINDOW_ID_CURRENT', WINDOW_ID_CURRENT);
    if (windows.WindowType === undefined) define(windows, 'WindowType', { NORMAL: 'normal', POPUP: 'popup', PANEL: 'panel', APP: 'app', DEVTOOLS: 'devtools' });
    if (windows.WindowState === undefined) define(windows, 'WindowState', { NORMAL: 'normal', MINIMIZED: 'minimized', MAXIMIZED: 'maximized', FULLSCREEN: 'fullscreen', LOCKED_FULLSCREEN: 'locked_fullscreen' });
    info.modes.windows = 'Obsidian is one window (id 0, as Electron reports for every tab); windows cannot be moved or closed; window events are registration-only';
  });
}

export function installTabExtras(ctx: InstallContext): void {
  const { c, chrome, info, shared, report } = ctx;
  const tabs = nsOf(c, 'tabs');
  if (!tabs || !shared.bridge.available) return;
  report('tabs.extras', () => {
    const added: string[] = [];
    const add = (name: string, fn: Listener) => { if (missingFn(tabs, name)) { define(tabs, name, fn); added.push(name); } };
    // The tab showing this extension page; undefined in workers and popups (as in Chrome).
    add('getCurrent', (callback?: unknown) => settle((async () => {
      if (isWorker || !globalThis.location) return undefined;
      const rows = await invoke(chrome, tabs, 'query', {}).catch(() => []);
      const popup = chrome.runtime.getManifest?.()?.action?.default_popup;
      if (typeof popup === 'string' && globalThis.location.pathname === '/' + popup.replace(/^\//, '').split(/[?#]/)[0]) return undefined;
      return Array.isArray(rows) ? (rows as unknown[]).find(t => fields(t).url === globalThis.location.href) : undefined;
    })(), callback));
    const history = (delta: -1 | 1) => (tabId?: unknown, callback?: unknown) => {
      if (callbackOf(tabId)) { callback = tabId; tabId = undefined; }
      return settle(shared.bridge.request('tabs.history', { tabId: typeof tabId === 'number' && Number.isSafeInteger(tabId) ? tabId : null, delta }, 5000)
        .then(() => undefined), callback);
    };
    add('goBack', history(-1));
    add('goForward', history(1));
    add('captureVisibleTab', (...args: unknown[]) => {
      const callback = callbackOf(args[args.length - 1]) ? args.pop() : undefined;
      const options = fields(args.find(a => a && typeof a === 'object'));
      const quality = options.quality;
      return settle(shared.bridge.request('tabs.capture', {
        format: options.format === 'png' ? 'png' : 'jpeg', ...(typeof quality === 'number' && Number.isInteger(quality) ? { quality } : {})
      }, 10000).then(r => r.dataUrl), callback);
    });
    add('duplicate', (tabId: unknown, callback?: unknown) => settle((async () => {
      const url = fields(await invoke(chrome, tabs, 'get', tabId)).url;
      if (typeof url !== 'string' || !url) throw new Error(`No tab with id: ${text(tabId)}.`);
      const { tabId: id } = await shared.bridge.request('tabs.open', { url, active: true, reason: 'tabs.create' }, 10000);
      return Number.isSafeInteger(id) ? invoke(chrome, tabs, 'get', id).catch(() => ({ id, url })) : undefined;
    })(), callback));
    add('highlight', (highlightInfo: unknown, callback?: unknown) => settle((async () => {
      const requested = fields(highlightInfo).tabs;
      const ids = Array.isArray(requested) ? requested as unknown[] : [requested];
      const first = ids.find((x): x is number => typeof x === 'number' && Number.isSafeInteger(x));
      if (first !== undefined) await shared.bridge.request('tabs.activate', { tabId: first }, 5000).catch(() => undefined);
      return windowOf();
    })(), callback));
    if (tabs.TAB_ID_NONE === undefined) define(tabs, 'TAB_ID_NONE', -1);
    if (tabs.TAB_INDEX_NONE === undefined) define(tabs, 'TAB_INDEX_NONE', -1);
    if (added.length) info.modes.tabsExtras = added.join(', ') + ' via Obsidian (captureVisibleTab: the active Web Viewer tab)';
  });
}
