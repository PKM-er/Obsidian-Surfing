import type { Hotkey } from 'obsidian';
import type * as Electron from 'electron';

export interface ExtensionRecord {
  /** Managed folder name under extensions/ (store ID or random UUID for local). */
  key: string;
  source: 'store' | 'local';
  storeId: string | null;
  /** Chromium extension ID as loaded into the browser session. */
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  installedAt?: string;
}

export interface BridgeSettings {
  extensions: ExtensionRecord[];
  autoUpdate: boolean;
  compatibilityEnabled: boolean;
  /** Record keys shown directly in the browser tab header; null = not chosen yet. */
  pinned: string[] | null;
  /** Reload browser pages after extensions change instead of offering to. */
  autoReloadPages: boolean;
  /** Show diagnostic controls in popups and menus. */
  debug: boolean;
}

export const DEFAULT_SETTINGS: BridgeSettings = {
  extensions: [],
  autoUpdate: false,
  compatibilityEnabled: true,
  pinned: null,
  autoReloadPages: false,
  debug: false
};

/** How many extensions are pinned before the user chooses. */
export const DEFAULT_PINNED_COUNT = 2;

/** Loose view of a Chrome manifest; extension files are untrusted. */
export interface ChromeManifest {
  manifest_version: 2 | 3;
  name?: string;
  version: string;
  description?: string;
  default_locale?: string;
  icons?: Record<string, string> | string;
  permissions?: unknown[];
  host_permissions?: unknown[];
  content_scripts?: Array<{ matches?: unknown[] }>;
  action?: { default_popup?: string; default_title?: string; default_icon?: Record<string, string> | string };
  browser_action?: { default_popup?: string; default_title?: string; default_icon?: Record<string, string> | string };
  page_action?: { default_popup?: string; default_icon?: Record<string, string> | string };
  options_ui?: { page?: string; open_in_tab?: boolean };
  /** Manifest commands: name → { description, suggested_key }. Untrusted. */
  commands?: Record<string, { description?: unknown } | null>;
  options_page?: string;
  background?: { service_worker?: string; type?: string; scripts?: string[] };
  key?: string;
  [key: string]: unknown;
}

/** Electron <webview> element of a browser tab (Web Viewer or Surfing). */
export type WebviewTag = Electron.WebviewTag;

/**
 * The parts of Obsidian's undocumented App internals this plugin uses. All
 * optional: they are not public API and may change.
 */
export interface AppInternals {
  setting?: { open(): void; openTabById(id: string): void };
  commands?: { removeCommand(id: string): void };
  hotkeyManager?: {
    getHotkeys(id: string): Hotkey[] | undefined;
    getDefaultHotkeys(id: string): Hotkey[] | undefined;
  };
}

/** Obsidian's @electron/remote: main-process modules reachable from the renderer. */
export type Remote = typeof import('@electron/remote');
