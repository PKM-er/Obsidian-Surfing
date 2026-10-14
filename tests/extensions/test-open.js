'use strict';
// Opening pages from an extension: tabs.create / windows.create /
// runtime.openOptionsPage, and window.open / new-tab links in extension pages,
// all become host requests that open Obsidian tabs.
const assert = require('node:assert/strict');
const { makeHub, hostEndpoint, evaluate, tick, plain, EXT_ID } = require('./helpers/compat-env');

(async () => {
  const hub = makeHub();
  const host = hostEndpoint(hub);
  const opened = [];
  host.handle('tabs.open', params => { opened.push(params); return { tabId: 9 }; });
  host.handle('runtime.openOptionsPage', () => ({ tabId: 11 }));

  // Worker context: Electron lacks tabs.create / windows / openOptionsPage.
  const { chrome, info } = evaluate({ permissions: ['tabs'], hub });
  for (const key of ['tabs.create', 'windows.create', 'runtime.openOptionsPage']) assert(info.installed.includes(key), key);
  const tab = await chrome.tabs.create({ url: 'https://example.com/welcome' });
  assert.equal(tab.id, 9);
  assert.equal(tab.url, 'https://opened.example/', 'returns the real Tab from tabs.get');
  await chrome.tabs.create({ url: 'options.html#dashboard', active: false });
  assert.deepEqual(plain(opened), [
    { url: 'https://example.com/welcome', active: true, reason: 'tabs.create' },
    { url: `chrome-extension://${EXT_ID}/options.html#dashboard`, active: false, reason: 'tabs.create' }
  ], 'relative URLs resolve against the extension root');
  await assert.rejects(chrome.tabs.create({ url: 'javascript:alert(1)' }), /Cannot open URL/);
  const callbackTab = await new Promise(resolve => chrome.tabs.create({ url: 'https://x.example/' }, resolve));
  assert.equal(callbackTab.id, 9, 'callback style');

  const win = await chrome.windows.create({ url: ['https://a.example/', 'https://b.example/'], type: 'popup' });
  assert.equal(win.tabs.length, 2);
  assert.deepEqual(plain(opened.slice(-2)).map(o => [o.url, o.active, o.reason]),
    [['https://a.example/', true, 'windows.create'], ['https://b.example/', false, 'windows.create']]);
  assert.equal(chrome.windows.WINDOW_ID_CURRENT, -2);
  await chrome.runtime.openOptionsPage();

  // Native implementations are never replaced.
  const nativeCreate = () => {};
  const native = evaluate({ permissions: ['tabs'], hub, extra: { tabs: { create: nativeCreate, query: async () => [] } } });
  assert.equal(native.chrome.tabs.create, nativeCreate);

  // Without a host channel nothing pretends to work.
  const lonely = evaluate({ permissions: ['tabs'] });
  assert.equal(lonely.chrome.tabs.create, undefined);

  // Page context: window.open and target=_blank links go to Obsidian.
  const docListeners = {};
  const page = {
    location: { href: `chrome-extension://${EXT_ID}/popup.html`, pathname: '/popup.html' },
    open: () => 'native-window',
    document: { addEventListener(type, fn) { docListeners[type] = fn; } }
  };
  const popup = evaluate({ permissions: [], hub, worker: false, page });
  assert(popup.info.installed.includes('page.open-in-obsidian'));
  assert.equal(popup.ctx.open('https://docs.example/', '_blank'), null, 'like a blocked popup: no WindowProxy');
  assert.equal(popup.ctx.open('#same', '_self'), 'native-window', 'same-document targets stay native');
  const anchor = target => ({ closest: () => ({ href: 'https://link.example/', getAttribute: () => target, hasAttribute: () => false }) });
  let prevented = 0;
  const click = (target, extra = {}) => docListeners.click({ target: anchor(target), defaultPrevented: false, preventDefault: () => prevented++, button: 0, ...extra });
  click('_blank');
  click('');
  click('', { ctrlKey: true });
  await tick();
  assert.equal(prevented, 2, 'only new-tab clicks are intercepted');
  assert.deepEqual(plain(opened.slice(-3)).map(o => [o.url, o.reason]),
    [['https://docs.example/', 'window.open'], ['https://link.example/', 'link'], ['https://link.example/', 'link']]);

  // tabs.remove (missing in Electron) closes the Obsidian tab; tabs.update({active}) also focuses it.
  const removedIds = [], activated = [], nativeUpdates = [];
  host.handle('tabs.remove', ({ tabIds }) => { removedIds.push(...tabIds); return { removed: tabIds.length }; });
  host.handle('tabs.activate', ({ tabId }) => { activated.push(tabId); return { activated: true }; });
  const closer = evaluate({ permissions: ['tabs'], hub, extra: { tabs: { query: async () => [], update: async (id, props) => { nativeUpdates.push([id, props]); return { id }; } } } });
  assert(closer.info.installed.includes('tabs.remove'));
  await closer.chrome.tabs.remove(41);
  await new Promise(resolve => closer.chrome.tabs.remove([42, 43], resolve));
  assert.deepEqual(removedIds, [41, 42, 43]);
  await closer.chrome.tabs.update(44, { active: true });
  await closer.chrome.tabs.update(45, { url: 'https://x.example/' });
  await tick();
  assert.deepEqual(activated, [44], 'only active:true focuses the Obsidian tab');
  assert.deepEqual(plain(nativeUpdates), [[44, { active: true }], [45, { url: 'https://x.example/' }]], 'native update still runs');

  // permissions.contains: a declared host pattern covers narrower requests (Chrome semantics).
  const broad = evaluate({ manifestExtra: { host_permissions: ['<all_urls>'] } });
  assert.equal(await broad.chrome.permissions.contains({ origins: ['*://*/*'] }), true);
  assert.equal(await broad.chrome.permissions.contains({ origins: ['https://a.example/*', 'file:///*'] }), true);
  const narrow = evaluate({ manifestExtra: { host_permissions: ['https://*.example.com/*'] } });
  assert.equal(await narrow.chrome.permissions.contains({ origins: ['https://www.example.com/x/*'] }), true);
  assert.equal(await narrow.chrome.permissions.contains({ origins: ['https://evil.com/*'] }), false);
  assert.equal(await narrow.chrome.permissions.contains({ origins: ['*://*/*'] }), false);

  console.log('PASS: tabs.create / windows.create / openOptionsPage / window.open / links open Obsidian tabs');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
