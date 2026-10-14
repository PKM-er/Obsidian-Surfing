'use strict';
// chrome.contextMenus end to end: items live in the extension (persisted),
// are announced to the host, rendered into Obsidian's Web Viewer menu, and
// clicks come back to onClicked with the real tab.
const assert = require('node:assert/strict');
const { makeHub, hostEndpoint, evaluate, makeLocalStorage, tick, plain } = require('./helpers/compat-env');
const { loadTs } = require('./helpers/load-ts');

const { contextsFor, visibleTree, menuTitle, electronTemplate, clickInfo } = loadTs('src/host/context-menu.ts');

(async () => {
  // ---- Extension side ----------------------------------------------------
  const hub = makeHub();
  const host = hostEndpoint(hub);
  const storage = makeLocalStorage();
  const permissions = ['contextMenus', 'storage', 'tabs'];
  const { chrome, info } = evaluate({ permissions, hub, storage });
  assert(info.installed.includes('contextMenus'));
  assert.match(info.modes.contextMenus, /Web Viewer context menu/);

  await chrome.contextMenus.removeAll();
  const created = [];
  assert.equal(chrome.contextMenus.create({ id: 'translate', title: 'Translate "%s"', contexts: ['selection'] }, () => created.push('translate')), 'translate');
  chrome.contextMenus.create({ id: 'parent', title: 'Read Frog', contexts: ['page', 'link'] });
  chrome.contextMenus.create({ id: 'child-a', parentId: 'parent', title: 'Child A', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'auto', type: 'checkbox', title: 'Auto', checked: false, contexts: ['page'] });
  chrome.contextMenus.create({ id: 'r1', type: 'radio', title: 'One', checked: true, contexts: ['page'] });
  chrome.contextMenus.create({ id: 'r2', type: 'radio', title: 'Two', checked: false, contexts: ['page'] });
  const legacy = [];
  chrome.contextMenus.create({ id: 'legacy', title: 'Legacy', onclick: data => legacy.push(data.menuItemId) });
  const generated = chrome.contextMenus.create({ title: 'No id' });
  assert.equal(typeof generated, 'number');
  await tick();
  assert.deepEqual(created, ['translate'], 'create callback runs');
  const announced = host.last('contextMenus.items').items;
  assert.deepEqual(announced.map(i => i.id), ['translate', 'parent', 'child-a', 'auto', 'r1', 'r2', 'legacy', generated]);
  assert(announced.every(i => !('onclick' in i)), 'functions never leave the extension');
  assert.equal(storage.data.get('__obsidian_bridge_context_menus_v1__').length, 8, 'persisted like Chrome');

  // Duplicate ids fail without replacing; unknown ids reject.
  chrome.contextMenus.create({ id: 'translate', title: 'Dup' });
  await assert.rejects(chrome.contextMenus.update('missing', { title: 'x' }), /Cannot find menu item/);
  await chrome.contextMenus.update('translate', { title: 'Translate selection' });
  await tick();
  assert.equal(host.last('contextMenus.items').items.find(i => i.id === 'translate').title, 'Translate selection');

  // Clicks from the host reach onClicked with the real tab; state toggles.
  const clicks = [];
  chrome.contextMenus.onClicked.addListener((data, tab) => clicks.push([data.menuItemId, data.checked, tab?.id]));
  host.send({ type: 'contextMenus.clicked', tabId: 7, info: { menuItemId: 'translate', selectionText: 'hello', editable: false, pageUrl: 'https://example.com/a' } });
  host.send({ type: 'contextMenus.clicked', tabId: 7, info: { menuItemId: 'auto', editable: false, wasChecked: false, checked: true } });
  host.send({ type: 'contextMenus.clicked', tabId: 7, info: { menuItemId: 'r2', editable: false, wasChecked: false, checked: true } });
  host.send({ type: 'contextMenus.clicked', tabId: null, info: { menuItemId: 'legacy', editable: false } });
  await tick(200);
  assert.deepEqual(clicks, [['translate', undefined, 7], ['auto', true, 7], ['r2', true, 7], ['legacy', undefined, undefined]]);
  assert.deepEqual(legacy, ['legacy'], 'MV2 onclick property is honored');
  const state = Object.fromEntries(host.last('contextMenus.items').items.map(i => [i.id, i.checked]));
  assert.equal(state.auto, true);
  assert.deepEqual([state.r1, state.r2], [false, true], 'radio group is exclusive');

  // A restarted worker restores items, so update() of an old item works.
  const restarted = evaluate({ permissions, hub, storage });
  await restarted.chrome.contextMenus.update('parent', { title: 'Read Frog 2' });
  await tick();
  assert.equal(host.last('contextMenus.items').items.find(i => i.id === 'parent').title, 'Read Frog 2');
  await restarted.chrome.contextMenus.remove('parent');
  await tick();
  assert(!host.last('contextMenus.items').items.some(i => i.id === 'child-a'), 'children removed with parent');

  // Without the permission nothing is granted.
  assert.equal(evaluate({ permissions: [] }).chrome.contextMenus, undefined);

  // ---- Host side rendering ------------------------------------------------
  assert.deepEqual([...contextsFor({ pageURL: 'https://a/' })].sort(), ['all', 'page']);
  assert.deepEqual([...contextsFor({ pageURL: 'https://a/', selectionText: 'x', linkURL: 'https://b/' })].sort(), ['all', 'link', 'selection']);
  assert.deepEqual([...contextsFor({ pageURL: 'https://a/', mediaType: 'image', srcURL: 'https://a/i.png' })].sort(), ['all', 'image']);
  assert(contextsFor({ pageURL: 'https://a/', frameURL: 'https://f/' }).has('page'), 'frame without other context is also page');

  const items = [
    { id: 't', title: 'Translate "%s"', contexts: ['selection'] },
    { id: 'p', title: 'Parent & Co', contexts: ['page'] },
    { id: 'c', parentId: 'p', title: 'Child', contexts: ['page'] },
    { id: 'hidden', title: 'Hidden', visible: false },
    { id: 'img', title: 'Image only', contexts: ['image'], targetUrlPatterns: ['*://*.example.com/*'] },
    { id: 'doc', title: 'Docs only', contexts: ['all'], documentUrlPatterns: ['https://docs.example.com/*'] },
    { id: 'act', title: 'Action item', contexts: ['action'] },
    { id: 'cb', type: 'checkbox', title: 'Check', checked: true, contexts: ['page'] }
  ];
  const ids = params => {
    const out = [];
    const walk = nodes => nodes.forEach(n => { out.push(n.item.id); walk(n.children); });
    walk(visibleTree(items, params));
    return out;
  };
  assert.deepEqual(ids({ pageURL: 'https://a.com/' }), ['p', 'c', 'cb']);
  assert.deepEqual(ids({ pageURL: 'https://docs.example.com/x', selectionText: 'hi' }), ['t', 'doc']);
  assert.deepEqual(ids({ pageURL: 'https://a.com/', mediaType: 'image', srcURL: 'https://cdn.example.com/x.png' }), ['img']);
  assert.deepEqual(ids({ pageURL: 'https://a.com/', mediaType: 'image', srcURL: 'https://other.org/x.png' }), [], 'targetUrlPatterns');
  assert.deepEqual(visibleTree(items, { pageURL: 'https://a.com/' }, true).map(n => n.item.id), ['act'], 'action menu items');
  assert.equal(menuTitle(items[0], { selectionText: '  a   long\nselection that is definitely longer than the limit ' }), 'Translate "a long selection that is definit…"');

  const sent = [];
  const sources = [
    { extensionId: 'x'.repeat(32), extensionName: 'Single', items: [{ id: 'only', title: 'Only item', contexts: ['page'] }], click: i => sent.push(i) },
    { extensionId: 'y'.repeat(32), extensionName: 'Many & More', items, click: i => sent.push(i) }
  ];
  const template = electronTemplate(sources, { pageURL: 'https://a.com/', isEditable: false });
  assert.equal(template[0].label, 'Only item', 'one top-level item shows directly');
  assert.equal(template[1].label, 'Many && More', 'several are grouped under the extension; & escaped');
  assert.deepEqual(template[1].submenu.map(i => i.label), ['Parent && Co', 'Check']);
  assert.equal(template[1].submenu[0].submenu[0].label, 'Child');
  assert.equal(template[1].submenu[1].type, 'checkbox');
  template[1].submenu[1].click();
  assert.deepEqual(plain(sent.at(-1)), { menuItemId: 'cb', editable: false, pageUrl: 'https://a.com/', frameId: 0, wasChecked: true, checked: false });
  assert.deepEqual(plain(clickInfo({ id: 'l' }, { pageURL: 'https://a/', linkURL: 'https://b/', selectionText: 's', isEditable: true })),
    { menuItemId: 'l', editable: true, linkUrl: 'https://b/', pageUrl: 'https://a/', frameId: 0, selectionText: 's' });
  assert.deepEqual(electronTemplate(sources, { pageURL: 'https://a.com/', mediaType: 'video', srcURL: 'https://x/' }), []);

  console.log('PASS: contextMenus items, persistence, host announcements, clicks with tab and state, Web Viewer menu rendering');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
