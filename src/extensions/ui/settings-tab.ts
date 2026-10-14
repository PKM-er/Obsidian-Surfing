import { Setting } from 'obsidian';
import type ChromeExtensionsBridge from '../bridge';
import { renderExtensionList, renderInstallButtons } from './extension-list';
import { shortError } from '../util';
import { tr } from '../i18n/strings';

/** The "Extensions" page of Surfing's settings. */
export function renderBridgeSettings(el: HTMLElement, plugin: ChromeExtensionsBridge, refresh: () => void): void {
  el.addClass('chrome-bridge-settings');

  const status = el.createDiv({ cls: 'chrome-bridge-status' });
  if (plugin.target) {
    status.setText(tr(plugin.target.kind === 'webviewer' ? 'settings.status.webviewer' : 'settings.status.surfing', { target: plugin.target.label }));
  } else {
    status.addClass('mod-warning');
    status.setText(plugin.unavailableReason());
  }

  const legacy = plugin.legacyImport();
  if (legacy) {
    new Setting(el).setName(tr('settings.legacy.name'))
      .setDesc(tr('settings.legacy.desc', { count: legacy.count }) +
        (plugin.legacyPluginEnabled() ? tr('settings.legacy.disableFirst') : ''))
      .addButton(b => b.setButtonText(tr('settings.legacy.import')).setCta().setDisabled(plugin.legacyPluginEnabled()).onClick(async () => {
        await plugin.withNotice(() => plugin.importLegacy());
        refresh();
      }));
  }

  new Setting(el).setName(tr('settings.installed')).setHeading();
  renderExtensionList(plugin, el, refresh);
  renderInstallButtons(plugin, el, refresh);

  new Setting(el).setName(tr('settings.toolbar')).setHeading();
  el.createEl('p', { cls: 'setting-item-description', text: tr('settings.toolbar.desc') });
  new Setting(el).setName(tr('settings.resetPinned'))
    .setDesc(tr('settings.resetPinned.desc'))
    .addButton(b => b.setButtonText(tr('settings.reset')).onClick(async () => { await plugin.resetPinned(); refresh(); }));

  new Setting(el).setName(tr('settings.behavior')).setHeading();
  new Setting(el).setName(tr('settings.autoReload'))
    .setDesc(tr('settings.autoReload.desc'))
    .addToggle(t => t.setValue(plugin.settings.autoReloadPages).onChange(async v => {
      plugin.settings.autoReloadPages = v; await plugin.saveSettings();
    }));
  new Setting(el).setName(tr('settings.autoUpdate'))
    .setDesc(tr('settings.autoUpdate.desc'))
    .addToggle(t => t.setValue(plugin.settings.autoUpdate).onChange(async v => {
      plugin.settings.autoUpdate = v; await plugin.saveSettings();
    }))
    .addButton(b => b.setButtonText(tr('settings.checkNow')).onClick(() => void plugin.checkUpdates()));

  new Setting(el).setName(tr('settings.compatibility')).setHeading();
  new Setting(el).setName(tr('settings.compat'))
    .setDesc(tr('settings.compat.desc'))
    .addToggle(t => t.setValue(plugin.settings.compatibilityEnabled !== false).onChange(async v => {
      await plugin.withNotice(() => plugin.setCompatibilityEnabled(v));
      refresh();
    }));

  new Setting(el).setName(tr('settings.advanced')).setHeading();
  new Setting(el).setName(tr('settings.debug'))
    .setDesc(tr('settings.debug.desc'))
    .addToggle(t => t.setValue(plugin.settings.debug).onChange(async v => {
      plugin.settings.debug = v; await plugin.saveSettings(); refresh();
    }));

  const diag = el.createEl('details', { cls: 'chrome-bridge-diagnostics' });
  diag.createEl('summary', { text: tr('settings.diagnostics') });
  const output = createEl('pre', { cls: 'chrome-bridge-diagnostic-output' });
  const run = async (task: () => Promise<unknown>) => {
    output.setText(tr('settings.checking'));
    try { output.setText(JSON.stringify(await task(), null, 2)); }
    catch (e) { output.setText(tr('settings.failed', { error: shortError(e) })); }
  };
  new Setting(diag).setName(tr('settings.state')).setDesc(tr('settings.state.desc'))
    .addButton(b => b.setButtonText(tr('settings.check')).onClick(() => run(() => plugin.diagnose())));
  new Setting(diag).setName(tr('settings.probe')).setDesc(tr('settings.probe.desc'))
    .addButton(b => b.setButtonText(tr('settings.run')).onClick(async () => {
      const rect = b.buttonEl.getBoundingClientRect();
      await plugin.withNotice(() => plugin.runProbe(rect));
    }));
  for (const rec of plugin.settings.extensions.filter(r => r.enabled && plugin.getManifest(r)?.background?.service_worker)) {
    new Setting(diag).setName(tr('settings.wake', { name: plugin.getDisplayName(rec) })).setDesc(tr('settings.wake.desc'))
      .addButton(b => b.setButtonText(tr('settings.wakeButton')).onClick(() => run(() => plugin.startExtensionWorker(rec.id))));
  }
  diag.appendChild(output);
}
