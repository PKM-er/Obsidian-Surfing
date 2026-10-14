import type { Bridge } from './bridge';
import type { CompatInfo } from './runtime';
import type { ChromeRoot, Namespace } from './chrome';
import type { ChromeManifest } from '../types';

/** State shared by every API root (`chrome` and Chromium's distinct `browser`). */
export interface SharedState {
  bridge: Bridge;
  /** webNavigation namespaces we filled; host events are emitted on each. */
  navigation: Set<Namespace>;
  /** contextMenus namespaces we filled. */
  contextMenus: Set<Namespace>;
  /** One object per key for every API root (events shared by `chrome` and `browser`). */
  once<T>(key: string, create: () => T): T;
}

export interface InstallContext {
  /** The API root being filled: globalThis.chrome or globalThis.browser. */
  c: ChromeRoot;
  /** The canonical chrome root (lastError lives here). */
  chrome: ChromeRoot;
  tag: string;
  info: CompatInfo;
  manifest: ChromeManifest;
  /** Declared required permissions (never optional ones). */
  granted: Set<string>;
  hosts: Set<string>;
  shared: SharedState;
  report: (key: string, fn: () => void) => void;
}
