'use strict';
// Modules that show text in Obsidian import 'obsidian' (for its locale), which
// only exists inside Obsidian. Require this before loading such a bundle from
// build/extensions/; without `moment` the text is English.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (name, parent, main) {
  if (name === 'obsidian') return {};
  return originalLoad.call(this, name, parent, main);
};
