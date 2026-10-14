// Opening pages. In Obsidian an extension has no browser window to open tabs
// or windows in, and its popup/options <webview> blocks window.open. Route
// every "show this page" request to the host, which opens web URLs in a Web
// Viewer tab and the extension's own pages in an extension page tab.
import type { InstallContext } from '../context';
import { define, invoke, isWorker, missingFn, settle } from '../runtime';
import { ApiFunction, fields, fnOf, nsOf } from '../chrome';
import type { OpenReason } from '../../shared/protocol';
import { OBSIDIAN_WINDOW_ID } from './windows';
import { text } from '../../shared/text';

const OPENABLE = /^(https?:|chrome-extension:|about:blank$)/i;
const activates = Symbol.for('obsidian-bridge.tabs-update-activates');

/** Relative URLs resolve against the calling page, else the extension root (as in Chrome). */
let extensionRoot: string | undefined;
function resolveUrl(raw: unknown): string | null {
  const value = raw === undefined || raw === null || raw === '' ? 'about:blank' : text(raw);
  try {
    const url = new URL(value, globalThis.location?.href ?? extensionRoot);
    return OPENABLE.test(url.href) ? url.href : null;
  } catch { return null; }
}

export function installOpen(ctx: InstallContext): void {
  const { c, chrome, info, shared, report } = ctx;
  if (!shared.bridge.available) return;
  if (fnOf(chrome.runtime, 'getURL')) extensionRoot ??= chrome.runtime.getURL('');
  const tabs = nsOf(c, 'tabs');

  const open = async (raw: unknown, active: boolean, reason: OpenReason): Promise<number | null> => {
    const url = resolveUrl(raw);
    if (!url) throw new Error(`Cannot open URL in Obsidian: ${text(raw, typeof raw)}`);
    const { tabId } = await shared.bridge.request('tabs.open', { url, active, reason }, 10000);
    return Number.isSafeInteger(tabId) ? tabId : null;
  };
  // A real Tab from Electron when possible; otherwise the fields we know.
  const tabFor = async (tabId: number | null, url: string | null, active: boolean): Promise<unknown> => {
    if (tabId !== null && fnOf(tabs, 'get')) {
      try { const tab = await invoke(chrome, tabs, 'get', tabId); if (tab) return tab; } catch { /* best effort */ }
    }
    return { id: tabId ?? -1, index: 0, windowId: -1, url: url ?? undefined, active, highlighted: active,
      pinned: false, incognito: false, discarded: false, autoDiscardable: true, groupId: -1 };
  };

  if (tabs && missingFn(tabs, 'create')) report('tabs.create', () => {
    define(tabs, 'create', (createProperties: unknown = {}, callback?: unknown) => {
      const properties = fields(createProperties);
      const active = properties.active !== false;
      const op = open(properties.url, active, 'tabs.create').then(tabId => tabFor(tabId, resolveUrl(properties.url), active));
      return settle(op, callback);
    });
    info.modes.tabsCreate = 'opens in an Obsidian tab (web URLs in Web Viewer, extension pages in an extension tab)';
  });

  // Electron has no tabs.remove; extensions close their own dialogs with it
  // (Tampermonkey's install page), so close the Obsidian tab instead.
  if (tabs && missingFn(tabs, 'remove')) report('tabs.remove', () => {
    define(tabs, 'remove', (tabIds: unknown, callback?: unknown) => {
      const ids = (Array.isArray(tabIds) ? tabIds as unknown[] : [tabIds]).filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id));
      return settle(shared.bridge.request('tabs.remove', { tabIds: ids }, 10000).then(() => undefined), callback);
    });
  });
  // Electron's tabs.update ignores `active`: also bring the Obsidian tab forward.
  const nativeUpdate = fnOf(tabs, 'update');
  if (tabs && nativeUpdate && !(activates in nativeUpdate)) report('tabs.update.active', () => {
    const update: ApiFunction = (...args) => {
      const [tabId, properties] = typeof args[0] === 'number' ? [args[0], args[1]] : [undefined, args[0]];
      if (fields(properties).active === true && typeof tabId === 'number') {
        shared.bridge.request('tabs.activate', { tabId }, 5000).catch(() => undefined);
      }
      return nativeUpdate.apply(tabs, args);
    };
    Object.defineProperty(update, activates, { value: true });
    define(tabs, 'update', update);
  });

  if (missingFn(c.windows, 'create')) report('windows.create', () => {
    const existing = nsOf(c, 'windows') ?? {};
    define(existing, 'create', (createData: unknown = {}, callback?: unknown) => {
      const data = fields(createData);
      const urls = Array.isArray(data.url) ? data.url as unknown[] : [data.url];
      const op = (async () => {
        const opened: unknown[] = [];
        for (const [i, url] of urls.entries()) {
          const active = i === 0 && data.focused !== false;
          opened.push(await tabFor(await open(url, active, 'windows.create'), resolveUrl(url), active));
        }
        // Obsidian has no extension-visible windows; the opened tabs are real.
        return { id: OBSIDIAN_WINDOW_ID, focused: data.focused !== false, top: 0, left: 0, width: 0, height: 0,
          incognito: false, type: typeof data.type === 'string' ? data.type : 'normal', state: 'normal', alwaysOnTop: false, tabs: opened };
      })();
      return settle(op, callback);
    });
    if (existing.WINDOW_ID_NONE === undefined) define(existing, 'WINDOW_ID_NONE', -1);
    if (existing.WINDOW_ID_CURRENT === undefined) define(existing, 'WINDOW_ID_CURRENT', -2);
    if (!c.windows) define(c, 'windows', existing);
    info.modes.windowsCreate = 'opens the URLs as Obsidian tabs; the returned window is not a real window';
  });

  if (missingFn(c.runtime, 'openOptionsPage')) report('runtime.openOptionsPage', () => {
    define(c.runtime, 'openOptionsPage', (callback?: unknown) => settle(
      shared.bridge.request('runtime.openOptionsPage', {}, 10000).then(() => undefined), callback));
  });
}

/** Page contexts only (popup, options, extension tabs): window.open and new-tab links. */
export function installPageOpen(ctx: Pick<InstallContext, 'shared' | 'info'>): void {
  const doc = typeof document === 'object' ? document : undefined;
  if (isWorker || !doc || !ctx.shared.bridge.available) return;
  const request = (raw: unknown, reason: OpenReason) => {
    const url = resolveUrl(raw);
    if (!url) return false;
    ctx.shared.bridge.request('tabs.open', { url, active: true, reason }, 10000)
      .catch(e => console.warn('[Chrome Bridge] open:', e));
    return true;
  };
  const nativeOpen = globalThis.open;
  define(globalThis, 'open', (url?: string | URL, target?: string, features?: string) => {
    // Same-document targets keep native behavior.
    if (target === '_self' || target === '_top' || target === '_parent') return nativeOpen.call(globalThis, url, target, features);
    request(url, 'window.open');
    // No WindowProxy can be provided for an Obsidian tab (like a blocked popup).
    return null;
  });
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor || anchor.hasAttribute('download')) return;
    const target = (anchor.getAttribute('target') || '').toLowerCase();
    const newTab = (target && !['_self', '_top', '_parent'].includes(target)) ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1;
    if (!newTab || /^javascript:/i.test(anchor.href)) return;
    if (request(anchor.href, 'link')) event.preventDefault();
  };
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('auxclick', onClick, true);
  ctx.info.installed.push('page.open-in-obsidian');
}
