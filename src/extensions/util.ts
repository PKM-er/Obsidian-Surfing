import { Notice } from 'obsidian';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChromeManifest } from './types';
import { tr } from './i18n/strings';

export function notify(message: string | DocumentFragment, time = 5500): Notice {
  if (typeof message === 'string') return new Notice(tr('notice.prefix') + message, time);
  return new Notice(message, time);
}

export function shortError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function readManifest(folder: string): ChromeManifest {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')) as Partial<ChromeManifest> | null;
  if (!manifest || (manifest.manifest_version !== 2 && manifest.manifest_version !== 3) || typeof manifest.version !== 'string') {
    throw new Error(tr('error.notExtensionFolder'));
  }
  return manifest as ChromeManifest;
}

export function labelName(m: { name?: unknown }): string {
  return typeof m.name === 'string' ? m.name : 'Unnamed extension';
}

export function showPermissions(m: ChromeManifest): { permissions: string[]; hosts: string[] } {
  const permissions = Array.isArray(m.permissions) ? m.permissions.filter((x): x is string => typeof x === 'string') : [];
  const hosts = Array.isArray(m.host_permissions) ? m.host_permissions.filter((x): x is string => typeof x === 'string') : [];
  const matches = Array.isArray(m.content_scripts)
    ? m.content_scripts.flatMap(x => Array.isArray(x.matches) ? x.matches.filter((y): y is string => typeof y === 'string') : [])
    : [];
  return { permissions, hosts: [...new Set([...hosts, ...matches])] };
}

export function isManagedFolder(pluginRoot: string, folder: string): boolean {
  const parent = path.resolve(pluginRoot, 'extensions') + path.sep;
  return path.resolve(folder).startsWith(parent);
}

export function popupPage(m: ChromeManifest | null): string | null {
  return m?.action?.default_popup || m?.browser_action?.default_popup || m?.page_action?.default_popup || null;
}

export function optionsPage(m: ChromeManifest | null): string | null {
  return m?.options_ui?.page || m?.options_page || null;
}

/**
 * The extension's icon as a data: URL, read from its own managed folder.
 * Extension files are untrusted: reject traversal, symlink escapes and large files.
 */
export function extensionIcon(extensionRoot: string, manifest: ChromeManifest, preferred = 32): string | null {
  const icons = manifest.action?.default_icon || manifest.browser_action?.default_icon || manifest.icons;
  let candidate: unknown = icons;
  if (icons && typeof icons === 'object') {
    const sizes = Object.keys(icons).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const size = sizes.find(s => s >= preferred) ?? sizes[sizes.length - 1];
    candidate = size !== undefined ? icons[String(size)] : undefined;
  }
  if (typeof candidate !== 'string' || !/\.(?:png|jpe?g|webp|gif|svg)$/i.test(candidate)) return null;
  const relative = candidate.replace(/^\//, '');
  if (relative.includes('\\') || relative.split('/').includes('..')) return null;
  try {
    const root = path.resolve(extensionRoot);
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) return null;
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(filename);
    if (!realFile.startsWith(realRoot + path.sep)) return null;
    const size = fs.statSync(realFile).size;
    if (!size || size > 256 * 1024) return null;
    const kind = /\.png$/i.test(relative) ? 'image/png' : /\.webp$/i.test(relative) ? 'image/webp' :
      /\.gif$/i.test(relative) ? 'image/gif' : /\.svg$/i.test(relative) ? 'image/svg+xml' : 'image/jpeg';
    return `data:${kind};base64,${fs.readFileSync(realFile).toString('base64')}`;
  } catch { return null; }
}

/** Fill an element with an extension icon, or a two-letter monogram. */
export function renderExtensionIcon(el: HTMLElement, icon: string | null, name: string): void {
  el.empty();
  if (icon) {
    el.createEl('img', { cls: 'chrome-bridge-ext-icon', attr: { src: icon, alt: '', draggable: 'false' } });
  } else {
    el.createSpan({ cls: 'chrome-bridge-ext-monogram', text: (name || 'EX').trim().slice(0, 2).toUpperCase() });
  }
}
