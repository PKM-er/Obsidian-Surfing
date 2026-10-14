'use strict';
// Load one TypeScript module from src/extensions/ for unit tests by bundling it with
// esbuild in memory (Obsidian and Electron are stubbed by the caller).
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

function loadTs(relativePath, { stubs = {} } = {}) {
  // Paths are relative to the extensions module: 'src/host/x.ts' is src/extensions/host/x.ts.
  const entry = path.join(__dirname, '..', '..', '..', 'src', 'extensions', relativePath.replace(/^src\//, ''));
  const result = esbuild.buildSync({
    entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false,
    target: 'es2022', external: ['obsidian', 'electron', '@electron/remote'], logLevel: 'silent'
  });
  const mod = new Module(entry);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(path.dirname(entry));
  const originalRequire = mod.require.bind(mod);
  // 'obsidian' exists only inside Obsidian; modules that just need its locale get English.
  mod.require = name => Object.prototype.hasOwnProperty.call(stubs, name) ? stubs[name] : name === 'obsidian' ? {} : originalRequire(name);
  mod._compile(result.outputFiles[0].text, entry);
  return mod.exports;
}

module.exports = { loadTs };
