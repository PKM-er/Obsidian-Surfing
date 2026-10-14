'use strict';
// Just enough of Obsidian's Component lifecycle for the bridge and tracker:
// load/unload, children, and cleanup of registered events and intervals.
class Component {
  constructor() { this._children = []; this._cleanup = []; this._loaded = false; }
  load() {
    if (this._loaded) return;
    this._loaded = true;
    this.onload();
    for (const child of this._children) child.load();
  }
  unload() {
    if (!this._loaded) return;
    this._loaded = false;
    for (const child of this._children.splice(0)) child.unload();
    for (const fn of this._cleanup.splice(0)) fn();
    this.onunload();
  }
  onload() {}
  onunload() {}
  addChild(child) { this._children.push(child); if (this._loaded) child.load(); return child; }
  removeChild(child) {
    const index = this._children.indexOf(child);
    if (index >= 0) { this._children.splice(index, 1); child.unload(); }
    return child;
  }
  register(fn) { this._cleanup.push(fn); }
  registerEvent() {}
  registerDomEvent() {}
  registerInterval(id) { this._cleanup.push(() => clearInterval(id)); return id; }
}

module.exports = { Component };
