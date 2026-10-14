'use strict';
// Obsidian evaluates the community plugin entrypoint without a conventional
// Node file-backed module. Unlike `node tests/extensions/test-plugin.js`, the
// loader must fail relative require('./...') to reflect the real plugin
// environment. Surfing's main.js bundles the bridge as build/extensions/bridge.js does.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..', 'build', 'extensions');
const obsidian = Object.fromEntries(['Component','ItemView','Modal','Setting','Notice','PluginSettingTab'].map(name => [name, class {}]));
function customRequire(request) {
  if (request.startsWith('.')) throw new Error(`Obsidian loader cannot resolve relative module: ${request}`);
  if (request === 'obsidian') return obsidian;
  return require(request);
}
function evaluateEntry(name, exposeDirname) {
  const source = fs.readFileSync(path.join(root, name), 'utf8');
  const wrapper = vm.runInNewContext(`(function (module, exports, require${exposeDirname ? ', __dirname' : ''}) {\n${source}\n})`, {
    console, Buffer, URL, setTimeout, clearTimeout
  }, {filename: `obsidian-eval:${name}`});
  const module = {exports: {}};
  if (exposeDirname) wrapper(module, module.exports, customRequire, root);
  else wrapper(module, module.exports, customRequire);
  return module.exports;
}
// Built from an ES module: module.exports.default is the bridge component.
const Bridge = evaluateEntry('bridge.js', false).default;
assert.equal(typeof Bridge, 'function', 'bridge.js exports the bridge');
assert.equal(Bridge.prototype instanceof obsidian.Component, true);
console.log('PASS: Obsidian-evaluated bridge without filename/dirname or relative require');
const wrapper = evaluateEntry('extension-wrapper.js', true);
assert.equal(typeof wrapper.wrapExtension, 'function');
assert.equal(typeof wrapper.unwrapExtension, 'function');
console.log('PASS: compatibility wrapper has no relative module dependencies');
// Deployment must not require helper-only source modules copied into vault.
const entries = ['bridge.js', 'extension-wrapper.js', path.join('..', '..', 'main.js')];
for (const entry of entries) {
  if (!fs.existsSync(path.join(root, entry))) continue;
  const content = fs.readFileSync(path.join(root, entry), 'utf8');
  assert(!/require\s*\(\s*['"]\.\.?\//.test(content), `${entry} contains relative require`);
}
console.log('PASS: released files contain no relative CommonJS imports');
