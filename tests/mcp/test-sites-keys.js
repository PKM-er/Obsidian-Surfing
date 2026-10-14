'use strict';
// Site patterns, access decisions, permissions flow, and key parsing.
const assert = require('node:assert/strict');
const sites = require('../../build/mcp/sites');
const { SitePermissions } = require('../../build/mcp/permissions');
const { parseKeys, parseKeyPress } = require('../../build/mcp/keys');

// hostOf / toWebUrl
assert.equal(sites.hostOf('https://Example.COM:8080/a?b#c'), 'example.com');
assert.equal(sites.hostOf('https://example.com./'), 'example.com');
assert.equal(sites.hostOf('about:blank'), '');
assert.equal(sites.hostOf('file:///etc/passwd'), '');
assert.equal(sites.hostOf('chrome-extension://abc/popup.html'), '');
assert.equal(sites.hostOf('not a url'), '');
assert.equal(sites.toWebUrl('example.com'), 'https://example.com/');
assert.equal(sites.toWebUrl('http://example.com/x'), 'http://example.com/x');
assert.equal(sites.toWebUrl('localhost:3000/app'), 'https://localhost:3000/app');
for (const bad of ['javascript:alert(1)', 'file:///c:/x', 'data:text/html,hi', 'obsidian://open', 'chrome://settings', '', '  ']) {
  assert.equal(sites.toWebUrl(bad), null, bad);
}

// Patterns
assert.equal(sites.normalizePattern(' https://Foo.com/path '), 'foo.com');
assert.equal(sites.normalizePattern('*.Foo.com'), '*.foo.com');
assert.equal(sites.normalizePattern('foo.com:8080/x'), 'foo.com');
assert.equal(sites.hostMatches('foo.com', 'foo.com'), true);
assert.equal(sites.hostMatches('a.foo.com', 'foo.com'), false, 'plain patterns match one host');
assert.equal(sites.hostMatches('a.foo.com', '*.foo.com'), true);
assert.equal(sites.hostMatches('foo.com', '*.foo.com'), true);
assert.equal(sites.hostMatches('evilfoo.com', '*.foo.com'), false);
assert.equal(sites.hostMatches('foo.com.evil.com', 'foo.com'), false);
assert.equal(sites.hostMatches('', ''), false);
assert.equal(sites.isBlockedHost('a.foo.com', ['foo.com']), true, 'a blocked host also blocks its subdomains');
assert.equal(sites.isBlockedHost('foo.com', ['*.foo.com']), true);
assert.equal(sites.isBlockedHost('barfoo.com', ['foo.com']), false);
assert.equal(sites.isBlockedHost('foo.com', ['', '  ']), false, 'empty entries block nothing');

// Decisions
const rules = (over = {}) => ({ siteAccess: 'ask', approvedSites: [], blockedSites: [], ...over });
const session = (approved = [], revoked = []) => ({ approved: new Set(approved), revoked: new Set(revoked) });
assert.equal(sites.decideAccess('', rules(), session()), 'allowed', 'a blank tab needs no approval');
assert.equal(sites.decideAccess('a.com', rules(), session()), 'ask');
assert.equal(sites.decideAccess('a.com', rules({ siteAccess: 'allow' }), session()), 'allowed');
assert.equal(sites.decideAccess('a.com', rules({ approvedSites: ['a.com'] }), session()), 'allowed');
assert.equal(sites.decideAccess('b.a.com', rules({ approvedSites: ['a.com'] }), session()), 'ask');
assert.equal(sites.decideAccess('a.com', rules(), session(['a.com'])), 'allowed');
assert.equal(sites.decideAccess('a.com', rules({ siteAccess: 'allow', blockedSites: ['a.com'] }), session()), 'blocked', 'blocked beats allow');
assert.equal(sites.decideAccess('a.com', rules({ approvedSites: ['a.com'], blockedSites: ['a.com'] }), session(['a.com'])), 'blocked');
assert.equal(sites.decideAccess('a.com', rules({ siteAccess: 'allow' }), session([], ['a.com'])), 'ask', 'a revoked host asks again');

// Permissions flow
async function flow() {
  let current = rules();
  const approvedForever = [];
  const questions = [];
  let nextAnswer = () => Promise.resolve('once');
  const perms = new SitePermissions({
    getRules: () => current,
    approveForever: (host) => approvedForever.push(host),
    ask: (host, client, signal) => {
      questions.push({ host, client });
      const answer = nextAnswer(host, signal);
      return answer;
    },
  }, 80);

  assert.deepEqual(await perms.ensure('', 'c'), { ok: true });
  assert.deepEqual(await perms.ensure('a.com', 'Claude'), { ok: true });
  assert.deepEqual(questions, [{ host: 'a.com', client: 'Claude' }]);
  assert.deepEqual(await perms.ensure('a.com', 'Claude'), { ok: true });
  assert.equal(questions.length, 1, 'allow-once lasts for the session');

  nextAnswer = () => Promise.resolve('always');
  assert.equal((await perms.ensure('b.com', 'c')).ok, true);
  assert.deepEqual(approvedForever, ['b.com']);

  nextAnswer = () => Promise.resolve('deny');
  const denied = await perms.ensure('c.com', 'c');
  assert.equal(denied.ok, false);
  assert.match(denied.message, /The user denied access to c\.com/);
  const before = questions.length;
  assert.equal((await perms.ensure('c.com', 'c')).ok, false);
  assert.equal(questions.length, before, 'a denial is not asked again straight away');

  current = rules({ blockedSites: ['c.com', 'd.com'] });
  const blocked = await perms.ensure('d.com', 'c');
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /blocked/);
  assert.equal(questions.length, before, 'blocked sites are never asked about');
  current = rules();

  // Concurrent requests for one host share one question; modals are serial.
  let open = 0;
  let maxOpen = 0;
  const release = [];
  nextAnswer = () =>
    new Promise((resolve) => {
      open += 1;
      maxOpen = Math.max(maxOpen, open);
      release.push(() => { open -= 1; resolve('once'); });
    });
  const asked = questions.length;
  const [x1, x2, y1] = [perms.ensure('x.com', 'c'), perms.ensure('x.com', 'c'), perms.ensure('y.com', 'c')];
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(questions.length - asked, 1, 'only x.com is on screen');
  release.shift()();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(questions.length - asked, 2, 'y.com is asked after x.com is answered');
  release.shift()();
  assert.deepEqual(await Promise.all([x1, x2, y1]), [{ ok: true }, { ok: true }, { ok: true }]);
  assert.equal(maxOpen, 1);
  assert.equal(questions.filter((q) => q.host === 'x.com').length, 1);

  // Timeout counts as deny and aborts the question.
  let aborted = false;
  nextAnswer = (host, signal) => new Promise((resolve) => { signal.addEventListener('abort', () => { aborted = true; resolve('once'); }); });
  const slow = await perms.ensure('slow.com', 'c');
  assert.equal(slow.ok, false, 'a question that times out is a denial even if it later says yes');
  assert.equal(aborted, true);

  // Revoke asks again, even for hosts approved in settings or in "allow" mode.
  current = rules({ siteAccess: 'allow' });
  nextAnswer = () => Promise.resolve('deny');
  assert.equal((await perms.ensure('r.com', 'c')).ok, true);
  perms.revoke('r.com');
  assert.equal((await perms.ensure('r.com', 'c')).ok, false);
  perms.reset();
}

function keys() {
  const down = (k) => parseKeys(k)[0].events;
  assert.deepEqual(down('Enter'), [
    { type: 'keyDown', keyCode: 'Enter', modifiers: [] },
    { type: 'char', keyCode: '\r', modifiers: [] },
    { type: 'keyUp', keyCode: 'Enter', modifiers: [] },
  ]);
  assert.deepEqual(down('Escape').map((e) => e.type), ['keyDown', 'keyUp'], 'Escape types no text');
  assert.equal(down('esc')[0].keyCode, 'Escape');
  assert.deepEqual(down('ctrl+a'), [
    { type: 'keyDown', keyCode: 'a', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'a', modifiers: ['control'] },
  ]);
  const shiftTab = down('shift+Tab');
  assert.equal(shiftTab[0].keyCode, 'Tab');
  assert.deepEqual(shiftTab[0].modifiers, ['shift']);
  assert.equal(down('ArrowDown')[0].keyCode, 'Down');
  assert.equal(down('pagedown')[0].keyCode, 'PageDown');
  assert.equal(down('F5')[0].keyCode, 'F5');
  assert.equal(down('cmd+Shift+p')[0].modifiers.join(), 'meta,shift');
  assert.equal(down('shift+a')[1].keyCode, 'A', 'shifted letters type uppercase');
  assert.equal(down('a')[1].keyCode, 'a');
  assert.equal(down('Space')[1].keyCode, ' ');
  assert.equal(parseKeyPress('ctrl++').events[0].keyCode, '+');
  assert.equal(parseKeyPress('+').events[0].keyCode, '+');
  assert.equal(parseKeys('Tab Tab Enter').length, 3);
  assert.equal(parseKeys('  ArrowDown   ArrowDown ').length, 2);
  assert.throws(() => parseKeys(''), /No keys/);
  assert.throws(() => parseKeys('hyper+a'), /Unknown modifier "hyper"/);
  assert.throws(() => parseKeys('Enterr'), /Unknown key "Enterr"/);
  assert.throws(() => parseKeys('a '.repeat(101)), /Too many/);
}

keys();
flow().then(() => {
  console.log('PASS: site patterns, blocked/approved/session decisions, consent flow (dedupe, serial, timeout, revoke), key parsing');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
