'use strict';
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-main-test-'));
const extensions = new Map();
const session = {
  extensions: {
    getExtension(id) { return extensions.get(id) || null; },
    async loadExtension(dir) {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      const id = manifest.key ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : 'local-ext-id';
      const record = { id, name: manifest.name }; extensions.set(id, record); return record;
    },
    removeExtension(id) { extensions.delete(id); },
    getAllExtensions() { return [...extensions.values()]; }
  },
  serviceWorkers: { getAllRunning() { return {}; } },
  getUserAgent() { return 'Chrome/142.0.7444.265'; }
};
const stubs = {
  Component: require('./helpers/component').Component,
  FileSystemAdapter: class { getBasePath() { return tmp; } },
  ItemView: class {}, Menu: class {},
  Modal: class { open() { this.settle(true); } close() {} }, Setting: class {}, Notice: class {}, PluginSettingTab: class {}
};
// Hidden extension channels create <webview> elements; a minimal DOM suffices.
const fakeElement = () => ({ className: '', tabIndex: 0, setAttribute() {}, addEventListener() {}, remove() {}, appendChild() {},
  createDiv() { return fakeElement(); }, isConnected: true, executeJavaScript: async () => true });
global.document = { body: fakeElement(), querySelector() { return null; }, querySelectorAll() { return []; }, createElement: fakeElement };
global.MutationObserver = class { observe(){} disconnect(){} };
global.window = { setInterval() { return 1; }, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) };
const originalLoad = Module._load;
Module._load = function (name, parent, main) {
  if (name === 'obsidian') return stubs;
  if (name === '@electron/remote') return { session: { fromPartition() { return session; } } };
  return originalLoad.call(this, name, parent, main);
};
// Minimal ZIP fixture for the renderer-safe end-to-end local install path.
function crc32(buf) {
  let c = 0xffffffff;
  for (const n of buf) {
    c ^= n;
    for (let i = 0; i < 8; i++) c = (c & 1) ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function makeZip(files) {
  const items = [], directory = [];
  let pos = 0;
  for (const [name, value] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(value), compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(pos, 42);
    items.push(local, n, compressed); directory.push(central, n);
    pos += local.length + n.length + compressed.length;
  }
  const listings = Buffer.concat(directory);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50);
  footer.writeUInt16LE(Object.keys(files).length, 8);
  footer.writeUInt16LE(Object.keys(files).length, 10);
  footer.writeUInt32LE(listings.length, 12);
  footer.writeUInt32LE(pos, 16);
  return Buffer.concat([...items, listings, footer]);
}
// Surfing hosts the bridge as a child component.
function makeHost(settings = {}) {
  const app = { appId: 'test123', vault: { adapter: new stubs.FileSystemAdapter(), configDir: '.obsidian' }, workspace: {
    detachLeavesOfType() {}, on() { return {}; }, onLayoutReady(fn) { fn(); }, getLeavesOfType() { return []; },
    getMostRecentLeaf() { return null; }, containerEl: {}
  } };
  const plugin = { app, manifest: { id: 'surfing', dir: '.obsidian/plugins/surfing', version: '0.0.0' }, registerView() {}, addCommand() {} };
  return { plugin, settings, saved: 0, save() { this.saved++; return Promise.resolve(); }, sessionIsolation: () => false, openSettings() {} };
}
async function main() {
  const Bridge = require('../../build/extensions/bridge.js').default;
  // Below the verified Electron the bridge loads nothing and says why.
  const old = new Bridge(makeHost());
  old.electronVersion = () => '37.2.0';
  old.load();
  assert.equal(old.root, undefined, 'nothing set up on Electron 37');
  assert.equal(old.state, 'old-electron');
  assert.match(old.unavailableReason(), /Electron 39/);
  old.unload();
  console.log('PASS: refuses to run below Electron 39');
  Bridge.prototype.electronVersion = () => '43.7.7';
  const host = makeHost();
  const plugin = new Bridge(host);
  plugin.load();
  await plugin.restorePromise;
  // Without the core Web Viewer, extensions run in Surfing's session.
  assert.equal(plugin.target.kind, 'surfing');
  assert.equal(plugin.partition(), 'persist:surfing-vault-test123');
  assert.equal(plugin.root, path.join(tmp, '.obsidian', 'plugins', 'surfing', 'chrome-extensions'));
  // A community-plugin install has only main.js: the files extensions load come out of it.
  for (const file of ['compat-api.js', 'bridge-host.js', 'compat-probe/manifest.json', 'compat-probe/background.js']) {
    assert.equal(fs.readFileSync(path.join(plugin.root, file), 'utf8'), fs.readFileSync(path.join(__dirname, '..', '..', 'build', 'extensions', file), 'utf8'), file);
  }
  console.log('PASS: the bridge writes the embedded compat layer, bridge page script and probe');
  const src = path.join(__dirname, 'fixtures', 'demo-extension');
  const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
  await plugin.installPrepared(src, manifest, { source: 'local', key: 'test-one' });
  assert.equal(plugin.settings.extensions.length, 1);
  assert.equal(extensions.size, 1);
  console.log('PASS: install managed unpacked extension');
  // Crucial regression: Obsidian renderer disallows new Worker(). The ZIP
  // install must work entirely without worker_threads (archive extraction is
  // bundled into main.js and uses zlib's threadpool instead).
  fs.copyFileSync(path.join(__dirname, '..', '..', 'build', 'extensions', 'archive.js'), path.join(plugin.root, 'archive.js'));
  const zipPath = path.join(tmp, 'plugin-test.zip');
  fs.writeFileSync(zipPath, makeZip({
    'manifest.json': JSON.stringify(manifest),
    'content.js': fs.readFileSync(path.join(src, 'content.js'))
  }));
  const WorkerThreads = require('node:worker_threads');
  const OriginalWorker = WorkerThreads.Worker;
  Object.defineProperty(WorkerThreads, 'Worker', {
    configurable: true, value: class { constructor() { throw new Error('V8 does not support creating Workers'); } }
  });
  try {
    await plugin.installLocal(zipPath);
  } finally {
    Object.defineProperty(WorkerThreads, 'Worker', { configurable: true, value: OriginalWorker });
  }
  assert.equal(plugin.settings.extensions.length, 2);
  assert.equal(fs.existsSync(path.join(plugin.root, 'extensions', plugin.settings.extensions[1].key, 'content.js')), true);
  await plugin.uninstall(plugin.settings.extensions[1].key);
  console.log('PASS: local ZIP installation with unavailable Node Workers');

  await plugin.toggle('test-one');
  assert.equal(extensions.size, 0);
  assert.equal(plugin.settings.extensions[0].enabled, false);
  await plugin.toggle('test-one');
  assert.equal(extensions.size, 1);
  console.log('PASS: disable/enable extension');
  await plugin.uninstall('test-one');
  assert.equal(plugin.settings.extensions.length, 0);
  assert.equal(extensions.size, 0);
  assert.equal(fs.existsSync(path.join(plugin.root, 'extensions', 'test-one')), false);
  console.log('PASS: uninstall and remove managed files');
  const existing = path.join(plugin.root, 'extensions', 'rollback');
  fs.mkdirSync(existing, { recursive: true });
  fs.writeFileSync(path.join(existing, 'manifest.json'), JSON.stringify({ manifest_version: 3, name:'Old', version: '1.0' }));
  const prior = { key: 'rollback', source: 'store', storeId: 'a'.repeat(32), id: 'local-ext-id', name: 'Old', version:'1.0', enabled: true };
  plugin.settings.extensions.push(prior);
  const failingManifest = { ...manifest, key: 'random-key', name: 'New', version: '2.0' };
  const badSource = path.join(tmp, 'broken-copy'); fs.mkdirSync(badSource);
  fs.writeFileSync(path.join(badSource, 'manifest.json'), JSON.stringify(failingManifest));
  await assert.rejects(plugin.installPrepared(badSource, failingManifest, {
    key: 'rollback', source: 'store', storeId: 'a'.repeat(32), expectedId: 'b'.repeat(32), previous: prior
  }), /does not match/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(existing, 'manifest.json'))).name, 'Old');
  assert.equal(plugin.settings.extensions[0].version, '1.0');
  console.log('PASS: rollback on mismatched Store extension ID');

  // Channel traffic is visible to every context of an extension: the host
  // withholds tab details and refuses requests the manifest does not cover.
  const { capabilitiesOf } = require('./helpers/load-ts').loadTs('src/host/grants.ts');
  const sent = [];
  const fakeChannel = (id, manifestPart) => ({ id, name: id, tabListeners: null, navigationListeners: null, menuItems: [], netRules: [],
    capabilities: capabilitiesOf({ manifest_version: 3, version: '1', ...manifestPart }), send: message => { sent.push([id, message]); return Promise.resolve(true); } });
  const tabsExt = fakeChannel('tabs', { permissions: ['tabs'] });
  const hostExt = fakeChannel('host', { host_permissions: ['https://docs.example/*'] });
  const plainExt = fakeChannel('plain', { permissions: ['storage'] });
  plugin.channels = { all: () => [tabsExt, hostExt, plainExt], get: () => null, dispose() {}, sync() {} };
  const tab = { id: 7, url: 'https://bank.example/account', title: 'Bank', favIconUrl: 'https://bank.example/f.ico', status: 'complete', active: true };
  plugin.deliverTabEvent('onUpdated', tab, { changeInfo: { status: 'complete' } });
  plugin.deliverTabEvent('onUpdated', tab, { changeInfo: { title: 'Bank' } });
  const seen = id => sent.filter(([to]) => to === id).map(([, m]) => m);
  assert.equal(seen('tabs').length, 2);
  assert.equal(seen('tabs')[0].tab.url, tab.url);
  assert.deepEqual(seen('plain').map(m => [m.tab.url, m.tab.title, m.tab.favIconUrl, m.changeInfo]), [[undefined, undefined, undefined, { status: 'complete' }]],
    'no url/title/icon, and title-only updates are not delivered');
  assert.deepEqual(seen('host').map(m => m.tab.url), [undefined]);
  sent.length = 0;
  plugin.deliverTabEvent('onUpdated', { ...tab, url: 'https://docs.example/a' }, { changeInfo: { url: 'https://docs.example/a' } });
  assert.equal(seen('host')[0].tab.url, 'https://docs.example/a', 'host access to that URL');
  assert.equal(seen('plain').length, 0);
  await assert.rejects(plugin.handleRequest(plainExt, 'webNavigation.getAllFrames', { tabId: 7 }), /webNavigation/);
  console.log('PASS: tab details and frames only for extensions entitled to them');

  plugin.openBrowserTab = async () => 99;
  for (let i = 0; i < 10; i++) assert.deepEqual(await plugin.handleRequest(plainExt, 'tabs.open', { url: 'https://example.com/' + i, active: false }), { tabId: 99 });
  await assert.rejects(plugin.handleRequest(plainExt, 'tabs.open', { url: 'https://example.com/11', active: false }), /too often/);
  assert.deepEqual(await plugin.handleRequest(tabsExt, 'tabs.open', { url: 'https://example.com/', active: false }), { tabId: 99 }, 'per extension');
  await assert.rejects(plugin.handleRequest(tabsExt, 'tabs.open', { url: 'file:///C:/Windows/win.ini', active: false }), /cannot open/);
  console.log('PASS: tabs.open is limited to web/own pages and rate-limited');

  // Local folders with links could expose files outside the extension.
  const linked = path.join(tmp, 'linked-ext');
  fs.mkdirSync(linked);
  fs.writeFileSync(path.join(linked, 'manifest.json'), JSON.stringify(manifest));
  let linkMade = true;
  try { fs.symlinkSync(os.tmpdir(), path.join(linked, 'outside'), 'junction'); } catch { linkMade = false; }
  if (linkMade) {
    await assert.rejects(plugin.installLocal(linked), /symbolic link|link/);
    console.log('PASS: local folders containing links are refused');
  } else console.log('SKIP: cannot create a junction here');

  // Enabling the core Web Viewer moves extensions to its session.
  host.plugin.app.internalPlugins = { getPluginById: id => id === 'webviewer' ? { enabled: true } : null };
  plugin.retarget();
  await plugin.restorePromise;
  assert.equal(plugin.target.kind, 'webviewer');
  assert.equal(plugin.partition(), 'persist:vault-test123');
  // Running the standalone plugin as well would load every extension twice.
  host.plugin.app.plugins = { plugins: { 'obsidian-chrome-bridge': {} } };
  plugin.retarget();
  assert.equal(plugin.target, null);
  assert.equal(plugin.state, 'conflict');
  assert.throws(() => plugin.partition(), /Chrome Extensions Bridge/);
  host.plugin.app.plugins = { plugins: {} };
  plugin.retarget();
  assert.equal(plugin.target.kind, 'webviewer');
  console.log('PASS: extensions follow the core Web Viewer and stop while the standalone plugin runs');

  plugin.unload();
  console.log('ALL PLUGIN TESTS PASSED');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad; fs.rmSync(tmp, { recursive: true, force: true });
});
