// Helpers shared by the compat-layer API modules. This code runs inside the
// extension's own contexts (service worker, popup/options, bridge page).
import { text } from '../shared/text';
import { ApiEvent, ApiFunction, ChromeRoot, Namespace, callbackOf, eventOf, fnOf, fields } from './chrome';

declare const ServiceWorkerGlobalScope: (abstract new () => object) | undefined;

export interface CompatInfo {
  version: string;
  extensionId: string;
  installed: string[];
  failed: string[];
  /** Every API that is filled but behaves differently from Chrome. */
  modes: Record<string, string>;
  [key: string]: unknown;
}

export const isWorker = typeof ServiceWorkerGlobalScope === 'function' &&
  globalThis instanceof ServiceWorkerGlobalScope;

export function define(obj: unknown, key: string, value: unknown): void {
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) throw new Error(`Target missing for ${key}`);
  const target = obj as Namespace;
  try { Object.defineProperty(target, key, { configurable: true, enumerable: true, writable: false, value }); }
  catch { target[key] = value; }
  if (target[key] !== value) throw new Error(`${key} is not writable`);
}

/** Any event listener (extension code passes arbitrary functions). */
export type Listener = ApiFunction;

export interface ChromeEvent extends ApiEvent {
  hasListeners(): boolean;
}

interface EventState {
  listeners: Map<Listener, unknown>;
  /** Decides per listener filter whether a dispatch reaches it. */
  accepts?: (filter: unknown, args: unknown[]) => boolean;
  onChange?: () => void;
}
// Listener sets stay private; only shims holding the event can emit on it.
const events = new WeakMap<object, EventState>();

export function event(options: Omit<EventState, 'listeners'> = {}): ChromeEvent {
  const state: EventState = { listeners: new Map(), ...options };
  const api: ChromeEvent = {
    addListener(fn, filter) {
      if (typeof fn !== 'function') return;
      state.listeners.set(fn, filter);
      state.onChange?.();
    },
    removeListener(fn) { if (state.listeners.delete(fn)) state.onChange?.(); },
    hasListener(fn) { return state.listeners.has(fn); },
    hasListeners() { return state.listeners.size > 0; }
  };
  events.set(api, state);
  return api;
}

export const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  !!value && (typeof value === 'object' || typeof value === 'function') && typeof fields(value).then === 'function';

export function emit(target: unknown, ...args: unknown[]): void {
  const state = typeof target === 'object' && target !== null ? events.get(target) : undefined;
  if (!state) return;
  for (const [fn, filter] of [...state.listeners]) {
    if (state.accepts && !state.accepts(filter, args)) continue;
    try {
      const result = fn(...args);
      if (isThenable(result)) result.then(undefined, (e: unknown) => console.error('[Chrome Bridge] listener rejected:', e));
    } catch (e) { console.error('[Chrome Bridge] listener threw:', e); }
  }
}

/** Listener functions of an event created by event(), in registration order. */
export function listenersOf(target: unknown): Listener[] {
  return typeof target === 'object' && target !== null ? [...(events.get(target)?.listeners.keys() ?? [])] : [];
}

export function listenerCount(target: unknown): number {
  return typeof target === 'object' && target !== null ? events.get(target)?.listeners.size ?? 0 : 0;
}

export const later = (fn: () => void) => queueMicrotask(fn);

export function callbackOrPromise<T>(callback: unknown, value: T): Promise<T> {
  const cb = callbackOf(callback);
  if (cb) later(() => { cb(value); });
  return Promise.resolve(value);
}

/** Chrome APIs return a Promise only when no callback is passed. */
export function settle<T>(op: Promise<T>, callback?: unknown): Promise<T> | undefined {
  const cb = callbackOf(callback);
  if (!cb) return op;
  op.then(value => { cb(value); }, error => { console.warn('[Chrome Bridge]', error); cb(undefined); });
  return undefined;
}

/**
 * Call a native API that may be callback-style (lastError) or promise-style.
 * `T` is the result type the Chrome API documents for that method.
 */
export function invoke<T = unknown>(chrome: ChromeRoot, target: unknown, method: string, ...args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, value?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error instanceof Error ? error : new Error(text(error, 'Unknown error')));
      else resolve(value as T);
    };
    try {
      const fn = fnOf(target, method);
      if (!fn) throw new Error(`${method} is not available`);
      const returned = fn.call(target, ...args, (result: unknown) => {
        const message = chrome.runtime.lastError?.message;
        finish(message ? new Error(message) : null, result);
      });
      if (isThenable(returned)) returned.then(value => finish(null, value), (error: unknown) => finish(error));
    } catch (e) { finish(e); }
  });
}

export const missingFn = (obj: unknown, key: string) => !fnOf(obj, key);
export const missingEvent = (obj: unknown, key: string) => !eventOf(obj, key);
export function fillEvents(obj: unknown, names: readonly string[]): void {
  for (const name of names) if (missingEvent(obj, name)) define(obj, name, event());
}
