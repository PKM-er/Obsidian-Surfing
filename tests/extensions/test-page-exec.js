'use strict';
// Inline <script>s from a USER_SCRIPT world: the session preload runs them
// through webFrame.executeJavaScript (exempt from the page CSP), and the
// world falls back to the MAIN-world relay when no preload took the event.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { loadTs } = require('./helpers/load-ts');
const { makeHub, hostEndpoint, evaluate, EXT_ID } = require('./helpers/compat-env');

const { pageExecPreload, pageExecEvent, installPageExec, uninstallPageExec, PAGE_EXEC_PRELOAD_ID } = loadTs('src/host/page-exec.ts');

// A tiny DOM: enough for script insertion and synthetic events.
function makeDom() {
  const ran = [];
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.cancelable = !!init.cancelable; this.defaultPrevented = false; this.stopped = false; }
    preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
    stopImmediatePropagation() { this.stopped = true; }
  }
  class Node {
    constructor() { this.children = []; this.parentNode = null; this.isConnected = false; }
    appendChild(child) {
      this.children.push(child); child.parentNode = this; child.isConnected = true;
      // A connected classic inline script runs (the page CSP is not modeled here).
      if (child.nodeName === 'SCRIPT' && !child.attrs.type) ran.push(child.textContent);
      return child;
    }
  }
  class Element extends Node {
    constructor(name) { super(); this.nodeType = 1; this.nodeName = name.toUpperCase(); this.attrs = {}; this.textContent = ''; }
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
    setAttribute(n, v) { this.attrs[n] = String(v); }
    removeAttribute(n) { delete this.attrs[n]; }
    hasAttribute(n) { return n in this.attrs; }
    remove() { if (this.parentNode) { const list = this.parentNode.children; list.splice(list.indexOf(this), 1); this.parentNode = null; this.isConnected = false; } }
  }
  class HTMLScriptElement extends Element {}
  const listeners = {};
  const document = new Node();
  Object.assign(document, {
    nodeType: 9,
    createElement: name => name === 'script' ? new HTMLScriptElement(name) : new Element(name),
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    dispatchEvent(event) {
      for (const fn of listeners[event.type] || []) { fn(event); if (event.stopped) break; }
      return !event.defaultPrevented;
    }
  });
  document.documentElement = new Element('html');
  document.head = new Element('head');
  const window = { frames: { length: 0 } };
  return { ran, listeners, document, window, CustomEvent, Node, Element, HTMLScriptElement };
}

(async () => {
  const event = pageExecEvent('0123abcd');
  assert.equal(event, '__obsidian_bridge_exec_0123abcd');

  // The preload: a sandboxed Electron preload with only require('electron').
  const dom = makeDom();
  const mainWorld = vm.createContext({ document: dom.document, window: dom.window });
  const executed = [];
  const preloadWorld = vm.createContext({
    document: dom.document, console,
    require: name => {
      assert.equal(name, 'electron');
      return { webFrame: { executeJavaScript: code => { executed.push(code); return vm.runInContext(code, mainWorld); } } };
    }
  });
  vm.runInContext(pageExecPreload(event), preloadWorld);
  const message = new dom.CustomEvent(event, { detail: JSON.stringify({ code: 'window.tm = 1', frame: null }), cancelable: true });
  assert.equal(dom.document.dispatchEvent(message), false, 'the preload cancels events it ran');
  assert.equal(message.stopped, true);
  // Top frame: the code itself goes to executeJavaScript (exempt from the page
  // CSP), never through a <script> element (which the page CSP would block).
  assert.deepEqual(executed, ['window.tm = 1']);
  assert.equal(dom.window.tm, 1, 'ran in the main world');
  assert.deepEqual(dom.ran, [], 'no inline <script> element');
  // A same-origin child frame: inserted there (that frame's CSP applies).
  const framed = new dom.CustomEvent(event, { detail: JSON.stringify({ code: 'window.child = 1', frame: 'tok' }), cancelable: true });
  assert.equal(dom.document.dispatchEvent(framed), false);
  assert.deepEqual(dom.ran, ['window.child = 1'], 'falls back to the element when the frame is not reachable');
  assert.equal(dom.document.head.children.length, 0, 'the helper script element is removed again');
  assert.equal(executed.length, 2);
  const noCode = new dom.CustomEvent(event, { detail: JSON.stringify({ frame: null }), cancelable: true });
  assert.equal(dom.document.dispatchEvent(noCode), true, 'malformed messages are left alone');
  const bogus = new dom.CustomEvent(event, { detail: { code: 'x' }, cancelable: true });
  assert.equal(dom.document.dispatchEvent(bogus), true, 'non-string details are ignored');

  // Registration on the session (and nothing where Electron lacks the API).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-page-exec-'));
  const file = path.join(dir, 'page-exec-preload.js');
  const calls = [];
  const ses = {
    registerPreloadScript: script => { calls.push(['register', script]); return script.id; },
    unregisterPreloadScript: id => calls.push(['unregister', id])
  };
  assert.equal(installPageExec(ses, file, event), true);
  assert.equal(fs.readFileSync(file, 'utf8'), pageExecPreload(event));
  assert.deepEqual(calls, [['unregister', PAGE_EXEC_PRELOAD_ID], ['register', { type: 'frame', id: PAGE_EXEC_PRELOAD_ID, filePath: file }]]);
  uninstallPageExec(ses);
  assert.deepEqual(calls.at(-1), ['unregister', PAGE_EXEC_PRELOAD_ID]);
  assert.equal(installPageExec({}, file, event), false, 'older Electron: no preload');
  fs.rmSync(dir, { recursive: true, force: true });

  // The USER_SCRIPT world: inline <script> goes to the preload first, the relay otherwise.
  const hub = makeHub();
  const host = hostEndpoint(hub);
  const files = new Map();
  host.handle('userScripts.syncFiles', ({ keep }) => ({ missing: keep.filter(h => !files.has(h)) }));
  host.handle('userScripts.writeFiles', ({ files: list }) => { for (const f of list) files.set(f.hash, f.code); return { written: list.length }; });
  host.handle('userScripts.pageExec', () => ({ event }));
  const registered = new Map();
  const scripting = {
    async registerContentScripts(list) { for (const r of list) registered.set(r.id, structuredClone(r)); },
    async unregisterContentScripts(filter) { for (const id of filter?.ids || [...registered.keys()]) registered.delete(id); },
    async getRegisteredContentScripts() { return [...registered.values()].map(r => structuredClone(r)); }
  };
  const runtime = { id: EXT_ID, getManifest: () => ({ manifest_version: 3, permissions: ['userScripts', 'scripting'] }), getURL: f => `chrome-extension://${EXT_ID}/${f}`, onMessage: { addListener() {} }, onConnect: { addListener() {} } };
  const env = evaluate({ permissions: ['userScripts', 'scripting'], hub, extra: { scripting, runtime }, page: { fetch: async () => ({ text: async () => '' }), crypto: globalThis.crypto } });
  await env.chrome.userScripts.configureWorld({ csp: "script-src 'self' 'unsafe-inline'", messaging: true });
  await env.chrome.userScripts.register([{ id: 'content', js: [{ code: '1' }], matches: ['<all_urls>'], world: 'USER_SCRIPT' }]);
  const fileOf = p => files.get(p.replace('__obsidian_bridge_us/', '').replace(/\.js$/, ''));
  const prologue = fileOf(registered.get('obsidian-us-content').js[0]);
  assert(prologue.includes(JSON.stringify(event)), 'the secret event is baked into the world prologue');
  const relaySource = fileOf(registered.get('obsidian-us-relay').js[0]);
  assert.match(relaySource, /function runInlineScript/);

  const runWorld = (withPreload) => {
    const d = makeDom();
    // Each world has its own DOM prototypes: the page's appendChild is never the patched one.
    const nativeAppend = d.Node.prototype.appendChild;
    const pageDocument = { createElement: d.document.createElement, documentElement: d.document.documentElement, head: { appendChild: c => nativeAppend.call(d.document.head, c) } };
    const page = vm.createContext({ document: pageDocument, window: d.window });
    if (withPreload) vm.runInContext(pageExecPreload(event), vm.createContext({ document: d.document, console, require: () => ({ webFrame: { executeJavaScript: code => vm.runInContext(code, page) } }) }));
    // The MAIN-world relay content script (subject to the page CSP in reality).
    const relayWorld = vm.createContext({ window: d.window, globalThis: {} });
    relayWorld.document = Object.assign(Object.create(d.document), { addEventListener: d.document.addEventListener, head: pageDocument.head });
    vm.runInContext(relaySource, relayWorld);
    const relayed = [];
    d.listeners['__obsidian_bridge_inline_' + EXT_ID].unshift(e => relayed.push(e.detail));
    const isolated = { chrome: { runtime: { ...runtime, sendMessage() {}, connect: () => ({}) } }, document: d.document, Node: d.Node, Element: d.Element, HTMLScriptElement: d.HTMLScriptElement, CustomEvent: d.CustomEvent };
    isolated.globalThis = isolated;
    vm.runInNewContext(prologue, isolated);
    const script = d.document.createElement('script');
    script.textContent = 'window.pageBridge = 1';
    d.document.head.appendChild(script);
    return { ran: d.ran, relayed, script, window: d.window };
  };
  const viaPreload = runWorld(true);
  assert.equal(viaPreload.window.pageBridge, 1, 'ran once, through the preload');
  assert.deepEqual(viaPreload.ran, [], 'executed directly, not as an inline <script> (the page CSP would block it)');
  assert.deepEqual(viaPreload.relayed, [], 'the relay is not involved');
  assert.equal(viaPreload.script.getAttribute('type'), null, 'the original element is restored after insertion');
  const viaRelay = runWorld(false);
  assert.equal(viaRelay.relayed.length, 1, 'without the preload the MAIN-world relay gets it');
  assert.deepEqual(viaRelay.ran, ['window.pageBridge = 1']);

  console.log('PASS: page-exec preload runs user-script inline code despite the page CSP; relay fallback');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
