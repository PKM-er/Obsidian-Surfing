'use strict';
// chrome.userScripts on top of Electron's working chrome.scripting content
// scripts: registration mapping, generated files written by the host,
// glob filtering, the USER_SCRIPT world facade, and message routing.
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const vm = require('node:vm');
const { makeHub, hostEndpoint, evaluate, tick, plain, EXT_ID } = require('./helpers/compat-env');

// A native event with a test-only dispatch (Electron's real events).
function nativeEvent() {
  const listeners = [];
  return {
    addListener: fn => listeners.push(fn),
    removeListener: fn => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    hasListener: fn => listeners.includes(fn),
    dispatch: (...args) => listeners.map(fn => fn(...args))
  };
}

function setup({ permissions = ['userScripts', 'storage', 'scripting'], manifestExtra = {} } = {}) {
  const hub = makeHub();
  const host = hostEndpoint(hub);
  const files = new Map();
  host.handle('userScripts.syncFiles', ({ keep, prune }) => {
    if (prune) for (const h of [...files.keys()]) if (!keep.includes(h)) files.delete(h);
    return { missing: keep.filter(h => !files.has(h)) };
  });
  host.handle('userScripts.writeFiles', ({ files: list }) => {
    for (const { hash, code } of list) {
      assert.equal(nodeCrypto.createHash('sha256').update(code).digest('hex'), hash, 'content-addressed');
      files.set(hash, code);
    }
    return { written: list.length };
  });
  host.handle('userScripts.pageExec', () => ({ event: '__obsidian_bridge_exec_s3cret' }));
  const registered = new Map();
  const executed = [];
  const scripting = {
    async registerContentScripts(list) {
      for (const r of list) { if (registered.has(r.id)) throw new Error('Duplicate script ID'); registered.set(r.id, structuredClone(r)); }
    },
    async unregisterContentScripts(filter) { for (const id of filter?.ids || [...registered.keys()]) registered.delete(id); },
    async getRegisteredContentScripts() { return [...registered.values()].map(r => structuredClone(r)); },
    async executeScript(injection) { executed.push(structuredClone(injection)); return [{ frameId: 0, documentId: 'd1', result: 42 }]; }
  };
  const runtime = {
    id: EXT_ID, lastError: undefined,
    getManifest: () => ({ manifest_version: 3, permissions, ...manifestExtra }),
    getURL: f => `chrome-extension://${EXT_ID}/${f}`,
    onMessage: nativeEvent(), onConnect: nativeEvent()
  };
  const packageFiles = { 'page.js': 'this.pagejs = () => 1;', 'lib/helper.js': 'var helper = 2;' };
  const fetch = async url => ({ text: async () => packageFiles[url.replace(`chrome-extension://${EXT_ID}/`, '')] });
  const env = evaluate({ permissions, hub, manifestExtra, extra: { scripting, runtime }, page: { fetch, crypto: globalThis.crypto } });
  return { ...env, host, files, registered, executed, runtime };
}

const fileOf = (files, path) => files.get(path.replace('__obsidian_bridge_us/', '').replace(/\.js$/, ''));

(async () => {
  const t = setup();
  const us = t.chrome.userScripts;
  assert(t.info.installed.includes('userScripts'));
  assert(t.info.installed.includes('runtime.onUserScriptMessage'));
  assert.match(t.info.modes.userScripts, /content scripts/);

  // Tampermonkey's pattern: configure the default world, then register.
  await us.configureWorld({ csp: "script-src 'self' 'unsafe-inline' *", messaging: true });
  await us.register([
    { id: 'content', js: [{ code: 'window.tm_scripts = 1;' }], matches: ['http://*/*', 'https://*/*'], runAt: 'document_start', world: 'USER_SCRIPT', allFrames: true },
    { id: 'page', js: [{ file: 'page.js' }], matches: ['https://*/*'], runAt: 'document_start', world: 'USER_SCRIPT' },
    { id: 'main', js: [{ code: 'window.inPage = 1;' }], matches: ['https://example.com/*'], world: 'MAIN' }
  ]);
  const content = t.registered.get('obsidian-us-content');
  assert.deepEqual(plain(content).matches, ['http://*/*', 'https://*/*']);
  assert.equal(content.world, 'ISOLATED');
  assert.equal(content.runAt, 'document_start');
  assert.equal(content.allFrames, true);
  assert.equal(content.persistAcrossSessions, true);
  assert.equal(content.js.length, 2, 'world prologue + code');
  assert.match(fileOf(t.files, content.js[0]), /function userScriptWorld/);
  assert.match(fileOf(t.files, content.js[0]), /\)\(null, true, "__obsidian_us__", "__obsidian_bridge_inline_m+", "__obsidian_bridge_exec_s3cret"\);/, 'messaging and inline scripts enabled by configureWorld');
  // 'unsafe-inline' in the world CSP: a MAIN-world relay runs inline scripts for the user script world.
  const relay = t.registered.get('obsidian-us-relay');
  assert.equal(relay.world, 'MAIN');
  assert.equal(relay.runAt, 'document_start');
  assert.equal([...t.registered.keys()][0], 'obsidian-us-relay', 'relay registered before user scripts');
  assert.match(fileOf(t.files, relay.js[0]), /function inlineRelay/);
  assert.equal(fileOf(t.files, content.js[1]), 'window.tm_scripts = 1;');
  const page = t.registered.get('obsidian-us-page');
  assert.deepEqual(plain(page.js.slice(1)), ['page.js'], 'file sources are used directly');
  const main = t.registered.get('obsidian-us-main');
  assert.equal(main.world, 'MAIN');
  assert.equal(main.js.length, 1, 'MAIN world has no extension API facade');
  assert.equal(main.runAt, 'document_idle', 'Chrome default');
  assert.deepEqual(plain(await us.getScripts({ ids: ['page'] })).map(s => s.id), ['page']);
  assert.deepEqual(plain(await us.getWorldConfigurations()), [{ csp: "script-src 'self' 'unsafe-inline' *", messaging: true }]);

  // Globs: every source (files too) is generated with a URL check.
  await us.register([{ id: 'globbed', js: [{ file: 'lib/helper.js' }, { code: 'run();' }], matches: ['*://*/*'], includeGlobs: ['*://*.news.example/*'], excludeGlobs: ['*/login*'] }]);
  const globbed = t.registered.get('obsidian-us-globbed');
  assert.equal(globbed.js.length, 3);
  const helperCode = fileOf(t.files, globbed.js[1]);
  assert.match(helperCode, /^if \(\(function globsAllow/);
  assert.match(helperCode, /\["\*:\/\/\*\.news\.example\/\*"\], \["\*\/login\*"\], location\.href\)\) \{\nvar helper = 2;\n\}/);
  // The generated guard works on its own.
  const guard = new vm.Script(helperCode.replace('var helper = 2;', 'globalThis.ran = true;'));
  for (const [href, expected] of [['https://www.news.example/a', true], ['https://www.news.example/login', false], ['https://other.example/', false]]) {
    const ctx = { location: { href } };
    guard.runInNewContext(ctx);
    assert.equal(!!ctx.ran, expected, href);
  }

  // Validation mirrors Chrome.
  await assert.rejects(us.register([{ id: 'content', js: [{ code: '' }], matches: ['*://*/*'] }]), /Duplicate script ID/);
  await assert.rejects(us.register([{ id: '_x', js: [{ code: '' }], matches: ['*://*/*'] }]), /must not start with '_'/);
  await assert.rejects(us.register([{ id: 'nojs', js: [], matches: ['*://*/*'] }]), /at least one js source/);
  await assert.rejects(us.register([{ id: 'nomatch', js: [{ code: '1' }] }]), /'matches' or 'includeGlobs'/);
  await assert.rejects(us.register([{ id: 'both', js: [{ code: '1', file: 'a.js' }], matches: ['*://*/*'] }]), /exactly one/);
  await assert.rejects(us.update([{ id: 'missing', matches: ['*://*/*'] }]), /does not exist/);

  // update / unregister keep native registrations and files in step.
  await us.update([{ id: 'main', matches: ['https://example.org/*'] }]);
  assert.deepEqual(plain(t.registered.get('obsidian-us-main').matches), ['https://example.org/*']);
  const globFiles = globbed.js.filter(p => p.startsWith('__obsidian_bridge_us/'));
  await us.unregister({ ids: ['globbed'] });
  assert(!t.registered.has('obsidian-us-globbed'));
  assert(globFiles.slice(1).every(p => !fileOf(t.files, p)), 'unreferenced generated files are pruned');
  assert.deepEqual(plain(await us.getScripts()).map(s => s.id), ['content', 'page', 'main']);
  await assert.rejects(us.register([{ id: 'relay', js: [{ code: '1' }], matches: ['*://*/*'] }]), /reserved/);

  // execute(): one-off injection through scripting.executeScript.
  const results = await us.execute({ target: { tabId: 7 }, js: [{ code: '6*7' }], world: 'MAIN', injectImmediately: true });
  assert.deepEqual(plain(results), [{ frameId: 0, documentId: 'd1', result: 42 }]);
  assert.equal(t.executed[0].world, 'MAIN');
  assert.equal(t.executed[0].injectImmediately, true);
  assert.equal(fileOf(t.files, t.executed[0].files[0]), '6*7');
  // USER_SCRIPT world while the world CSP needs the inline relay: inject the
  // script itself (world prologue + code), not the relay registered before it.
  await us.execute({ target: { tabId: 7 }, js: [{ code: '7*6' }] });
  assert.equal(t.executed[1].world, 'ISOLATED');
  assert.equal(t.executed[1].files.length, 2);
  assert.match(fileOf(t.files, t.executed[1].files[0]), /function userScriptWorld/);
  assert.equal(fileOf(t.files, t.executed[1].files[1]), '7*6');

  // Message routing: tagged traffic goes to onUserScript*, never to onMessage/onConnect.
  const userMessages = [], regularMessages = [], userPorts = [], regularPorts = [];
  t.chrome.runtime.onUserScriptMessage.addListener((m, sender, respond) => { userMessages.push([m, sender.userScriptWorldId, sender.tab?.id]); setTimeout(() => respond({ ok: m }), 0); return true; });
  const regular = (m) => { regularMessages.push(m); };
  t.chrome.runtime.onMessage.addListener(regular);
  t.chrome.runtime.onUserScriptConnect.addListener(port => userPorts.push(port.name));
  t.chrome.runtime.onConnect.addListener(port => regularPorts.push(port.name));
  const replies = [];
  t.runtime.onMessage.dispatch({ __obsidianUserScript: 1, worldId: 'w1', message: 'ping' }, { tab: { id: 7 } }, r => replies.push(r));
  t.runtime.onMessage.dispatch({ type: 'popup' }, { url: 'popup.html' }, () => {});
  t.runtime.onConnect.dispatch({ name: '__obsidian_us__' + JSON.stringify({ worldId: null, name: 'tm' }), sender: {} });
  t.runtime.onConnect.dispatch({ name: 'options', sender: {} });
  await tick();
  assert.deepEqual(userMessages, [['ping', 'w1', 7]]);
  assert.deepEqual(replies, [{ ok: 'ping' }], 'async sendResponse');
  assert.deepEqual(regularMessages, [{ type: 'popup' }]);
  assert.deepEqual(userPorts, ['tm'], 'port name restored');
  assert.deepEqual(regularPorts, ['options']);
  assert.equal(t.chrome.runtime.onMessage.hasListener(regular), true);
  t.chrome.runtime.onMessage.removeListener(regular);
  assert.equal(t.chrome.runtime.onMessage.hasListener(regular), false);

  // The world prologue itself: a restricted chrome whose messages are tagged.
  const prologue = fileOf(t.files, content.js[0]);
  const sent = [], connected = [];
  const isolated = { chrome: { runtime: { id: EXT_ID, lastError: undefined, getURL: p => 'chrome-extension://' + EXT_ID + '/' + p, onMessage: { addListener() {} }, onConnect: { addListener() {} }, sendMessage: (...a) => sent.push(a), connect: info => { connected.push(info.name); return { name: info.name }; } }, storage: {}, i18n: {} } };
  isolated.globalThis = isolated;
  vm.runInNewContext(prologue, isolated);
  assert.deepEqual(Object.keys(isolated.chrome), ['runtime'], 'no storage/i18n etc. in the user script world');
  assert.deepEqual(Object.keys(isolated.chrome.runtime).sort(), ['connect', 'getURL', 'id', 'lastError', 'onConnect', 'onMessage', 'sendMessage']);
  isolated.chrome.runtime.sendMessage(EXT_ID, { a: 1 }, () => {});
  assert.deepEqual(plain(sent[0][0]), { __obsidianUserScript: 1, worldId: null, message: { a: 1 } });
  assert.equal(isolated.chrome.runtime.connect({ name: 'tm' }).name, 'tm');
  assert.equal(connected[0], '__obsidian_us__{"worldId":null,"name":"tm"}');
  vm.runInNewContext(prologue, isolated);
  assert.equal(sent.length, 1, 'idempotent per frame');

  // Same-origin frames reached from the world never expose the full chrome.
  {
    const full = () => ({ runtime: { id: EXT_ID, sendMessage() {} }, storage: { local: {} } });
    const makeWindow = (extra = {}) => { const w = { chrome: full(), length: 0, ...extra }; return w; };
    const parentWin = makeWindow();
    const loadListeners = [];
    class Node { appendChild(child) { (this.kids ||= []).push(child); if (child.frameWindow) { win[win.length] = child.frameWindow; win.length++; } return child; } }
    class Element extends Node {}
    Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, get() { return ''; }, set() { const child = makeWindow(); win[win.length] = child; win.length++; } });
    class HTMLIFrameElement extends Element { constructor(w) { super(); this.frameWindow = w; } }
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { configurable: true, get() { return this.frameWindow; } });
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', { configurable: true, get() { return { defaultView: this.frameWindow }; } });
    const crossOrigin = { length: 0 };
    Object.defineProperty(crossOrigin, 'chrome', { get() { throw new Error('SecurityError'); } });
    const win = {
      chrome: { runtime: { id: EXT_ID, getURL: p => p, onMessage: {}, onConnect: {}, sendMessage() {}, connect() { return {}; } }, storage: { local: {} } },
      length: 1, 0: crossOrigin, parent: parentWin, Node, Element, HTMLIFrameElement,
      document: { addEventListener: (type, fn) => loadListeners.push([type, fn]) },
      open: () => makeWindow()
    };
    Object.assign(parentWin, { parent: parentWin, length: 1, 0: win });
    win.globalThis = win;
    vm.runInNewContext(prologue, win);
    const facade = win.chrome;
    assert.deepEqual(Object.keys(facade), ['runtime']);
    assert.equal(parentWin.chrome, facade, 'the parent frame (same origin) gets the facade');
    const frameWin = makeWindow();
    new Element().appendChild(new HTMLIFrameElement(frameWin));
    assert.equal(win[1].chrome, facade, 'a frame inserted from the world, reached by index');
    new Element().innerHTML = '<iframe></iframe>';
    assert.equal(win[2].chrome, facade, 'a frame created by innerHTML');
    const lazy = makeWindow();
    assert.equal(new HTMLIFrameElement(lazy).contentWindow.chrome, facade, 'contentWindow');
    assert.equal(win.open().chrome, facade, 'window.open');
    assert.equal(win.__obsidianBridgeUserScriptWorld, true);
    assert.equal(frameWin.__obsidianBridgeUserScriptWorld, true, 'a later injection into the frame does not wrap the facade');
    // A frame that navigates to a new same-origin document is checked again on load.
    frameWin.chrome = full();
    const [type, onLoad] = loadListeners[0];
    assert.equal(type, 'load');
    onLoad({ target: new HTMLIFrameElement(frameWin) });
    assert.equal(frameWin.chrome, facade);
  }

  // Gating: permission required; extensions with their own content scripts keep the full API.
  assert.equal(setup({ permissions: ['scripting'] }).chrome.userScripts, undefined);
  const withContent = setup({ manifestExtra: { content_scripts: [{ matches: ['<all_urls>'], js: ['c.js'] }] } });
  await withContent.chrome.userScripts.register([{ id: 'x', js: [{ code: '1' }], matches: ['*://*/*'] }]);
  assert.equal(withContent.registered.get('obsidian-us-x').js.length, 1, 'no facade when the world is shared with real content scripts');
  console.log('PASS: userScripts register/update/unregister/getScripts/execute/configureWorld via scripting, generated files, globs, USER_SCRIPT world facade, message routing');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
