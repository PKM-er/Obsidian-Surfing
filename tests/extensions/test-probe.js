'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../../src/extensions/compat-probe');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.service_worker, 'background.js');
assert.equal(manifest.content_scripts[0].matches[0], 'https://example.com/*');
let listener;
const chrome = {
  runtime: { id: 'a'.repeat(32), onMessage: { addListener: fn => { listener = fn; } } },
  alarms: { create() {} },
  tabs: { query() {} },
  storage: { local: {} }
};
vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), { chrome, console });
assert.equal(typeof listener, 'function');
let response;
const result = listener({ type: 'BRIDGE_PING', nonce: 'test-123' }, { origin: 'chrome-extension://probe' }, r => response = r);
assert.equal(result, false);
assert.equal(response.ok, true);
assert.equal(response.nonce, 'test-123');
assert.equal(response.hasAlarms, true);
assert.equal(response.hasStorageLocal, true);
console.log('PASS: real MV3 probe manifest and synchronous message listener');
