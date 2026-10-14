// chrome.notifications shown as Obsidian notices. Clicking the notice body is
// onClicked, a button is onButtonClicked; both close it (as Obsidian notices
// do), which reports onClosed(byUser: true). A notice that times out reports
// onClosed(byUser: false). Extension data is untrusted: text only, icons only
// as data:image URLs (the compat layer converts extension files).
import { Notice } from 'obsidian';
import type { NotificationOptions } from '../shared/protocol';

const MAX_PER_EXTENSION = 20;
const DEFAULT_MS = 8000;
const ICON = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

export type NotificationEvent =
  | { event: 'onClicked'; id: string }
  | { event: 'onButtonClicked'; id: string; buttonIndex: number }
  | { event: 'onClosed'; id: string; byUser: boolean };

interface Shown { notice: Notice; options: NotificationOptions; closedBy: 'user' | 'replace' | 'clear' | null }

export class NotificationCenter {
  private shown = new Map<string, Map<string, Shown>>();

  constructor(private deliver: (extensionId: string, event: NotificationEvent) => void) {}

  /** Show (or with `update`, merge into) a notification; false when update finds none. */
  show(extensionId: string, extensionName: string, id: string, raw: unknown, update: boolean): boolean {
    const mine = this.shown.get(extensionId) ?? new Map<string, Shown>();
    this.shown.set(extensionId, mine);
    const previous = mine.get(id);
    if (update && !previous) return false;
    const options = { ...(update ? previous!.options : {}), ...sanitize(raw) };
    if (!previous && mine.size >= MAX_PER_EXTENSION) {
      const [oldest] = mine.keys();
      this.close(extensionId, oldest, 'clear');
    }
    // Replacing keeps the ID; the old notice goes without an onClosed event.
    if (previous) this.close(extensionId, id, 'replace');
    const entry: Shown = { notice: null as unknown as Notice, options, closedBy: null };
    const fragment = createFragment(f => {
      const root = f.createDiv({ cls: 'chrome-bridge-notification' });
      if (options.iconUrl) root.createEl('img', { cls: 'chrome-bridge-notification-icon', attr: { src: options.iconUrl, alt: '' } });
      const body = root.createDiv({ cls: 'chrome-bridge-notification-body' });
      body.createDiv({ cls: 'chrome-bridge-notification-title', text: options.title || extensionName });
      if (options.message) body.createDiv({ cls: 'chrome-bridge-notification-message', text: options.message });
      for (const item of options.items ?? []) body.createDiv({ cls: 'chrome-bridge-notification-item', text: `${item.title} ${item.message}` });
      if (typeof options.progress === 'number') {
        const bar = body.createEl('progress', { attr: { max: '100' } });
        bar.value = options.progress;
      }
      body.createDiv({ cls: 'chrome-bridge-notification-context', text: options.contextMessage || extensionName });
      if (options.buttons?.length) {
        const row = body.createDiv({ cls: 'chrome-bridge-notification-buttons' });
        options.buttons.forEach((button, buttonIndex) => {
          const el = row.createEl('button', { text: button.title });
          el.addEventListener('click', event => {
            event.stopPropagation();
            this.deliver(extensionId, { event: 'onButtonClicked', id, buttonIndex });
            this.close(extensionId, id, 'user');
          });
        });
      }
      // Runs before Obsidian's own click handler on the notice hides it.
      root.addEventListener('click', () => {
        if (entry.closedBy) return;
        entry.closedBy = 'user';
        this.deliver(extensionId, { event: 'onClicked', id });
      });
    });
    const notice = new Notice(fragment, options.requireInteraction ? 0 : DEFAULT_MS);
    entry.notice = notice;
    // Obsidian hides a notice on click or timeout through hide().
    const hide = notice.hide.bind(notice);
    let hidden = false;
    notice.hide = () => {
      if (hidden) return;
      hidden = true;
      if (mine.get(id) === entry) mine.delete(id);
      hide();
      // No reason recorded: the notice timed out.
      const by = entry.closedBy;
      if (by !== 'replace' && by !== 'clear') this.deliver(extensionId, { event: 'onClosed', id, byUser: by === 'user' });
    };
    mine.set(id, entry);
    return true;
  }

  private close(extensionId: string, id: string, by: 'user' | 'replace' | 'clear'): boolean {
    const entry = this.shown.get(extensionId)?.get(id);
    if (!entry) return false;
    entry.closedBy = by;
    entry.notice.hide();
    return true;
  }

  /** chrome.notifications.clear: closes without a user action (onClosed byUser false). */
  clear(extensionId: string, id: string): boolean {
    const entry = this.shown.get(extensionId)?.get(id);
    if (!entry) return false;
    this.close(extensionId, id, 'clear');
    this.deliver(extensionId, { event: 'onClosed', id, byUser: false });
    return true;
  }

  ids(extensionId: string): string[] { return [...(this.shown.get(extensionId)?.keys() ?? [])]; }

  /** The extension was disabled or removed: close its notices silently. */
  forget(extensionId: string): void {
    for (const id of this.ids(extensionId)) this.close(extensionId, id, 'clear');
    this.shown.delete(extensionId);
  }

  dispose(): void { for (const id of [...this.shown.keys()]) this.forget(id); }
}

function sanitize(raw: unknown): NotificationOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown, max = 500) => typeof v === 'string' ? v.slice(0, max) : undefined;
  const out: NotificationOptions = {};
  for (const key of ['type', 'title', 'message', 'contextMessage'] as const) {
    const v = text(r[key], key === 'message' ? 2000 : 300);
    if (v !== undefined) out[key] = v;
  }
  if (typeof r.iconUrl === 'string' && r.iconUrl.length <= 512 * 1024 && ICON.test(r.iconUrl)) out.iconUrl = r.iconUrl;
  const field = (o: unknown, key: string, max: number) => text(o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined, max) ?? '';
  if (Array.isArray(r.buttons)) out.buttons = (r.buttons as unknown[]).slice(0, 2).map(b => ({ title: field(b, 'title', 100) }));
  if (Array.isArray(r.items)) out.items = (r.items as unknown[]).slice(0, 10).map(i => ({ title: field(i, 'title', 100), message: field(i, 'message', 300) }));
  if (typeof r.requireInteraction === 'boolean') out.requireInteraction = r.requireInteraction;
  if (typeof r.progress === 'number' && Number.isFinite(r.progress)) out.progress = Math.max(0, Math.min(100, r.progress));
  return out;
}
