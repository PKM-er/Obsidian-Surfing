'use strict';
// Browser tab integration (Web Viewer and Surfing): header buttons via
// view.addAction (puzzle + pinned extensions + store install), Obsidian
// context menu merge, and webNavigation event mapping from <webview> events.
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts');

// Minimal element with the Obsidian DOM helpers the tracker uses.
function el(tag = 'div') {
  const node = {
    tag, children: [], classes: new Set(), attrs: {}, dataset: {}, listeners: {}, isConnected: true, parent: null, text: '',
    addClass(...c) { c.forEach(x => this.classes.add(x)); }, removeClass(...c) { c.forEach(x => this.classes.delete(x)); },
    toggleClass(c, on) { if (on) this.classes.add(c); else this.classes.delete(c); }, style: {},
    hasClass(c) { return this.classes.has(c); },
    empty() { this.children.forEach(ch => { ch.isConnected = false; }); this.children = []; },
    createEl(t, o = {}) { const ch = el(t); if (o.cls) ch.addClass(...[].concat(o.cls)); if (o.text) ch.text = o.text; Object.assign(ch.attrs, o.attr || {}); ch.parent = this; this.children.push(ch); return ch; },
    createSpan(o) { return this.createEl('span', o); }, createDiv(o) { return this.createEl('div', o); },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); },
    fire(type, event = {}) { for (const fn of this.listeners[type] || []) fn({ target: this, ...event }); },
    remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  };
  return node;
}

global.window = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) };
global.MutationObserver = class { observe() {} disconnect() {} };
global.HTMLElement = class {};

const { Component } = require('./helpers/component');
const { BrowserTabTracker } = loadTs('src/host/browser-tabs.ts', { stubs: { obsidian: { setTooltip() {}, Component } } });

const browserTarget = (kind, partition) => ({
  kind, label: kind, viewType: kind === 'webviewer' ? 'webviewer' : 'surfing-view', partition, webviewSelector: 'webview',
  webviewOf: view => view.webview, nativePageMenu: kind === 'webviewer'
});

function makeView(url) {
  const actionsEl = el('div');
  const containerEl = el('div');
  containerEl.querySelector = () => null;
  const webview = el('webview');
  webview.attrs.partition = 'persist:x';
  webview.url = url;
  webview.getURL = () => webview.url;
  webview.getWebContentsId = () => 52;
  webview.stopped = 0;
  webview.loaded = [];
  webview.stop = () => { webview.stopped++; };
  webview.loadURL = async url => { webview.loaded.push(url); };
  webview.executed = [];
  webview.executeJavaScript = async code => { webview.executed.push(code); };
  const view = {
    containerEl, actionsEl, webview,
    addAction(icon, title, callback) {
      const button = el('button');
      button.icon = icon;
      button.title = title;
      button.click = () => callback({});
      // Obsidian prepends header actions.
      button.parent = actionsEl;
      actionsEl.children.unshift(button);
      return button;
    }
  };
  return view;
}

(async () => {
  const records = [
    { key: 'a', id: 'a'.repeat(32), name: 'Alpha', storeId: null, source: 'local', enabled: true },
    { key: 'b', id: 'b'.repeat(32), name: 'Beta', storeId: 'b'.repeat(32), source: 'store', enabled: true }
  ];
  const calls = [];
  const delivered = [];
  const tabEvents = [];
  const historyEntries = [];
  const fakeHistory = {
    getActiveIndex: () => historyEntries.length - 1,
    length: () => historyEntries.length,
    getEntryAtIndex: i => ({ url: historyEntries[i] }),
    removeEntryAtIndex: i => { historyEntries.splice(i, 1); return true; }
  };
  let built = null;
  const Menu = { buildFromTemplate(items) { built = items; return { popup() {} }; } };
  const originalBuild = Menu.buildFromTemplate;
  const leaves = [];
  const workspaceEvents = {};
  const plugin = {
    settings: { extensions: records },
    remote: { Menu, webContents: { fromId: () => ({ navigationHistory: fakeHistory }) }, webFrameMain: { fromId: (pid, rid) => ({ frameTreeNodeId: 40 + rid, parent: { parent: null } }) } },
    app: { workspace: {
      on(name, fn) { workspaceEvents[name] = fn; return {}; }, onLayoutReady(fn) { fn(); },
      getLeavesOfType: type => type === 'webviewer' ? leaves : [], getMostRecentLeaf: () => leaves[0] ?? null, containerEl: el('div')
    } },
    registerEvent() {},
    pinnedRecords: () => records.slice(0, 2),
    getDisplayName: rec => rec.name,
    iconFor: rec => rec.key === 'a' ? 'data:image/png;base64,AAAA' : null,
    badges: { a: '12' },
    actionView(rec, tabId) {
      return { name: rec.name, title: rec.name, icon: this.iconFor(rec), badgeText: tabId === 52 ? this.badges[rec.key] ?? '' : '', badgeBackgroundColor: 'rgba(200, 0, 0, 1)', enabled: rec.key !== 'b' };
    },
    forgetTab: tabId => calls.push(['forget', tabId]),
    togglePanel: (anchor, webview) => calls.push(['panel', anchor.title, webview.url]),
    activateExtension: (rec, anchor, webview) => calls.push(['activate', rec.key, anchor.title, webview.url]),
    showExtensionMenu: rec => calls.push(['menu', rec.key]),
    installFromStore: async id => calls.push(['install', id]),
    menuSources: tabId => [{ extensionId: 'b'.repeat(32), extensionName: 'Beta', items: [{ id: 'x', title: 'Do X', contexts: ['page'] }], click: info => calls.push(['clicked', info.menuItemId, tabId]) }],
    wantsNavigation: () => true,
    wantsTabEvents: () => true,
    deliverTabEvent: (event, tab, extra) => tabEvents.push([event, tab.id, tab.status, JSON.stringify(extra?.changeInfo || extra?.removeInfo || {})]),
    netRequestDecision: url => /.user.js$/.test(url) ? { extension: 'TM', decision: { kind: 'redirect', url: 'https://www.tampermonkey.net/script_installation.php#url=' + url } }
      : /blocked.example/.test(url) ? { extension: 'Blocker', decision: { kind: 'block' } } : null,
    notifyBlocked: (ext, url) => calls.push(['blocked', ext, url]),
    deliverNavigation: (event, details) => delivered.push([event, details])
  };

  const view = makeView('https://chromewebstore.google.com/detail/x/' + 'c'.repeat(32));
  leaves.push({ view });
  const tracker = new BrowserTabTracker(plugin, browserTarget('webviewer', 'persist:x'));
  tracker.load();

  // Header: [store install] [Alpha] [Beta] [puzzle], all via addAction.
  const titles = () => view.actionsEl.children.map(b => b.title);
  assert.deepEqual(titles(), ['Install to Obsidian', 'Alpha', 'Beta', 'Chrome extensions']);
  const [store, alpha, beta, puzzle] = view.actionsEl.children;
  assert(alpha.children.some(c => c.tag === 'img'), 'extension icon replaces the placeholder icon');
  assert(beta.children.some(c => c.classes.has('chrome-bridge-ext-monogram')), 'monogram without an icon');
  // chrome.action: badge text/colors for this tab, disabled look, redraw on change.
  const badgeOf = button => button.children.find(c => c.classes.has('chrome-bridge-badge'));
  assert.equal(badgeOf(alpha).text, '12');
  assert.equal(badgeOf(alpha).style.backgroundColor, 'rgba(200, 0, 0, 1)');
  assert.equal(badgeOf(beta), undefined);
  assert(beta.classes.has('is-action-disabled'));
  plugin.badges.a = '99+';
  tracker.refreshActionVisuals('a'.repeat(32));
  assert.equal(badgeOf(alpha).text, '99+');
  plugin.badges.a = '';
  tracker.refreshActionVisuals();
  assert.equal(badgeOf(alpha), undefined);
  assert.equal(tracker.actionAnchor('a'.repeat(32), view.webview), alpha);
  assert.equal(tracker.actionAnchor('z'.repeat(32), view.webview), puzzle, 'falls back to the puzzle button');
  puzzle.click();
  alpha.click();
  alpha.fire('contextmenu', { preventDefault() {} });
  await store.click();
  assert.deepEqual(calls.splice(0), [
    ['panel', 'Chrome extensions', view.webview.url],
    ['activate', 'a', 'Alpha', view.webview.url],
    ['menu', 'a'],
    ['install', 'c'.repeat(32)]
  ]);
  // Leaving the store page removes the install action.
  view.webview.url = 'https://example.com/';
  view.webview.fire('did-navigate');
  assert.deepEqual(titles(), ['Alpha', 'Beta', 'Chrome extensions']);
  // Already-installed store extension offers an update check instead.
  view.webview.url = 'https://chromewebstore.google.com/detail/beta/' + 'b'.repeat(32);
  view.webview.fire('did-navigate-in-page');
  assert.equal(titles()[0], 'Installed · Check for updates');

  // Pins changed: only header buttons are rebuilt.
  plugin.pinnedRecords = () => [records[1]];
  tracker.refreshActions();
  assert.deepEqual(titles(), ['Installed · Check for updates', 'Beta', 'Chrome extensions'], 'store action stays leftmost');
  assert(!titles().includes('Alpha'));

  // Context menu: our capture listener extends the template Obsidian builds next.
  view.containerEl.fire('context-menu', { target: view.webview, params: { pageURL: 'https://example.com/' } });
  Menu.buildFromTemplate([{ label: 'Back' }, { label: 'Reload' }]);
  assert.deepEqual(built.map(i => i.label ?? i.type), ['Back', 'Reload', 'separator', 'Do X']);
  assert.equal(Menu.buildFromTemplate, originalBuild, 'patch is one-shot');
  built.at(-1).click();
  assert.deepEqual(calls.splice(0), [['clicked', 'x', 52]]);

  // webNavigation mapping for a main-frame load and a sub-frame.
  const w = view.webview;
  w.url = 'https://news.example/a';
  w.fire('did-start-navigation', { url: w.url, isMainFrame: true, isInPlace: false, frameProcessId: 4, frameRoutingId: 1 });
  w.fire('did-frame-navigate', { url: w.url, isMainFrame: true, frameProcessId: 4, frameRoutingId: 1 });
  w.fire('dom-ready');
  w.fire('did-frame-navigate', { url: 'https://ads.example/', isMainFrame: false, frameProcessId: 5, frameRoutingId: 2 });
  w.fire('did-frame-finish-load', { isMainFrame: false, frameProcessId: 5, frameRoutingId: 2 });
  w.fire('did-frame-finish-load', { isMainFrame: true, frameProcessId: 4, frameRoutingId: 1 });
  w.fire('did-navigate-in-page', { url: 'https://news.example/a#c2', isMainFrame: true, frameProcessId: 4, frameRoutingId: 1 });
  w.fire('did-navigate-in-page', { url: 'https://news.example/b', isMainFrame: true, frameProcessId: 4, frameRoutingId: 1 });
  w.fire('did-frame-navigate', { url: 'https://news.example/b', isMainFrame: true, frameProcessId: 4, frameRoutingId: 1 });
  w.fire('did-fail-load', { isMainFrame: true, errorCode: -105, errorDescription: 'ERR_NAME_NOT_RESOLVED', validatedURL: 'https://nope.invalid/', frameProcessId: 4 });
  const summary = delivered.map(([e, d]) => [e, d.frameId, d.parentFrameId, d.url, d.transitionType ?? d.error ?? '']);
  assert.deepEqual(summary, [
    ['onBeforeNavigate', 0, -1, 'https://news.example/a', ''],
    ['onCommitted', 0, -1, 'https://news.example/a', 'link'],
    ['onDOMContentLoaded', 0, -1, 'https://news.example/a', ''],
    ['onCommitted', 42, 0, 'https://ads.example/', 'auto_subframe'],
    ['onCompleted', 42, 0, 'https://ads.example/', ''],
    ['onCompleted', 0, -1, 'https://news.example/a', ''],
    ['onReferenceFragmentUpdated', 0, -1, 'https://news.example/a#c2', 'link'],
    ['onHistoryStateUpdated', 0, -1, 'https://news.example/b', 'link'],
    ['onCommitted', 0, -1, 'https://news.example/b', 'reload'],
    ['onErrorOccurred', 0, -1, 'https://nope.invalid/', 'net::ERR_NAME_NOT_RESOLVED']
  ]);
  assert(delivered.every(([, d]) => d.tabId === 52 && typeof d.timeStamp === 'number'));
  // Nothing is observed (not even remote frame lookups) when nobody listens.
  plugin.wantsNavigation = () => false;
  w.fire('did-frame-navigate', { url: 'https://x/', isMainFrame: false, frameProcessId: 9, frameRoutingId: 9 });
  assert.equal(delivered.length, 10);

  // declarativeNetRequest: redirect / block top-level navigations, no loops.
  // A web redirect waits for the original to commit, then replaces it in place
  // (no extra history entry; the page's history.length stays right).
  const script = 'https://update.greasyfork.org/scripts/3374/script.user.js';
  const target = 'https://www.tampermonkey.net/script_installation.php#url=' + script;
  w.fire('did-start-navigation', { url: script, isMainFrame: true, isInPlace: false });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(w.stopped, 0, 'web redirects do not cancel the original');
  historyEntries.push('data:text/plain,', script);
  w.fire('did-navigate', { url: script });
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(w.executed, [`location.replace(${JSON.stringify(target)})`]);
  assert.deepEqual(historyEntries, [script], 'blank new-tab placeholder dropped before replacing');
  historyEntries[0] = target;
  w.fire('did-navigate', { url: target });
  // window.close() from a single-entry tab closes the Obsidian tab (even if the guest is already gone).
  let detached = 0;
  view.leaf = { detach: () => detached++ };
  w.fire('close');
  assert.equal(detached, 1);
  // With a real previous page, it stays (history.back() returns there).
  const other = 'https://update.greasyfork.org/scripts/9999/other.user.js';
  historyEntries.length = 0;
  historyEntries.push('https://greasyfork.org/scripts/3374', other);
  w.fire('did-start-navigation', { url: other, isMainFrame: true, isInPlace: false });
  w.fire('did-navigate', { url: other });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(w.executed.length, 2);
  assert.deepEqual(historyEntries, ['https://greasyfork.org/scripts/3374', other], 'real pages are kept');
  historyEntries[1] = 'https://www.tampermonkey.net/script_installation.php#url=' + other;
  w.fire('did-navigate', { url: historyEntries[1] });
  w.fire('close');
  assert.equal(detached, 1, 'a tab with history is not closed by window.close()');
  // The original never commits (download/error): fall back to loading the target.
  const third = 'https://update.greasyfork.org/scripts/7777/third.user.js';
  w.fire('did-start-navigation', { url: third, isMainFrame: true, isInPlace: false });
  w.fire('did-fail-load', { isMainFrame: true, validatedURL: third, errorCode: -3 });
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(w.loaded, ['https://www.tampermonkey.net/script_installation.php#url=' + third]);
  // Targets, sub-frames and in-page changes are never redirected.
  w.fire('did-start-navigation', { url: target, isMainFrame: true, isInPlace: false });
  w.fire('did-start-navigation', { url: script, isMainFrame: false, isInPlace: false });
  w.fire('did-start-navigation', { url: script + '#x', isMainFrame: true, isInPlace: true });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(w.executed.length + w.loaded.length, 3, 'targets, sub-frames and in-page changes are not redirected');
  w.fire('did-start-navigation', { url: 'https://blocked.example/', isMainFrame: true, isInPlace: false });
  assert.equal(w.stopped, 1, 'blocks cancel the navigation');
  assert.deepEqual(calls.splice(0), [['blocked', 'Blocker', 'https://blocked.example/']]);

  // chrome.tabs events: Chrome's load sequence from the same webview events.
  const tabSummary = tabEvents.filter(e => e[0] === 'onUpdated').slice(0, 4);
  assert.equal(tabSummary[0][0], 'onUpdated');
  w.fire('did-stop-loading');
  tabEvents.length = 0;
  w.fire('did-start-navigation', { url: 'https://t.example/', isMainFrame: true, isInPlace: false });
  w.url = 'https://t.example/';
  w.fire('did-navigate', { url: 'https://t.example/' });
  w.fire('page-title-updated', { title: 'T' });
  w.fire('page-title-updated', { title: 'T' });
  w.fire('did-stop-loading');
  assert.deepEqual(tabEvents.map(e => [e[0], e[2], e[3]]), [
    ['onUpdated', 'loading', '{"status":"loading","url":"https://t.example/"}'],
    ['onUpdated', 'loading', '{"title":"T"}'],
    ['onUpdated', 'complete', '{"status":"complete"}']
  ], 'duplicate titles are not repeated');
  tabEvents.length = 0;
  // A navigation that never commits (blocked history.back() to data:) is not a reload.
  w.fire('did-start-navigation', { url: 'data:text/plain,', isMainFrame: true, isInPlace: false });
  w.fire('did-stop-loading');
  assert.deepEqual(tabEvents, []);
  // A tab opened after startup is reported as created.
  const second = makeView('https://second.example/');
  second.webview.getWebContentsId = () => 77;
  leaves.push({ view: second });
  tracker.sync();
  assert.deepEqual(tabEvents.map(e => [e[0], e[1]]), [['onCreated', 77]]);
  tabEvents.length = 0;
  leaves.pop();
  tracker.sync();
  assert.deepEqual(tabEvents.map(e => [e[0], e[1], e[3]]), [['onRemoved', 77, '{"windowId":-1,"isWindowClosing":false}']]);

  // Closing the Web Viewer tab tears everything down.
  leaves.length = 0;
  tracker.sync();
  assert.deepEqual(titles(), []);
  assert.equal((view.containerEl.listeners['context-menu'] || []).length, 0);
  assert.equal((w.listeners['did-navigate'] || []).length, 0);
  assert.equal((w.listeners['did-start-navigation'] || []).length, 0);
  tracker.unload();
  console.log('PASS: Web Viewer header actions via addAction, pins, store install, context menu merge, webNavigation mapping, teardown');

  // Surfing tabs: the same header buttons, but Surfing builds its own page
  // menu (no native menu patching), and isolated sessions are left alone.
  const surfing = makeView('https://surfing.example/');
  const isolated = makeView('https://isolated.example/');
  isolated.webview.attrs.partition = 'surfing-vault-app-leaf';
  leaves.push({ view: surfing }, { view: isolated });
  const surfingTracker = new BrowserTabTracker(plugin, browserTarget('surfing', 'persist:x'));
  plugin.app.workspace.getLeavesOfType = type => type === 'surfing-view' ? leaves : [];
  surfingTracker.load();
  assert.deepEqual(surfing.actionsEl.children.map(b => b.title), ['Beta', 'Chrome extensions']);
  assert.equal((surfing.containerEl.listeners['context-menu'] || []).length, 0, 'no native menu merge in Surfing');
  assert.deepEqual(isolated.actionsEl.children, [], 'tabs in another session get no extension buttons');
  surfingTracker.unload();
  assert.deepEqual(surfing.actionsEl.children, []);
  console.log('PASS: Surfing tabs get header buttons; isolated sessions and native menus are skipped');
})().catch(error => { console.error(error); process.exitCode = 1; });
