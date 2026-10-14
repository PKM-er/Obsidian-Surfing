'use strict';
// Host-side permission checks: what an extension may receive over its channel
// and which of its declarativeNetRequest rules may act on a navigation.
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts');
const {
  capabilitiesOf, canSeeTab, hasHostAccess, netRuleAllowed, redirectTargetAllowed, supportedRegexFilter, sanitizeNetRules
} = loadTs('src/host/grants.ts');
const { evaluate } = loadTs('src/shared/net-request.ts');

const EXT = 'dhdgffkkebhmkfjojejmpbldmpobfkfo';

// Manifest parsing: MV3 host_permissions, MV2 host patterns among permissions.
const tm = capabilitiesOf({ manifest_version: 3, version: '1', permissions: ['tabs', 'declarativeNetRequestWithHostAccess', 'chrome://favicon/'], host_permissions: ['<all_urls>'] });
assert.equal(tm.tabs, true);
assert.equal(tm.netRequest, false);
assert.equal(tm.netRequestWithHostAccess, true);
assert.deepEqual(tm.hosts, ['chrome://favicon/', '<all_urls>']);
const mv2 = capabilitiesOf({ manifest_version: 2, version: '1', permissions: ['contextMenus', '*://*.example.com/*'] });
assert.equal(mv2.contextMenus, true);
assert.deepEqual(mv2.hosts, ['*://*.example.com/*']);
const none = capabilitiesOf(null);
assert.equal(none.webNavigation || none.contextMenus || none.tabs || none.netRequest, false);
console.log('PASS: capabilities come from the approved manifest');

// Tab details: "tabs", or host access to that tab's URL.
assert.equal(canSeeTab(tm, 'https://bank.example/'), true);
assert.equal(canSeeTab(mv2, 'https://www.example.com/a'), true);
assert.equal(canSeeTab(mv2, 'https://bank.example/'), false);
assert.equal(canSeeTab(none, 'https://bank.example/'), false);
assert.equal(hasHostAccess(mv2, undefined), false);
console.log('PASS: tab url/title only with "tabs" or matching host access');

// declarativeNetRequest host access (Chrome's rules).
const blockRule = { id: 1, action: { type: 'block' }, condition: { resourceTypes: ['main_frame'] } };
const redirectRule = { id: 2, action: { type: 'redirect', redirect: { url: 'https://safe.example/' } }, condition: { resourceTypes: ['main_frame'] } };
const dnr = capabilitiesOf({ manifest_version: 3, version: '1', permissions: ['declarativeNetRequest'] });
const dnrHosts = capabilitiesOf({ manifest_version: 3, version: '1', permissions: ['declarativeNetRequest'], host_permissions: ['https://only.example/*'] });
const withHost = capabilitiesOf({ manifest_version: 3, version: '1', permissions: ['declarativeNetRequestWithHostAccess'], host_permissions: ['https://only.example/*'] });
assert.equal(netRuleAllowed(dnr, blockRule, 'https://any.example/'), true, 'block needs no host access');
assert.equal(netRuleAllowed(dnr, redirectRule, 'https://any.example/'), false, 'redirect needs host access');
assert.equal(netRuleAllowed(dnrHosts, redirectRule, 'https://only.example/x'), true);
assert.equal(netRuleAllowed(withHost, blockRule, 'https://any.example/'), false, 'WithHostAccess: every action needs host access');
assert.equal(netRuleAllowed(withHost, blockRule, 'https://only.example/x'), true);
assert.equal(netRuleAllowed(none, blockRule, 'https://any.example/'), false, 'no DNR permission: nothing applies');
// A disallowed higher-priority rule must not hide an allowed lower one.
const high = { ...redirectRule, priority: 9 };
assert.equal(evaluate([high, blockRule], { url: 'https://any.example/', tabId: 1 }, EXT, r => netRuleAllowed(dnr, r, 'https://any.example/')).kind, 'block');
console.log('PASS: declarativeNetRequest actions follow Chrome host-permission rules');

assert.equal(redirectTargetAllowed('https://www.tampermonkey.net/script_installation.php#url=x', EXT), true);
assert.equal(redirectTargetAllowed(`chrome-extension://${EXT}/ask.html`, EXT), true);
assert.equal(redirectTargetAllowed('chrome-extension://eimadpbcbfnmbkopoojfekhnkhdbieeh/ui/popup/index.html', EXT), false, 'another extension');
for (const target of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,<h1>login</h1>', 'app://obsidian.md/index.html', 'not a url']) {
  assert.equal(redirectTargetAllowed(target, EXT), false, target);
}
console.log('PASS: redirects only to web pages and the extension\'s own pages');

// Regex filters: RE2 syntax only (as Chrome); anything RE2 accepts is matched in linear time.
for (const ok of [String.raw`^(?:https?|ftp)://[^\#\?]+/[^\#\?]+\.(?:user|tamper)\.js[^/]*$`, String.raw`^https?://openuserjs\.org/install/([^/]+)+/(.+?)(?:\.min)?\.user\.js(?:$|\?|\#)`, '(a+)+$', '[(+)]+']) {
  assert.equal(supportedRegexFilter(ok), true, ok);
}
for (const bad of [String.raw`(a)\1`, '(?=a)b', '(?<!a)b', 'a{1001}', 'a**', '(', 'a'.repeat(3000)]) {
  assert.equal(supportedRegexFilter(bad), false, bad);
}
const rules = sanitizeNetRules([
  blockRule, { id: 3, action: { type: 'block' }, condition: { regexFilter: '(?=x)', resourceTypes: ['main_frame'] } },
  { id: 'x', action: { type: 'block' }, condition: {} }, null, redirectRule
], 2);
assert.deepEqual(rules.map(r => r.id), [1, 2], 'RE2-incompatible/malformed rules dropped, limit applied');
// Tampermonkey's real openuserjs rule is exponential for JavaScript's RegExp on this URL.
const evil = { id: 9, priority: 1, action: { type: 'block' }, condition: { resourceTypes: ['main_frame'], regexFilter: String.raw`^https?://openuserjs\.org/install/([^/]+)+/(.+?)(?:\.min)?\.user\.js(?:$|\?|\#)` } };
const started = Date.now();
assert.equal(evaluate([evil], { url: 'https://openuserjs.org/install/' + 'a'.repeat(5000), tabId: 1 }, EXT), null);
assert(Date.now() - started < 1000, 'linear time: ' + (Date.now() - started) + 'ms');
assert.equal(evaluate([evil], { url: 'https://openuserjs.org/install/me/My_Script.user.js', tabId: 1 }, EXT).kind, 'block');
console.log('PASS: regexFilter uses RE2 syntax and runs in linear time');

// Match-pattern paths use a linear wildcard matcher, not a backtracking RegExp.
const { matchPattern, wildcardMatch } = loadTs('src/shared/url-match.ts');
assert.equal(wildcardMatch('/a*b*c', '/axxbyyc'), true);
assert.equal(wildcardMatch('/a*b*c', '/axxbyyd'), false);
assert.equal(wildcardMatch('*', ''), true);
assert.equal(wildcardMatch('/x.y', '/xzy'), false, 'dots are literal');
assert.equal(matchPattern('*://*.example.com/docs/*', 'https://a.example.com/docs/x?y'), true);
assert.equal(matchPattern('*://*.example.com/docs/*', 'https://a.example.com/doc'), false);
const wildcardStarted = Date.now();
assert.equal(matchPattern('*://*/' + '*a'.repeat(30) + 'b', 'https://h/' + 'a'.repeat(20000)), false);
assert(Date.now() - wildcardStarted < 2000, 'wildcards: ' + (Date.now() - wildcardStarted) + 'ms');
console.log('PASS: match patterns are matched without backtracking');
