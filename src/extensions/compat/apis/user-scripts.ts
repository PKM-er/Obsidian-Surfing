// chrome.userScripts is not in Electron's extension API subset, but Electron
// does inject content scripts registered through chrome.scripting (verified in
// Obsidian: ISOLATED and MAIN worlds, document_start, messaging, and files
// written after the extension loaded). User scripts are mapped onto that:
//  - each user script becomes one native registered content script;
//  - `{code}` sources (and every source of a glob-filtered script) become
//    files the host writes into the extension folder, named by SHA-256;
//  - the USER_SCRIPT world runs in the extension's ISOLATED world behind a
//    restricted `chrome` object; its messages are tagged and routed to
//    runtime.onUserScriptMessage / onUserScriptConnect.
// Known differences: configureWorld's CSP is only honored for inline
// <script>s ('unsafe-inline'; run through the host's session preload, or the
// MAIN-world relay under the page CSP); eval stays blocked; and all
// USER_SCRIPT worlds share the extension's isolated world.
import type { InstallContext } from '../context';
import { define, event, invoke, isThenable, isWorker, listenersOf, missingEvent, missingFn, settle } from '../runtime';
import { ApiFunction, Namespace, callbackOf, eventOf, fields, fnOf, nsOf } from '../chrome';
import { createKV, KV } from '../kv';
import { USER_SCRIPT_DIR } from '../../shared/protocol';
import { runInlineScript } from '../../shared/inline-script';
import { text } from '../../shared/text';

const PREFIX = 'obsidian-us-';
const PORT_PREFIX = '__obsidian_us__';
const STATE_KEY = 'userScripts.v1';
const DEFAULT_WORLD = '';

type Source = { code: string } | { file: string };
interface UserScript {
  id: string;
  js: Source[];
  matches?: string[];
  excludeMatches?: string[];
  includeGlobs?: string[];
  excludeGlobs?: string[];
  allFrames?: boolean;
  runAt?: 'document_start' | 'document_end' | 'document_idle';
  world?: 'MAIN' | 'USER_SCRIPT';
  worldId?: string;
}
interface WorldProperties { worldId?: string; csp?: string; messaging?: boolean }
interface State { scripts: UserScript[]; worlds: WorldProperties[] }
interface NativeRegistration {
  id: string; js: string[]; matches: string[]; excludeMatches?: string[];
  allFrames: boolean; runAt: string; world: 'MAIN' | 'ISOLATED'; persistAcrossSessions: boolean;
}

const list = (value: unknown): unknown[] => Array.isArray(value) ? value as unknown[] : [];

// ---- Code generated into injected files (serialized with toString) ---------
// These functions run in web pages, so they use nothing from outside their
// own body (types only).

/** chrome.runtime as the isolated world sees it, before the facade replaces it. */
interface WorldRuntime {
  id: string;
  getURL(path: string): string;
  lastError?: unknown;
  onMessage?: unknown;
  onConnect?: unknown;
  sendMessage(...args: unknown[]): unknown;
  connect(info: { name: string }): object;
}
/** A window of the isolated world, with the globals the prologue touches. */
type WorldWindow = Window & { [key: string]: unknown };
/** A prototype whose methods/accessors the prologue wraps. */
type Prototype = Record<string, unknown>;
type NodeMethod = (this: Node, ...args: unknown[]) => unknown;
/** A property descriptor whose accessors are plain functions, called with an explicit receiver. */
interface Accessor { get?: (this: unknown) => unknown; set?: (this: unknown, value: unknown) => void; configurable?: boolean; enumerable?: boolean }

/** Chrome glob semantics: `*` any run, `?` one character; whole URL. */
function globsAllow(include: string[] | null, exclude: string[] | null, url: string): boolean {
  const test = (glob: string) => {
    let source = '^';
    for (const ch of glob) source += ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\/]/g, m => '\\' + m);
    return new RegExp(source + '$').test(url);
  };
  if (include && include.length && !include.some(test)) return false;
  if (exclude && exclude.some(test)) return false;
  return true;
}

/** Turns the isolated world into a USER_SCRIPT-like world (runs once per frame). */
function userScriptWorld(worldId: string | null, messaging: boolean, portPrefix: string, inlineEvent: string | null, execEvent: string | null = null): void {
  const g = globalThis as unknown as WorldWindow;
  const marker = '__obsidianBridgeUserScriptWorld';
  if (g[marker]) return;
  const rt = (g.chrome as { runtime?: WorldRuntime } | undefined)?.runtime;
  if (!rt) return;
  Object.defineProperty(g, marker, { value: true });
  const runtime: Record<string, unknown> = { id: rt.id, getURL: (path: string) => rt.getURL(path) };
  Object.defineProperty(runtime, 'lastError', { enumerable: true, get: () => rt.lastError });
  if (messaging) {
    // Messages the extension sends to the tab (tabs.sendMessage / ports).
    runtime.onMessage = rt.onMessage;
    runtime.onConnect = rt.onConnect;
    const tag = (message: unknown) => ({ __obsidianUserScript: 1, worldId, message });
    runtime.sendMessage = (...args: unknown[]) => {
      // sendMessage([extensionId,] message [, options] [, callback])
      if (args.length > 1 && typeof args[0] === 'string' && /^[a-p]{32}$/.test(args[0])) args.shift();
      args[0] = tag(args[0]);
      return rt.sendMessage(...args);
    };
    runtime.connect = (...args: unknown[]) => {
      const info = args.find(a => !!a && typeof a === 'object') as { name?: unknown } | undefined;
      const name = typeof info?.name === 'string' ? info.name : '';
      const port = rt.connect({ name: portPrefix + JSON.stringify({ worldId, name }) });
      try { Object.defineProperty(port, 'name', { value: name, configurable: true, enumerable: true }); } catch { /* best effort */ }
      return port;
    };
  }
  const prototypeOf = (win: WorldWindow, name: string) => (win[name] as { prototype?: Prototype } | undefined)?.prototype;
  if (inlineEvent && typeof Node === 'function' && typeof HTMLScriptElement === 'function') {
    // A world whose CSP allows 'unsafe-inline' may insert inline <script>s
    // that run in the page, synchronously and whatever the page CSP says. The
    // isolated world's CSP blocks them, so hand the code to the host's session
    // preload (CSP-exempt; it cancels the event when it ran the code), else to
    // the MAIN-world relay, and keep the element inert. This also covers
    // same-origin child frames the user script world reaches.
    const inert = 'application/x-obsidian-bridge-relayed';
    const frameAttr = 'data-obsidian-bridge-relay';
    const relay = (node: unknown, parent: unknown): (() => void) | null => {
      const el = node as Element | null;
      if (!el || el.nodeType !== 1 || el.nodeName.toUpperCase() !== 'SCRIPT' || el.isConnected || el.hasAttribute('src')) return null;
      const type = (el.getAttribute('type') || '').trim().toLowerCase();
      if (type && !/^(text|application)\/(java|ecma)script$/.test(type)) return null;
      const code = el.textContent || '';
      if (!code) return null;
      const host = parent as Node | null;
      const doc = host ? (host.nodeType === 9 ? host as Document : host.ownerDocument) : null;
      let frame: string | null = null;
      if (doc && doc !== document && doc.documentElement) {
        frame = Math.random().toString(36).slice(2);
        doc.documentElement.setAttribute(frameAttr, frame);
      }
      try {
        const detail = JSON.stringify({ code, frame });
        const ran = !!execEvent && !document.dispatchEvent(new CustomEvent(execEvent, { detail, cancelable: true }));
        if (!ran) document.dispatchEvent(new CustomEvent(inlineEvent, { detail }));
      }
      finally { if (frame) doc?.documentElement.removeAttribute(frameAttr); }
      const original = el.getAttribute('type');
      el.setAttribute('type', inert);
      return () => { if (original === null) el.removeAttribute('type'); else el.setAttribute('type', original); };
    };
    const patchedRealms = new WeakSet<object>();
    const patchRealm = (realm: unknown) => {
      const win = realm as WorldWindow | null;
      try { if (!win || patchedRealms.has(win) || !win.Node) return; patchedRealms.add(win); } catch { return; }
      const patch = (proto: Prototype | undefined, method: string, targets: (self: Node, args: unknown[]) => Array<[unknown, unknown]>) => {
        const original = proto?.[method];
        if (!proto || typeof original !== 'function') return;
        const call = original as NodeMethod;
        proto[method] = function (this: Node, ...args: unknown[]) {
          const restore = targets(this, args).map(([node, parent]) => relay(node, parent)).filter((r): r is () => void => !!r);
          try { return call.apply(this, args); } finally { for (const r of restore) r(); }
        };
      };
      const intoSelf = (self: Node, args: unknown[]): Array<[unknown, unknown]> => [[args[0], self]];
      const siblings = (self: Node, args: unknown[]): Array<[unknown, unknown]> => args.map(a => [a, self.parentNode || self]);
      const node = prototypeOf(win, 'Node'), element = prototypeOf(win, 'Element');
      patch(node, 'appendChild', intoSelf);
      patch(node, 'insertBefore', intoSelf);
      patch(node, 'replaceChild', intoSelf);
      for (const m of ['append', 'prepend']) patch(element, m, (self, args) => args.map(a => [a, self]));
      for (const m of ['before', 'after', 'replaceWith']) patch(element, m, siblings);
      patch(element, 'insertAdjacentElement', (self, args) => [[args[1],
        typeof args[0] === 'string' && /^(beforebegin|afterend)$/i.test(args[0]) ? (self.parentNode || self) : self]]);
      // Child frames reached from this world get the same treatment.
      for (const name of ['HTMLIFrameElement', 'HTMLFrameElement']) {
        const proto = prototypeOf(win, name);
        for (const prop of ['contentWindow', 'contentDocument']) {
          const descriptor: Accessor | undefined = proto && Object.getOwnPropertyDescriptor(proto, prop);
          const getter = descriptor?.get;
          if (!proto || !getter) continue;
          Object.defineProperty(proto, prop, {
            ...descriptor,
            get(this: unknown) {
              const value: unknown = getter.call(this);
              try { patchRealm(prop === 'contentWindow' ? value : (value as Document | null)?.defaultView); } catch { /* best effort */ }
              return value;
            }
          });
        }
      }
    };
    patchRealm(g);
  }
  const facade = { runtime };
  const install = (win: WorldWindow) => {
    Object.defineProperty(win, 'chrome', { value: facade, configurable: true, writable: true });
    if ('browser' in win) Object.defineProperty(win, 'browser', { value: facade, configurable: true, writable: true });
    // A user script injected there later must not wrap the facade again.
    if (win !== g) Object.defineProperty(win, marker, { value: true });
  };
  try { install(g); } catch { /* best effort */ }
  // A same-origin frame (about:blank, srcdoc, the parent) gets its own copy of
  // this world when first reached from here, with the full content-script
  // `chrome`. Give every such window the facade: on each path to a frame
  // window, after each DOM change that can create one, and once for the
  // whole same-origin frame tree. Cross-origin windows throw and are skipped.
  // Windows already handled (cross-origin ones included: reading them throws,
  // which is costly per DOM change). A frame that loads a new document is
  // checked again from the load event, before the page's own listeners.
  const checked = new WeakSet<object>();
  const guard = (value: unknown) => {
    const win = value as WorldWindow | null;
    if (!win || win === g || checked.has(win)) return;
    checked.add(win);
    try { if (win.chrome && win.chrome !== facade) install(win); } catch { /* best effort */ }
  };
  const sweep = (value: unknown, depth: number) => {
    guard(value);
    const win = value as WorldWindow | null;
    try { for (let i = 0; win && i < win.length && depth < 8; i++) sweep(win[i], depth + 1); } catch { /* best effort */ }
  };
  const sweepAll = () => {
    let top: Window = g;
    try { while (top.parent && top.parent !== top) top = top.parent; } catch { /* best effort */ }
    sweep(top, 0);
  };
  sweepAll();
  const after = (proto: Prototype | undefined, method: string) => {
    const original = proto?.[method];
    if (!proto || typeof original !== 'function') return;
    const call = original as NodeMethod;
    proto[method] = function (this: Node, ...args: unknown[]) { try { return call.apply(this, args); } finally { sweepAll(); } };
  };
  const afterSet = (proto: Prototype | undefined, prop: string) => {
    const descriptor: Accessor | undefined = proto && Object.getOwnPropertyDescriptor(proto, prop);
    const setter = descriptor?.set;
    if (!proto || !setter) return;
    Object.defineProperty(proto, prop, { ...descriptor, set(this: unknown, value: unknown) { try { setter.call(this, value); } finally { sweepAll(); } } });
  };
  if (typeof Node === 'function' && typeof document === 'object') {
    document.addEventListener('load', event => {
      const win = (event.target as { contentWindow?: unknown } | null)?.contentWindow;
      if (!win || typeof win !== 'object') return;
      checked.delete(win);
      sweep(win, 0);
    }, true);
    for (const m of ['appendChild', 'insertBefore', 'replaceChild']) after(prototypeOf(g, 'Node'), m);
    for (const m of ['append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren', 'insertAdjacentElement', 'insertAdjacentHTML', 'setHTMLUnsafe']) after(prototypeOf(g, 'Element'), m);
    for (const m of ['write', 'writeln']) after(prototypeOf(g, 'Document'), m);
    after(prototypeOf(g, 'Range'), 'insertNode');
    for (const p of ['innerHTML', 'outerHTML']) afterSet(prototypeOf(g, 'Element'), p);
    for (const name of ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement']) {
      const proto = prototypeOf(g, name);
      for (const prop of ['contentWindow', 'contentDocument']) {
        const descriptor: Accessor | undefined = proto && Object.getOwnPropertyDescriptor(proto, prop);
        const getter = descriptor?.get;
        if (!proto || !getter) continue;
        Object.defineProperty(proto, prop, {
          ...descriptor,
          get(this: unknown) {
            const value: unknown = getter.call(this);
            const win = prop === 'contentWindow' ? value : (value as Document | null)?.defaultView;
            if (win) sweep(win, 0);
            return value;
          }
        });
      }
    }
  }
  if (typeof g.open === 'function') {
    const open = g.open.bind(g);
    try {
      Object.defineProperty(g, 'open', { configurable: true, writable: true,
        value: (url?: string | URL, target?: string, features?: string) => {
          const win = open(url, target, features);
          if (win) sweep(win, 0);
          return win;
        } });
    } catch { /* best effort */ }
  }
}

/** MAIN world: runs inline scripts relayed from the USER_SCRIPT world (under the page CSP). */
function inlineRelay(eventName: string, run: (detail: unknown) => boolean): void {
  const marker = '__obsidianBridgeInlineRelay';
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[marker]) return;
  Object.defineProperty(g, marker, { value: true });
  document.addEventListener(eventName, (event: Event) => {
    if (run((event as CustomEvent<unknown>).detail)) event.stopImmediatePropagation();
  }, true);
}

// ---------------------------------------------------------------------------

async function sha256(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function validate(script: unknown, existing: Set<string>, requireNew: boolean): UserScript {
  const s = fields(script);
  const id = s.id;
  if (typeof id !== 'string' || !id) throw new Error('User script must have a non-empty ID.');
  if (id.startsWith('_')) throw new Error(`User script with ID '${id}' must not start with '_'.`);
  if (requireNew && id === 'relay') throw new Error(`User script ID 'relay' is reserved by Obsidian.`);
  if (requireNew && existing.has(id)) throw new Error(`Duplicate script ID '${id}'.`);
  if (!Array.isArray(s.js) || !s.js.length) throw new Error(`User script with ID '${id}' must specify at least one js source.`);
  for (const source of list(s.js)) {
    const hasCode = typeof fields(source).code === 'string', hasFile = typeof fields(source).file === 'string';
    if (hasCode === hasFile) throw new Error(`User script with ID '${id}' must specify exactly one of 'code' or 'file' per source.`);
  }
  const hasMatches = list(s.matches).length > 0;
  const hasGlobs = list(s.includeGlobs).length > 0;
  if (!hasMatches && !hasGlobs) throw new Error(`User script with ID '${id}' must specify 'matches' or 'includeGlobs'.`);
  if (s.world !== undefined && s.world !== 'MAIN' && s.world !== 'USER_SCRIPT') throw new Error(`Invalid world for user script '${id}'.`);
  return JSON.parse(JSON.stringify(script)) as UserScript;
}

export function installUserScripts(ctx: InstallContext): void {
  const { c, chrome, granted, info, manifest, shared, report } = ctx;
  const scripting = nsOf(c, 'scripting');
  if (!granted.has('userScripts') || c.userScripts || !shared.bridge.available) return;
  if (missingFn(scripting, 'registerContentScripts')) return;
  report('userScripts', () => {
    const kv: KV = createKV();
    // Replacing `chrome` in the isolated world would break the extension's
    // own content scripts, which share that world.
    const facadeAllowed = !(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length);

    let chain: Promise<unknown> = Promise.resolve();
    const serial = <T>(op: () => Promise<T> | T): Promise<T> => {
      const result = chain.then(op);
      chain = result.then(() => undefined, () => undefined);
      return result;
    };
    const load = async (): Promise<State> => {
      const state = await kv.get<State>(STATE_KEY).catch(() => undefined);
      return { scripts: Array.isArray(state?.scripts) ? state.scripts : [], worlds: Array.isArray(state?.worlds) ? state.worlds : [] };
    };
    const worldOf = (state: State, id: string | undefined) =>
      state.worlds.find(w => (w.worldId ?? DEFAULT_WORLD) === (id ?? DEFAULT_WORLD)) ??
      state.worlds.find(w => (w.worldId ?? DEFAULT_WORLD) === DEFAULT_WORLD);

    /** Native registrations and generated files for a state. */
    const plan = async (state: State) => {
      const files = new Map<string, string>();
      const generated = async (code: string) => {
        const hash = await sha256(code);
        files.set(hash, code);
        return `${USER_SCRIPT_DIR}/${hash}.js`;
      };
      const registrations: NativeRegistration[] = [];
      const inlineEvent = '__obsidian_bridge_inline_' + chrome.runtime.id;
      let execEvent: string | null = null;
      try { execEvent = (await shared.bridge.request('userScripts.pageExec', {}, 5000))?.event ?? null; } catch { /* best effort */ }
      let relayNeeded = false;
      // Chrome injects user scripts in ID order (Tampermonkey relies on it:
      // "1|page" must define pagejs before "3|content" runs).
      const ordered = [...state.scripts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      for (const script of ordered) {
        const main = script.world === 'MAIN';
        const globs = !!(script.includeGlobs?.length || script.excludeGlobs?.length);
        const js: string[] = [];
        if (!main && facadeAllowed) {
          const world = worldOf(state, script.worldId);
          const inline = typeof world?.csp === 'string' && world.csp.includes("'unsafe-inline'");
          relayNeeded ||= inline;
          js.push(await generated(`(${userScriptWorld.toString()})(${JSON.stringify(script.worldId ?? null)}, ${!!world?.messaging}, ${JSON.stringify(PORT_PREFIX)}, ${inline ? JSON.stringify(inlineEvent) : 'null'}, ${inline ? JSON.stringify(execEvent) : 'null'});\n`));
        }
        for (const source of script.js) {
          if ('file' in source && !globs) { js.push(source.file.replace(/^\//, '')); continue; }
          let code = 'code' in source ? source.code : '';
          if ('file' in source) {
            try { code = await (await fetch(chrome.runtime.getURL(source.file.replace(/^\//, '')))).text(); }
            catch (e) { console.warn('[Chrome Bridge] userScripts source', source.file, e); continue; }
          }
          if (globs) {
            // Globs cannot be expressed as match patterns: check them in the frame.
            code = `if ((${globsAllow.toString()})(${JSON.stringify(script.includeGlobs ?? null)}, ${JSON.stringify(script.excludeGlobs ?? null)}, location.href)) {\n${code}\n}\n`;
          }
          js.push(await generated(code));
        }
        registrations.push({
          id: PREFIX + script.id, js,
          matches: script.matches?.length ? script.matches : ['<all_urls>'],
          ...(script.excludeMatches?.length ? { excludeMatches: script.excludeMatches } : {}),
          allFrames: !!script.allFrames, runAt: script.runAt || 'document_idle',
          world: main ? 'MAIN' : 'ISOLATED', persistAcrossSessions: true
        });
      }
      if (relayNeeded) {
        // Registered first so it is listening before user scripts run.
        registrations.unshift({
          id: PREFIX + 'relay', js: [await generated(`(${inlineRelay.toString()})(${JSON.stringify(inlineEvent)}, ${runInlineScript.toString()});\n`)],
          matches: ['<all_urls>'], allFrames: true, runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true
        });
      }
      return { registrations, files };
    };

    const writeFiles = async (files: Map<string, string>) => {
      const { missing } = await shared.bridge.request('userScripts.syncFiles', { keep: [...files.keys()], prune: false }, 10000);
      const pending = (Array.isArray(missing) ? missing : []).filter(h => files.has(h));
      // Batches keep each relayed message reasonably small.
      let batch: Array<{ hash: string; code: string }> = [], size = 0;
      const flush = async () => {
        if (batch.length) await shared.bridge.request('userScripts.writeFiles', { files: batch }, 30000);
        batch = []; size = 0;
      };
      for (const hash of pending) {
        const code = files.get(hash)!;
        if (size + code.length > 4_000_000) await flush();
        batch.push({ hash, code }); size += code.length;
      }
      await flush();
    };

    const comparable = (r: Record<string, unknown>) => JSON.stringify([r.id, r.js, r.matches, r.excludeMatches ?? [], !!r.allFrames, r.runAt ?? 'document_idle', r.world ?? 'ISOLATED']);
    /** Make native registrations and files match the stored state. */
    const reconcile = async () => {
      const state = await load();
      const { registrations, files } = await plan(state);
      await writeFiles(files);
      // Our own registrations (Electron's RegisteredContentScript objects).
      const current = list(await invoke(chrome, scripting, 'getRegisteredContentScripts')).map(fields)
        .flatMap(r => typeof r.id === 'string' && r.id.startsWith(PREFIX) ? [{ ...r, id: r.id }] : []);
      const wanted = new Map(registrations.map(r => [r.id, comparable({ ...r })]));
      // Injection follows registration order: re-register everything if it drifted.
      const order = (ids: string[]) => ids.filter(id => wanted.has(id)).join('\n');
      const reorder = order(current.map(r => r.id)) !== order(registrations.map(r => r.id).filter(id => current.some(cur => cur.id === id)));
      const stale = current.filter(r => reorder || wanted.get(r.id) !== comparable(r)).map(r => r.id);
      const kept = new Set(current.map(r => r.id).filter(id => !stale.includes(id)));
      if (stale.length) await invoke(chrome, scripting, 'unregisterContentScripts', { ids: stale });
      const add = registrations.filter(r => !kept.has(r.id));
      if (add.length) await invoke(chrome, scripting, 'registerContentScripts', add);
      await shared.bridge.request('userScripts.syncFiles', { keep: [...files.keys()], prune: true }, 10000);
    };
    // Coalesce bursts (Tampermonkey registers one script per call).
    let scheduled: Promise<void> | null = null;
    const scheduleReconcile = () => scheduled ??= new Promise<void>(resolve => setTimeout(() => {
      scheduled = null;
      serial(reconcile).then(resolve, e => { console.warn('[Chrome Bridge] userScripts sync (retried when Obsidian reconnects):', e); resolve(); });
    }, 30));

    const mutate = (change: (state: State) => void) => serial(async () => {
      const state = await load();
      change(state);
      await kv.set(STATE_KEY, state);
    }).then(() => scheduleReconcile());

    const ids = (filter: unknown): string[] | null => {
      const value = fields(filter).ids;
      return Array.isArray(value) ? list(value).map(id => text(id)) : null;
    };
    /** (filter?, callback?) where the callback may come first. */
    const filterAndCallback = (filter: unknown, callback: unknown): [unknown, unknown] =>
      callbackOf(filter) ? [undefined, filter] : [filter, callback];
    const api = {
      register: (scripts: unknown, callback?: unknown) => settle(mutate(state => {
        const existing = new Set(state.scripts.map(s => s.id));
        const added = list(scripts).map(s => { const v = validate(s, existing, true); existing.add(v.id); return v; });
        state.scripts.push(...added);
      }), callback),
      update: (scripts: unknown, callback?: unknown) => settle(mutate(state => {
        for (const patch of list(scripts)) {
          const id = fields(patch).id;
          const index = state.scripts.findIndex(s => s.id === id);
          if (index < 0) throw new Error(`Script with ID '${text(id)}' does not exist.`);
          state.scripts[index] = validate({ ...state.scripts[index], ...fields(patch) }, new Set(), false);
        }
      }), callback),
      unregister: (filterArg?: unknown, callbackArg?: unknown) => {
        const [filter, callback] = filterAndCallback(filterArg, callbackArg);
        const wanted = ids(filter);
        return settle(mutate(state => { state.scripts = wanted ? state.scripts.filter(s => !wanted.includes(s.id)) : []; }), callback);
      },
      getScripts: (filterArg?: unknown, callbackArg?: unknown) => {
        const [filter, callback] = filterAndCallback(filterArg, callbackArg);
        const wanted = ids(filter);
        return settle(serial(load).then(state => state.scripts.filter(s => !wanted || wanted.includes(s.id))), callback);
      },
      configureWorld: (properties: unknown = {}, callback?: unknown) => settle(mutate(state => {
        const requested = fields(properties);
        const key = typeof requested.worldId === 'string' ? requested.worldId : DEFAULT_WORLD;
        const next: WorldProperties = { ...(state.worlds.find(w => (w.worldId ?? DEFAULT_WORLD) === key) || {}), ...JSON.parse(JSON.stringify(requested)) as WorldProperties };
        state.worlds = state.worlds.filter(w => (w.worldId ?? DEFAULT_WORLD) !== key).concat(next);
      }), callback),
      getWorldConfigurations: (callback?: unknown) => settle(serial(load).then(state => state.worlds), callback),
      resetWorldConfiguration: (worldIdArg?: unknown, callbackArg?: unknown) => {
        const [worldId, callback] = filterAndCallback(worldIdArg, callbackArg);
        const key = typeof worldId === 'string' ? worldId : DEFAULT_WORLD;
        return settle(mutate(state => { state.worlds = state.worlds.filter(w => (w.worldId ?? DEFAULT_WORLD) !== key); }), callback);
      },
      execute: (injectionArg: unknown, callback?: unknown) => settle((async () => {
        const injection = fields(injectionArg);
        if (!injection.target || !Array.isArray(injection.js) || !injection.js.length) throw new Error('Invalid injection.');
        const script = validate({ id: 'execute', matches: ['<all_urls>'], ...injection, world: injection.world }, new Set(), false);
        const { registrations, files } = await plan({ scripts: [script], worlds: (await serial(load)).worlds });
        await writeFiles(files);
        // The plan may also hold the MAIN-world inline relay (registered first).
        const own = registrations.find(r => r.id === PREFIX + script.id)!;
        const results = await invoke(chrome, scripting, 'executeScript', {
          target: injection.target, files: own.js, world: own.world,
          ...(injection.injectImmediately ? { injectImmediately: true } : {})
        });
        return list(results).map(fields).map(r => ({
          frameId: r.frameId, documentId: r.documentId, result: r.result, ...(r.error ? { error: text(r.error, 'Error') } : {})
        }));
      })(), callback)
    };
    const namespace: Namespace = {};
    for (const [key, value] of Object.entries(api)) define(namespace, key, value);
    define(c, 'userScripts', namespace);

    if (isWorker) {
      // Native registrations persist across restarts; refresh files and
      // registrations whenever Obsidian (re)connects.
      shared.bridge.on('bridge.sync', () => { void scheduleReconcile(); });
      void scheduleReconcile();
    }
    info.modes.userScripts = "registered as Electron content scripts in ID order; USER_SCRIPT world = the extension's isolated world with a restricted chrome object; inline <script> is relayed to the page when the world CSP allows 'unsafe-inline' (the page's own CSP still applies); eval is not available" +
      (facadeAllowed ? '' : '; user scripts see the full content-script API (the extension has its own content scripts)') +
      (kv.persistent ? '' : '; not persisted (no IndexedDB)');
  });
}

/** Route tagged messages/ports from user scripts to the onUserScript* events. */
const routed = Symbol.for('obsidian-bridge.user-script-routing');

/** A message sent through the USER_SCRIPT world's facade. */
interface TaggedMessage { __obsidianUserScript: 1; worldId?: unknown; message?: unknown }
const isTagged = (m: unknown): m is TaggedMessage => fields(m).__obsidianUserScript === 1;

/** Per API root, once the userScripts fill is active. */
export function installUserScriptMessaging({ c, report }: InstallContext): void {
  const runtime = c.runtime;
  const onMessage = eventOf(runtime, 'onMessage'), onConnect = eventOf(runtime, 'onConnect');
  if (routed in runtime || !onMessage || !onConnect || missingEvent(runtime, 'onMessage')) return;
  report('runtime.onUserScriptMessage', () => {
    try { Object.defineProperty(runtime, routed, { value: true }); } catch { /* best effort */ }
    // Any native onUserScript* events would never fire without native user
    // scripts; ours are dispatched by the routing below.
    const onUserScriptMessage = event();
    const onUserScriptConnect = event();
    define(runtime, 'onUserScriptMessage', onUserScriptMessage);
    define(runtime, 'onUserScriptConnect', onUserScriptConnect);
    const routedPorts = new WeakSet<object>();
    const nativeAddMessage = onMessage.addListener.bind(onMessage);
    const nativeAddConnect = onConnect.addListener.bind(onConnect);

    // Registered before the extension's own code, so it sees ports first.
    nativeAddMessage((message: unknown, sender: unknown, sendResponse: unknown) => {
      if (!isTagged(message)) return undefined;
      const respond = callbackOf(sendResponse) ?? (() => undefined);
      const from = { ...fields(sender), ...(message.worldId ? { userScriptWorldId: message.worldId } : {}) };
      let keepOpen = false;
      for (const listener of listenersOf(onUserScriptMessage)) {
        try {
          const result = listener(message.message, from, respond);
          if (result === true) keepOpen = true;
          else if (isThenable(result)) { keepOpen = true; result.then(respond, () => respond(undefined)); }
        } catch (e) { console.error('[Chrome Bridge] onUserScriptMessage listener threw:', e); }
      }
      return keepOpen;
    });
    nativeAddConnect((portArg: unknown) => {
      const port = portArg as { name?: unknown; sender?: Record<string, unknown> } | null;
      if (!port || typeof port.name !== 'string' || !port.name.startsWith(PORT_PREFIX)) return;
      let meta: { worldId?: unknown; name?: unknown } = {};
      try { meta = fields(JSON.parse(port.name.slice(PORT_PREFIX.length))); } catch { /* best effort */ }
      routedPorts.add(port);
      try { Object.defineProperty(port, 'name', { value: text(meta.name), configurable: true, enumerable: true }); } catch { /* best effort */ }
      if (meta.worldId && port.sender) { try { port.sender.userScriptWorldId = meta.worldId; } catch { /* best effort */ } }
      for (const listener of listenersOf(onUserScriptConnect)) {
        try { listener(port); } catch (e) { console.error('[Chrome Bridge] onUserScriptConnect listener threw:', e); }
      }
    });

    // Regular onMessage/onConnect listeners never see user-script traffic.
    const hide = (target: object, skip: (args: unknown[]) => boolean) => {
      const wrapped = new WeakMap<ApiFunction, ApiFunction>();
      const add = fnOf(target, 'addListener'), remove = fnOf(target, 'removeListener'), has = fnOf(target, 'hasListener');
      if (!add || !remove || !has) return;
      define(target, 'addListener', (fn: unknown, ...rest: unknown[]) => {
        const listener = callbackOf(fn);
        if (!listener) return add.call(target, fn, ...rest);
        let w = wrapped.get(listener);
        if (!w) {
          w = function (this: unknown, ...args: unknown[]) { return skip(args) ? undefined : listener.apply(this, args); };
          wrapped.set(listener, w);
        }
        return add.call(target, w, ...rest);
      });
      const known = (fn: unknown) => { const listener = callbackOf(fn); return (listener && wrapped.get(listener)) ?? fn; };
      define(target, 'removeListener', (fn: unknown) => remove.call(target, known(fn)));
      define(target, 'hasListener', (fn: unknown) => has.call(target, known(fn)));
    };
    hide(onMessage, args => isTagged(args[0]));
    hide(onConnect, args => !!args[0] && typeof args[0] === 'object' && routedPorts.has(args[0]));
  });
}
