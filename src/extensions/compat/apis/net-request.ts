// chrome.declarativeNetRequest is not in Electron's extension API subset.
// Rules are kept here (dynamic rules persisted; session rules dropped when
// Obsidian restarts; static rulesets read from the package) and the ones that
// can match a top-level navigation are announced to the host, which applies
// them to Obsidian Web Viewer navigations. Sub-resource requests and
// modifyHeaders cannot be intercepted from Obsidian.
import type { InstallContext } from '../context';
import { callbackOrPromise, define, event, invoke, isThenable, isWorker, missingFn, settle } from '../runtime';
import { appliesToMainFrame, NetRule } from '../../shared/net-request';
import { compileRe2 } from '../../shared/re2';
import { ChromeRoot, Namespace, callbackOf, fields, fnOf, nsOf } from '../chrome';
import type { ChromeManifest } from '../../types';
import { text } from '../../shared/text';
import { HOST_PAGE } from '../../shared/protocol';

const observed = Symbol.for('obsidian-bridge.dnr-observed');

const DYNAMIC_KEY = '__obsidian_bridge_dnr_dynamic_v1__';
const SESSION_KEY = '__obsidian_bridge_dnr_session_v1__';
const ENABLED_KEY = '__obsidian_bridge_dnr_enabled_rulesets_v1__';
const LIMITS = {
  MAX_NUMBER_OF_DYNAMIC_RULES: 30000, MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES: 5000,
  MAX_NUMBER_OF_SESSION_RULES: 5000, MAX_NUMBER_OF_UNSAFE_SESSION_RULES: 5000,
  MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES: 5000, MAX_NUMBER_OF_REGEX_RULES: 1000,
  MAX_NUMBER_OF_STATIC_RULESETS: 100, MAX_NUMBER_OF_ENABLED_STATIC_RULESETS: 50,
  GUARANTEED_MINIMUM_STATIC_RULES: 30000, GETMATCHEDRULES_QUOTA_INTERVAL: 10,
  MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL: 20
};

interface StaticRuleset { id: string; path: string; enabled: boolean }

function validate(rules: unknown, existing: Map<number, NetRule>): NetRule[] {
  if (!Array.isArray(rules)) return [];
  const out: NetRule[] = [];
  for (const raw of rules) {
    const rule = raw as NetRule;
    if (!rule || !Number.isInteger(rule.id) || rule.id < 1) throw new Error(`Rule with id ${JSON.stringify((raw as { id?: unknown } | null)?.id)} does not have a valid ID.`);
    if (existing.has(rule.id) || out.some(r => r.id === rule.id)) throw new Error(`Rule with id ${rule.id} does not have a unique ID.`);
    if (!rule.action || typeof rule.action.type !== 'string') throw new Error(`Rule with id ${rule.id} does not specify a valid action.`);
    if (rule.priority !== undefined && (!Number.isInteger(rule.priority) || rule.priority < 1)) throw new Error(`Rule with id ${rule.id} has an invalid priority.`);
    // Chrome compiles regexFilter with RE2: no backreferences or lookaround.
    if (typeof rule.condition?.regexFilter === 'string' && !compileRe2(rule.condition.regexFilter)) {
      throw new Error(`Rule with id ${rule.id} specified a non-supported regular expression.`);
    }
    out.push(JSON.parse(JSON.stringify({ ...rule, priority: rule.priority ?? 1, condition: rule.condition ?? {} })) as NetRule);
  }
  return out;
}

/** Rule arrays from Chrome's own API or our storage (validated when they were added). */
const ruleList = (value: unknown): NetRule[] => Array.isArray(value) ? (value as unknown[]).filter(r => Number.isInteger(fields(r).id)) as NetRule[] : [];
const list = (value: unknown): unknown[] => Array.isArray(value) ? value as unknown[] : [];

function declaredRulesets(manifest: ChromeManifest): StaticRuleset[] {
  const resources = fields(manifest.declarative_net_request).rule_resources;
  const out: StaticRuleset[] = [];
  for (const raw of list(resources)) {
    const { id, path, enabled } = fields(raw);
    if (typeof id === 'string' && typeof path === 'string') out.push({ id, path, enabled: enabled !== false });
  }
  return out;
}

/** Static ruleset files from the package, reduced to navigation-relevant rules. */
function staticLoader(chrome: ChromeRoot): (ruleset: StaticRuleset) => Promise<NetRule[]> {
  const cache = new Map<string, Promise<NetRule[]>>();
  return ruleset => {
    if (!cache.has(ruleset.id)) cache.set(ruleset.id, (async () => {
      try {
        const response = await fetch(chrome.runtime.getURL(ruleset.path.replace(/^\//, '')));
        const parsed: unknown = await response.json();
        return ruleList(parsed).filter(appliesToMainFrame);
      } catch (e) {
        console.warn('[Chrome Bridge] declarativeNetRequest ruleset', ruleset.id, e);
        return [];
      }
    })());
    return cache.get(ruleset.id)!;
  };
}

const isBridgePage = () => !isWorker && globalThis.location?.pathname === '/' + HOST_PAGE;

/**
 * Electron 43 exposes declarativeNetRequest and stores rules, but never
 * applies them. Keep the native API (the extension's own source of truth) and
 * report its rules to the host after every change, which enforces them.
 */
function observeNative(ctx: InstallContext, dnr: Namespace): void {
  const { chrome, info, manifest, shared, report } = ctx;
  // `browser` may alias the same native object; observe it once.
  if (observed in dnr) return;
  report('declarativeNetRequest.enforced-by-obsidian', () => {
    const declared = declaredRulesets(manifest);
    const loadStatic = staticLoader(chrome);
    let pending = false;
    const announce = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => void (async () => {
        pending = false;
        try {
          const [session, dynamic, enabled] = await Promise.all([
            invoke(chrome, dnr, 'getSessionRules'), invoke(chrome, dnr, 'getDynamicRules'),
            missingFn(dnr, 'getEnabledRulesets') ? Promise.resolve(declared.filter(r => r.enabled).map(r => r.id)) : invoke(chrome, dnr, 'getEnabledRulesets')
          ]);
          const enabledIds = list(enabled);
          const statics = (await Promise.all(declared.filter(r => enabledIds.includes(r.id)).map(loadStatic))).flat();
          const rules = [...ruleList(session), ...ruleList(dynamic), ...statics].filter(appliesToMainFrame);
          shared.bridge.post({ type: 'netRequest.rules', rules });
        } catch (e) { console.warn('[Chrome Bridge] declarativeNetRequest snapshot:', e); }
      })(), 0);
    };
    // Observe (not replace) native updates: call through, then report.
    for (const method of ['updateSessionRules', 'updateDynamicRules', 'updateEnabledRulesets', 'updateStaticRules']) {
      const original = fnOf(dnr, method);
      if (!original) continue;
      define(dnr, method, (...args: unknown[]) => {
        const last = args.length - 1;
        const callback = callbackOf(args[last]);
        if (callback) args[last] = (...result: unknown[]) => { announce(); callback(...result); };
        const returned = original.apply(dnr, args);
        if (isThenable(returned)) returned.then(announce, announce);
        return returned;
      });
    }
    try { Object.defineProperty(dnr, observed, { value: true }); } catch { /* best effort */ }
    shared.bridge.on('bridge.sync', announce);
    // Rules registered before the host connected: the worker and the bridge
    // page (which loads whenever Obsidian connects) both report a snapshot.
    if (isWorker || isBridgePage()) announce();
    info.modes.declarativeNetRequest = 'native rules enforced by Obsidian for Web Viewer top-level navigations (block/allow/redirect/upgradeScheme); sub-resources and modifyHeaders are not';
  });
}

export function installNetRequest(ctx: InstallContext): void {
  const { c, chrome, granted, info, manifest, shared, report } = ctx;
  if (!granted.has('declarativeNetRequest') && !granted.has('declarativeNetRequestWithHostAccess')) return;
  if (!shared.bridge.available) return;
  const native = nsOf(c, 'declarativeNetRequest');
  if (native && fnOf(native, 'updateSessionRules')) {
    observeNative(ctx, native);
    return;
  }
  report('declarativeNetRequest', () => {
    const existing = native ?? {};
    const local = nsOf(nsOf(c, 'storage'), 'local');
    const persistent = granted.has('storage') && !missingFn(local, 'get');
    const boot = fields(fields(globalThis).__obsidianBridgeLocaleData).bridgeBootId;
    const bootId = typeof boot === 'string' ? boot : null;
    const dynamic = new Map<number, NetRule>();
    const session = new Map<number, NetRule>();
    const declared = declaredRulesets(manifest);
    let enabledRulesets = new Set(declared.filter(r => r.enabled).map(r => r.id));
    const loadStatic = staticLoader(chrome);

    let announcing = false;
    const announce = () => {
      if (!isWorker || announcing) return;
      announcing = true;
      setTimeout(() => void (async () => {
        announcing = false;
        const statics = (await Promise.all(declared.filter(r => enabledRulesets.has(r.id)).map(loadStatic))).flat();
        const rules = [...session.values(), ...dynamic.values(), ...statics].filter(appliesToMainFrame);
        shared.bridge.post({ type: 'netRequest.rules', rules });
      })(), 0);
    };
    const save = () => {
      if (!persistent) return;
      invoke(chrome, local, 'set', {
        [DYNAMIC_KEY]: [...dynamic.values()],
        [SESSION_KEY]: { boot: bootId, rules: [...session.values()] },
        [ENABLED_KEY]: [...enabledRulesets]
      }).catch(e => console.warn('[Chrome Bridge] declarativeNetRequest persist:', e));
    };
    // Restore first; updates issued during startup queue behind it.
    let chain: Promise<unknown> = persistent
      ? invoke(chrome, local, 'get', [DYNAMIC_KEY, SESSION_KEY, ENABLED_KEY]).then(raw => {
        const all = fields(raw);
        for (const rule of ruleList(all[DYNAMIC_KEY])) dynamic.set(rule.id, rule);
        const stored = fields(all[SESSION_KEY]);
        // Session rules end with the browser session (an Obsidian restart).
        if (stored.boot === bootId) for (const rule of ruleList(stored.rules)) session.set(rule.id, rule);
        if (Array.isArray(all[ENABLED_KEY])) enabledRulesets = new Set(list(all[ENABLED_KEY]).filter((id): id is string => declared.some(r => r.id === id)));
      }).catch(e => console.warn('[Chrome Bridge] declarativeNetRequest restore:', e))
      : Promise.resolve();
    const enqueue = <T>(op: () => T): Promise<T> => {
      const result = chain.then(op);
      chain = result.then(() => undefined, () => undefined);
      return result.then(value => { save(); announce(); return value; });
    };
    const update = (store: Map<number, NetRule>, options: unknown) => enqueue(() => {
      const { removeRuleIds, addRules } = fields(options);
      const next = new Map(store);
      for (const id of list(removeRuleIds)) if (typeof id === 'number') next.delete(id);
      const added = validate(addRules, next);
      for (const rule of added) next.set(rule.id, rule);
      store.clear();
      for (const [id, rule] of next) store.set(id, rule);
    });
    const read = (store: Map<number, NetRule>, filter: unknown) => chain.then(() => {
      const { ruleIds } = fields(filter);
      const ids = Array.isArray(ruleIds) ? list(ruleIds) : null;
      return [...store.values()].filter(r => !ids || ids.includes(r.id)).map(r => JSON.parse(JSON.stringify(r)) as NetRule);
    });
    const args = (a: unknown, b: unknown): [unknown, unknown] => callbackOf(a) ? [undefined, a] : [a, b];

    const api: Record<string, unknown> = {
      updateDynamicRules: (options: unknown, callback?: unknown) => settle(update(dynamic, options).then(() => undefined), callback),
      updateSessionRules: (options: unknown, callback?: unknown) => settle(update(session, options).then(() => undefined), callback),
      getDynamicRules: (a?: unknown, b?: unknown) => { const [filter, cb] = args(a, b); return settle(read(dynamic, filter), cb); },
      getSessionRules: (a?: unknown, b?: unknown) => { const [filter, cb] = args(a, b); return settle(read(session, filter), cb); },
      getEnabledRulesets: (callback?: unknown) => settle(chain.then(() => [...enabledRulesets]), callback),
      updateEnabledRulesets: (options: unknown, callback?: unknown) => settle(enqueue(() => {
        const { disableRulesetIds, enableRulesetIds } = fields(options);
        const disable = list(disableRulesetIds), enable = list(enableRulesetIds);
        for (const id of [...disable, ...enable]) {
          if (!declared.some(r => r.id === id)) throw new Error(`Invalid ruleset id: ${text(id)}.`);
        }
        for (const id of disable) if (typeof id === 'string') enabledRulesets.delete(id);
        for (const id of enable) if (typeof id === 'string') enabledRulesets.add(id);
      }).then(() => undefined), callback),
      getAvailableStaticRuleCount: (callback?: unknown) => callbackOrPromise(callback, LIMITS.GUARANTEED_MINIMUM_STATIC_RULES),
      // RE2, as Chrome compiles regexFilter (no backreferences or lookaround).
      isRegexSupported: (options: unknown, callback?: unknown) => {
        const supported = !!compileRe2(text(fields(options).regex));
        return callbackOrPromise(callback, supported ? { isSupported: true } : { isSupported: false, reason: 'syntaxError' });
      },
      getMatchedRules: (filter?: unknown, callback?: unknown) => callbackOrPromise(callbackOf(filter) ? filter : callback, { rulesMatchedInfo: [] }),
      setExtensionActionOptions: (_options: unknown, callback?: unknown) => callbackOrPromise(callback, undefined)
    };
    for (const [key, value] of Object.entries(api)) if (missingFn(existing, key)) define(existing, key, value);
    if (!existing.onRuleMatchedDebug) define(existing, 'onRuleMatchedDebug', event());
    for (const [key, value] of Object.entries({ ...LIMITS, SESSION_RULESET_ID: '_session', DYNAMIC_RULESET_ID: '_dynamic' })) {
      if (existing[key] === undefined) define(existing, key, value);
    }
    if (!c.declarativeNetRequest) define(c, 'declarativeNetRequest', existing);
    shared.bridge.on('bridge.sync', () => { void chain.then(announce); });
    if (isWorker) void chain.then(announce);
    info.modes.declarativeNetRequest = shared.bridge.available
      ? 'applied to Obsidian Web Viewer top-level navigations (block/allow/redirect/upgradeScheme); sub-resources and modifyHeaders are not intercepted'
      : 'registration-only: BroadcastChannel unavailable, rules are not applied';
  });
}
