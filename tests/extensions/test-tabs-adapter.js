'use strict';
// Popup "active tab": Electron marks no Web Viewer guest active. The popup's
// compat layer asks the host which REAL tab it was opened for; the popup URL
// itself is never changed (Dark Reader only trusts its exact popup URL).
const assert = require('node:assert/strict');
const { makeHub, hostEndpoint, evaluate } = require('./helpers/compat-env');

const extId = 'm'.repeat(32);
const raw = [
  { id: 53, url: `chrome-extension://${extId}/popup.html`, active: false, windowId: 0 },
  { id: 54, url: `chrome-extension://${extId}/__obsidian_bridge_host.html`, active: false, windowId: 0 },
  { id: 52, url: 'https://hckrnews.com/', active: false, windowId: 0 },
  { id: 51, url: 'https://example.com/', active: false, windowId: 0 },
  { id: 50, url: 'https://other.example/', active: false, windowId: 1 }
];

function environment(targetId, pathname = '/popup.html', worker = false) {
  const hub = makeHub();
  const host = hostEndpoint(hub);
  let asked = 0;
  host.handle('popup.targetTab', () => { asked++; return { tabId: targetId }; });
  host.handle('tabs.activeTab', () => { asked++; return { tabId: targetId }; });
  const calls = [];
  let lastSentTabId = null;
  const tabs = {
    query(query, callback) {
      calls.push(query);
      const rows = query?.active ? [] : raw.slice();
      if (callback) queueMicrotask(() => callback(rows));
      return Promise.resolve(rows);
    },
    sendMessage(tabId) { lastSentTabId = tabId; return Promise.resolve({ ok: true }); },
    get(id) { return Promise.resolve(raw.find(tab => tab.id === id)); }
  };
  const href = `chrome-extension://${extId}${pathname}`;
  const env = evaluate({
    hub, worker, extra: { tabs }, manifestExtra: { action: { default_popup: 'popup.html' } },
    page: worker ? null : { location: { href, pathname }, document: { addEventListener() {} } }
  });
  return { chrome: env.chrome, info: env.info, calls, href, get asked() { return asked; }, get lastSentTabId() { return lastSentTabId; } };
}

(async () => {
  const env = environment(52);
  assert.equal(env.href, `chrome-extension://${extId}/popup.html`, 'popup URL is the extension\'s own, unmodified');
  assert(env.info.installed.includes('tabs.active-webviewer'));
  const active = await env.chrome.tabs.query({ active: true, currentWindow: true });
  assert.equal(active.length, 1);
  assert.equal(active[0].id, 52);
  assert.equal(active[0].active, true);
  assert.equal(env.info.targetTabId, 52);
  const all = await env.chrome.tabs.query({});
  assert.equal(all.length, 3, 'neither the popup nor Bridge\'s hidden page is a browser tab');
  assert.equal(all.find(t => t.id === 52).active, true);
  assert.equal(all.find(t => t.id === 51).active, false);
  const inactive = await env.chrome.tabs.query({ active: false, currentWindow: true });
  assert.equal(inactive.length, 1);
  assert.equal(inactive[0].id, 51);
  assert.equal((await env.chrome.tabs.query({ currentWindow: true })).length, 2);
  assert.equal((await env.chrome.tabs.query({ active: true, currentWindow: false })).length, 0);
  const cbResult = await new Promise(resolve => env.chrome.tabs.query({ active: true, currentWindow: true }, resolve));
  assert.equal(cbResult[0].id, 52);
  assert.equal(env.asked, 1, 'the host is asked once per popup document');
  const detail = await env.chrome.tabs.get(52);
  await env.chrome.tabs.sendMessage(detail.id, { ping: true });
  assert.equal(env.lastSentTabId, 52, 'native tabs.get and tabs.sendMessage use the SAME REAL ID');
  assert(env.calls.filter(q => q && Object.keys(q).length).every(q => !Object.hasOwn(q, 'active')), 'native query must not keep broken active filter');

  assert.equal((await environment(999).chrome.tabs.query({ active: true, currentWindow: true })).length, 0, 'do not make up a deleted tab');
  const noTarget = environment(null);
  assert.equal((await noTarget.chrome.tabs.query({ active: true, currentWindow: true })).length, 0, 'do not guess active tab without host target');
  const options = environment(52, '/options.html');
  assert(!options.info.installed.includes('tabs.active-webviewer'), 'only the popup document uses the popup target');
  assert(options.info.installed.includes('tabs.active-from-obsidian'));

  // Background workers: the active tab is the Web Viewer focused in Obsidian.
  const worker = environment(51, '/', true);
  assert(worker.info.installed.includes('tabs.active-from-obsidian'));
  const lastFocused = await worker.chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: 'normal' });
  assert.deepEqual(lastFocused.map(t => [t.id, t.active]), [[51, true]], 'Dark Reader style getActiveTab finds the page');
  assert.equal(worker.calls.at(-1).windowType, 'normal', 'other filters still go to Electron');
  assert.deepEqual((await worker.chrome.tabs.query({ windowId: -2 })).map(t => t.id).sort(), [51, 52, 53], 'WINDOW_ID_CURRENT');
  const unrelated = await worker.chrome.tabs.query({ url: 'https://example.com/*' });
  assert.equal(unrelated.length, 4, 'unrelated filters are answered by Electron');
  assert.equal(unrelated.find(t => t.id === 51).active, true, '...with correct active flags');
  const asked = worker.asked;
  await Promise.all([worker.chrome.tabs.query({}), worker.chrome.tabs.query({}), worker.chrome.tabs.query({})]);
  assert.equal(worker.asked, asked + 1, 'concurrent queries share one host round trip');
  assert.equal((await worker.chrome.tabs.query({})).some(t => t.url.includes('__obsidian_bridge_')), false);
  const unknown = environment(null, '/', true);
  assert.equal((await unknown.chrome.tabs.query({ active: true, currentWindow: true })).length, 0, 'no focused Web Viewer: nothing active');
  // chrome.tabs events delivered by the host (Electron never fires them).
  for (const permissions of [['tabs'], []]) {
    const hub = makeHub();
    const host = hostEndpoint(hub);
    const tabs = { get: async id => ({ id, windowId: 3, url: 'https://native.example/', index: 0 }), query: async () => [] };
    const env = evaluate({ hub, permissions, extra: { tabs } });
    const seen = [];
    env.chrome.tabs.onUpdated.addListener((tabId, change, tab) => seen.push(['updated', tabId, change, tab]));
    env.chrome.tabs.onActivated.addListener(info => seen.push(['activated', info]));
    env.chrome.tabs.onRemoved.addListener((tabId, info) => seen.push(['removed', tabId, info]));
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(host.last('tabs.listeners').events.sort(), ['onActivated', 'onRemoved', 'onUpdated']);
    host.send({ type: 'tabs.event', event: 'onUpdated', tab: { id: 52, url: 'https://live.example/', status: 'complete', active: true }, changeInfo: { status: 'complete', url: 'https://live.example/' } });
    host.send({ type: 'tabs.event', event: 'onActivated', tab: { id: 52, active: true } });
    host.send({ type: 'tabs.event', event: 'onRemoved', tab: { id: 52 }, removeInfo: { windowId: -1, isWindowClosing: false } });
    await new Promise(r => setTimeout(r, 200));
    const [updated, activated, removed] = JSON.parse(JSON.stringify(seen));
    assert.equal(updated[1], 52);
    assert.equal(updated[3].windowId, 3, 'real Tab from Electron');
    assert.equal(updated[3].status, 'complete');
    assert.equal(updated[3].active, true);
    if (permissions.length) {
      assert.equal(updated[3].url, 'https://live.example/', 'live URL from Obsidian');
      assert.equal(updated[2].url, 'https://live.example/');
    } else {
      assert.equal(updated[3].url, undefined, 'no URL without the tabs permission');
      assert.equal(updated[2].url, undefined);
    }
    assert.deepEqual(activated, ['activated', { tabId: 52, windowId: 3 }]);
    assert.deepEqual(removed, ['removed', 52, { windowId: -1, isWindowClosing: false }]);
  }
  console.log('PASS: popup active tab from host (unmodified popup URL), callback/promise, window scoping, popup/bridge exclusion, native get/sendMessage');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
