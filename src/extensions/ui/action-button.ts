// Draws an extension's toolbar button the way Chrome does: its action icon,
// a badge with text in the extension's colors, its title as the tooltip, and
// a dimmed look when the action is disabled for the tab.
import { setTooltip } from 'obsidian';
import { renderExtensionIcon } from '../util';

export interface ActionView {
  name: string;
  title: string;
  icon: string | null;
  badgeText: string;
  badgeBackgroundColor?: string;
  badgeTextColor?: string;
  enabled: boolean;
}

/** Chrome's default badge background. */
const DEFAULT_BADGE = '#5f6368';

const drawn = new WeakMap<HTMLElement, string>();

export function renderActionButton(el: HTMLElement, view: ActionView, tooltip = true): void {
  const key = JSON.stringify(view);
  // Badges change often (per page load); skip identical redraws.
  if (drawn.get(el) === key) return;
  drawn.set(el, key);
  renderExtensionIcon(el, view.icon, view.name);
  if (view.badgeText) {
    const badge = el.createSpan({ cls: 'chrome-bridge-badge', text: view.badgeText });
    badge.style.backgroundColor = view.badgeBackgroundColor || DEFAULT_BADGE;
    badge.style.color = view.badgeTextColor || '#fff';
  }
  el.toggleClass('is-action-disabled', !view.enabled);
  if (!tooltip) return;
  const label = view.title && view.title !== view.name ? `${view.name}\n${view.title}` : view.name;
  el.setAttribute('aria-label', label);
  setTooltip(el, label);
}
