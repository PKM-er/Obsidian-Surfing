'use strict';
// Electron's extension API subset lacks several namespaces MV3 workers touch
// at top level. Replays Read Frog's startup calls against an Electron-like
// chrome object and checks each fallback's behavior and disclosure.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '..', '..', 'build', 'extensions', 'compat-api.js'), 'utf8');
// Values from the vm realm have foreign prototypes; compare their JSON shape.
const deepEq = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual ?? null)), expected, message);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// storage.local shared by every context of one extension, like Chromium's.
function makeLocalStorage() {
  const data = new Map();
  const listeners = new Set();
  const changed = changes => { for (const fn of listeners) fn(changes, 'local'); };
  const local = {
    async get(keys) {
      const out = {};
      if (keys == null) { for (const [k, v] of data) out[k] = structuredClone(v); return out; }
      for (const k of typeof keys === 'string' ? [keys] : keys) if (data.has(k)) out[k] = structuredClone(data.get(k));
      return out;
    },
    async set(values) {
      const changes = {};
      for (const [k, v] of Object.entries(values)) {
        changes[k] = { oldValue: data.get(k), newValue: structuredClone(v) };
        data.set(k, structuredClone(v));
      }
      changed(changes);
    },
    async remove(keys) {
      const changes = {};
      for (const k of typeof keys === 'string' ? [keys] : keys) {
        if (data.has(k)) { changes[k] = { oldValue: data.get(k) }; data.delete(k); }
      }
      if (Object.keys(changes).length) changed(changes);
    }
  };
  return { data, local, onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } };
}

const readFrogPermissions = ['storage', 'unlimitedStorage', 'tabs', 'alarms', 'cookies', 'contextMenus',
  'identity', 'scripting', 'webNavigation', 'offscreen', 'sidePanel'];

function evaluate({ storage, permissions = readFrogPermissions, worker = true, bootId = 'boot-1', extra = {} }) {
  const chrome = {
    runtime: {
      id: 'm'.repeat(32), lastError: undefined,
      getManifest: () => ({ manifest_version: 3, permissions, action: { default_title: 'Popup | Read Frog', default_popup: 'popup.html' } }),
      getURL: file => `chrome-extension://${'m'.repeat(32)}/${file}`
    },
    // Electron: tabs.query/get exist, tabs events do not.
    tabs: { get: async id => id === 7 ? { id: 7, url: 'https://example.com/a' } : undefined, query: async () => [] },
    storage: { local: storage.local, onChanged: storage.onChanged },
    ...extra
  };
  const ctx = {
    chrome, console: { info() {}, warn() {}, error() {}, debug() {} }, queueMicrotask, Promise, setTimeout, clearTimeout,
    TextEncoder, URL, structuredClone,
    __obsidianBridgeLocaleData: { locale: 'en', messages: {}, ...(bootId ? { bridgeBootId: bootId } : {}) },
    addEventListener() {}
  };
  if (worker) ctx.ServiceWorkerGlobalScope = class { static [Symbol.hasInstance]() { return true; } };
  vm.runInNewContext(script, ctx);
  return { chrome, info: ctx.__obsidianBridgeCompatV06 };
}

(async () => {
  const storage = makeLocalStorage();
  const { chrome: T, info } = evaluate({ storage });
  deepEq(info.failed, []);
  for (const key of ['worker.error-trap', 'alarms.worker-timers', 'contextMenus',
    'tabs.events-registration-only', 'action.state-only', 'runtime.setUninstallURL-ignored',
    'storage.session-local', 'webNavigation.events', 'webNavigation.frames']) {
    assert(info.installed.includes(key), `${key} installed`);
  }
  for (const key of ['alarms', 'contextMenus', 'otherTabsEvents', 'action', 'storageSession', 'webNavigationFrames']) {
    assert.equal(typeof info.modes[key], 'string', `mode disclosed: ${key}`);
  }

  // Read Frog background top level, in source order; any TypeError aborts the worker.
  await T.alarms.get('config-backup').then(e => e || T.alarms.create('config-backup', { delayInMinutes: 60, periodInMinutes: 60 }));
  T.alarms.onAlarm.addListener(() => {});
  T.storage.session.onChanged.addListener(() => {});
  T.tabs.onActivated.addListener(() => {});
  T.tabs.onUpdated.addListener(() => {});
  T.tabs.onRemoved.addListener(() => {});
  T.webNavigation.onCommitted.addListener(() => {});
  T.contextMenus.onClicked.addListener(() => {});
  T.runtime.setUninstallURL('https://readfrog.app/uninstall');
  assert.equal((await T.action.getUserSettings()).isOnToolbar, true);
  assert.equal(typeof T.action.onUserSettingsChanged.addListener, 'function', 'avoids 1s getUserSettings polling');
  await T.action.setIcon({ tabId: 7, path: { 16: '/icon/16-active.png' } });

  // alarms: stored, fired once, periodic rescheduled, cleared.
  const stored = await T.alarms.get('config-backup');
  assert.equal(stored.periodInMinutes, 60);
  assert(Math.abs(stored.scheduledTime - (Date.now() + 3600000)) < 2000);
  const fired = [];
  T.alarms.onAlarm.addListener(alarm => fired.push(alarm.name));
  await T.alarms.create('once', { when: Date.now() + 20 });
  await T.alarms.create('every', { when: Date.now() + 20, periodInMinutes: 1 });
  await sleep(120);
  deepEq(fired.sort(), ['every', 'once']);
  assert.equal(await T.alarms.get('once'), undefined, 'one-shot alarm removed after firing');
  assert((await T.alarms.get('every')).scheduledTime > Date.now() + 50000, 'periodic alarm rescheduled');
  assert.equal(await T.alarms.clear('every'), true);
  assert.equal(await T.alarms.clear('every'), false);
  await assert.rejects(T.alarms.create('bad', {}), /Must set at least one/);
  await new Promise(resolve => T.alarms.getAll(all => { assert.equal(all.length, 1); resolve(); }));

  // A restarted worker restores persisted alarms and fires overdue ones.
  await T.alarms.create('overdue', { when: Date.now() + 1 });
  const restored = [];
  await sleep(0);
  const { chrome: T2 } = evaluate({ storage });
  T2.alarms.onAlarm.addListener(alarm => restored.push(alarm.name));
  await sleep(80);
  assert(restored.includes('overdue') || fired.includes('overdue'), 'overdue alarm fired exactly by one worker');
  assert.equal((await T2.alarms.get('config-backup')).periodInMinutes, 60, 'restored from storage');
  // A popup context reads the shared alarm set but never runs timers.
  const { chrome: popup } = evaluate({ storage, worker: false });
  assert.equal((await popup.alarms.getAll()).some(a => a.name === 'config-backup'), true);

  // contextMenus: registration semantics, no fabricated clicks.
  await T.contextMenus.removeAll();
  assert.equal(T.contextMenus.create({ id: 'read-frog-translate', title: 'Translate', contexts: ['selection'] }), 'read-frog-translate');
  T.contextMenus.create({ id: 'child', parentId: 'read-frog-translate', title: 'x' });
  await T.contextMenus.update('read-frog-translate', { title: 'Translate page' });
  await assert.rejects(T.contextMenus.update('missing', {}), /Cannot find menu item/);
  await T.contextMenus.remove('read-frog-translate');
  await assert.rejects(T.contextMenus.remove('child'), /Cannot find/, 'children removed with parent');

  // storage.session: shared via storage.local, derived change events, private prefix.
  const sessionChanges = [];
  T.storage.session.onChanged.addListener(changes => sessionChanges.push(changes));
  await T.storage.session.set({ translationState7: { enabled: true } });
  deepEq(await T.storage.session.get('translationState7'), { translationState7: { enabled: true } });
  deepEq(sessionChanges.at(-1), { translationState7: { newValue: { enabled: true } } });
  assert(storage.data.has('__obsidian_bridge_session_v1__translationState7'));
  deepEq(await T.storage.sync.get(null), {}, 'session keys do not leak into sync');
  // Same Obsidian start (popup, reloaded worker): values survive.
  const { chrome: samePopup } = evaluate({ storage, worker: false });
  deepEq(await samePopup.storage.session.get(null), { translationState7: { enabled: true } });
  // Next Obsidian start: tab ids are reused, so stale session state must go.
  const { chrome: nextStart } = evaluate({ storage, bootId: 'boot-2' });
  deepEq(await nextStart.storage.session.get(null), {});

  // webNavigation frame queries: main frame from tabs.get; unknown tab -> null.
  deepEq(await T.webNavigation.getAllFrames({ tabId: 7 }),
    [{ frameId: 0, parentFrameId: -1, processId: -1, url: 'https://example.com/a', errorOccurred: false, documentLifecycle: 'active', frameType: 'outermost_frame' }]);
  assert.equal(await T.webNavigation.getAllFrames({ tabId: 99 }), null);
  assert.equal(await T.webNavigation.getFrame({ tabId: 7, frameId: 3 }), null);

  // action state round-trips per tab with global fallback.
  await T.action.setBadgeText({ text: 'ON', tabId: 7 });
  assert.equal(await T.action.getBadgeText({ tabId: 7 }), 'ON');
  assert.equal(await T.action.getBadgeText({ tabId: 8 }), '');
  assert.equal(await T.action.getTitle({}), 'Popup | Read Frog');
  assert.equal(await T.action.getPopup({}), `chrome-extension://${'m'.repeat(32)}/popup.html`);

  // Undeclared permissions grant nothing; native APIs are never replaced.
  const { chrome: bare } = evaluate({ storage: makeLocalStorage(), permissions: [] });
  assert.equal(bare.alarms, undefined);
  assert.equal(bare.contextMenus, undefined);
  assert.equal(bare.storage.session, undefined);
  const nativeAlarms = { create() {}, get() {}, onAlarm: { addListener() {} } };
  const withNativeAlarms = evaluate({ storage: makeLocalStorage(), extra: { alarms: nativeAlarms } }).chrome;
  assert.equal(withNativeAlarms.alarms, nativeAlarms);
  assert.equal(withNativeAlarms.alarms.create, nativeAlarms.create);
  const nativeSession = { get() {}, onChanged: { addListener() {} } };
  const plain = makeLocalStorage();
  const withNativeSession = evaluate({ storage: plain,
    extra: { storage: { local: plain.local, onChanged: plain.onChanged, session: nativeSession } } }).chrome;
  assert.equal(withNativeSession.storage.session, nativeSession);
  // Chromium (Electron 43) also exposes `browser` as a distinct object, and WXT
  // selects it when browser.runtime.id exists. Both roots must be filled.
  {
    const s = makeLocalStorage();
    const runtime = { id: 'm'.repeat(32), getManifest: () => ({ manifest_version: 3, permissions: readFrogPermissions }) };
    const chrome = { runtime, tabs: { query: async () => [] }, storage: { local: s.local, onChanged: s.onChanged } };
    const browser = { runtime: { ...runtime }, tabs: { query: async () => [] }, storage: { local: s.local, onChanged: s.onChanged } };
    const ctx = { chrome, browser, console: { info() {}, warn() {}, error() {}, debug() {} }, queueMicrotask, Promise, setTimeout, clearTimeout, TextEncoder, URL };
    vm.runInNewContext(script, ctx);
    const wxt = ctx.browser?.runtime?.id ? ctx.browser : ctx.chrome;
    assert.equal(wxt, browser);
    wxt.webNavigation.onCommitted.addListener(() => {});
    assert.equal(browser.webNavigation, chrome.webNavigation, 'namespace aliased, shared listeners');
    assert.equal(browser.contextMenus, chrome.contextMenus);
    assert.equal(typeof browser.tabs.onActivated.addListener, 'function', 'member gaps filled on distinct native object');
    assert.equal(typeof browser.storage.session.onChanged.addListener, 'function');
    const roots = ctx.__obsidianBridgeCompatV06;
    assert.equal(roots.failed.length, 0, roots.failed.join('; '));
    assert(roots.installed.includes('browser:webNavigation=chrome.webNavigation'));
  }
  // Features that apps detect themselves stay absent rather than faked.
  assert.equal(T.runtime.getContexts, undefined);
  assert.equal(T.sidePanel, undefined);
  assert.equal(T.offscreen, undefined);
  assert.equal(T.cookies, undefined);
  console.log('PASS: MV3 startup gaps (alarms, contextMenus, tabs events, action, storage.session, setUninstallURL, frames), persistence, boot reset, permission gating');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
