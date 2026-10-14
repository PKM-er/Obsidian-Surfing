// chrome.action. Electron 43 implements the API and keeps its state, but
// nothing ever renders it: Obsidian draws the toolbar button. Every setter
// call (native or filled) is therefore reported to the host, which shows the
// icon, badge, title and enabled state per tab and opens the popup the
// extension set. Clicks without a popup arrive as action.onClicked, and
// action.openPopup asks Obsidian to open the popup.
import type { InstallContext } from '../context';
import { define, emit, event, fillEvents, invoke, isWorker, missingFn, settle } from '../runtime';
import { ApiFunction, ChromeRoot, Namespace, callbackOf, fields, fnOf, nsOf } from '../chrome';
import type { ActionProps, TabFields } from '../../shared/protocol';
import { text } from '../../shared/text';

const observed = Symbol.for('obsidian-bridge.action-observed');
const MAX_ICON_BYTES = 256 * 1024;

export function installAction(ctx: InstallContext): void {
  const { c, manifest } = ctx;
  if (!manifest.action) return;
  if (missingFn(c.action, 'setIcon') || missingFn(c.action, 'getUserSettings')) installStateOnly(ctx);
  const action = nsOf(c, 'action');
  if (action && ctx.shared.bridge.available) observeAction(ctx, action);
}

/** Where Electron lacks chrome.action members: per-tab/global state per context, so setters and getters round-trip. */
function installStateOnly({ c, manifest, info, report }: InstallContext): void {
  report('action.state-only', () => {
    const existing = nsOf(c, 'action') ?? {};
    const declared = manifest.action ?? {};
    const extensionUrl = (file: string) => fnOf(c.runtime, 'getURL') ? c.runtime.getURL(file) : file;
    const global: Record<string, unknown> = {
      title: text(declared.default_title),
      badgeText: '', badgeBackgroundColor: [0, 0, 0, 0], badgeTextColor: [0, 0, 0, 0],
      popup: declared.default_popup ? extensionUrl(declared.default_popup) : '',
      enabled: true
    };
    const perTab = new Map<number, Record<string, unknown>>();
    const tabIdOf = (details: unknown) => {
      const tabId = fields(details).tabId;
      return typeof tabId === 'number' && Number.isInteger(tabId) ? tabId : null;
    };
    const read = (details: unknown, key: string) => {
      const tabId = tabIdOf(details);
      const tab = tabId === null ? null : perTab.get(tabId);
      return tab && Object.hasOwn(tab, key) ? tab[key] : global[key];
    };
    const write = (details: unknown, key: string, value: unknown) => {
      const tabId = tabIdOf(details);
      if (tabId === null) { global[key] = value; return; }
      if (!perTab.has(tabId)) perTab.set(tabId, {});
      perTab.get(tabId)![key] = value;
    };
    const setter = (key: string, field: string, normalize: (v: unknown) => unknown) => (details: unknown = {}, callback?: unknown) => {
      write(details, key, normalize(fields(details)[field]));
      return settle(Promise.resolve(), callback);
    };
    const getter = (key: string) => (details: unknown = {}, callback?: unknown) => settle(Promise.resolve(read(details, key)), callback);
    const color = (v: unknown) => typeof v === 'string' ? v : Array.isArray(v) ? [...(v as unknown[])] : [0, 0, 0, 0];
    const toText = (v: unknown) => text(v);
    const api = {
      setIcon: setter('icon', 'path', v => v ?? null),
      setTitle: setter('title', 'title', toText),
      getTitle: getter('title'),
      setBadgeText: setter('badgeText', 'text', toText),
      getBadgeText: getter('badgeText'),
      setBadgeBackgroundColor: setter('badgeBackgroundColor', 'color', color),
      getBadgeBackgroundColor: getter('badgeBackgroundColor'),
      setBadgeTextColor: setter('badgeTextColor', 'color', color),
      getBadgeTextColor: getter('badgeTextColor'),
      setPopup: setter('popup', 'popup', v => v ? extensionUrl(text(v).replace(/^\//, '')) : ''),
      getPopup: getter('popup'),
      enable: (tabId?: unknown, callback?: unknown) => { write({ tabId }, 'enabled', true); return settle(Promise.resolve(), callback); },
      disable: (tabId?: unknown, callback?: unknown) => { write({ tabId }, 'enabled', false); return settle(Promise.resolve(), callback); },
      isEnabled: (tabId?: unknown, callback?: unknown) => settle(Promise.resolve(read({ tabId }, 'enabled')), callback),
      // Chrome Bridge always offers the button in the Web Viewer toolbar.
      getUserSettings: (callback?: unknown) => settle(Promise.resolve({ isOnToolbar: true }), callback)
    };
    for (const [key, value] of Object.entries(api)) if (missingFn(existing, key)) define(existing, key, value);
    fillEvents(existing, ['onClicked', 'onUserSettingsChanged']);
    if (!c.action) define(c, 'action', existing);
    info.modes.action = 'state-only: values round-trip in this context';
  });
}

/** Chrome's ColorArray [r, g, b, a] or a CSS color string → CSS color. */
export function cssColor(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value) && value.length === 4 && value.every(n => typeof n === 'number' && Number.isFinite(n))) {
    const [r, g, b, a] = (value as number[]).map(n => Math.max(0, Math.min(255, Math.round(n))));
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  }
  return undefined;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The size Chrome would pick for a 16px button at 2x: 32, else the nearest larger, else the largest. */
function pick<T>(value: unknown, isLeaf: (v: unknown) => v is T): T | undefined {
  if (isLeaf(value)) return value;
  if (!value || typeof value !== 'object') return undefined;
  const sizes = Object.keys(value).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const size = sizes.find(s => s >= 32) ?? sizes[sizes.length - 1];
  const chosen = size === undefined ? undefined : fields(value)[String(size)];
  return isLeaf(chosen) ? chosen : undefined;
}

interface ImageDataLike { width: number; height: number; data: ArrayLike<number> }
const isImageData = (v: unknown): v is ImageDataLike => {
  const f = fields(v);
  return typeof f.width === 'number' && typeof f.height === 'number' && !!f.data && typeof f.data === 'object';
};
const isString = (v: unknown): v is string => typeof v === 'string';

/** setIcon details → a data: URL the host can show (extension files and ImageData are not reachable from Obsidian). */
async function iconDataUrl(chrome: ChromeRoot, details: unknown): Promise<string | undefined> {
  const { imageData, path: pathField } = fields(details);
  const image = imageData !== undefined ? pick(imageData, isImageData) : undefined;
  if (image) {
    if (typeof OffscreenCanvas !== 'function') return undefined;
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    const data = typeof ImageData === 'function' && image instanceof ImageData ? image : new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
    context.putImageData(data, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    if (blob.size > MAX_ICON_BYTES) return undefined;
    return 'data:image/png;base64,' + base64(new Uint8Array(await blob.arrayBuffer()));
  }
  const path = pathField !== undefined ? pick(pathField, isString) : undefined;
  if (typeof path !== 'string') return undefined;
  const url = /^[a-z-]+:/i.test(path) ? path : chrome.runtime.getURL(path.replace(/^\//, ''));
  if (!url.startsWith(chrome.runtime.getURL(''))) return undefined;
  const response = await fetch(url);
  const blob = await response.blob();
  if (!response.ok || blob.size > MAX_ICON_BYTES) return undefined;
  const type = /^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(blob.type) ? blob.type : 'image/png';
  return `data:${type};base64,` + base64(new Uint8Array(await blob.arrayBuffer()));
}

/** Popup URL or path → a path inside this extension ('' = none). */
function popupPath(chrome: ChromeRoot, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const path = text(value);
  if (!path) return '';
  const root = chrome.runtime.getURL('');
  if (path.startsWith(root)) return path.slice(root.length);
  return /^[a-z-]+:/i.test(path) ? undefined : path.replace(/^\/+/, '');
}

/**
 * A chrome.tabs.Tab for host-provided fields: Electron's tabs.get plus what
 * the host knows. url/title stay out when the host withheld them.
 */
export async function fullTab(chrome: ChromeRoot, known: TabFields): Promise<Record<string, unknown>> {
  let tab: Record<string, unknown> = { id: known.id, index: 0, windowId: -1, pinned: false, highlighted: true, incognito: false, discarded: false, autoDiscardable: true, groupId: -1 };
  const tabs = nsOf(chrome, 'tabs');
  if (fnOf(tabs, 'get')) { try { tab = { ...tab, ...fields(await invoke(chrome, tabs, 'get', known.id)) }; } catch { /* best effort */ } }
  tab = { ...tab, ...known, highlighted: known.active ?? tab.highlighted };
  if (known.url === undefined) { delete tab.url; delete tab.pendingUrl; delete tab.title; delete tab.favIconUrl; }
  return tab;
}

type Change = [unknown, ActionProps] | null;

function observeAction({ chrome, info, shared, report }: InstallContext, action: Namespace): void {
  // `browser` may alias the very same object; wrap it once.
  if (observed in action) return;
  report('action.rendered-by-obsidian', () => {
    try { Object.defineProperty(action, observed, { value: true }); } catch { /* best effort */ }
    const post = (tabId: unknown, props: ActionProps) => {
      shared.bridge.post({ type: 'action.update', tabId: typeof tabId === 'number' && Number.isSafeInteger(tabId) ? tabId : null, props });
    };
    // What each setter changes, derived from its arguments.
    const changes: Record<string, (args: unknown[]) => Promise<Change> | Change> = {
      setTitle: ([d]) => [fields(d).tabId, { title: text(fields(d).title) }],
      setBadgeText: ([d]) => [fields(d).tabId, { badgeText: text(fields(d).text) }],
      setBadgeBackgroundColor: ([d]) => [fields(d).tabId, { badgeBackgroundColor: cssColor(fields(d).color) }],
      setBadgeTextColor: ([d]) => [fields(d).tabId, { badgeTextColor: cssColor(fields(d).color) }],
      setPopup: ([d]) => { const popup = popupPath(chrome, fields(d).popup); return popup === undefined ? null : [fields(d).tabId, { popup }]; },
      enable: ([tabId]) => [typeof tabId === 'number' ? tabId : null, { enabled: true }],
      disable: ([tabId]) => [typeof tabId === 'number' ? tabId : null, { enabled: false }],
      setIcon: async ([d]) => {
        const icon = await iconDataUrl(chrome, d).catch(() => undefined);
        return icon ? [fields(d).tabId, { icon }] : null;
      }
    };
    for (const [method, change] of Object.entries(changes)) {
      const original = fnOf(action, method);
      if (!original) continue;
      const wrapped: ApiFunction = (...args) => {
        const returned = original.apply(action, args);
        Promise.resolve(change(args)).then(result => { if (result) post(result[0], result[1]); }, () => undefined);
        return returned;
      };
      define(action, method, wrapped);
    }

    // Electron never fires its own onClicked; Obsidian's toolbar does.
    const onClicked = shared.once('action.onClicked', () => {
      const e = event();
      shared.bridge.on('action.clicked', async message => {
        if (Number.isSafeInteger(message.tab?.id)) emit(e, await fullTab(chrome, message.tab));
      });
      return e;
    });
    define(action, 'onClicked', onClicked);
    define(action, 'openPopup', (options?: unknown, callback?: unknown) => {
      if (callbackOf(options)) callback = options;
      return settle(shared.bridge.request('action.openPopup', {}, 5000).then(r => {
        if (!r?.opened) throw new Error('Failed to open popup.');
      }), callback);
    });

    // After (re)connecting, give the host the global state Electron kept
    // (tab-specific values and the icon cannot be read back).
    if (isWorker) {
      const snapshot = async () => {
        const read = (method: string, arg: unknown = {}) => missingFn(action, method) ? Promise.resolve(undefined) : invoke(chrome, action, method, arg).catch(() => undefined);
        const [title, badgeText, background, color, popup, enabled] = await Promise.all([
          read('getTitle'), read('getBadgeText'), read('getBadgeBackgroundColor'), read('getBadgeTextColor'), read('getPopup'), read('isEnabled', undefined)
        ]);
        // Electron answers '' where nothing was set (not the manifest
        // defaults), so only values that were really set are restored.
        const props: ActionProps = {};
        if (typeof title === 'string' && title) props.title = title;
        if (typeof badgeText === 'string' && badgeText) props.badgeText = badgeText;
        // Electron reports [0,0,0,0] when no color was set.
        const isSet = (v: unknown) => Array.isArray(v) && typeof v[3] === 'number' && v[3] > 0;
        const bg = cssColor(background), fg = cssColor(color);
        if (bg && isSet(background)) props.badgeBackgroundColor = bg;
        if (fg && isSet(color)) props.badgeTextColor = fg;
        const path = popupPath(chrome, popup);
        if (path) props.popup = path;
        if (enabled === false) props.enabled = false;
        shared.bridge.post({ type: 'action.reset', props });
      };
      shared.bridge.on('bridge.sync', () => { void snapshot(); });
      void snapshot();
    }
    info.modes.action = 'rendered by Obsidian in the Web Viewer toolbar (icon, badge, title, enabled, popup per tab); onClicked and openPopup work';
  });
}
