// chrome.cookies is not in Electron's extension API subset. Obsidian answers
// from the Web Viewer session's cookie store, with Chrome's checks: the
// "cookies" permission and host access to each cookie's URL. There is one
// store ("0"), as in a Chrome profile without incognito.
import type { InstallContext } from '../context';
import { define, emit, event, isWorker, listenerCount, settle } from '../runtime';

const STORE = { id: '0', tabIds: [] as number[] };

export function installCookies(ctx: InstallContext): void {
  const { c, granted, info, shared, report } = ctx;
  if (!granted.has('cookies') || c.cookies || !shared.bridge.available) return;
  report('cookies', () => {
    const onChanged = shared.once('cookies.onChanged', () => {
      let announced = false;
      const announce = () => {
        const active = listenerCount(e) > 0;
        // The worker speaks for the extension; a page only ever adds interest.
        if (active === announced || (!isWorker && !active)) return;
        announced = active;
        shared.bridge.post({ type: 'cookies.listeners', active });
      };
      const e = event({ onChange: announce });
      shared.bridge.on('cookies.changed', message => { if (message.info?.cookie) emit(e, message.info); });
      shared.bridge.on('bridge.sync', () => { if (announced) shared.bridge.post({ type: 'cookies.listeners', active: true }); });
      return e;
    });
    const call = <T>(method: 'cookies.get' | 'cookies.getAll' | 'cookies.set' | 'cookies.remove', details: unknown, callback?: unknown) =>
      settle(shared.bridge.request(method, JSON.parse(JSON.stringify(details ?? {})) as Record<string, unknown> & { url: string; name: string }, 10000) as Promise<T>, callback);
    define(c, 'cookies', {
      get: (details: unknown, callback?: unknown) => call('cookies.get', details, callback),
      getAll: (details: unknown, callback?: unknown) => call('cookies.getAll', details, callback),
      set: (details: unknown, callback?: unknown) => call('cookies.set', details, callback),
      remove: (details: unknown, callback?: unknown) => call('cookies.remove', details, callback),
      getAllCookieStores: (callback?: unknown) => settle(Promise.resolve([{ ...STORE, tabIds: [...STORE.tabIds] }]), callback),
      getPartitionKey: (_details: unknown, callback?: unknown) => settle(Promise.resolve({ partitionKey: {} }), callback),
      onChanged,
      OnChangedCause: { EVICTED: 'evicted', EXPIRED: 'expired', EXPLICIT: 'explicit', EXPIRED_OVERWRITE: 'expired_overwrite', OVERWRITE: 'overwrite' },
      SameSiteStatus: { NO_RESTRICTION: 'no_restriction', LAX: 'lax', STRICT: 'strict', UNSPECIFIED: 'unspecified' }
    });
    info.modes.cookies = 'the Web Viewer session cookie store (one store "0"); partitioned cookies are not supported';
  });
}
