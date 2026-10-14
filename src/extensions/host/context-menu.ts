// Renders extension chrome.contextMenus items. Page menus are merged into
// Obsidian's own Web Viewer context menu (an Electron menu built from a
// template); toolbar-button menus use the same filtering for 'action' items.
import { matchAny } from '../shared/url-match';
import type { MenuClickInfo, MenuItem } from '../shared/protocol';
import type * as Electron from 'electron';

/** Electron ContextMenuParams as delivered on the <webview> 'context-menu' event. */
export interface ContextParams {
  pageURL?: string;
  frameURL?: string;
  linkURL?: string;
  srcURL?: string;
  mediaType?: string;
  selectionText?: string;
  isEditable?: boolean;
}

export interface MenuSource {
  extensionId: string;
  extensionName: string;
  items: MenuItem[];
  click(info: MenuClickInfo): void;
}

const ACTION_CONTEXTS = ['action', 'browser_action', 'page_action'];
const SELECTION_LABEL_MAX = 32;

/** Chrome's ContextType values that apply to a right-click with these params. */
export function contextsFor(params: ContextParams): Set<string> {
  const contexts = new Set<string>(['all']);
  if (params.selectionText) contexts.add('selection');
  if (params.linkURL) contexts.add('link');
  if (params.isEditable) contexts.add('editable');
  if (params.mediaType === 'image' || params.mediaType === 'video' || params.mediaType === 'audio') contexts.add(params.mediaType);
  const inFrame = !!params.frameURL && params.frameURL !== params.pageURL;
  if (inFrame) contexts.add('frame');
  if (contexts.size === 1 || (inFrame && contexts.size === 2)) contexts.add('page');
  return contexts;
}

function visibleFor(item: MenuItem, contexts: Set<string>, params: ContextParams, actionMenu: boolean): boolean {
  if (item.visible === false) return false;
  const wanted = item.contexts?.length ? item.contexts : ['page'];
  const matches = actionMenu
    ? wanted.some(c => ACTION_CONTEXTS.includes(c))
    : wanted.some(c => c !== 'launcher' && !ACTION_CONTEXTS.includes(c) && contexts.has(c));
  if (!matches) return false;
  const documentUrl = contexts.has('frame') ? params.frameURL : params.pageURL;
  if (!matchAny(item.documentUrlPatterns, documentUrl)) return false;
  const target = params.linkURL || params.srcURL;
  if (item.targetUrlPatterns?.length && (contexts.has('link') || contexts.has('image') || contexts.has('video') || contexts.has('audio'))) {
    if (!matchAny(item.targetUrlPatterns, target)) return false;
  }
  return true;
}

export function menuTitle(item: MenuItem, params: ContextParams): string {
  let selection = params.selectionText?.replace(/\s+/g, ' ').trim() || '';
  if (selection.length > SELECTION_LABEL_MAX) selection = selection.slice(0, SELECTION_LABEL_MAX) + '…';
  return String(item.title ?? '').replace(/%s/g, selection);
}

export interface MenuNode { item: MenuItem; children: MenuNode[] }

/** Visible items as a tree; separators at edges and duplicates are dropped. */
export function visibleTree(items: MenuItem[], params: ContextParams, actionMenu = false): MenuNode[] {
  const contexts = contextsFor(params);
  const nodes = new Map<string | number, MenuNode>();
  for (const item of items) nodes.set(item.id, { item, children: [] });
  const roots: MenuNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.item.parentId !== undefined ? nodes.get(node.item.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  // A parent is shown when it matches or any descendant does (Chrome shows
  // a submenu only through its visible children).
  const prune = (list: MenuNode[]): MenuNode[] => {
    const kept: MenuNode[] = [];
    for (const node of list) {
      if (node.item.visible === false) continue;
      node.children = prune(node.children);
      if (node.children.length || (node.item.type === 'separator' ? true : visibleFor(node.item, contexts, params, actionMenu))) kept.push(node);
    }
    while (kept[0]?.item.type === 'separator') kept.shift();
    while (kept[kept.length - 1]?.item.type === 'separator') kept.pop();
    return kept.filter((n, i) => !(n.item.type === 'separator' && kept[i - 1]?.item.type === 'separator'));
  };
  return prune(roots);
}

export function clickInfo(item: MenuItem, params: ContextParams): MenuClickInfo {
  const media = params.mediaType === 'image' || params.mediaType === 'video' || params.mediaType === 'audio' ? params.mediaType : undefined;
  const inFrame = !!params.frameURL && params.frameURL !== params.pageURL;
  const info: MenuClickInfo = { menuItemId: item.id, editable: !!params.isEditable };
  if (item.parentId !== undefined) info.parentMenuItemId = item.parentId;
  if (media) info.mediaType = media;
  if (params.linkURL) info.linkUrl = params.linkURL;
  if (params.srcURL && media) info.srcUrl = params.srcURL;
  if (params.pageURL) info.pageUrl = params.pageURL;
  if (inFrame) info.frameUrl = params.frameURL;
  else info.frameId = 0;
  if (params.selectionText) info.selectionText = params.selectionText;
  if (item.type === 'checkbox' || item.type === 'radio') {
    info.wasChecked = !!item.checked;
    info.checked = item.type === 'radio' ? true : !item.checked;
  }
  return info;
}

/** Electron's menu labels treat '&' as a mnemonic marker. */
const label = (text: string) => text.replace(/&/g, '&&');

/**
 * Electron MenuItemConstructorOptions for all extensions. Like Chrome, an
 * extension with one top-level item shows it directly; with several, they are
 * grouped under a submenu named after the extension.
 */
export function electronTemplate(sources: MenuSource[], params: ContextParams): Electron.MenuItemConstructorOptions[] {
  const out: Electron.MenuItemConstructorOptions[] = [];
  for (const source of sources) {
    const tree = visibleTree(source.items, params);
    if (!tree.length) continue;
    const build = (node: MenuNode): Electron.MenuItemConstructorOptions => {
      const { item } = node;
      if (item.type === 'separator') return { type: 'separator' };
      const entry: Electron.MenuItemConstructorOptions = { label: label(menuTitle(item, params)), enabled: item.enabled !== false };
      if (node.children.length) entry.submenu = node.children.map(build);
      else {
        if (item.type === 'checkbox' || item.type === 'radio') { entry.type = item.type; entry.checked = !!item.checked; }
        entry.click = () => source.click(clickInfo(item, params));
      }
      return entry;
    };
    out.push(tree.length === 1 && tree[0].item.type !== 'separator'
      ? build(tree[0])
      : { label: label(source.extensionName), submenu: tree.map(build) });
  }
  return out;
}
