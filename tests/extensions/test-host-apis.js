'use strict';
// Host side of chrome.action state, chrome.notifications (Obsidian notices)
// and chrome.cookies (the Web Viewer session): validation and Chrome's
// permission rules.
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts');

const { ActionState, sanitizeActionProps } = loadTs('src/host/action-state.ts');
const { capabilitiesOf } = loadTs('src/host/grants.ts');

// ---- action state ------------------------------------------------------------
assert.deepEqual(sanitizeActionProps({
  title: 'T', badgeText: '1234567890123456789', badgeBackgroundColor: 'rgba(1, 2, 3, 0.5)', badgeTextColor: 'red;background:url(x)',
  icon: 'data:image/png;base64,AAAA', popup: '/popup.html?x=1', enabled: false, extra: 1
}), { title: 'T', badgeText: '1234567890123456', badgeBackgroundColor: 'rgba(1, 2, 3, 0.5)', icon: 'data:image/png;base64,AAAA', popup: 'popup.html?x=1', enabled: false });
for (const icon of ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'https://x/y.png']) assert.equal(sanitizeActionProps({ icon }).icon, undefined, icon);
for (const popup of ['../x.html', 'https://evil.example/', 'a\\b.html']) assert.equal(sanitizeActionProps({ popup }).popup, undefined, popup);
assert.deepEqual(sanitizeActionProps(null), {});
const state = new ActionState();
state.reset({ title: 'Global', badgeText: '' });
state.update(7, { badgeText: '5' });
state.update(null, { badgeBackgroundColor: '#f00' });
assert.deepEqual(state.resolve(7), { title: 'Global', badgeText: '5', badgeBackgroundColor: '#f00' });
assert.deepEqual(state.resolve(8), { title: 'Global', badgeText: '', badgeBackgroundColor: '#f00' });
state.forgetTab(7);
assert.equal(state.resolve(7).badgeText, '');
for (let i = 0; i < 600; i++) state.update(1000 + i, { badgeText: String(i) });
assert.equal(state.resolve(1000).badgeText, '', 'per-tab entries are bounded');
assert.equal(state.resolve(1599).badgeText, '599');
console.log('PASS: action state: validation, tab over global, forgetting, bounded');

// ---- notifications --------------------------------------------------------------
const notices = [];
class Notice {
  constructor(fragment, duration) { this.fragment = fragment; this.duration = duration; this.hidden = false; notices.push(this); }
  hide() { this.hidden = true; }
}
function el(tag) {
  return {
    tag, children: [], listeners: {}, attrs: {}, text: '',
    createDiv(o = {}) { return this.createEl('div', o); },
    createEl(t, o = {}) { const c = el(t); c.cls = o.cls; c.text = o.text ?? ''; Object.assign(c.attrs, o.attr || {}); this.children.push(c); return c; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    click() { for (const fn of this.listeners.click || []) fn({ stopPropagation() {} }); }
  };
}
global.createFragment = build => { const f = el('fragment'); build(f); return f; };
const { NotificationCenter } = loadTs('src/host/notifications.ts', { stubs: { obsidian: { Notice } } });
const events = [];
const center = new NotificationCenter((ext, event) => events.push([ext, event]));
const find = (node, cls) => node.cls === cls ? node : node.children.map(c => find(c, cls)).find(Boolean);
assert.equal(center.show('ext', 'Ext', 'n1', { title: 'Hello', message: 'World', iconUrl: 'https://tracker.example/i.png', buttons: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }, false), true);
const first = notices[0];
assert.equal(first.duration, 8000);
assert.equal(find(first.fragment, 'chrome-bridge-notification-icon'), undefined, 'remote icons are never loaded');
assert.equal(find(first.fragment, 'chrome-bridge-notification-buttons').children.length, 2, 'at most two buttons');
assert.equal(find(first.fragment, 'chrome-bridge-notification-title').text, 'Hello');
// update merges and replaces the notice silently.
assert.equal(center.show('ext', 'Ext', 'n1', { message: 'Updated' }, true), true);
assert.equal(first.hidden, true);
assert.equal(find(notices[1].fragment, 'chrome-bridge-notification-title').text, 'Hello', 'update keeps earlier fields');
assert.equal(find(notices[1].fragment, 'chrome-bridge-notification-message').text, 'Updated');
assert.deepEqual(events, [], 'replacing reports nothing');
assert.equal(center.show('ext', 'Ext', 'missing', { title: 'x' }, true), false);
// Clicking the body: onClicked, then Obsidian hides it (closed by the user).
find(notices[1].fragment, 'chrome-bridge-notification').click();
notices[1].hide();
assert.deepEqual(events.splice(0), [['ext', { event: 'onClicked', id: 'n1' }], ['ext', { event: 'onClosed', id: 'n1', byUser: true }]]);
// A button.
center.show('ext', 'Ext', 'n2', { title: 'x', buttons: [{ title: 'Go' }], requireInteraction: true }, false);
assert.equal(notices[2].duration, 0, 'requireInteraction stays until dismissed');
find(notices[2].fragment, 'chrome-bridge-notification-buttons').children[0].click();
assert.deepEqual(events.splice(0), [['ext', { event: 'onButtonClicked', id: 'n2', buttonIndex: 0 }], ['ext', { event: 'onClosed', id: 'n2', byUser: true }]]);
// Timing out is not the user; clear() is not the user either.
center.show('ext', 'Ext', 'n3', { title: 'x' }, false);
notices[3].hide();
center.show('ext', 'Ext', 'n4', { title: 'x' }, false);
assert.deepEqual(center.ids('ext'), ['n4']);
assert.equal(center.clear('ext', 'n4'), true);
assert.equal(center.clear('ext', 'n4'), false);
assert.deepEqual(events.splice(0), [['ext', { event: 'onClosed', id: 'n3', byUser: false }], ['ext', { event: 'onClosed', id: 'n4', byUser: false }]]);
for (let i = 0; i < 25; i++) center.show('spam', 'Spam', 's' + i, { title: 'x' }, false);
assert.equal(center.ids('spam').length, 20, 'bounded per extension');
center.forget('spam');
assert.deepEqual(center.ids('spam'), []);
console.log('PASS: notifications as notices: click/button/timeout/clear events, update, limits, no remote icons');

// ---- cookies ----------------------------------------------------------------------
(async () => {
  const { getCookie, getAllCookies, setCookie, removeCookie, canAccessCookie } = loadTs('src/host/cookies.ts');
  const jar = [
    { name: 'sid', value: '1', domain: 'docs.example', hostOnly: true, path: '/', secure: true, httpOnly: true, session: true, sameSite: 'lax' },
    { name: 'sid', value: '2', domain: '.bank.example', hostOnly: false, path: '/', secure: true, httpOnly: true, session: false, expirationDate: 2e9, sameSite: 'strict' }
  ];
  const calls = [];
  const cookies = {
    async get(filter) { calls.push(['get', filter]); return jar.filter(c => !filter.name || c.name === filter.name).filter(c => !filter.url || new URL(filter.url).hostname.endsWith(c.domain.replace(/^\./, ''))); },
    async set(details) { calls.push(['set', details]); jar.push({ ...details, domain: new URL(details.url).hostname, hostOnly: true, path: '/', secure: false, httpOnly: false, session: true }); },
    async remove(url, name) { calls.push(['remove', url, name]); }
  };
  const docsOnly = capabilitiesOf({ manifest_version: 3, version: '1', permissions: ['cookies'], host_permissions: ['https://docs.example/*'] });
  const noCookies = capabilitiesOf({ manifest_version: 3, version: '1', permissions: [], host_permissions: ['<all_urls>'] });
  assert.equal((await getCookie(cookies, docsOnly, { url: 'https://docs.example/a', name: 'sid' })).value, '1');
  await assert.rejects(getCookie(cookies, docsOnly, { url: 'https://bank.example/', name: 'sid' }), /No host permissions/);
  await assert.rejects(getCookie(cookies, noCookies, { url: 'https://docs.example/', name: 'sid' }), /cookies permission/);
  await assert.rejects(getCookie(cookies, docsOnly, { url: 'file:///C:/x', name: 'a' }), /Invalid url/);
  const all = await getAllCookies(cookies, docsOnly, {});
  assert.deepEqual(all.map(c => c.domain), ['docs.example'], 'getAll filters out cookies the extension may not access');
  assert.equal(all[0].storeId, '0');
  await assert.rejects(setCookie(cookies, docsOnly, { url: 'https://docs.example/', name: 'x', value: 'y', domain: '.example' }), /No host permissions for cookies at domain/);
  assert.equal((await setCookie(cookies, docsOnly, { url: 'https://docs.example/', name: 'new', value: 'y', sameSite: 'bogus' })).name, 'new');
  assert.equal(calls.find(c => c[0] === 'set')[1].sameSite, undefined, 'invalid sameSite dropped');
  assert.deepEqual(await removeCookie(cookies, docsOnly, { url: 'https://docs.example/', name: 'new' }), { url: 'https://docs.example/', name: 'new', storeId: '0' });
  assert.equal(canAccessCookie(docsOnly, { domain: '.docs.example', path: '/', secure: true }), true);
  assert.equal(canAccessCookie(docsOnly, { domain: 'bank.example', path: '/', secure: true }), false);
  console.log('PASS: cookies need the permission and host access (get/getAll/set/remove, domain widening refused)');
})().catch(error => { console.error(error); process.exit(1); });
