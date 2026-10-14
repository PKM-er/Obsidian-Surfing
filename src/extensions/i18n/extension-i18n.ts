// Resolve Chrome extension manifest localization from its unpacked _locales.
// Never alter the original manifest string or trust paths from the extension.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { text } from '../shared/text';

const TOKEN = /^__MSG_([\w@]+)__$/i;
const LOCALE = /^[a-z]{2,3}(?:_[A-Za-z0-9]{2,8}){0,2}$/i;
const MAX_LOCALE_FILE = 2 * 1024 * 1024;

export interface LocaleMessage { message: string; placeholders: Record<string, { content?: string }> }
export interface LocaleBundle { locale: string; defaultLocale: string; messages: Record<string, LocaleMessage> }

export function normalizedLocale(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/-/g, '_');
  return LOCALE.test(name) ? name : null;
}

export function localeCandidates(preferred: unknown, fallback: unknown): string[] {
  const out: string[] = [];
  const add = (loc: unknown) => { const s = normalizedLocale(loc); if (s && !out.includes(s)) out.push(s); };
  const chosen = normalizedLocale(preferred);
  if (chosen) { add(chosen); add(chosen.split('_')[0]); }
  add(fallback); add('en');
  return out;
}

function readLocale(dir: string, locale: string): Record<string, LocaleMessage> {
  const name = normalizedLocale(locale);
  if (!name) return {};
  const file = path.join(dir, '_locales', name, 'messages.json');
  try {
    const root = fs.realpathSync(dir);
    const real = fs.realpathSync(file);
    if (!real.startsWith(root + path.sep)) return {};
    if (fs.statSync(real).size > MAX_LOCALE_FILE) return {};
    const parsed = JSON.parse(fs.readFileSync(real, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const messages: Record<string, LocaleMessage> = {};
    for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = (raw && typeof raw === 'object' ? raw : {}) as { message?: unknown; placeholders?: unknown };
      if (typeof entry.message !== 'string') continue;
      const placeholders: LocaleMessage['placeholders'] = {};
      if (entry.placeholders && typeof entry.placeholders === 'object') {
        for (const [name, value] of Object.entries(entry.placeholders as Record<string, unknown>)) {
          const content = (value && typeof value === 'object' ? value as { content?: unknown } : {}).content;
          if (typeof content === 'string') placeholders[name] = { content };
        }
      }
      messages[key.toLowerCase()] = { message: entry.message, placeholders };
    }
    return messages;
  } catch { return {}; }
}

export function localeBundle(dir: string, manifest: { default_locale?: unknown }, preferred: unknown): LocaleBundle {
  const defaultLocale = normalizedLocale(manifest.default_locale) || 'en';
  const locales = localeCandidates(preferred, defaultLocale);
  const defaultMessages = readLocale(dir, defaultLocale);
  let matched = defaultLocale;
  let currentMessages = defaultMessages;
  // Prefer exact/current UI locale, falling back to the manifest default.
  for (const name of locales) {
    const obj = readLocale(dir, name);
    if (Object.keys(obj).length) { matched = name; currentMessages = obj; break; }
  }
  return { locale: matched, defaultLocale, messages: { ...defaultMessages, ...currentMessages } };
}

export function getMessage(bundle: LocaleBundle, name: unknown, substitutions: unknown = []): string {
  const key = text(name).toLowerCase();
  if (key === '@@ui_locale') return bundle.locale || bundle.defaultLocale || 'en';
  if (key === '@@bidi_dir') return /^(ar|he|fa|ur)(_|$)/i.test(bundle.locale) ? 'rtl' : 'ltr';
  const e = bundle.messages?.[key];
  if (!e) return '';
  const values = Array.isArray(substitutions) ? substitutions : [substitutions];
  const placeholderValues: Record<string, string> = {};
  for (const [k, value] of Object.entries(e.placeholders || {})) {
    if (typeof value?.content === 'string') {
      placeholderValues[k.toLowerCase()] = value.content.replace(/\$(\d)/g, (_m, n: string) => text(values[Number(n) - 1]));
    }
  }
  // Match Chrome's case-insensitive substitution names and $$ escape.
  return e.message.replace(/\$\$|\$([\w@]+)\$/g, (full: string, k: string) => {
    if (full === '$$') return '$';
    if (/^\d+$/.test(k)) return text(values[Number(k) - 1]);
    return placeholderValues[k.toLowerCase()] ?? full;
  });
}

export function localizedField<T>(dir: string, manifest: { default_locale?: unknown }, value: T, preferred: unknown): T | string {
  if (typeof value !== 'string') return value;
  const match = TOKEN.exec(value);
  if (!match) return value;
  return getMessage(localeBundle(dir, manifest, preferred), match[1]) || value;
}

export function makeLocaleScript(bundle: object): string {
  // Plain JS file loaded as an extension script before any other wrapper.
  return 'globalThis.__obsidianBridgeLocaleData = ' + JSON.stringify(bundle)
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';\n';
}
