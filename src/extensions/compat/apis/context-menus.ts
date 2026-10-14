// chrome.contextMenus is not in Electron's extension API subset. Items are
// kept here (and in storage.local when declared, as Chrome keeps them across
// worker restarts) and announced to the host, which renders them in Obsidian's
// Web Viewer context menu and on the extension's toolbar button. Clicks come
// back through the bridge and are dispatched to onClicked.
import type { InstallContext } from '../context';
import { define, emit, event, invoke, isWorker, later, missingEvent, missingFn, settle, type Listener } from '../runtime';
import { CONTEXT_MENU_STORAGE_KEY, MenuClickInfo, MenuItem } from '../../shared/protocol';
import { callbackOf, eventOf, fields, fnOf, nsOf } from '../chrome';
import { text } from '../../shared/text';

const FIELDS = ['id', 'parentId', 'title', 'type', 'contexts', 'checked', 'enabled', 'visible',
  'documentUrlPatterns', 'targetUrlPatterns'] as const;

function serializable(id: string | number, properties: Record<string, unknown>): MenuItem {
  const item: Record<string, unknown> = { id };
  for (const key of FIELDS) {
    const value = properties[key];
    if (value !== undefined && typeof value !== 'function') item[key] = JSON.parse(JSON.stringify(value));
  }
  item.id = id;
  return item as unknown as MenuItem;
}

export function installContextMenus(ctx: InstallContext): void {
  const { c, chrome, granted, info, shared, report } = ctx;
  if (!granted.has('contextMenus') || !missingFn(c.contextMenus, 'create')) return;
  report('contextMenus', () => {
    const existing = nsOf(c, 'contextMenus') ?? {};
    const storage = nsOf(c, 'storage');
    const local = nsOf(storage, 'local');
    const items = new Map<string | number, MenuItem>();
    // MV2-style `onclick` properties are kept per context, like Chrome.
    const onclick = new Map<string | number, Listener>();
    const persistent = granted.has('storage') && !missingFn(local, 'get');
    let sequence = 0;

    let announcing = false;
    const announce = () => {
      if (announcing) return;
      announcing = true;
      setTimeout(() => {
        announcing = false;
        shared.bridge.post({ type: 'contextMenus.items', items: [...items.values()] });
      }, 0);
    };
    const save = () => {
      if (persistent) invoke(chrome, local, 'set', { [CONTEXT_MENU_STORAGE_KEY]: [...items.values()] })
        .catch(e => console.warn('[Chrome Bridge] contextMenus persist:', e));
    };
    const replaceAll = (list: unknown) => {
      items.clear();
      if (!Array.isArray(list)) return;
      for (const raw of list as unknown[]) {
        const id = fields(raw).id;
        // Our own persisted MenuItem records.
        if (typeof id === 'string' || typeof id === 'number') items.set(id, raw as MenuItem);
      }
    };
    // Restore persisted items first; later calls queue behind the restore so
    // removeAll/create issued during startup apply in order.
    let chain: Promise<unknown> = persistent
      ? invoke(chrome, local, 'get', CONTEXT_MENU_STORAGE_KEY)
        .then(all => replaceAll(fields(all)[CONTEXT_MENU_STORAGE_KEY]))
        .catch(e => console.warn('[Chrome Bridge] contextMenus restore:', e))
      : Promise.resolve();
    const enqueue = <T>(op: () => T): Promise<T> => {
      const result = chain.then(op);
      chain = result.then(() => undefined, () => undefined);
      return result.then(value => { save(); announce(); return value; });
    };
    const onStorageChanged = eventOf(storage, 'onChanged');
    if (persistent && onStorageChanged) onStorageChanged.addListener((changes: unknown, areaName: unknown) => {
      // Another extension context changed the menu: adopt its list.
      const change = fields(changes)[CONTEXT_MENU_STORAGE_KEY];
      if (areaName === 'local' && change) replaceAll(fields(change).newValue);
    });
    const removeTree = (id: string | number) => {
      items.delete(id);
      onclick.delete(id);
      for (const item of [...items.values()]) if (item.parentId === id) removeTree(item.id);
    };
    const notFound = (id: unknown) => new Error(`Cannot find menu item with id ${text(id)}`);
    const isId = (v: unknown): v is string | number => typeof v === 'string' || typeof v === 'number';

    const api = {
      create(createProperties: unknown = {}, callback?: unknown) {
        const properties = fields(createProperties);
        const id = isId(properties.id) ? properties.id : ++sequence;
        const done = enqueue(() => {
          if (items.has(id)) throw new Error(`Cannot create item with duplicate id ${id}`);
          const parentId = properties.parentId;
          if (parentId !== undefined && !(isId(parentId) && items.has(parentId))) throw new Error(`Cannot find menu item with id ${text(parentId)}`);
          items.set(id, serializable(id, properties));
          const handler = callbackOf(properties.onclick);
          if (handler) onclick.set(id, handler);
        });
        const cb = callbackOf(callback);
        done.then(() => { cb?.(); },
          (e: unknown) => { console.warn('[Chrome Bridge] contextMenus.create:', e instanceof Error ? e.message : e); cb?.(); });
        return id;
      },
      update(id: unknown, updateProperties: unknown = {}, callback?: unknown) {
        const properties = fields(updateProperties);
        return settle(enqueue(() => {
          const current = isId(id) ? items.get(id) : undefined;
          if (!isId(id) || !current) throw notFound(id);
          items.set(id, serializable(id, { ...current, ...properties }));
          const handler = callbackOf(properties.onclick);
          if (handler) onclick.set(id, handler);
        }), callback);
      },
      remove(id: unknown, callback?: unknown) {
        return settle(enqueue(() => {
          if (!isId(id) || !items.has(id)) throw notFound(id);
          removeTree(id);
        }), callback);
      },
      removeAll(callback?: unknown) {
        return settle(enqueue(() => { items.clear(); onclick.clear(); }), callback);
      }
    };
    for (const [key, value] of Object.entries(api)) if (missingFn(existing, key)) define(existing, key, value);
    const onClicked = eventOf(existing, 'onClicked') ?? event();
    if (missingEvent(existing, 'onClicked')) define(existing, 'onClicked', onClicked);
    if (existing.ACTION_MENU_TOP_LEVEL_LIMIT === undefined) define(existing, 'ACTION_MENU_TOP_LEVEL_LIMIT', 6);
    if (!c.contextMenus) define(c, 'contextMenus', existing);
    shared.contextMenus.add(existing);

    // Clicks rendered by the host. Checkbox/radio state is owned by the worker.
    shared.bridge.on('contextMenus.clicked', async message => {
      const clicked: MenuClickInfo | undefined = message.info;
      if (!clicked) return;
      const item = items.get(clicked.menuItemId);
      if (!item && !isWorker) return;
      if (isWorker && item && (item.type === 'checkbox' || item.type === 'radio')) {
        await enqueue(() => {
          if (item.type === 'checkbox') item.checked = !item.checked;
          else {
            // A radio group is a run of adjacent radio siblings.
            const siblings = [...items.values()].filter(x => x.parentId === item.parentId);
            const index = siblings.indexOf(item);
            let start = index, end = index;
            while (start > 0 && siblings[start - 1].type === 'radio') start--;
            while (end < siblings.length - 1 && siblings[end + 1].type === 'radio') end++;
            for (let i = start; i <= end; i++) siblings[i].checked = i === index;
          }
        });
      }
      let tab: unknown;
      const tabs = nsOf(c, 'tabs');
      if (Number.isInteger(message.tabId) && fnOf(tabs, 'get')) {
        try { tab = await invoke(chrome, tabs, 'get', message.tabId); } catch { tab = undefined; }
      }
      const data: MenuClickInfo = { ...clicked, ...(item?.type === 'checkbox' || item?.type === 'radio' ? { checked: !!item.checked } : {}) };
      emit(onClicked, data, tab);
      const legacy = onclick.get(clicked.menuItemId);
      if (legacy) later(() => { try { legacy(data, tab); } catch (e) { console.error('[Chrome Bridge] contextMenus onclick:', e); } });
    });
    if (isWorker) shared.bridge.on('bridge.sync', () => { void chain.then(announce); });
    info.modes.contextMenus = shared.bridge.available
      ? 'shown in the Obsidian Web Viewer context menu and on the toolbar button; icons are not shown'
      : 'registration-only: BroadcastChannel unavailable, menus are not shown';
  });
}
