'use strict';
// The linear-time RE2-syntax matcher the host uses for declarativeNetRequest
// regexFilter/urlFilter: same results as JavaScript's RegExp on the RE2
// subset, no exponential cases, and RE2's rejections.
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts');
const { compileRe2 } = loadTs('src/shared/re2.ts');

const same = (source, inputs, ci = false) => {
  const js = new RegExp(source, ci ? 'i' : '');
  const re = compileRe2(source, ci);
  assert(re, 'compiles: ' + source);
  for (const input of inputs) {
    const a = js.exec(input);
    assert.deepEqual(re.exec(input), a ? [...a] : null, `${source} on ${input}`);
  }
};

same(String.raw`^https?://([^/]+)/(.*)$`, ['https://a.com/x/y', 'ftp://a.com/', 'http://h/']);
same(String.raw`(a|ab)(c|bcd)(d*)`, ['abcd', 'xabcdd'], false); // leftmost-first submatches
same(String.raw`a+?b*?`, ['aaabbb']);
same(String.raw`(\d{2,3})-(\w+)\b`, ['x 1234-ab_c!', '12-x']);
same(String.raw`[^\\#\\?]+\.(?:user|tamper)\.js[^/]*$`, ['https://e.com/a.user.js?x', 'https://e.com/a.user.js/']);
same(String.raw`[a-c-]+x`, ['zz-ab-cx']);
assert.deepEqual(compileRe2('[]a]+').exec('x]a]'), [']a]'], 'RE2: a leading ] is literal (JS reads [] as empty)');
same(String.raw`\x41\.\/\-`, ['zA./-']);
assert.equal(compileRe2(String.raw`\x{42}`).test('B'), true, 'RE2 hex escape with braces');
same(String.raw`(?:ab){2}(c)?`, ['abab', 'ababc']);
same(String.raw`^$`, ['', 'a']);
same(String.raw`\Bb\b`, ['ab b', 'abb']);
same('PATH', ['https://a.com/path', 'https://a.com/PATH'], true);
same(String.raw`[a-z]+`, ['ABC'], true);
assert.deepEqual(compileRe2(String.raw`(?P<host>[a-z.]+)/(?<path>.*)`).exec('x.com/p'), ['x.com/p', 'x.com', 'p'], 'named groups (RE2 and JS forms)');
assert.equal(compileRe2('[[:digit:]]+x').test('12x'), true, 'POSIX classes');
assert.equal(compileRe2('(?i)abc').test('ABC'), true, 'inline flag');
assert.equal(compileRe2('a(?i:b)c').test('aBc'), true);
assert.equal(compileRe2('a(?i:b)c').test('aBC'), false);
console.log('PASS: RE2-syntax matching agrees with JavaScript RegExp, including submatches');

for (const bad of [String.raw`(a)\1`, '(?=a)', '(?!a)', '(?<=a)', '(?<!a)', 'a**', 'a{1001}', 'a{3,2}', '(', ')', '[a', String.raw`\p`, '*a']) {
  assert.equal(compileRe2(bad), null, 'rejected: ' + bad);
}
console.log('PASS: rejects what RE2 rejects (backreferences, lookaround, bad repetition)');

const long = 'a'.repeat(20000);
for (const [source, input] of [['(a+)+$', long + '!'], ['(a|aa)+$', long + '!'], ['(.*a){20}$', long + '!'], ['(x+x+)+y', 'x'.repeat(5000)]]) {
  const started = Date.now();
  assert.equal(compileRe2(source).test(input), false);
  assert(Date.now() - started < 3000, `${source}: ${Date.now() - started}ms`);
}
console.log('PASS: catastrophic patterns run in linear time');
