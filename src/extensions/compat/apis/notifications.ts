// chrome.notifications is not in Electron's extension API subset. Obsidian
// shows them as notices: title, message, icon, progress, list items and up to
// two buttons. Clicks, button clicks and closing come back as the usual
// events. Icons are converted to data: URLs here, because extension files are
// not reachable from Obsidian's window.
import type { InstallContext } from '../context';
import { define, emit, event, settle } from '../runtime';
import { ChromeRoot, callbackOf, fields } from '../chrome';
import { text } from '../../shared/text';

const MAX_ICON_BYTES = 256 * 1024;

async function iconData(chrome: ChromeRoot, iconUrl: unknown): Promise<string | undefined> {
  if (typeof iconUrl !== 'string' || !iconUrl) return undefined;
  if (/^data:image\//i.test(iconUrl)) return iconUrl;
  let url: URL;
  try { url = new URL(iconUrl, globalThis.location?.href ?? chrome.runtime.getURL('')); } catch { return undefined; }
  // Only the extension's own files (as Chrome resolves relative icon URLs).
  if (url.protocol !== 'chrome-extension:' || url.hostname !== chrome.runtime.id) return undefined;
  try {
    const response = await fetch(url.href);
    const blob = await response.blob();
    if (!response.ok || blob.size > MAX_ICON_BYTES) return undefined;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const type = /^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(blob.type) ? blob.type : 'image/png';
    return `data:${type};base64,${btoa(binary)}`;
  } catch { return undefined; }
}

const randomId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export function installNotifications(ctx: InstallContext): void {
  const { c, chrome, granted, info, shared, report } = ctx;
  if (!granted.has('notifications') || c.notifications || !shared.bridge.available) return;
  report('notifications', () => {
    const events = shared.once('notifications.events', () => {
      const all = { onClicked: event(), onClosed: event(), onButtonClicked: event(), onPermissionLevelChanged: event(), onShowSettings: event() };
      shared.bridge.on('notifications.event', message => {
        if (typeof message.id !== 'string') return;
        if (message.event === 'onClicked') emit(all.onClicked, message.id);
        else if (message.event === 'onButtonClicked' && Number.isInteger(message.buttonIndex)) emit(all.onButtonClicked, message.id, message.buttonIndex);
        else if (message.event === 'onClosed') emit(all.onClosed, message.id, message.byUser === true);
      });
      return all;
    });
    // create([id,] options [, callback]); update(id, options [, callback]).
    const show = async (id: string, raw: unknown, update: boolean) => {
      if (!raw || typeof raw !== 'object') throw new Error('Invalid notification options.');
      const options = fields(raw);
      if (!update && (!options.type || !options.title || options.message === undefined || !options.iconUrl)) {
        // Chrome requires these on create; extensions rely on the error.
        throw new Error('Some of the required properties are missing: type, iconUrl, title and message.');
      }
      const plain = JSON.parse(JSON.stringify({ ...options, iconUrl: undefined, imageUrl: undefined, appIconMaskUrl: undefined })) as Record<string, unknown>;
      const iconUrl = await iconData(chrome, options.iconUrl);
      if (iconUrl) plain.iconUrl = iconUrl;
      const { shown } = await shared.bridge.request('notifications.show', { id, options: plain, update }, 5000);
      return shown;
    };
    const api = {
      create(...args: unknown[]) {
        const callback = callbackOf(args[args.length - 1]) ? args.pop() : undefined;
        const [id, options] = typeof args[0] === 'string' ? [args[0] || randomId(), args[1]] : [randomId(), args[0]];
        return settle(show(id, options, false).then(() => id), callback);
      },
      update(id: unknown, options: unknown, callback?: unknown) {
        return settle(show(text(id), options, true), callback);
      },
      clear(id: unknown, callback?: unknown) {
        return settle(shared.bridge.request('notifications.clear', { id: text(id) }, 5000).then(r => !!r?.cleared), callback);
      },
      getAll(callback?: unknown) {
        return settle(shared.bridge.request('notifications.getAll', {}, 5000).then(r =>
          Object.fromEntries((r?.ids ?? []).map((id: string) => [id, true]))), callback);
      },
      getPermissionLevel(callback?: unknown) { return settle(Promise.resolve('granted'), callback); },
      TemplateType: { BASIC: 'basic', IMAGE: 'image', LIST: 'list', PROGRESS: 'progress' },
      PermissionLevel: { GRANTED: 'granted', DENIED: 'denied' },
      ...events
    };
    define(c, 'notifications', api);
    info.modes.notifications = 'shown as Obsidian notices (title, message, icon, progress, items, buttons); images are not shown';
  });
}
