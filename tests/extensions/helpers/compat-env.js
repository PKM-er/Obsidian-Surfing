'use strict';
// Runs the built compat layer (compat-api.js) in a vm context that looks like
// an extension context, with an in-memory BroadcastChannel shared between
// contexts and a fake host endpoint (what the hidden bridge page relays).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'build', 'extensions', 'compat-api.js'), 'utf8');
const CHANNEL = '__obsidian_bridge_channel_v1';
const EXT_ID = 'm'.repeat(32);

/** BroadcastChannel semantics: delivered async to every other open instance. */
function makeHub() {
  const members = new Set();
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.listeners = new Set();
      members.add(this);
    }
    addEventListener(type, fn) { if (type === 'message') this.listeners.add(fn); }
    removeEventListener(type, fn) { this.listeners.delete(fn); }
    postMessage(data) {
      const copy = structuredClone(data);
      for (const other of members) {
        if (other === this || other.name !== this.name) continue;
        setTimeout(() => { for (const fn of other.listeners) fn({ data: structuredClone(copy) }); }, 0);
      }
    }
    close() { members.delete(this); }
  }
  return { FakeBroadcastChannel };
}

/** The host side: receives extension messages, can answer and push events. */
function hostEndpoint(hub) {
  const channel = new hub.FakeBroadcastChannel(CHANNEL);
  const received = [];
  const handlers = new Map();
  channel.addEventListener('message', ({ data }) => {
    if (data?.from !== 'extension') return;
    received.push(data);
    if (data.type === 'request') {
      const handler = handlers.get(data.method);
      Promise.resolve(handler ? handler(data.params) : undefined).then(result => {
        if (result !== undefined) channel.postMessage({ v: 1, from: 'host', type: 'response', requestId: data.requestId, result });
      }, error => channel.postMessage({ v: 1, from: 'host', type: 'response', requestId: data.requestId, error: String(error.message || error) }));
    }
  });
  return {
    received,
    send(message) { channel.postMessage({ v: 1, from: 'host', ...message }); },
    handle(method, fn) { handlers.set(method, fn); },
    last(type) { return [...received].reverse().find(m => m.type === type); }
  };
}

function makeLocalStorage() {
  const data = new Map();
  const listeners = new Set();
  const changed = changes => { for (const fn of listeners) fn(changes, 'local'); };
  return {
    data,
    onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    local: {
      async get(keys) {
        const out = {};
        if (keys == null) { for (const [k, v] of data) out[k] = structuredClone(v); return out; }
        for (const k of typeof keys === 'string' ? [keys] : keys) if (data.has(k)) out[k] = structuredClone(data.get(k));
        return out;
      },
      async set(values) {
        const changes = {};
        for (const [k, v] of Object.entries(values)) { changes[k] = { oldValue: data.get(k), newValue: structuredClone(v) }; data.set(k, structuredClone(v)); }
        changed(changes);
      },
      async remove(keys) {
        const changes = {};
        for (const k of typeof keys === 'string' ? [keys] : keys) if (data.has(k)) { changes[k] = { oldValue: data.get(k) }; data.delete(k); }
        if (Object.keys(changes).length) changed(changes);
      }
    }
  };
}

/**
 * Evaluate compat-api.js in a fresh context. Returns the context's chrome
 * object, the compat report and the context itself.
 */
function evaluate({ permissions = [], worker = true, hub = null, storage = null, extra = {}, page = null, bootId = 'boot-1', manifestExtra = {} } = {}) {
  const store = storage || makeLocalStorage();
  const chrome = {
    runtime: {
      id: EXT_ID, lastError: undefined,
      getManifest: () => ({ manifest_version: 3, permissions, ...manifestExtra }),
      getURL: file => `chrome-extension://${EXT_ID}/${file}`
    },
    tabs: {
      get: async id => id === 7 ? { id: 7, url: 'https://example.com/a', windowId: 1 } : id === 9 ? { id: 9, url: 'https://opened.example/', windowId: 1 } : undefined,
      query: async () => []
    },
    storage: { local: store.local, onChanged: store.onChanged },
    ...extra
  };
  const ctx = {
    chrome, console: { info() {}, warn() {}, error() {}, debug() {} }, queueMicrotask, Promise, setTimeout, clearTimeout,
    TextEncoder, URL, structuredClone,
    __obsidianBridgeLocaleData: { locale: 'en', messages: {}, ...(bootId ? { bridgeBootId: bootId } : {}) },
    addEventListener() {}
  };
  if (hub) ctx.BroadcastChannel = hub.FakeBroadcastChannel;
  if (worker) ctx.ServiceWorkerGlobalScope = class { static [Symbol.hasInstance]() { return true; } };
  if (page) Object.assign(ctx, page);
  vm.runInNewContext(script, ctx);
  return { chrome, info: ctx.__obsidianBridgeCompatV06, ctx, storage: store };
}

const tick = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
/** vm-realm values have foreign prototypes; compare their JSON shape. */
const plain = value => JSON.parse(JSON.stringify(value ?? null));

module.exports = { makeHub, hostEndpoint, makeLocalStorage, evaluate, tick, plain, EXT_ID };
