// The installed-extensions list shared by the manager dialog and settings.
import { Setting, ToggleComponent } from 'obsidian';
import type ChromeExtensionsBridge from '../bridge';
import type { ExtensionRecord } from '../types';
import { renderExtensionIcon } from '../util';
import { tr } from '../i18n/strings';

export function renderInstallButtons(plugin: ChromeExtensionsBridge, el: HTMLElement, onChange: () => void, beforeLeave?: () => void): void {
  renderInstallRow(plugin, new Setting(el), onChange, beforeLeave);
}

/** The "add an extension" row: open the store, install from a link, import a folder. */
export function renderInstallRow(plugin: ChromeExtensionsBridge, row: Setting, onChange: () => void, beforeLeave?: () => void): void {
  row
    .setClass('chrome-bridge-install-row')
    .setName(tr('list.add'))
    .setDesc(tr('list.addDesc'))
    .addButton(b => b.setButtonText(tr('command.openStore')).setCta().onClick(() => { beforeLeave?.(); void plugin.openStore(); }))
    .addButton(b => b.setButtonText(tr('list.installFromLink')).onClick(() => plugin.askStoreUrl(onChange)))
    .addButton(b => b.setButtonText(tr('list.importLocal')).onClick(() => plugin.askLocalPath(onChange)));
}

export function renderExtensionList(plugin: ChromeExtensionsBridge, el: HTMLElement, onChange: () => void, beforeLeave?: () => void): void {
  const list = el.createDiv({ cls: 'chrome-bridge-ext-list' });
  const records = plugin.settings.extensions;
  if (!records.length) {
    list.createDiv({ cls: 'chrome-bridge-empty', text: tr('list.empty') });
    return;
  }
  for (const rec of records) renderExtensionRow(plugin, new Setting(list), rec, onChange, beforeLeave);
}

/** One installed extension: icon, name, details and its controls. */
export function renderExtensionRow(plugin: ChromeExtensionsBridge, row: Setting, rec: ExtensionRecord, onChange: () => void, beforeLeave?: () => void): void {
  const name = plugin.getDisplayName(rec);
  row.setClass('chrome-bridge-ext-row');
  row.nameEl.empty();
  if (!rec.enabled) row.settingEl.addClass('is-disabled');
  renderExtensionIcon(row.nameEl.createSpan({ cls: 'chrome-bridge-ext-row-icon' }), plugin.iconFor(rec, 32), name);
  row.nameEl.createSpan({ text: name });
  const source = rec.source === 'store' ? tr('source.store') : tr('source.local');
  row.setDesc(`${rec.version} · ${source}${plugin.isPinned(rec) ? ' · ' + tr('list.pinned') : ''}`);

  // Capture the anchor position first: a closing modal removes the button.
  const iconButton = (icon: string, label: string, onClick: (e: MouseEvent) => void, disabled = false) => {
    row.addExtraButton(b => {
      b.setIcon(icon).setTooltip(label).setDisabled(disabled);
      // onClick gives no event; the menu and popups anchor to the button.
      if (!disabled) b.extraSettingsEl.addEventListener('click', onClick);
    });
  };
  const popup = plugin.popupPageOf(rec), options = plugin.optionsPageOf(rec);
  if (popup) iconButton('panel-top-open', tr('menu.openPanel'), e => { const at = (e.currentTarget as HTMLElement).getBoundingClientRect(); beforeLeave?.(); plugin.openPopup(rec, at, null); }, !rec.enabled);
  if (options) iconButton('settings', tr('list.options'), e => { const at = (e.currentTarget as HTMLElement).getBoundingClientRect(); beforeLeave?.(); void plugin.openOptions(rec, at); }, !rec.enabled);
  iconButton(plugin.isPinned(rec) ? 'pin' : 'pin-off', plugin.isPinned(rec) ? tr('menu.unpin') : tr('menu.pin'),
    () => void plugin.togglePinned(rec).then(onChange), !rec.enabled);
  iconButton('more-vertical', tr('common.more'), e => plugin.showExtensionMenu(rec, e, null, onChange));
  row.addToggle((t: ToggleComponent) => t.setValue(rec.enabled).setTooltip(rec.enabled ? tr('menu.disable') : tr('menu.enable')).onChange(async () => {
    await plugin.withNotice(() => plugin.toggle(rec.key));
    onChange();
  }));
}
