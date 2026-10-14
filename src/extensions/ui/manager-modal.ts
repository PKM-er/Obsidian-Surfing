import { App, Modal } from 'obsidian';
import type ChromeExtensionsBridge from '../bridge';
import { renderExtensionList, renderInstallButtons } from './extension-list';
import { tr } from '../i18n/strings';

export class ManagerModal extends Modal {
  constructor(app: App, private plugin: ChromeExtensionsBridge) { super(app); }

  onOpen(): void {
    this.modalEl.addClass('chrome-bridge-manager');
    this.setTitle(tr('toolbar.extensions'));
    this.render();
  }

  render(): void {
    const el = this.contentEl;
    el.empty();
    const refresh = () => this.render();
    const leave = () => this.close();
    renderExtensionList(this.plugin, el, refresh, leave);
    renderInstallButtons(this.plugin, el, refresh, leave);
    const foot = el.createDiv({ cls: 'chrome-bridge-manager-foot' });
    foot.createSpan({ cls: 'chrome-bridge-muted', text: tr('manager.scope', { target: this.plugin.target?.label ?? 'Web Viewer' }) });
    const settings = foot.createEl('a', { text: tr('manager.settings'), href: '#' });
    settings.addEventListener('click', e => { e.preventDefault(); this.close(); this.plugin.openSettings(); });
  }

  onClose(): void { this.contentEl.empty(); }
}
