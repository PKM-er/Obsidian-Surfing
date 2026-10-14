import { Setting } from 'obsidian';
import type { SettingDefinitionItem, SettingGroupItem } from 'obsidian';
import type ChromeExtensionsBridge from '../bridge';
import { renderExtensionList, renderExtensionRow, renderInstallButtons, renderInstallRow } from './extension-list';
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

  new Setting(el).setName(tr('settings.toolbar')).setDesc(tr('settings.toolbar.desc')).setHeading();
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

/**
 * The same page as declarative definitions, for Obsidian 1.13+ (the host
 * tab's getSettingDefinitions). Plain values are `control` rows whose keys
 * are the bridge settings' field names behind `keyPrefix`; the host tab
 * resolves them in its own settings and runs the side effects of
 * `compatibilityEnabled` and `debug` (see Surfing's settings/definitions.ts).
 */
export function bridgeSettingDefinitions(plugin: ChromeExtensionsBridge, update: () => void, keyPrefix = ''): SettingDefinitionItem[] {
  const status: SettingGroupItem[] = [{
    name: tr('settings.status.name'),
    desc: plugin.target
      ? tr(plugin.target.kind === 'webviewer' ? 'settings.status.webviewer' : 'settings.status.surfing', { target: plugin.target.label })
      : plugin.unavailableReason(),
    render: setting => { if (!plugin.target) setting.settingEl.addClass('mod-warning'); }
  }];

  const legacy = plugin.legacyImport();
  if (legacy) {
    status.push({
      name: tr('settings.legacy.name'),
      desc: tr('settings.legacy.desc', { count: legacy.count }) +
        (plugin.legacyPluginEnabled() ? tr('settings.legacy.disableFirst') : ''),
      render: setting => { setting.addButton(b => b.setButtonText(tr('settings.legacy.import')).setCta().setDisabled(plugin.legacyPluginEnabled()).onClick(async () => {
        await plugin.withNotice(() => plugin.importLegacy());
        update();
      })); }
    });
  }

  const extensions: SettingDefinitionItem = {
    type: 'list',
    heading: tr('settings.installed'),
    emptyState: tr('list.empty'),
    items: plugin.settings.extensions.map(rec => ({
      name: plugin.getDisplayName(rec),
      desc: `${rec.version} · ${rec.source === 'store' ? tr('source.store') : tr('source.local')}`,
      render: setting => renderExtensionRow(plugin, setting, rec, update)
    }))
  };

  const output = createEl('pre', { cls: 'chrome-bridge-diagnostic-output' });
  const run = async (task: () => Promise<unknown>) => {
    output.setText(tr('settings.checking'));
    try { output.setText(JSON.stringify(await task(), null, 2)); }
    catch (e) { output.setText(tr('settings.failed', { error: shortError(e) })); }
  };
  const diagnostics: SettingGroupItem[] = [
    {
      name: tr('settings.state'),
      desc: tr('settings.state.desc'),
      render: setting => { setting.addButton(b => b.setButtonText(tr('settings.check')).onClick(() => run(() => plugin.diagnose()))); }
    },
    {
      name: tr('settings.probe'),
      desc: tr('settings.probe.desc'),
      render: setting => { setting.addButton(b => b.setButtonText(tr('settings.run')).onClick(async () => {
        const rect = b.buttonEl.getBoundingClientRect();
        await plugin.withNotice(() => plugin.runProbe(rect));
      })); }
    }
  ];
  for (const rec of plugin.settings.extensions.filter(r => r.enabled && plugin.getManifest(r)?.background?.service_worker)) {
    diagnostics.push({
      name: tr('settings.wake', { name: plugin.getDisplayName(rec) }),
      desc: tr('settings.wake.desc'),
      render: setting => { setting.addButton(b => b.setButtonText(tr('settings.wakeButton')).onClick(() => run(() => plugin.startExtensionWorker(rec.id)))); }
    });
  }
  diagnostics.push({
    name: tr('settings.output'),
    desc: tr('settings.output.desc'),
    render: setting => { setting.settingEl.appendChild(output); }
  });

  return [
    { type: 'group', items: status },
    extensions,
    {
      type: 'group',
      items: [{
        name: tr('list.add'),
        desc: tr('list.addDesc'),
        render: setting => renderInstallRow(plugin, setting, update)
      }]
    },
    {
      type: 'group',
      items: [
        { name: tr('settings.toolbar'), desc: tr('settings.toolbar.desc') },
        {
          name: tr('settings.resetPinned'),
          desc: tr('settings.resetPinned.desc'),
          render: setting => { setting.addButton(b => b.setButtonText(tr('settings.reset')).onClick(async () => { await plugin.resetPinned(); update(); })); }
        }
      ]
    },
    {
      type: 'group',
      heading: tr('settings.behavior'),
      items: [
        {
          name: tr('settings.autoReload'),
          desc: tr('settings.autoReload.desc'),
          control: { type: 'toggle', key: keyPrefix + 'autoReloadPages' }
        },
        {
          name: tr('settings.autoUpdate'),
          desc: tr('settings.autoUpdate.desc'),
          control: { type: 'toggle', key: keyPrefix + 'autoUpdate' }
        },
        {
          name: tr('settings.checkNow'),
          desc: tr('settings.checkNow.desc'),
          render: setting => { setting.addButton(b => b.setButtonText(tr('settings.checkNow')).onClick(() => void plugin.checkUpdates())); }
        }
      ]
    },
    {
      type: 'group',
      heading: tr('settings.compatibility'),
      items: [{
        name: tr('settings.compat'),
        desc: tr('settings.compat.desc'),
        control: { type: 'toggle', key: keyPrefix + 'compatibilityEnabled', defaultValue: true }
      }]
    },
    {
      type: 'group',
      heading: tr('settings.advanced'),
      items: [{
        name: tr('settings.debug'),
        desc: tr('settings.debug.desc'),
        control: { type: 'toggle', key: keyPrefix + 'debug' }
      }]
    },
    { type: 'group', heading: tr('settings.diagnostics'), items: diagnostics }
  ];
}
