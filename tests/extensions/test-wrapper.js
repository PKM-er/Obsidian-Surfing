'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
require('./helpers/obsidian-stub');
const {wrapExtension, unwrapExtension, status} = require('../../build/extensions/extension-wrapper.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-wrapper-'));
const root = path.join(tmp, 'extension');
function write(rel, content) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true});
  fs.writeFileSync(path.join(root, rel), typeof content === 'string' ? content : JSON.stringify(content));
}
function manifest() { return JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))); }
function localArea() {
  const values = {};
  const local = {
    get(keys, cb) {
      const data = keys === null ? {...values} : Object.fromEntries(Object.entries(values).filter(([k]) => keys.includes(k)));
      queueMicrotask(() => cb?.(data)); return Promise.resolve(data);
    },
    set(entries, cb) { Object.assign(values, entries); queueMicrotask(() => cb?.()); return Promise.resolve(); },
    remove(keys, cb) { for (const k of keys) delete values[k]; queueMicrotask(() => cb?.()); return Promise.resolve(); }
  };
  return {local, values};
}
async function main() {
  try {
    write('manifest.json', {manifest_version:3, name:'Wrapper Test', version:'1.2.3',
      key:'AAAA', permissions:['storage', 'alarms'], host_permissions:['https://example.com/*'],
      background:{service_worker:'background/index.js'},
      action:{default_popup:'ui/popup.html'}, options_page:'ui/options.html'});
    write('_locales/en/messages.json', {extName:{message:'Read Frog'}});
    write('_locales/zh_CN/messages.json', {extName:{message:'陪读蛙'}});
    write('background/index.js', "globalThis.workerRan = true; globalThis.workerSawPermissions = !!chrome.permissions?.onRemoved?.addListener;");
    const original = '<!DOCTYPE html><html><head><script src="real.js"></script></head><body>Hello</body></html>';
    write('ui/popup.html', original);
    write('ui/options.html', original);
    write('ui/real.js', 'console.log(123)');
    const before = manifest();
    const result = wrapExtension(root, {locale:'zh-CN'});
    assert.equal(result.serviceWorker.original, 'background/index.js');
    assert.equal(manifest().background.service_worker, 'background/__obsidian_bridge_worker.js');
    assert.equal(manifest().key, before.key, 'extension ID key must stay stable');
    assert(fs.readFileSync(path.join(root, 'ui/popup.html'),'utf8').indexOf('__obsidian_bridge_compat.js') < fs.readFileSync(path.join(root, 'ui/popup.html'),'utf8').indexOf('real.js'));
    assert.equal(result.html.length, 2);
    assert.equal(result.locale, 'zh_CN');
    assert.equal(result.version, 8);
    assert.equal(wrapExtension(root).serviceWorker.original, 'background/index.js', 'wrapper idempotent');
    // Hidden bridge page: Bridge-generated, loads locale + compat, then the relay script.
    const hostHtml = fs.readFileSync(path.join(root, '__obsidian_bridge_host.html'), 'utf8');
    assert(hostHtml.indexOf('__obsidian_bridge_compat.js') < hostHtml.indexOf('__obsidian_bridge_host.js'));
    assert(fs.readFileSync(path.join(root, '__obsidian_bridge_host.js'), 'utf8').includes('__obsidianBridgeHost'));
    // Same-version rewrap refreshes Bridge-owned files: new compat code and a
    // new per-start boot id (expires the storage.session fallback).
    const localeFile = path.join(root, '__obsidian_bridge_locale_data.js');
    const bootOf = () => /"bridgeBootId":"([0-9a-f-]{36})"/.exec(fs.readFileSync(localeFile, 'utf8'))?.[1];
    const firstBoot = bootOf();
    assert(firstBoot, 'locale data carries a boot id');
    fs.writeFileSync(path.join(root, '__obsidian_bridge_compat.js'), '// stale');
    wrapExtension(root, {locale:'zh-CN'});
    assert.notEqual(bootOf(), firstBoot, 'boot id changes on every start');
    assert.notEqual(fs.readFileSync(path.join(root, '__obsidian_bridge_compat.js'), 'utf8'), '// stale', 'compat script refreshed');
    // Existing v0.10.x managed extensions must rewrap on upgrade, without
    // accumulating duplicate injection tags or changing the stable ID key.
    const stateFile = path.join(root, '__obsidian_bridge_compat_state.json');
    const previous = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    fs.writeFileSync(stateFile, JSON.stringify({...previous, version: 4}));
    const migrated = wrapExtension(root, {locale:'zh-CN'});
    assert.equal(migrated.version, 8);
    assert.equal(manifest().key, before.key);
    assert.equal((fs.readFileSync(path.join(root, 'ui/popup.html'), 'utf8').match(/data-obsidian-chrome-bridge/g) || []).length, 2);
    assert.equal(manifest().background.service_worker, 'background/__obsidian_bridge_worker.js');
    const worker = path.join(root, manifest().background.service_worker);
    const context = { console, Promise, queueMicrotask, TextEncoder, importScripts(...files) {
      for (const file of files) {
        const script = fs.readFileSync(path.resolve(path.dirname(worker), file), 'utf8');
        vm.runInContext(script, context);
      }
    }, chrome: {runtime:{id:'a'.repeat(32), getManifest:() => manifest()}, storage: localArea(), extension: {} }};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(worker,'utf8'), context);
    assert.equal(context.workerRan,true);
    assert.equal(context.workerSawPermissions,true);
    assert.equal(context.chrome.i18n.getMessage('extName'),'陪读蛙');
    assert.equal(context.chrome.i18n.getUILanguage(),'zh-CN');
    assert.equal(context.__obsidianBridgeCompatV06.installed.includes('permissions'),true);
    assert.equal(context.__obsidianBridgeCompatV06.installed.includes('storage.sync-local'),true);
    assert.equal(await context.chrome.permissions.contains({permissions:['storage'], origins:['https://example.com/*']}), true);
    assert.equal(await context.chrome.permissions.contains({permissions:['storage'], origins:['https://evil.com/*']}), false);
    assert.equal(await context.chrome.permissions.request({permissions:['downloads']}), false);
    assert.equal(await context.chrome.extension.isAllowedFileSchemeAccess(),false);
    assert.equal(typeof context.chrome.commands.onCommand.addListener,'function');
    await context.chrome.storage.sync.set({theme: 'dark'});
    assert.equal((await context.chrome.storage.sync.get('theme')).theme, 'dark');
    assert.equal((await context.chrome.storage.local.get(null))['__obsidian_bridge_sync_v1__theme'], 'dark');
    await context.chrome.storage.sync.clear();
    assert.deepEqual(Object.keys(await context.chrome.storage.sync.get(null)), []);
    let cbResult;
    await new Promise(resolve => context.chrome.permissions.contains({permissions:['storage']}, v => { cbResult = v; resolve(); }));
    assert.equal(cbResult,true);
    assert.equal(unwrapExtension(root),true);
    assert.deepEqual(manifest(), before);
    assert.equal(fs.readFileSync(path.join(root,'ui/popup.html'),'utf8'), original);
    assert.equal(status(root).applied, false);
    assert.equal(fs.existsSync(path.join(root,'__obsidian_bridge_locale_data.js')),false);
    console.log('PASS: classic MV3 worker bootstrap, permission-safe shim, popup injection, local-only sync, restore');

    // A WXT/ESM worker must import the compatibility shim BEFORE vendor code.
    // Test with a fresh Node module process and a real static import graph.
    const mod = manifest(); mod.background = {service_worker:'background/index.js', type:'module'};
    write('manifest.json', mod);
    write('background/index.js', "import './vendor-chunk.js';\nglobalThis.moduleOrder.push('entry');");
    write('background/vendor-chunk.js', "if (!chrome.permissions?.onRemoved?.addListener) throw new Error('shim was too late');\nif (!globalThis.__obsidianBridgeLocaleData) throw new Error('locale missing');\nglobalThis.moduleOrder.push('vendor-chunk');");
    write('package.json', {type:'module'}); // fixture only; not required in Chrome
    const moduleResult = wrapExtension(root);
    assert.equal(moduleResult.version, 8);
    assert.equal(moduleResult.serviceWorker.type, 'module');
    assert.equal(manifest().background.type, 'module');
    assert.equal(manifest().background.service_worker, 'background/__obsidian_bridge_worker.js');
    assert(!moduleResult.warnings.some(x => x.includes('module 类型')));
    const esm = fs.readFileSync(path.join(root, moduleResult.serviceWorker.wrapper), 'utf8');
    assert(!esm.includes('importScripts('));
    assert(esm.indexOf('__obsidian_bridge_compat.js') < esm.indexOf('index.js'));
    const {spawnSync} = require('node:child_process');
    const {pathToFileURL} = require('node:url');
    const runner = `globalThis.moduleOrder = [];\n` +
      `globalThis.chrome = {runtime: {id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', getManifest: () => ({permissions: ['storage']})}, storage: {local:{get: async () => ({}),set: async () => {},remove: async () => {}}}, extension:{}};\n` +
      `await import(${JSON.stringify(pathToFileURL(path.join(root, moduleResult.serviceWorker.wrapper)).href)});\n` +
      `if (moduleOrder.join(',') !== 'vendor-chunk,entry') throw Error('wrong order: ' + moduleOrder);\n` +
      `if (!__obsidianBridgeCompatV06.installed.includes('permissions')) throw Error('shim not installed');\n` +
      `console.log('MODULE_BOOTSTRAP_OK');`;
    const run = spawnSync(process.execPath, ['--input-type=module', '--eval', runner], {encoding:'utf8'});
    assert.equal(run.status, 0, `${run.stderr} ${run.stdout}`);
    assert(run.stdout.includes('MODULE_BOOTSTRAP_OK'));
    assert.equal(wrapExtension(root).version, 8, 'module wrapper idempotent');
    const originalModuleManifest = mod;
    assert.equal(unwrapExtension(root),true);
    assert.deepEqual(manifest(), originalModuleManifest);
    assert.equal(fs.existsSync(path.join(root,'background/__obsidian_bridge_worker.js')),false);
    assert.equal(fs.existsSync(path.join(root,'__obsidian_bridge_compat.js')),false);
    console.log('PASS: MV3 ESM startup order, original module imports, migration, and rollback');

    // Root-relative entry ("/js/background.js", as in uBlock Origin Lite) resolves like Chrome.
    const rooted = manifest(); rooted.background = {service_worker:'/background/index.js', type:'module'};
    write('manifest.json', rooted);
    const rootedResult = wrapExtension(root);
    assert.equal(manifest().background.service_worker, 'background/__obsidian_bridge_worker.js');
    assert(fs.readFileSync(path.join(root, rootedResult.serviceWorker.wrapper), 'utf8').includes('import "./index.js";'));
    assert.equal(unwrapExtension(root), true);
    assert.deepEqual(manifest(), rooted, 'the declared path is restored verbatim');
    for (const bad of ['//outside.js', '/../outside.js']) {
      const m2 = manifest(); m2.background = {service_worker: bad};
      write('manifest.json', m2);
      assert.throws(() => wrapExtension(root), /invalid file path|outside the extension/, bad);
      write('manifest.json', rooted);
    }
    console.log('PASS: root-relative worker path');

    const malicious = manifest(); malicious.background = {service_worker:'../outside.js'};
    write('manifest.json', malicious);
    assert.throws(() => wrapExtension(root), /invalid file path/);
    console.log('PASS: traversal rejected');
    console.log('ALL WRAPPER TESTS PASSED');
  } finally { fs.rmSync(tmp, {recursive:true, force:true}); }
}
main().catch(e=>{ console.error(e); process.exitCode=1; });
