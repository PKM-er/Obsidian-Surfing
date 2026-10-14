import type { InstallContext } from '../context';
import { callbackOrPromise, define, emit, event, settle } from '../runtime';
import { eventOf, fields, fnOf, nsOf } from '../chrome';
import { fullTab } from './action';
import { patternCovers } from '../../shared/url-match';
import { text } from '../../shared/text';
import type { LocaleBundle } from '../../i18n/extension-i18n';

// Chrome's i18n facade is not part of Electron's guaranteed extension APIs.
// Consult only messages generated from this extension's own _locales, without
// replacing a functioning native implementation.
export function installI18n({ c, report }: InstallContext): void {
  if (fnOf(c.i18n, 'getMessage')) return;
  report('i18n', () => {
    const original = nsOf(c, 'i18n') ?? {};
    // Written by the host (i18n/extension-i18n.ts makeLocaleScript) before this script.
    const bundle = (fields(globalThis).__obsidianBridgeLocaleData ?? {}) as Partial<LocaleBundle>;
    const locale = bundle.locale || 'en';
    const getMessage = (name: unknown, substitutions?: unknown) => {
      const key = text(name).toLowerCase();
      if (key === '@@extension_id') return c.runtime.id;
      if (key === '@@ui_locale') return locale;
      const rtl = /^(ar|he|fa|ur)(_|$)/i.test(locale);
      if (key === '@@bidi_dir') return rtl ? 'rtl' : 'ltr';
      if (key === '@@bidi_reversed_dir') return rtl ? 'ltr' : 'rtl';
      if (key === '@@bidi_start_edge') return rtl ? 'right' : 'left';
      if (key === '@@bidi_end_edge') return rtl ? 'left' : 'right';
      const entry = bundle.messages?.[key];
      if (!entry || typeof entry.message !== 'string') return '';
      const subs: unknown[] = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions as unknown[] : [substitutions];
      const placeholders: Record<string, string> = {};
      for (const [k, v] of Object.entries(entry.placeholders || {})) {
        if (typeof v?.content === 'string')
          placeholders[k.toLowerCase()] = v.content.replace(/\$(\d)/g, (_m: string, n: string) => text(subs[Number(n) - 1]));
      }
      return entry.message.replace(/\$\$|\$([\w@]+)\$/g, (token: string, name: string) => {
        if (token === '$$') return '$';
        if (/^\d+$/.test(name)) return text(subs[Number(name) - 1]);
        return placeholders[name.toLowerCase()] ?? token;
      });
    };
    define(c, 'i18n', Object.assign({
      getMessage,
      getUILanguage: () => locale.replace(/_/g, '-'),
      getAcceptLanguages: (callback?: unknown) => callbackOrPromise(callback, [locale.replace(/_/g, '-')])
    }, original));
  });
}

const strings = (value: unknown): string[] => Array.isArray(value) ? (value as unknown[]).filter((x): x is string => typeof x === 'string') : [];

// Declared required permissions were shown and approved at install time.
// Optional permissions have NOT been granted, and this shim never grants them.
export function installPermissions({ c, granted, hosts, report }: InstallContext): void {
  if (fnOf(c.permissions, 'contains')) return;
  report('permissions', () => {
    const existing = nsOf(c, 'permissions') ?? {};
    const shim = {
      onRemoved: eventOf(existing, 'onRemoved') ?? event(),
      onAdded: eventOf(existing, 'onAdded') ?? event(),
      contains(query: unknown, callback?: unknown) {
        const { permissions, origins } = fields(query);
        // A requested origin is granted when a declared host pattern covers it.
        return callbackOrPromise(callback, strings(permissions).every(x => granted.has(x)) &&
          strings(origins).every(x => [...hosts].some(g => patternCovers(g, x))));
      },
      getAll(callback?: unknown) { return callbackOrPromise(callback, { permissions: [...granted], origins: [...hosts] }); },
      request(_query: unknown, callback?: unknown) { return callbackOrPromise(callback, false); },
      remove(_query: unknown, callback?: unknown) { return callbackOrPromise(callback, false); }
    };
    define(c, 'permissions', Object.assign(shim, existing));
  });
}

// Manifest commands appear in Obsidian's command palette, where the user
// binds hotkeys; running one dispatches onCommand (or opens the popup for
// _execute_action). Electron has no chrome.commands of its own.
const commandsFilled = Symbol.for('obsidian-bridge.commands');
export function installCommands({ c, manifest, shared, report }: InstallContext): void {
  const current = nsOf(c, 'commands');
  if ((current && commandsFilled in current) || (eventOf(current, 'onCommand') && !shared.bridge.available)) return;
  report('commands', () => {
    const existing = current ?? {};
    const onCommand = shared.once('commands.onCommand', () => {
      const e = event();
      shared.bridge.on('commands.command', async message => {
        if (typeof message.command !== 'string') return;
        const tab: unknown = message.tab && Number.isSafeInteger(message.tab.id) ? await fullTab(c, message.tab) : undefined;
        emit(e, message.command, tab);
      });
      return e;
    });
    const declared = fields(manifest.commands);
    const getAll = (callback?: unknown) => settle((async () => {
      let shortcuts: Record<string, string> = {};
      if (shared.bridge.available) shortcuts = await shared.bridge.request('commands.shortcuts', {}, 3000).catch(() => ({}));
      return Object.entries(declared).map(([name, value]) => {
        const description = fields(value).description;
        return { name, description: typeof description === 'string' ? description : '', shortcut: typeof shortcuts[name] === 'string' ? shortcuts[name] : '' };
      });
    })(), callback);
    const commands = Object.assign(existing, { onCommand, getAll });
    define(c, 'commands', commands);
    try { Object.defineProperty(commands, commandsFilled, { value: true }); } catch { /* best effort */ }
  });
}

export function installExtension({ c, report }: InstallContext): void {
  if (fnOf(c.extension, 'isAllowedFileSchemeAccess')) return;
  report('extension.fileSchemeAccess', () => {
    const existing = nsOf(c, 'extension') ?? {};
    if (!fnOf(existing, 'isAllowedFileSchemeAccess')) {
      define(existing, 'isAllowedFileSchemeAccess', (callback?: unknown) => callbackOrPromise(callback, false));
    }
    if (!fnOf(existing, 'isAllowedIncognitoAccess')) {
      define(existing, 'isAllowedIncognitoAccess', (callback?: unknown) => callbackOrPromise(callback, false));
    }
    if (!c.extension) define(c, 'extension', existing);
  });
}

// Chrome opens this URL after uninstall. Obsidian never does; accept it.
export function installRuntimeExtras({ c, info, report }: InstallContext): void {
  if (fnOf(c.runtime, 'setUninstallURL')) return;
  report('runtime.setUninstallURL-ignored', () => {
    define(c.runtime, 'setUninstallURL', (_url: unknown, callback?: unknown) => callbackOrPromise(callback, undefined));
    info.modes.setUninstallURL = 'accepted and ignored';
  });
}
