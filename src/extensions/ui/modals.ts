import { App, Modal, Setting } from 'obsidian';
import type { ChromeManifest } from '../types';
import { labelName, showPermissions } from '../util';
import { tr } from '../i18n/strings';

/** Resolves true on confirm, false on cancel or dismissal. */
abstract class PromiseModal extends Modal {
  private finish!: (value: boolean) => void;
  private resolved = false;
  readonly promise = new Promise<boolean>(resolve => { this.finish = resolve; });
  openAndWait(): Promise<boolean> { this.open(); return this.promise; }
  protected settle(value: boolean): void {
    if (!this.resolved) { this.resolved = true; this.finish(value); }
    this.close();
  }
  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) { this.resolved = true; this.finish(false); }
  }
}

export class ConfirmInstallModal extends PromiseModal {
  constructor(app: App, private manifestData: ChromeManifest, private source: string, private displayName?: string) { super(app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('chrome-bridge-confirm');
    this.setTitle(tr('install.title', { name: this.displayName || labelName(this.manifestData) }));
    contentEl.createEl('p', { cls: 'chrome-bridge-muted', text: tr('install.version', { version: this.manifestData.version, source: this.source }) });
    const { permissions, hosts } = showPermissions(this.manifestData);
    const list = contentEl.createEl('ul', { cls: 'chrome-bridge-permissions' });
    if (hosts.some(h => /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*)$/.test(h))) list.createEl('li', { text: tr('install.allSites') });
    else if (hosts.length) list.createEl('li', { text: tr('install.sites', {
      sites: hosts.slice(0, 6).join(tr('common.separator')),
      more: hosts.length > 6 ? tr('install.sitesMore', { count: hosts.length }) : ''
    }) });
    if (permissions.length) list.createEl('li', { text: tr('install.apis', { apis: permissions.join(tr('common.separator')) }) });
    if (!list.childElementCount) list.createEl('li', { text: tr('install.noPermissions') });
    contentEl.createEl('p', { cls: 'chrome-bridge-warning', text: tr('install.warning') });
    new Setting(contentEl)
      .addButton(b => b.setButtonText(tr('common.cancel')).onClick(() => this.settle(false)))
      .addButton(b => b.setButtonText(tr('install.confirm')).setCta().onClick(() => this.settle(true)));
  }
}

export class ConfirmModal extends PromiseModal {
  constructor(app: App, private titleText: string, private message: string, private confirmText = tr('common.ok'), private danger = false) { super(app); }
  onOpen(): void {
    this.setTitle(this.titleText);
    this.contentEl.createEl('p', { text: this.message });
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText(tr('common.cancel')).onClick(() => this.settle(false)))
      .addButton(b => {
        b.setButtonText(this.confirmText).onClick(() => this.settle(true));
        if (this.danger) b.setWarning(); else b.setCta();
      });
  }
}

export class InputModal extends Modal {
  constructor(app: App, private titleText: string, private placeholderText: string, private description: string,
    private onSubmit: (value: string) => void | Promise<void>) { super(app); }
  onOpen(): void {
    this.contentEl.empty();
    this.setTitle(this.titleText);
    if (this.description) this.contentEl.createEl('p', { cls: 'chrome-bridge-muted', text: this.description });
    let value = '';
    const submit = () => { if (!value.trim()) return; this.close(); void this.onSubmit(value.trim()); };
    new Setting(this.contentEl).setClass('chrome-bridge-input-row').addText(t => {
      t.setPlaceholder(this.placeholderText).onChange(v => { value = v; });
      t.inputEl.addClass('chrome-bridge-input');
      t.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
      window.setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(this.contentEl).addButton(b => b.setButtonText(tr('common.ok')).setCta().onClick(submit));
  }
  onClose(): void { this.contentEl.empty(); }
}
