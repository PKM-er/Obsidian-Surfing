// The puzzle-button panel in a Web Viewer header, like Chrome's extensions
// menu: every installed extension, one click to open it, pin/unpin, and a
// per-extension menu. Pinned extensions also get their own header button.
import { setIcon, setTooltip } from 'obsidian';
import type ChromeExtensionsBridge from '../bridge';
import type { WebviewTag } from '../types';
import { AnchoredSurface } from './anchored';
import { renderActionButton } from './action-button';
import { tr } from '../i18n/strings';

const ROW_HEIGHT = 36;

export class ExtensionsPanel {
  private surface: AnchoredSurface | null = null;

  constructor(private plugin: ChromeExtensionsBridge, private anchor: HTMLElement, private webview: WebviewTag | null) {}

  get isOpen(): boolean { return !!this.surface && !this.surface.isClosed; }
  isAnchoredTo(el: HTMLElement): boolean { return !!this.surface?.isAnchoredTo(el); }

  open(): this {
    const surface = new AnchoredSurface(this.anchor, 'chrome-bridge-panel', tr('toolbar.extensions'));
    this.surface = surface;
    surface.onClose = () => this.plugin.panelClosed(this);
    this.render();
    return this;
  }

  close(): void { this.surface?.close(); }

  render(): void {
    const surface = this.surface;
    if (!surface || surface.isClosed) return;
    const el = surface.el;
    el.empty();
    const head = el.createDiv({ cls: 'chrome-bridge-panel-head' });
    head.createSpan({ cls: 'chrome-bridge-panel-title', text: tr('panel.title') });
    const manage = head.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': tr('command.manage') } });
    setIcon(manage, 'settings');
    setTooltip(manage, tr('command.manage'));
    manage.addEventListener('click', () => { surface.close(); this.plugin.openManager(); });

    const list = el.createDiv({ cls: 'chrome-bridge-panel-list' });
    const records = this.plugin.settings.extensions;
    let tabId: number | null = null;
    try { tabId = this.webview?.getWebContentsId() ?? null; } catch { /* best effort */ }
    if (!records.length) {
      list.createDiv({ cls: 'chrome-bridge-panel-empty', text: tr('panel.empty') });
    }
    for (const rec of records) {
      const name = this.plugin.getDisplayName(rec);
      const row = list.createDiv({ cls: 'chrome-bridge-panel-row' + (rec.enabled ? '' : ' is-disabled') });
      const main = row.createEl('button', { cls: 'chrome-bridge-panel-open', attr: { type: 'button' } });
      const view = this.plugin.actionView(rec, tabId);
      renderActionButton(main.createSpan({ cls: 'chrome-bridge-panel-icon' }), view, false);
      main.createSpan({ cls: 'chrome-bridge-panel-name', text: name });
      if (!rec.enabled) main.createSpan({ cls: 'chrome-bridge-panel-badge', text: tr('panel.disabledBadge') });
      const popup = this.plugin.popupFor(rec, tabId);
      const clickable = this.plugin.hasAction(rec);
      const canOpen = rec.enabled && view.enabled && !!(popup || clickable || this.plugin.optionsPageOf(rec));
      main.disabled = !canOpen;
      setTooltip(main, !rec.enabled ? tr('panel.disabled') : popup ? tr('menu.openPanel') : clickable ? (view.title || name) : canOpen ? tr('panel.openOptions') : tr('panel.noPanel'));
      main.addEventListener('click', () => {
        surface.close();
        this.plugin.activateExtension(rec, this.anchor, this.webview);
      });
      main.addEventListener('contextmenu', e => { e.preventDefault(); this.plugin.showExtensionMenu(rec, e, this.webview); });

      const pinned = this.plugin.isPinned(rec);
      const pin = row.createEl('button', {
        cls: 'clickable-icon chrome-bridge-panel-pin' + (pinned ? ' is-active' : ''),
        attr: { type: 'button', 'aria-label': pinned ? tr('menu.unpin') : tr('menu.pin'), 'aria-pressed': String(pinned) }
      });
      setIcon(pin, pinned ? 'pin' : 'pin-off');
      setTooltip(pin, pinned ? tr('menu.unpin') : tr('menu.pin'));
      pin.disabled = !rec.enabled;
      pin.addEventListener('click', () => void this.plugin.togglePinned(rec).then(() => this.render()));

      const more = row.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': tr('common.more') } });
      setIcon(more, 'more-vertical');
      setTooltip(more, tr('common.more'));
      more.addEventListener('click', e => this.plugin.showExtensionMenu(rec, e, this.webview, () => this.render()));
    }

    const foot = el.createDiv({ cls: 'chrome-bridge-panel-foot' });
    const add = foot.createEl('button', { cls: 'chrome-bridge-panel-link', attr: { type: 'button' } });
    setIcon(add.createSpan({ cls: 'chrome-bridge-panel-link-icon' }), 'plus');
    add.createSpan({ text: tr('panel.addFromStore') });
    add.addEventListener('click', () => { surface.close(); void this.plugin.openStore(); });

    const height = 44 + Math.max(1, records.length) * ROW_HEIGHT + 46 + 8;
    surface.setSize(320, Math.min(height, 480));
  }
}
