// Types for the Chrome extension API objects the compat layer reads and
// fills. Any member may be native, missing, or ours, and its runtime shape is
// not guaranteed, so members are `unknown` and narrowed with the guards below
// before use. Values that come from extension code are `unknown` as well.
import type { ChromeManifest } from '../types';

/** A callable API member or listener: invoked with whatever the caller passes. */
export type ApiFunction = (...args: unknown[]) => unknown;

/** chrome.events.Event */
export interface ApiEvent {
  addListener(fn: ApiFunction, filter?: unknown): void;
  removeListener(fn: ApiFunction): void;
  hasListener(fn: ApiFunction): boolean;
  hasListeners?(): boolean;
}

/** An API namespace (chrome.tabs, chrome.action, …) or any other API object. */
export interface Namespace { [member: string]: unknown }

export interface Runtime extends Namespace {
  id: string;
  lastError?: { message?: string };
  getURL(path: string): string;
  getManifest?(): ChromeManifest;
}

/** globalThis.chrome, or Chromium's distinct globalThis.browser. */
export interface ChromeRoot extends Namespace {
  runtime: Runtime;
}

export const isNamespace = (value: unknown): value is Namespace =>
  !!value && (typeof value === 'object' || typeof value === 'function');

/** obj[key] when it is an object (a namespace or other API object). */
export function nsOf(obj: unknown, key: string): Namespace | undefined {
  const value = isNamespace(obj) ? obj[key] : undefined;
  return isNamespace(value) ? value : undefined;
}

/** obj[key] when it is a function. */
export function fnOf(obj: unknown, key: string): ApiFunction | undefined {
  const value = isNamespace(obj) ? obj[key] : undefined;
  return typeof value === 'function' ? value as ApiFunction : undefined;
}

export const isEvent = (value: unknown): value is ApiEvent =>
  isNamespace(value) && typeof value.addListener === 'function';

/** obj[key] when it is an event (has addListener). */
export function eventOf(obj: unknown, key: string): ApiEvent | undefined {
  const value = isNamespace(obj) ? obj[key] : undefined;
  return isEvent(value) ? value : undefined;
}

/** A callback argument, if the caller passed one. */
export const callbackOf = (value: unknown): ApiFunction | undefined =>
  typeof value === 'function' ? value as ApiFunction : undefined;

/** Fields of an untrusted object (an empty record for anything else). */
export const fields = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

/** An extension API root: chrome or browser with a runtime that has an extension ID. */
export const isChromeRoot = (value: unknown): value is ChromeRoot => {
  const id = fields(fields(value).runtime).id;
  return typeof id === 'string' && !!id;
};
