// chrome.action state of one extension as the toolbar shows it: global
// values, overridden per tab (Chrome's tab-specific setters). Electron keeps
// its own copy but never renders it; the compat layer reports every setter
// call here. Everything received is untrusted and validated.
import type { ActionProps } from '../shared/protocol';

const MAX_TITLE = 1000;
const MAX_BADGE = 16;
const MAX_ICON = 512 * 1024;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)|[a-z]{3,20})$/i;
const ICON = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const POPUP = /^[^\\:?#]*(\?[^#]*)?(#.*)?$/;

/** The valid fields of an untrusted props object; unknown or malformed ones are dropped. */
export function sanitizeActionProps(raw: unknown): ActionProps {
  const out: ActionProps = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.title === 'string') out.title = r.title.slice(0, MAX_TITLE);
  if (typeof r.badgeText === 'string') out.badgeText = r.badgeText.slice(0, MAX_BADGE);
  for (const key of ['badgeBackgroundColor', 'badgeTextColor'] as const) {
    const value = r[key];
    if (typeof value === 'string' && COLOR.test(value)) out[key] = value;
  }
  if (typeof r.icon === 'string' && r.icon.length <= MAX_ICON && ICON.test(r.icon)) out.icon = r.icon;
  // A path inside the extension; resolved and checked again when opened.
  if (typeof r.popup === 'string' && r.popup.length <= 2048 && POPUP.test(r.popup) && !r.popup.split('/').includes('..')) {
    out.popup = r.popup.replace(/^\/+/, '');
  }
  if (typeof r.enabled === 'boolean') out.enabled = r.enabled;
  return out;
}

export class ActionState {
  private globalProps: ActionProps = {};
  private tabs = new Map<number, ActionProps>();

  /** Apply one setter call; tabId null changes the global value. */
  update(tabId: number | null, props: ActionProps): void {
    if (tabId === null) { this.globalProps = { ...this.globalProps, ...props }; return; }
    if (!Number.isSafeInteger(tabId)) return;
    // Bounded: tab IDs are forgotten when tabs close, but never trust the sender.
    if (!this.tabs.has(tabId) && this.tabs.size >= 500) this.tabs.delete(this.tabs.keys().next().value!);
    this.tabs.set(tabId, { ...this.tabs.get(tabId), ...props });
  }

  /** The extension reconnected: its global values as Electron still has them. */
  reset(props: ActionProps): void { this.globalProps = { ...props }; }

  forgetTab(tabId: number): void { this.tabs.delete(tabId); }

  /** What the button shows in a tab: tab-specific values over global ones. */
  resolve(tabId: number | null): ActionProps {
    const tab = tabId === null ? undefined : this.tabs.get(tabId);
    return tab ? { ...this.globalProps, ...tab } : { ...this.globalProps };
  }
}
