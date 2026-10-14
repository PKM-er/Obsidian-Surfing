// Extension-side end of the host channel. All extension contexts (worker,
// pages, the hidden bridge page) share one BroadcastChannel because they share
// the chrome-extension:// origin; the host itself only reaches it through the
// bridge page. Nothing here is visible to websites.
import { CHANNEL_NAME, Envelope, ExtensionToHost, HostMethod, HostMethods, HostToExtension } from '../shared/protocol';

type HostMessage<T extends HostToExtension['type']> = Extract<HostToExtension, { type: T }>;

export class BridgeUnavailable extends Error {}

export interface Bridge {
  readonly available: boolean;
  post(message: Exclude<ExtensionToHost, { type: 'request' }>): void;
  on<T extends HostToExtension['type']>(type: T, handler: (message: HostMessage<T>) => void | Promise<void>): void;
  /** Ask the host; rejects with BridgeUnavailable when it does not answer in time. */
  request<M extends HostMethod>(method: M, params: HostMethods[M]['params'], timeoutMs?: number): Promise<HostMethods[M]['result']>;
}

export function createBridge(): Bridge {
  type Handler = (message: HostToExtension) => void | Promise<void>;
  const handlers = new Map<string, Handler[]>();
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let channel: BroadcastChannel | null = null;
  try { channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null; }
  catch { channel = null; }
  // Node (used by tests) keeps a process alive while a channel is open.
  (channel as unknown as { unref?: () => void } | null)?.unref?.();
  channel?.addEventListener('message', event => {
    const data = event.data as Envelope;
    if (!data || data.v !== 1 || data.from !== 'host' || typeof data.type !== 'string') return;
    if (data.type === 'response') {
      // Every context hears every response; only the requester has it pending.
      const waiter = pending.get(data.requestId);
      if (!waiter) return;
      pending.delete(data.requestId);
      if (typeof data.error === 'string') waiter.reject(new Error(data.error));
      else waiter.resolve(data.result);
      return;
    }
    for (const handler of handlers.get(data.type) || []) {
      try {
        const result = handler(data);
        if (result instanceof Promise) result.catch(e => console.error('[Chrome Bridge] host message handler failed:', e));
      } catch (e) { console.error('[Chrome Bridge] host message handler failed:', e); }
    }
  });
  const send = (message: ExtensionToHost) => {
    try { channel?.postMessage({ v: 1, from: 'extension', ...message }); } catch (e) { console.warn('[Chrome Bridge] post failed:', e); }
  };
  return {
    available: !!channel,
    post: send,
    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, []);
      // Dispatch only hands a handler the messages of its own type.
      handlers.get(type)!.push(handler as Handler);
    },
    request(method, params, timeoutMs = 5000) {
      if (!channel) return Promise.reject(new BridgeUnavailable('Obsidian host channel unavailable'));
      const requestId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new BridgeUnavailable(`Obsidian did not answer ${method}`));
        }, timeoutMs);
        pending.set(requestId, {
          // The host answers with the result type the protocol declares for `method`.
          resolve: value => { clearTimeout(timer); resolve(value as HostMethods[typeof method]['result']); },
          reject: error => { clearTimeout(timer); reject(error); }
        });
        send({ type: 'request', requestId, method, params });
      });
    }
  };
}
