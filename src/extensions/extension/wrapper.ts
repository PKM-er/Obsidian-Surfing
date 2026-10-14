// Alter ONLY the plugin-managed unpacked copy; source ZIP/CRX and vault notes
// stay unchanged. Preloads the compat layer before MV3 classic AND module
// worker evaluation, injects it into popup/options pages, and generates the
// hidden bridge page the host uses to talk to the extension.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ChromeManifest } from '../types';
import { text } from '../shared/text';
import { localeBundle, makeLocaleScript, LocaleBundle } from '../i18n/extension-i18n';
import { HOST_PAGE, HOST_SCRIPT, USER_SCRIPT_DIR } from '../shared/protocol';
import { tr } from '../i18n/strings';

const SCRIPT = '__obsidian_bridge_compat.js';
const META = '__obsidian_bridge_compat_state.json';
const ENTRY = '__obsidian_bridge_worker.js';
const BACKUP_PREFIX = '__obsidian_bridge_original_';
const LOCALE_SCRIPT = '__obsidian_bridge_locale_data.js';
/** Bump when the wrapped layout changes; a mismatch forces unwrap + rewrap. */
export const WRAPPER_VERSION = 8;
const MAX_PAGES = 300;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

export interface WrapOptions {
  enabled?: boolean;
  locale?: string;
  /** Built compat-api.js and bridge-host.js. Required where __dirname is absent (Obsidian). */
  compatSource?: string;
  hostSource?: string;
}
export interface WrapState {
  version: number;
  serviceWorker: { original: string; wrapper: string; type: 'module' | 'classic' } | null;
  html: Array<{ page: string; backup: string }>;
  warnings: string[];
  locale: string | null;
  hostPage?: string;
}

// Bundled into main.js, __dirname does not exist in Obsidian; the plugin
// passes explicit sources. Standalone (tests) the built files sit next to us.
const here = typeof __dirname === 'string' ? __dirname : '';
const sources = (options: WrapOptions) => ({
  compat: options.compatSource || path.join(here, 'compat-api.js'),
  host: options.hostSource || path.join(here, 'bridge-host.js')
});

// A fresh id per wrap (i.e. per Obsidian start) lets the compat layer expire
// chrome.storage.session data the way a browser restart does.
const localeScript = (bundle: LocaleBundle) => makeLocaleScript({ ...bundle, bridgeBootId: crypto.randomUUID() });

const HOST_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Chrome Bridge</title>
<script src="/${HOST_SCRIPT}"></script>
</head><body></body></html>
`;

function safeFile(root: string, value: string): string {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\\') || value.split('/').some(s => !s || s === '.' || s === '..') || /^[a-z]+:/i.test(value)) {
    throw new Error(tr('error.invalidFilePath', { path: String(value) }));
  }
  const resolved = path.resolve(root, value);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error(tr('error.pathOutside'));
  let current = root;
  for (const part of value.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(tr('error.pathSymlink'));
  }
  return resolved;
}
const manifestFile = (dir: string) => path.join(dir, 'manifest.json');
const read = (dir: string) => JSON.parse(fs.readFileSync(manifestFile(dir), 'utf8')) as ChromeManifest;
const readState = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as WrapState;
const write = (file: string, content: string) => fs.writeFileSync(file, content, 'utf8');

export function injectHtml(html: string): string {
  const tag = `<script src="/${LOCALE_SCRIPT}" data-obsidian-chrome-bridge="0.8"></script>\n<script src="/${SCRIPT}" data-obsidian-chrome-bridge="0.8"></script>`;
  // Insert before *all* existing extension scripts, including modules.
  const match = /<head\b[^>]*>/i.exec(html);
  if (match) return html.slice(0, match.index + match[0].length) + '\n' + tag + html.slice(match.index + match[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const index = doctype ? doctype[0].length : 0;
  return html.slice(0, index) + '\n' + tag + '\n' + html.slice(index);
}

/**
 * Every extension HTML page gets the compat layer: pages opened in tabs (an
 * install dialog, a dashboard) call the same APIs as the popup. Sandboxed
 * pages have no extension APIs and Bridge's own files are skipped.
 */
function extensionPages(dir: string, m: ChromeManifest): string[] {
  const sandboxPages = (m.sandbox as { pages?: unknown } | undefined)?.pages;
  const sandboxed = new Set<string>((Array.isArray(sandboxPages) ? sandboxPages as unknown[] : []).map(p => text(p).replace(/^\//, '')));
  const found: string[] = [];
  const walk = (rel: string, depth: number) => {
    if (depth > 6 || found.length >= MAX_PAGES) return;
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || entry.name.startsWith('__obsidian_bridge_') || entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) { if (entry.name !== '_locales' && entry.name !== '_metadata') walk(child, depth + 1); continue; }
      if (!/\.html?$/i.test(entry.name) || sandboxed.has(child)) continue;
      if (fs.statSync(path.join(dir, child)).size > MAX_PAGE_BYTES) continue;
      found.push(child);
    }
  };
  walk('', 0);
  return found;
}

/** Bridge page: loads the locale data and compat layer like any extension page. */
function writeHostPage(dir: string, hostSource: string): void {
  write(path.join(dir, HOST_PAGE), injectHtml(HOST_HTML));
  fs.copyFileSync(hostSource, path.join(dir, HOST_SCRIPT));
}

export function wrapExtension(dir: string, options: WrapOptions = {}): { applied: boolean; reason?: string } & Partial<WrapState> {
  const { enabled = true, locale = 'en' } = options;
  const src = sources(options);
  if (!enabled) { unwrapExtension(dir); return { applied: false, reason: 'disabled' }; }
  let m = read(dir);
  if (fs.existsSync(path.join(dir, META))) {
    const existing = readState(path.join(dir, META));
    if (existing.version === WRAPPER_VERSION) {
      // Same layout: refresh only Bridge-owned generated files so compat-api
      // fixes reach existing installs and the boot id changes every start.
      fs.copyFileSync(src.compat, path.join(dir, SCRIPT));
      writeHostPage(dir, src.host);
      const bundle = localeBundle(dir, m, locale);
      write(path.join(dir, LOCALE_SCRIPT), localeScript(bundle));
      return { applied: true, ...existing, locale: bundle.locale };
    }
    unwrapExtension(dir);
    m = read(dir);
  }
  const state: WrapState = { version: WRAPPER_VERSION, serviceWorker: null, html: [], warnings: [], locale: null };
  const originalManifest = fs.readFileSync(manifestFile(dir), 'utf8');
  try {
    // Generate only the selected UI locale + fallback from this extension's own
    // _locales. No remote requests; no mutation of the vendor's original assets.
    const bundle = localeBundle(dir, m, locale);
    state.locale = bundle.locale;
    for (const reserved of [LOCALE_SCRIPT, HOST_PAGE, HOST_SCRIPT]) {
      if (fs.existsSync(path.join(dir, reserved))) throw new Error(tr('error.reservedFile', { name: reserved }));
    }
    write(path.join(dir, LOCALE_SCRIPT), localeScript(bundle));
    const declared = m?.manifest_version === 3 && m.background?.service_worker;
    if (declared) {
      // Chrome resolves manifest paths from the extension root: "/js/bg.js" is "js/bg.js" (uBlock Origin Lite).
      const background = declared.replace(/^\//, '');
      const file = safeFile(dir, background);
      if (!fs.statSync(file).isFile()) throw new Error(tr('error.workerEntryNotFile'));
      const folder = path.posix.dirname(background);
      const wrapperRel = folder === '.' ? ENTRY : `${folder}/${ENTRY}`;
      if (fs.existsSync(safeFile(dir, wrapperRel))) throw new Error(tr('error.reservedWorkerFile'));
      const relative = (target: string) => {
        const rel = path.posix.relative(folder, target);
        return rel.startsWith('.') ? rel : `./${rel}`;
      };
      const compatRel = relative(SCRIPT);
      const localeRel = relative(LOCALE_SCRIPT);
      const originalRel = './' + path.posix.basename(background);
      const isModule = m.background?.type === 'module';
      // ESM evaluates side-effect imports in dependency order. The original
      // module retains its own URL, so its relative imports still resolve.
      // A classic worker must instead use importScripts (ESM import is invalid).
      const lines = isModule ? [
        '// Chrome Bridge: MV3 ESM worker bootstrap (local extension files only)',
        `import ${JSON.stringify(localeRel)};`,
        `import ${JSON.stringify(compatRel)};`,
        `import ${JSON.stringify(originalRel)};`
      ] : [
        '// Chrome Bridge: MV3 classic worker bootstrap',
        `importScripts(${JSON.stringify(localeRel)});`,
        `importScripts(${JSON.stringify(compatRel)});`,
        `importScripts(${JSON.stringify(originalRel)});`
      ];
      write(safeFile(dir, wrapperRel), lines.join('\n') + '\n');
      state.serviceWorker = { original: declared, wrapper: wrapperRel, type: isModule ? 'module' : 'classic' };
      if (m.background) m.background.service_worker = wrapperRel;
    }
    // Popup and options pages are extension-origin HTML, not arbitrary site pages.
    const pageCandidates = [m.action?.default_popup, m.browser_action?.default_popup,
      m.page_action?.default_popup, m.options_ui?.page, m.options_page];
    const pages = [...new Set([
      ...pageCandidates.filter((s): s is string => typeof s === 'string' && !!s).map(s => s.split(/[?#]/)[0].replace(/^\//, '')),
      ...extensionPages(dir, m)
    ])];
    for (const page of pages) {
      const file = safeFile(dir, page);
      if (!fs.existsSync(file)) { state.warnings.push(tr('warning.pageNotFound', { page })); continue; }
      if (!/\.html?$/i.test(page)) { state.warnings.push(tr('warning.skipNonHtml', { page })); continue; }
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('data-obsidian-chrome-bridge')) continue;
      const id = crypto.createHash('sha256').update(page).digest('hex').slice(0, 12);
      const backup = BACKUP_PREFIX + id + '.html';
      if (fs.existsSync(safeFile(dir, backup))) throw new Error(tr('error.reservedHtmlBackup'));
      write(safeFile(dir, backup), content);
      write(file, injectHtml(content));
      state.html.push({ page, backup });
    }
    // Copy in managed copy, not the source extension archive.
    fs.copyFileSync(src.compat, path.join(dir, SCRIPT));
    writeHostPage(dir, src.host);
    state.hostPage = HOST_PAGE;
    write(manifestFile(dir), JSON.stringify(m, null, 2));
    write(path.join(dir, META), JSON.stringify(state, null, 2));
    return { applied: true, ...state };
  } catch (error) {
    // Preparation must be transactional: leave no half-wrapped extension.
    for (const { page, backup } of state.html) {
      try {
        const source = safeFile(dir, backup);
        if (fs.existsSync(source)) fs.copyFileSync(source, safeFile(dir, page));
        fs.rmSync(source, { force: true });
      } catch (rollbackError) { console.error('[Chrome Bridge] HTML 回滚失败', rollbackError); }
    }
    if (state.serviceWorker) {
      try { fs.rmSync(safeFile(dir, state.serviceWorker.wrapper), { force: true }); } catch { /* best effort */ }
    }
    for (const generated of [SCRIPT, LOCALE_SCRIPT, HOST_PAGE, HOST_SCRIPT, META]) {
      try { fs.rmSync(path.join(dir, generated), { force: true }); } catch { /* best effort */ }
    }
    try { write(manifestFile(dir), originalManifest); } catch { /* best effort */ }
    throw error;
  }
}

export function unwrapExtension(dir: string): boolean {
  const file = path.join(dir, META);
  if (!fs.existsSync(file)) return false;
  const state = readState(file);
  const m = read(dir);
  if (state.serviceWorker) {
    if (m.background?.service_worker === state.serviceWorker.wrapper) m.background.service_worker = state.serviceWorker.original;
    fs.rmSync(safeFile(dir, state.serviceWorker.wrapper), { force: true });
  }
  for (const { page, backup } of state.html || []) {
    const target = safeFile(dir, page), source = safeFile(dir, backup);
    if (fs.existsSync(source)) fs.copyFileSync(source, target);
    fs.rmSync(source, { force: true });
  }
  for (const generated of [SCRIPT, LOCALE_SCRIPT, HOST_PAGE, HOST_SCRIPT]) fs.rmSync(path.join(dir, generated), { force: true });
  // Generated user-script files only exist while the compat layer is active.
  fs.rmSync(path.join(dir, USER_SCRIPT_DIR), { recursive: true, force: true });
  write(manifestFile(dir), JSON.stringify(m, null, 2));
  fs.rmSync(file, { force: true });
  return true;
}

export function status(dir: string): { applied: boolean; version?: number; locale?: string | null; serviceWorker?: WrapState['serviceWorker']; pages?: string[]; warnings?: string[]; hostPage?: boolean } {
  const file = path.join(dir, META);
  if (!fs.existsSync(file)) return { applied: false };
  const { version, locale, serviceWorker, html, warnings } = readState(file);
  return {
    applied: true, version, locale, serviceWorker, pages: html?.map(x => x.page) || [], warnings: warnings || [],
    hostPage: fs.existsSync(path.join(dir, HOST_PAGE))
  };
}
