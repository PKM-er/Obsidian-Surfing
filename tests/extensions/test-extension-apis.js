'use strict';
// Extension side of the APIs Obsidian provides: chrome.action reporting and
// onClicked/openPopup, notifications, cookies, windows, tabs extras and
// commands — all as messages/requests over the host channel.
const assert = require('node:assert/strict');
const { makeHub, hostEndpoint, evaluate, tick, plain, EXT_ID } = require('./helpers/compat-env');

(async () => {
  const hub = makeHub();
  const host = hostEndpoint(hub);
  const requests = [];
  const answer = (method, fn) => host.handle(method, params => { requests.push([method, plain(params)]); return fn(params); });

  // ---- chrome.action: native setters observed, state reported -------------
  const nativeCalls = [];
  const nativeAction = {};
  for (const m of ['setTitle', 'setBadgeText', 'setBadgeBackgroundColor', 'setBadgeTextColor', 'setPopup', 'setIcon', 'enable', 'disable']) {
    nativeAction[m] = (...args) => { nativeCalls.push(m); return Promise.resolve(); };
  }
  Object.assign(nativeAction, {
    getTitle: async () => 'Native title', getBadgeText: async () => '3', getBadgeBackgroundColor: async () => [255, 0, 0, 255],
    getBadgeTextColor: async () => [0, 0, 0, 0], getPopup: async () => `chrome-extension://${EXT_ID}/popup.html`, isEnabled: async () => true,
    getUserSettings: async () => ({ isOnToolbar: true }), onClicked: { addListener() {} }
  });
  const fetched = [];
  const worker = evaluate({
    hub, permissions: ['notifications', 'cookies', 'tabs'],
    manifestExtra: { action: { default_popup: 'popup.html' }, commands: { _execute_action: {}, 'toggle-enable': { description: 'Toggle' } } },
    extra: {
      action: nativeAction,
      tabs: { get: async id => ({ id, url: 'https://native.example/', title: 'Native', windowId: 0 }), query: async () => [
        { id: 1, url: 'https://a.example/', windowId: 0 },
        { id: 2, url: `chrome-extension://${'d'.repeat(32)}/__obsidian_bridge_host.html`, windowId: 0 },
        { id: 3, url: `chrome-extension://${EXT_ID}/__obsidian_bridge_host.html`, windowId: 0 }
      ] }
    },
    page: { fetch: async url => { fetched.push(url); return { ok: true, blob: async () => ({ size: 3, type: 'image/png', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) }; }, btoa: s => Buffer.from(s, 'binary').toString('base64') }
  });
  const { chrome, info } = worker;
  assert(info.installed.includes('action.rendered-by-obsidian'), JSON.stringify(info.failed));
  await tick();
  assert.deepEqual(plain(host.last('action.reset').props), { title: 'Native title', badgeText: '3', badgeBackgroundColor: 'rgba(255, 0, 0, 1.000)', popup: 'popup.html' },
    'global snapshot from Electron on start (unset values omitted)');
  // Electron answers '' for an unset popup/title (not the manifest default): never "no popup".
  const blankHub = makeHub();
  const blankHost = hostEndpoint(blankHub);
  evaluate({ hub: blankHub, manifestExtra: { action: { default_popup: 'popup.html' } }, extra: { action: {
    ...nativeAction, getTitle: async () => '', getBadgeText: async () => '', getPopup: async () => '', getBadgeBackgroundColor: async () => [0, 0, 0, 0]
  } } });
  await tick();
  assert.deepEqual(plain(blankHost.last('action.reset').props), {});
  await chrome.action.setBadgeText({ text: '12', tabId: 7 });
  await chrome.action.setBadgeBackgroundColor({ color: [0, 128, 0, 255] });
  await chrome.action.setPopup({ popup: '', tabId: 7 });
  await chrome.action.disable(8);
  await chrome.action.setIcon({ path: { 16: 'icons/16.png', 48: 'icons/48.png' }, tabId: 7 });
  await tick();
  assert.deepEqual(nativeCalls, ['setBadgeText', 'setBadgeBackgroundColor', 'setPopup', 'disable', 'setIcon'], 'native setters still called');
  const updates = host.received.filter(m => m.type === 'action.update').map(m => [m.tabId, m.props]);
  assert.deepEqual(plain(updates), [
    [7, { badgeText: '12' }], [null, { badgeBackgroundColor: 'rgba(0, 128, 0, 1.000)' }], [7, { popup: '' }], [8, { enabled: false }],
    [7, { icon: 'data:image/png;base64,AQID' }]
  ]);
  assert.deepEqual(fetched, [`chrome-extension://${EXT_ID}/icons/48.png`], 'icon from the extension, size >= 32 preferred');

  const clicks = [];
  chrome.action.onClicked.addListener(tab => clicks.push(tab));
  host.send({ type: 'action.clicked', tab: { id: 52, url: 'https://page.example/', title: 'Page', active: true } });
  host.send({ type: 'action.clicked', tab: { id: 53, active: true } });
  await tick();
  assert.equal(clicks[0].id, 52);
  assert.equal(clicks[0].url, 'https://page.example/');
  assert.equal(clicks[1].url, undefined, 'url withheld by the host stays withheld');
  answer('action.openPopup', () => ({ opened: true }));
  await chrome.action.openPopup();
  answer('action.openPopup', () => ({ opened: false }));
  await assert.rejects(chrome.action.openPopup(), /Failed to open popup/);
  console.log('PASS: action setters reported (per tab, colors, icon as data URL), onClicked and openPopup');

  // ---- notifications --------------------------------------------------------
  assert(info.installed.includes('notifications'));
  answer('notifications.show', p => ({ shown: !(p.update && p.id === 'missing') }));
  answer('notifications.clear', () => ({ cleared: true }));
  answer('notifications.getAll', () => ({ ids: ['n1'] }));
  const id = await chrome.notifications.create('n1', { type: 'basic', title: 'Hi', message: 'There', iconUrl: 'icons/16.png', buttons: [{ title: 'OK' }] });
  assert.equal(id, 'n1');
  const shown = requests.find(r => r[0] === 'notifications.show')[1];
  assert.deepEqual(shown, { id: 'n1', update: false, options: { type: 'basic', title: 'Hi', message: 'There', buttons: [{ title: 'OK' }], iconUrl: 'data:image/png;base64,AQID' } });
  const generated = await chrome.notifications.create({ type: 'basic', title: 'T', message: 'M', iconUrl: 'i.png' });
  assert.match(generated, /^[a-z0-9]{8,}$/);
  await assert.rejects(chrome.notifications.create('x', { title: 'no type' }), /required properties/);
  assert.equal(await chrome.notifications.update('missing', { title: 'u' }), false);
  assert.equal(await chrome.notifications.clear('n1'), true);
  assert.deepEqual(plain(await chrome.notifications.getAll()), { n1: true });
  const events = [];
  chrome.notifications.onClicked.addListener(i => events.push(['clicked', i]));
  chrome.notifications.onButtonClicked.addListener((i, b) => events.push(['button', i, b]));
  chrome.notifications.onClosed.addListener((i, byUser) => events.push(['closed', i, byUser]));
  host.send({ type: 'notifications.event', event: 'onClicked', id: 'n1' });
  host.send({ type: 'notifications.event', event: 'onButtonClicked', id: 'n1', buttonIndex: 0 });
  host.send({ type: 'notifications.event', event: 'onClosed', id: 'n1', byUser: true });
  await tick();
  assert.deepEqual(events, [['clicked', 'n1'], ['button', 'n1', 0], ['closed', 'n1', true]]);
  console.log('PASS: notifications create/update/clear/getAll and events');

  // ---- cookies ------------------------------------------------------------------
  answer('cookies.get', p => ({ name: p.name, value: 'v', domain: 'a.example', hostOnly: true, path: '/', secure: true, httpOnly: false, sameSite: 'lax', session: true, storeId: '0' }));
  answer('cookies.getAll', () => []);
  answer('cookies.set', () => null);
  answer('cookies.remove', p => ({ url: p.url, name: p.name, storeId: '0' }));
  assert.equal((await chrome.cookies.get({ url: 'https://a.example/', name: 'sid' })).value, 'v');
  assert.deepEqual(plain(await chrome.cookies.getAll({ domain: 'a.example' })), []);
  assert.deepEqual(plain(await chrome.cookies.getAllCookieStores()), [{ id: '0', tabIds: [] }]);
  const cookieEvents = [];
  const onCookie = change => cookieEvents.push(change);
  chrome.cookies.onChanged.addListener(onCookie);
  await tick();
  assert.equal(host.last('cookies.listeners').active, true, 'interest announced');
  host.send({ type: 'cookies.changed', info: { cookie: { name: 'sid' }, cause: 'explicit', removed: false } });
  await tick();
  assert.equal(cookieEvents[0].cookie.name, 'sid');
  chrome.cookies.onChanged.removeListener(onCookie);
  await tick();
  assert.equal(host.last('cookies.listeners').active, false);
  const noPermission = evaluate({ hub, permissions: [] });
  assert.equal(noPermission.chrome.cookies, undefined);
  assert.equal(noPermission.chrome.notifications, undefined);
  console.log('PASS: cookies get/getAll/set/remove/stores and onChanged interest; permission-gated');

  // ---- windows and tabs extras ---------------------------------------------------
  const win = await chrome.windows.getCurrent({ populate: true });
  assert.equal(win.id, 0);
  assert.deepEqual(win.tabs.map(t => t.id), [1], 'hidden bridge pages of every extension are not tabs');
  assert.deepEqual((await chrome.tabs.query({})).map(t => t.id), [1]);
  assert.equal((await chrome.windows.get(-2)).id, 0);
  await assert.rejects(chrome.windows.get(5), /No window with id: 5/);
  assert.equal((await chrome.windows.getAll()).length, 1);
  assert.deepEqual(plain(await chrome.windows.getAll({ windowTypes: ['popup'] })), []);
  await assert.rejects(chrome.windows.remove(0), /cannot be closed/);
  assert.equal(typeof chrome.windows.onFocusChanged.addListener, 'function');
  answer('tabs.history', () => ({ moved: true }));
  answer('tabs.capture', p => ({ dataUrl: `data:image/${p.format};base64,AAAA` }));
  await chrome.tabs.goBack();
  await chrome.tabs.goForward(7);
  assert.equal(await chrome.tabs.captureVisibleTab(), 'data:image/jpeg;base64,AAAA');
  assert.equal(await chrome.tabs.captureVisibleTab(0, { format: 'png' }), 'data:image/png;base64,AAAA');
  assert.deepEqual(requests.filter(r => r[0].startsWith('tabs.')).map(r => r[1]), [
    { tabId: null, delta: -1 }, { tabId: 7, delta: 1 }, { format: 'jpeg' }, { format: 'png' }
  ]);
  assert.equal(await chrome.tabs.getCurrent(), undefined, 'undefined in a worker');
  console.log('PASS: windows (one Obsidian window), tabs goBack/goForward/captureVisibleTab/getCurrent');

  // ---- commands ------------------------------------------------------------------
  answer('commands.shortcuts', () => ({ 'toggle-enable': 'Ctrl+Shift+T' }));
  assert.deepEqual(plain(await chrome.commands.getAll()), [
    { name: '_execute_action', description: '', shortcut: '' },
    { name: 'toggle-enable', description: 'Toggle', shortcut: 'Ctrl+Shift+T' }
  ]);
  const commands = [];
  chrome.commands.onCommand.addListener((name, tab) => commands.push([name, tab?.id]));
  host.send({ type: 'commands.command', command: 'toggle-enable', tab: { id: 52, url: 'https://p.example/', active: true } });
  host.send({ type: 'commands.command', command: 'other', tab: null });
  await tick();
  assert.deepEqual(commands, [['toggle-enable', 52], ['other', undefined]]);
  console.log('PASS: commands getAll (Obsidian hotkeys) and onCommand');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
