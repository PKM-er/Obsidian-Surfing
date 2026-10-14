/* Chrome Bridge compatibility layer. Runs only in managed extension contexts
 * (service worker, popup/options pages, the hidden bridge page), loaded before
 * the extension's own code. Never exposes Node/Electron APIs and never grants
 * permissions the manifest did not declare. Fills gaps; never replaces native
 * members. This is a local compatibility polyfill, not a Chrome replacement.
 */
import { createBridge } from './bridge';
import { ChromeRoot, Namespace, fnOf, isChromeRoot, isNamespace } from './chrome';
import type { ChromeManifest } from '../types';
import { text } from '../shared/text';
import type { InstallContext, SharedState } from './context';
import { CompatInfo, define, isWorker } from './runtime';
import { installCommands, installExtension, installI18n, installPermissions, installRuntimeExtras } from './apis/basics';
import { deliverWebNavigation, installWebNavigation } from './apis/web-navigation';
import { installStorage } from './apis/storage';
import { installAlarms } from './apis/alarms';
import { installContextMenus } from './apis/context-menus';
import { installTabs } from './apis/tabs';
import { installAction } from './apis/action';
import { installOpen, installPageOpen } from './apis/open';
import { installNetRequest } from './apis/net-request';
import { installUserScriptMessaging, installUserScripts } from './apis/user-scripts';
import { installNotifications } from './apis/notifications';
import { installCookies } from './apis/cookies';
import { installTabExtras, installWindows } from './apis/windows';

const VERSION = '0.15.0';

(() => {
  const g = globalThis as unknown as Namespace;
  const chrome = g.chrome;
  if (!isChromeRoot(chrome)) return;
  if (g.__obsidianBridgeCompatV06) return;
  const info: CompatInfo = { version: VERSION, extensionId: chrome.runtime.id, installed: [], failed: [], modes: {} };
  Object.defineProperty(g, '__obsidianBridgeCompatV06', { value: info, configurable: false });

  // Errors thrown while the original background module evaluates are otherwise
  // reported without stack. Register first so host diagnostics see the cause.
  if (isWorker && typeof globalThis.addEventListener === 'function') {
    const describe = (e: unknown) => e instanceof Error ? `${e.name}: ${e.message}\n${e.stack || ''}` : text(e, typeof e);
    globalThis.addEventListener('error', (ev: ErrorEvent) => console.error('[Chrome Bridge Worker] Uncaught:',
      describe(ev.error ?? ev.message), `${ev.filename || ''}:${ev.lineno || 0}:${ev.colno || 0}`));
    globalThis.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) =>
      console.error('[Chrome Bridge Worker] Unhandled rejection:', describe(ev.reason)));
    info.installed.push('worker.error-trap');
  }

  // Declared permissions come from the one extension manifest, whichever root asks.
  const manifest: ChromeManifest = (fnOf(chrome.runtime, 'getManifest') && chrome.runtime.getManifest?.()) || { manifest_version: 3, version: '0' };
  const strings = (value: unknown) => Array.isArray(value) ? (value as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const singletons = new Map<string, unknown>();
  const shared: SharedState = {
    bridge: createBridge(), navigation: new Set(), contextMenus: new Set(),
    once<T>(key: string, create: () => T): T {
      if (!singletons.has(key)) singletons.set(key, create());
      return singletons.get(key) as T;
    }
  };
  const installOn = (c: ChromeRoot, tag: string) => {
    const ctx: InstallContext = {
      c, chrome, tag, info, manifest, shared,
      granted: new Set(strings(manifest.permissions)),
      hosts: new Set(strings(manifest.host_permissions)),
      report(key, fn) {
        const name = tag + key;
        try { fn(); info.installed.push(name); } catch (error) { info.failed.push(`${name}: ${String(error)}`); }
      }
    };
    installI18n(ctx);
    installPermissions(ctx);
    installCommands(ctx);
    installExtension(ctx);
    installWebNavigation(ctx);
    installStorage(ctx);
    installAlarms(ctx);
    installContextMenus(ctx);
    installTabs(ctx);
    installAction(ctx);
    installOpen(ctx);
    installWindows(ctx);
    installTabExtras(ctx);
    installNotifications(ctx);
    installCookies(ctx);
    installNetRequest(ctx);
    installUserScripts(ctx);
    if (info.installed.includes('userScripts')) installUserScriptMessaging(ctx);
    installRuntimeExtras(ctx);
  };
  installOn(chrome, '');
  // Chromium also exposes a `browser` namespace that is a distinct object from
  // `chrome`, and libraries such as WXT prefer it whenever browser.runtime.id
  // exists. Namespaces it lacks are aliased to the very same objects on
  // `chrome` (one listener set, one state); remaining member gaps are filled.
  const alt = g.browser;
  if (isNamespace(alt) && alt !== chrome && typeof alt === 'object') {
    for (const key of ['i18n', 'permissions', 'commands', 'extension', 'webNavigation',
      'alarms', 'contextMenus', 'action', 'tabs', 'storage', 'scripting', 'windows', 'declarativeNetRequest', 'userScripts',
      'notifications', 'cookies']) {
      if (alt[key] == null && chrome[key] != null) {
        try { define(alt, key, chrome[key]); info.installed.push(`browser:${key}=chrome.${key}`); }
        catch (error) { info.failed.push(`browser:${key}: ${String(error)}`); }
      }
    }
    if (isChromeRoot(alt)) installOn(alt, 'browser:');
  }
  deliverWebNavigation({ shared });
  installPageOpen({ shared, info });
  info.bridge = shared.bridge.available ? 'broadcast-channel' : 'unavailable';

  // One string so Electron's serviceWorkers console-message carries the full report.
  console.debug('[Chrome Bridge Compat] ' + JSON.stringify(info));
  if (info.failed.length) console.warn('[Chrome Bridge] 部分 API 兼容层安装失败', info);
})();
