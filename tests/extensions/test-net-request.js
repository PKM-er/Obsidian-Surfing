'use strict';
// chrome.declarativeNetRequest: the extension API (rules kept, persisted,
// announced) and the host's evaluation of top-level navigations.
const assert = require('node:assert/strict');
const { makeHub, hostEndpoint, evaluate: compat, makeLocalStorage, tick, plain, EXT_ID } = require('./helpers/compat-env');
const { loadTs } = require('./helpers/load-ts');
const { evaluate, ruleMatches, urlFilterRegex, appliesToMainFrame } = loadTs('src/shared/net-request.ts');

// Tampermonkey 5.5's real .user.js rule.
const TM_RULE = {
  id: 7, priority: 3,
  condition: {
    excludedRequestDomains: ['tampermonkey.net', 'userscripts.org', 'userscripts-mirror.org'],
    requestMethods: ['get'],
    regexFilter: '^(?:https?|ftp)://[^\\#\\?]+/[^\\#\\?]+\\.(?:user|tamper)\\.js[^/]*$',
    resourceTypes: ['main_frame']
  },
  action: { type: 'redirect', redirect: { regexSubstitution: 'https://www.tampermonkey.net/script_installation.php#url=\\0' } }
};
const nav = url => ({ url, tabId: 70, method: 'get' });

(async () => {
  // ---- Evaluation --------------------------------------------------------
  const script = 'https://update.greasyfork.org/scripts/3374/script.user.js';
  assert.deepEqual(plain(evaluate([TM_RULE], nav(script), EXT_ID)),
    { kind: 'redirect', rule: TM_RULE, url: 'https://www.tampermonkey.net/script_installation.php#url=' + script });
  assert.equal(evaluate([TM_RULE], nav('https://www.tampermonkey.net/x.user.js'), EXT_ID), null, 'excludedRequestDomains');
  assert.equal(evaluate([TM_RULE], nav('https://example.com/app.js'), EXT_ID), null);

  // urlFilter syntax.
  assert(urlFilterRegex('||ads.example^').test('https://cdn.ads.example/x'));
  assert(!urlFilterRegex('||ads.example^').test('https://notads.example/x'));
  assert(urlFilterRegex('|https://a.com/*.pdf|').test('https://a.com/docs/x.pdf'));
  assert(!urlFilterRegex('|https://a.com/*.pdf|').test('https://a.com/docs/x.pdf?y'));
  assert(urlFilterRegex('PATH').test('https://a.com/path'), 'case-insensitive by default');
  assert(!urlFilterRegex('PATH', true).test('https://a.com/path'));

  // Chrome's default resource types exclude main_frame.
  assert.equal(appliesToMainFrame({ id: 1, condition: { urlFilter: 'x' }, action: { type: 'block' } }), false);
  assert.equal(appliesToMainFrame({ id: 1, condition: { excludedResourceTypes: ['image'] }, action: { type: 'block' } }), true);

  const rules = [
    { id: 1, priority: 1, condition: { urlFilter: '||news.example', resourceTypes: ['main_frame'] }, action: { type: 'block' } },
    { id: 2, priority: 2, condition: { urlFilter: '||news.example/ok', resourceTypes: ['main_frame'] }, action: { type: 'allow' } },
    { id: 3, priority: 1, condition: { requestDomains: ['plain.example'], resourceTypes: ['main_frame'] }, action: { type: 'upgradeScheme' } },
    { id: 4, priority: 1, condition: { urlFilter: 'utm_', resourceTypes: ['main_frame'] },
      action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: ['utm_source'] } } } } },
    { id: 5, priority: 1, condition: { urlFilter: '/landing', resourceTypes: ['main_frame'], tabIds: [99] }, action: { type: 'block' } },
    { id: 6, priority: 1, condition: { urlFilter: '/third', resourceTypes: ['main_frame'], domainType: 'thirdParty' }, action: { type: 'block' } },
    { id: 8, priority: 1, condition: { urlFilter: '/ext', resourceTypes: ['main_frame'] }, action: { type: 'redirect', redirect: { extensionPath: '/page.html' } } }
  ];
  assert.equal(evaluate(rules, nav('https://news.example/a'), EXT_ID).kind, 'block');
  assert.equal(evaluate(rules, nav('https://news.example/ok/1'), EXT_ID).kind, 'allow', 'higher priority allow wins');
  assert.equal(evaluate(rules, nav('http://sub.plain.example/x'), EXT_ID).url, 'https://sub.plain.example/x');
  assert.equal(evaluate(rules, nav('https://plain.example/x'), EXT_ID), null, 'upgradeScheme only for http');
  assert.equal(evaluate(rules, nav('https://shop.example/p?utm_source=a&id=3'), EXT_ID).url, 'https://shop.example/p?id=3');
  assert.equal(evaluate(rules, nav('https://x.example/landing'), EXT_ID), null, 'tabIds');
  assert.equal(evaluate(rules, nav('https://x.example/third'), EXT_ID), null, 'top-level navigations are first-party');
  assert.equal(evaluate(rules, nav('https://x.example/ext'), EXT_ID).url, `chrome-extension://${EXT_ID}/page.html`);
  const tie = [
    { id: 1, priority: 5, condition: { urlFilter: 'tie', resourceTypes: ['main_frame'] }, action: { type: 'redirect', redirect: { url: 'https://r/' } } },
    { id: 2, priority: 5, condition: { urlFilter: 'tie', resourceTypes: ['main_frame'] }, action: { type: 'block' } }
  ];
  assert.equal(evaluate(tie, nav('https://tie/'), EXT_ID).kind, 'block', 'block beats redirect at equal priority');
  assert(!ruleMatches({ id: 1, condition: { urlFilter: 'x', resourceTypes: ['main_frame'], requestMethods: ['post'] }, action: { type: 'block' } }, nav('https://x/')));

  // ---- Extension API -----------------------------------------------------
  const hub = makeHub();
  const host = hostEndpoint(hub);
  const storage = makeLocalStorage();
  const permissions = ['declarativeNetRequest', 'storage'];
  const manifestExtra = { declarative_net_request: { rule_resources: [{ id: 'base', path: 'rules/base.json', enabled: true }, { id: 'extra', path: 'rules/extra.json', enabled: false }] } };
  const staticRules = {
    'rules/base.json': [
      { id: 1, condition: { urlFilter: '||tracker.example', resourceTypes: ['main_frame'] }, action: { type: 'block' } },
      { id: 2, condition: { urlFilter: '||tracker.example', resourceTypes: ['image'] }, action: { type: 'block' } }
    ],
    'rules/extra.json': [{ id: 1, condition: { urlFilter: 'extra', resourceTypes: ['main_frame'] }, action: { type: 'block' } }]
  };
  const fetch = async url => ({ json: async () => staticRules[url.replace(`chrome-extension://${EXT_ID}/`, '')] });
  const make = (bootId = 'boot-1') => compat({ permissions, hub, storage, manifestExtra, bootId, page: { fetch } });
  const { chrome, info } = make();
  assert(info.installed.includes('declarativeNetRequest'));
  const dnr = chrome.declarativeNetRequest;
  await dnr.updateSessionRules({ addRules: [TM_RULE] });
  await dnr.updateDynamicRules({ addRules: [{ id: 3, condition: { urlFilter: 'x', resourceTypes: ['image'] }, action: { type: 'block' } }] });
  await assert.rejects(dnr.updateSessionRules({ addRules: [{ ...TM_RULE }] }), /unique ID/);
  await assert.rejects(dnr.updateDynamicRules({ addRules: [{ id: 0, condition: {}, action: { type: 'block' } }] }), /valid ID/);
  await assert.rejects(dnr.updateDynamicRules({ addRules: [{ id: 9, condition: { regexFilter: '(' }, action: { type: 'block' } }] }), /non-supported/);
  await assert.rejects(dnr.updateDynamicRules({ addRules: [{ id: 9, condition: { regexFilter: '(?=a)b' }, action: { type: 'block' } }] }), /non-supported/, 'lookaround: RE2 rejects it');
  assert.deepEqual(plain(await dnr.getSessionRules()).map(r => r.id), [7]);
  assert.deepEqual(plain(await dnr.getDynamicRules({ ruleIds: [3] })).map(r => r.id), [3]);
  assert.deepEqual(plain(await dnr.getEnabledRulesets()), ['base']);
  assert.deepEqual(plain(await dnr.isRegexSupported({ regex: '[a-z]+' })), { isSupported: true });
  assert.equal(dnr.SESSION_RULESET_ID, '_session');
  await tick();
  // Only rules that can match a navigation reach the host.
  assert.deepEqual(host.last('netRequest.rules').rules.map(r => r.id).sort(), [1, 7]);
  await dnr.updateEnabledRulesets({ enableRulesetIds: ['extra'], disableRulesetIds: ['base'] });
  await tick();
  assert.deepEqual(host.last('netRequest.rules').rules.map(r => r.id), [7, 1]);
  await assert.rejects(dnr.updateEnabledRulesets({ enableRulesetIds: ['nope'] }), /Invalid ruleset/);

  // A restarted worker keeps dynamic + session rules; an Obsidian restart drops session rules.
  const sameBoot = make('boot-1');
  assert.deepEqual(plain(await sameBoot.chrome.declarativeNetRequest.getSessionRules()).map(r => r.id), [7]);
  assert.deepEqual(plain(await sameBoot.chrome.declarativeNetRequest.getEnabledRulesets()), ['extra']);
  const nextBoot = make('boot-2');
  assert.deepEqual(plain(await nextBoot.chrome.declarativeNetRequest.getSessionRules()), []);
  assert.deepEqual(plain(await nextBoot.chrome.declarativeNetRequest.getDynamicRules()).map(r => r.id), [3]);
  await dnr.updateSessionRules({ removeRuleIds: [7] });
  assert.deepEqual(plain(await dnr.getSessionRules()), []);

  assert.equal(compat({ permissions: ['storage'] }).chrome.declarativeNetRequest, undefined, 'permission required');

  // Electron 43: a native API that stores rules but never applies them.
  // It stays the source of truth; Obsidian is told the rules and enforces them.
  const nativeStore = { session: [] };
  // Each extension context has its own native object over shared browser state.
  const makeNative = () => ({
    updateSessionRules(options, callback) {
      nativeStore.session = nativeStore.session.filter(r => !(options.removeRuleIds || []).includes(r.id)).concat(options.addRules || []);
      if (callback) setTimeout(callback, 0); else return Promise.resolve();
    },
    getSessionRules: async () => nativeStore.session.slice(),
    getDynamicRules: async () => [],
    getEnabledRulesets: async () => []
  });
  const native = makeNative();
  const hub2 = makeHub();
  const host2 = hostEndpoint(hub2);
  const observed = compat({ permissions: ['declarativeNetRequestWithHostAccess', 'storage'], hub: hub2, extra: { declarativeNetRequest: native } });
  assert(observed.info.installed.includes('declarativeNetRequest.enforced-by-obsidian'));
  assert.equal(observed.chrome.declarativeNetRequest, native, 'native namespace kept');
  await new Promise(resolve => observed.chrome.declarativeNetRequest.updateSessionRules({ addRules: [TM_RULE] }, resolve));
  await tick();
  assert.deepEqual(nativeStore.session.map(r => r.id), [7], 'native call went through');
  assert.deepEqual(host2.last('netRequest.rules').rules.map(r => r.id), [7], 'host learns the native rules');
  // The bridge page reports a snapshot when it loads (rules set before Obsidian connected).
  const before = host2.received.length;
  compat({ permissions: ['declarativeNetRequestWithHostAccess'], hub: hub2, worker: false, extra: { declarativeNetRequest: makeNative() },
    page: { location: { href: `chrome-extension://${EXT_ID}/__obsidian_bridge_host.html`, pathname: '/__obsidian_bridge_host.html' }, document: { addEventListener() {} } } });
  await tick();
  assert(host2.received.slice(before).some(m => m.type === 'netRequest.rules' && m.rules.length === 1));
  console.log('PASS: declarativeNetRequest rules API, persistence, static rulesets, host evaluation (Tampermonkey .user.js redirect)');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
