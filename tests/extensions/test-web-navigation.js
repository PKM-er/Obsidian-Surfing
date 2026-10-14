'use strict';
// chrome.webNavigation in Electron: events are filled for extensions that
// declared the permission and delivered from the host through the bridge.
const assert = require('node:assert/strict');
const { makeHub, hostEndpoint, evaluate, tick, plain } = require('./helpers/compat-env');

const EVENTS = ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onErrorOccurred',
  'onCreatedNavigationTarget', 'onReferenceFragmentUpdated', 'onHistoryStateUpdated', 'onTabReplaced'];

(async () => {
  // Registration API, permission gating and native preservation.
  const allowed = evaluate({ permissions: ['webNavigation'] });
  assert(allowed.info.installed.includes('webNavigation.events'));
  for (const name of EVENTS) {
    const nav = allowed.chrome.webNavigation;
    const listener = () => {};
    nav[name].addListener(listener, { url: [{ hostEquals: 'example.com' }] });
    assert(nav[name].hasListener(listener));
    assert(nav[name].hasListeners());
    nav[name].removeListener(listener);
    assert(!nav[name].hasListener(listener));
  }
  assert.match(allowed.info.modes.webNavigation, /registration-only/, 'no channel: disclosed as not delivered');
  const forbidden = evaluate({ permissions: [] });
  assert.equal(forbidden.chrome.webNavigation, undefined, 'do not grant undeclared API');
  const nativeCommitted = { addListener() {}, removeListener() {}, hasListener() { return false; } };
  const nativeApi = { onCommitted: nativeCommitted };
  const withNative = evaluate({ permissions: ['webNavigation'], extra: { webNavigation: nativeApi } });
  assert.equal(withNative.chrome.webNavigation, nativeApi);
  assert.equal(withNative.chrome.webNavigation.onCommitted, nativeCommitted, 'do not replace native event');

  // Delivery from the host, URL filters, and listener announcements.
  const hub = makeHub();
  const host = hostEndpoint(hub);
  const { chrome, info } = evaluate({ permissions: ['webNavigation', 'tabs'], hub });
  assert.match(info.modes.webNavigation, /delivered/);
  const seen = [];
  chrome.webNavigation.onCommitted.addListener(d => seen.push(['all', d.url]));
  chrome.webNavigation.onCommitted.addListener(d => seen.push(['filtered', d.url]), { url: [{ hostSuffix: 'example.com' }] });
  await tick();
  assert.deepEqual(host.last('webNavigation.listeners').events, ['onCommitted'], 'worker announces its listeners');
  host.send({ type: 'webNavigation.event', event: 'onCommitted', details: { tabId: 7, frameId: 0, url: 'https://www.example.com/x' } });
  host.send({ type: 'webNavigation.event', event: 'onCommitted', details: { tabId: 7, frameId: 0, url: 'https://other.org/' } });
  host.send({ type: 'webNavigation.event', event: 'bogus', details: {} });
  await tick();
  assert.deepEqual(seen, [['all', 'https://www.example.com/x'], ['filtered', 'https://www.example.com/x'], ['all', 'https://other.org/']]);
  // A reconnecting host asks for the listener set again.
  const before = host.received.length;
  host.send({ type: 'bridge.sync' });
  await tick();
  assert(host.received.slice(before).some(m => m.type === 'webNavigation.listeners'));

  // getAllFrames: answered by the host; null for unknown tabs; fallback when silent.
  host.handle('webNavigation.getAllFrames', ({ tabId }) => tabId === 7
    ? [{ frameId: 0, parentFrameId: -1, processId: 4, url: 'https://example.com/a', errorOccurred: false, frameType: 'outermost_frame', documentLifecycle: 'active' },
       { frameId: 12, parentFrameId: 0, processId: 4, url: 'https://ads.example/', errorOccurred: false, frameType: 'sub_frame', documentLifecycle: 'active' }]
    : null);
  const frames = await chrome.webNavigation.getAllFrames({ tabId: 7 });
  assert.deepEqual(plain(frames).map(f => f.frameId), [0, 12]);
  assert.equal((await chrome.webNavigation.getFrame({ tabId: 7, frameId: 12 })).url, 'https://ads.example/');
  assert.equal(await chrome.webNavigation.getAllFrames({ tabId: 99 }), null);
  const lonely = evaluate({ permissions: ['webNavigation'] });
  assert.deepEqual(plain(await lonely.chrome.webNavigation.getAllFrames({ tabId: 7 })).map(f => f.frameId), [0], 'no host: main frame from tabs.get');

  console.log('PASS: webNavigation registration, host delivery, URL filters, listener announcements, getAllFrames');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
