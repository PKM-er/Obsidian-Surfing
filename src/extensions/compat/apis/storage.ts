import type { InstallContext } from '../context';
import { callbackOrPromise, define, emit, event, invoke, settle } from '../runtime';
import { ChromeRoot, callbackOf, eventOf, fields, nsOf } from '../chrome';

type Items = Record<string, unknown>;

// A storage area kept in storage.local under a disjoint key prefix. Change
// events are derived from real storage.local changes, never fabricated.
// Quotas are reported for feature detection but not enforced.
function prefixedArea(chrome: ChromeRoot, c: ChromeRoot, prefix: string, before: () => Promise<unknown> = () => Promise.resolve()) {
  const storage = nsOf(c, 'storage');
  const local = nsOf(storage, 'local');
  const call = (method: string, ...args: unknown[]) => before().then(() => invoke(chrome, local, method, ...args));
  const clone = (data: unknown): unknown => data === undefined ? null : JSON.parse(JSON.stringify(data));
  const fromLocal = (all: unknown) => {
    const out: Items = {};
    for (const [k, v] of Object.entries(fields(all))) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    return out;
  };
  const select = (all: Items, keys: unknown) => {
    if (keys == null) return all;
    const selected: Items = {};
    const wanted = typeof keys === 'string' ? [keys] : keys;
    if (Array.isArray(wanted)) { for (const k of wanted) if (typeof k === 'string' && Object.hasOwn(all, k)) selected[k] = all[k]; }
    else if (wanted && typeof wanted === 'object') {
      for (const [k, v] of Object.entries(wanted)) selected[k] = Object.hasOwn(all, k) ? all[k] : v;
    }
    return selected;
  };
  const onChanged = event();
  eventOf(storage, 'onChanged')?.addListener((changes: unknown, areaName: unknown) => {
    if (areaName !== 'local') return;
    const out = fromLocal(changes);
    if (Object.keys(out).length) emit(onChanged, out);
  });
  const get = (keys: unknown) => call('get', null).then(all => select(fromLocal(all), keys));
  return {
    onChanged,
    get(keys?: unknown, callback?: unknown) {
      if (callbackOf(keys)) { callback = keys; keys = null; }
      return settle(get(keys), callback);
    },
    getKeys(callback?: unknown) {
      return settle(call('get', null).then(all => Object.keys(fromLocal(all))), callback);
    },
    set(data: unknown, callback?: unknown) {
      const values: Items = {};
      for (const [k, v] of Object.entries(fields(data))) values[prefix + k] = clone(v);
      return settle(call('set', values).then(() => undefined), callback);
    },
    remove(keys: unknown, callback?: unknown) {
      const names = (Array.isArray(keys) ? keys as unknown[] : [keys]).filter((k): k is string => typeof k === 'string').map(k => prefix + k);
      return settle(call('remove', names).then(() => undefined), callback);
    },
    clear(callback?: unknown) {
      const op = call('get', null).then(all => invoke(chrome, local, 'remove', Object.keys(fields(all)).filter(k => k.startsWith(prefix))));
      return settle(op.then(() => undefined), callback);
    },
    getBytesInUse(keys?: unknown, callback?: unknown) {
      if (callbackOf(keys)) { callback = keys; keys = null; }
      const op = get(keys).then(obj => new TextEncoder().encode(JSON.stringify(obj)).length);
      return settle(op, callback);
    }
  };
}

export function installStorage({ c, chrome, granted, info, report }: InstallContext): void {
  const storage = nsOf(c, 'storage');
  const local = nsOf(storage, 'local');
  if (!storage || !local || !granted.has('storage')) return;
  // Electron exposes chrome.storage.sync but rejects calls. Use a *local-only*
  // backing area. Nothing is sent to Chrome sync.
  report('storage.sync-local', () => {
    const area = Object.assign(prefixedArea(chrome, c, '__obsidian_bridge_sync_v1__'), {
      QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_ITEMS: 512,
      MAX_WRITE_OPERATIONS_PER_HOUR: 1800, MAX_WRITE_OPERATIONS_PER_MINUTE: 120
    });
    define(storage, 'sync', area);
    info.modes.storageSync = 'local-only: stored in storage.local, never synced';
  });
  // Electron's storage.managed rejects every call, which some extensions
  // (e.g. Tampermonkey) retry with back-off during startup. Without enterprise
  // policies Chrome's managed area is simply empty and read-only.
  report('storage.managed-empty', () => {
    const readOnly = () => Promise.reject(new Error('This is a read-only store.'));
    const area = {
      onChanged: eventOf(nsOf(storage, 'managed'), 'onChanged') ?? event(),
      get(keys?: unknown, callback?: unknown) {
        if (callbackOf(keys)) { callback = keys; keys = null; }
        // Defaults passed as an object are returned unchanged, like an empty store.
        const result = keys && typeof keys === 'object' && !Array.isArray(keys) ? { ...keys } : {};
        return settle(Promise.resolve(result), callback);
      },
      getBytesInUse(keys?: unknown, callback?: unknown) {
        if (callbackOf(keys)) callback = keys;
        return settle(Promise.resolve(0), callback);
      },
      set: (_items: unknown, callback?: unknown) => settle(readOnly(), callback),
      remove: (_keys: unknown, callback?: unknown) => settle(readOnly(), callback),
      clear: (callback?: unknown) => settle(readOnly(), callback)
    };
    define(storage, 'managed', area);
    info.modes.storageManaged = 'empty and read-only (no enterprise policies in Obsidian)';
  });
  // chrome.storage.session is shared by all extension contexts and dropped
  // when the browser restarts. The host writes a fresh bridgeBootId on every
  // Obsidian start; a changed id means the previous session's values are stale.
  if (!storage.session) report('storage.session-local', () => {
    const prefix = '__obsidian_bridge_session_v1__';
    const markerKey = '__obsidian_bridge_session_boot_v1__';
    const bootId = fields(fields(globalThis).__obsidianBridgeLocaleData).bridgeBootId;
    let ready: Promise<unknown> | null = null;
    const resetIfNewBoot = () => ready ||= (typeof bootId !== 'string' ? Promise.resolve() :
      invoke(chrome, local, 'get', null).then(raw => {
        const all = fields(raw);
        if (all[markerKey] === bootId) return;
        const stale = Object.keys(all).filter(k => k.startsWith(prefix));
        return (stale.length ? invoke(chrome, local, 'remove', stale) : Promise.resolve())
          .then(() => invoke(chrome, local, 'set', { [markerKey]: bootId }));
      }).catch(e => console.warn('[Chrome Bridge] storage.session reset:', e)));
    const area = Object.assign(prefixedArea(chrome, c, prefix, resetIfNewBoot), {
      QUOTA_BYTES: 10485760,
      setAccessLevel: (_options: unknown, callback?: unknown) => callbackOrPromise(callback, undefined)
    });
    define(storage, 'session', area);
    info.modes.storageSession = typeof bootId === 'string'
      ? 'kept in storage.local under a private prefix; cleared on each Obsidian start'
      : 'kept in storage.local under a private prefix; NOT cleared (host boot id missing)';
    void resetIfNewBoot();
  });
}
