// chrome.declarativeNetRequest rule evaluation for top-level navigations.
// Obsidian can only intervene in Web Viewer main-frame navigations, so only
// rules that can match a `main_frame` request are evaluated here.
import { compileRe2, Re2 } from './re2';

export interface NetRuleCondition {
  urlFilter?: string;
  regexFilter?: string;
  isUrlFilterCaseSensitive?: boolean;
  requestDomains?: string[];
  excludedRequestDomains?: string[];
  initiatorDomains?: string[];
  excludedInitiatorDomains?: string[];
  requestMethods?: string[];
  excludedRequestMethods?: string[];
  resourceTypes?: string[];
  excludedResourceTypes?: string[];
  tabIds?: number[];
  excludedTabIds?: number[];
  domainType?: 'firstParty' | 'thirdParty';
  /** Deprecated aliases still accepted by Chrome. */
  domains?: string[];
  excludedDomains?: string[];
}

export interface NetRuleAction {
  type: 'block' | 'redirect' | 'allow' | 'upgradeScheme' | 'modifyHeaders' | 'allowAllRequests';
  redirect?: {
    url?: string;
    extensionPath?: string;
    regexSubstitution?: string;
    transform?: {
      scheme?: string; host?: string; port?: string; path?: string; query?: string; fragment?: string;
      username?: string; password?: string;
      queryTransform?: { removeParams?: string[]; addOrReplaceParams?: Array<{ key: string; value: string; replaceOnly?: boolean }> };
    };
  };
}

export interface NetRule { id: number; priority?: number; condition: NetRuleCondition; action: NetRuleAction }

export interface NavigationRequest { url: string; tabId: number; method?: string; initiator?: string | null }

export type NetDecision =
  | { kind: 'block'; rule: NetRule }
  | { kind: 'allow'; rule: NetRule }
  | { kind: 'redirect'; rule: NetRule; url: string };

/** Could this rule ever match a main_frame request? (Chrome's default excludes main_frame.) */
export function appliesToMainFrame(rule: NetRule): boolean {
  const c = rule?.condition || {};
  if (Array.isArray(c.resourceTypes)) return c.resourceTypes.includes('main_frame');
  if (Array.isArray(c.excludedResourceTypes)) return !c.excludedResourceTypes.includes('main_frame');
  return false;
}

// Patterns run in Obsidian's UI thread: use the linear-time RE2 matcher, never
// JavaScript's backtracking RegExp (see re2.ts).
function compile(source: string, flags: string): Re2 | null {
  return compileRe2(source, flags.includes('i'));
}

/** DNR urlFilter syntax: `*` wildcard, `^` separator, `|` anchors, `||` domain anchor. */
export function urlFilterRegex(filter: string, caseSensitive = false): Re2 | null {
  let pattern = filter;
  let prefix = '', suffix = '';
  if (pattern.startsWith('||')) { prefix = '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^/?#]*\\.)?'; pattern = pattern.slice(2); }
  else if (pattern.startsWith('|')) { prefix = '^'; pattern = pattern.slice(1); }
  if (pattern.endsWith('|')) { suffix = '$'; pattern = pattern.slice(0, -1); }
  // Runs of '*' are one wildcard; collapsing them bounds backtracking.
  const body = pattern.replace(/\*{2,}/g, '*').split('').map(ch => {
    if (ch === '*') return '.*';
    if (ch === '^') return '(?:[^A-Za-z0-9_\\-.%]|$)';
    return ch.replace(/[.+?${}()|[\]\\/]/g, '\\$&');
  }).join('');
  return compile(prefix + body + suffix, caseSensitive ? '' : 'i');
}

const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
const domainMatches = (host: string, domains: string[]) =>
  domains.some(d => { const x = String(d).toLowerCase(); return host === x || host.endsWith('.' + x); });

export function ruleMatches(rule: NetRule, request: NavigationRequest): boolean {
  const c = rule.condition || {};
  if (!appliesToMainFrame(rule)) return false;
  const url = request.url;
  const host = hostOf(url);
  const method = (request.method || 'get').toLowerCase();
  const requestDomains = c.requestDomains ?? c.domains;
  const excludedRequestDomains = c.excludedRequestDomains ?? c.excludedDomains;
  if (Array.isArray(requestDomains) && !domainMatches(host, requestDomains)) return false;
  if (Array.isArray(excludedRequestDomains) && domainMatches(host, excludedRequestDomains)) return false;
  const initiator = request.initiator ? hostOf(request.initiator) : '';
  if (Array.isArray(c.initiatorDomains) && (!initiator || !domainMatches(initiator, c.initiatorDomains))) return false;
  if (Array.isArray(c.excludedInitiatorDomains) && initiator && domainMatches(initiator, c.excludedInitiatorDomains)) return false;
  if (Array.isArray(c.requestMethods) && !c.requestMethods.map(m => m.toLowerCase()).includes(method)) return false;
  if (Array.isArray(c.excludedRequestMethods) && c.excludedRequestMethods.map(m => m.toLowerCase()).includes(method)) return false;
  if (Array.isArray(c.tabIds) && !c.tabIds.includes(request.tabId)) return false;
  if (Array.isArray(c.excludedTabIds) && c.excludedTabIds.includes(request.tabId)) return false;
  // A top-level navigation is always first-party.
  if (c.domainType === 'thirdParty') return false;
  if (typeof c.regexFilter === 'string') {
    const re = compile(c.regexFilter, c.isUrlFilterCaseSensitive ? '' : 'i');
    if (!re || !re.test(url)) return false;
  } else if (typeof c.urlFilter === 'string' && c.urlFilter) {
    const re = urlFilterRegex(c.urlFilter, !!c.isUrlFilterCaseSensitive);
    if (!re || !re.test(url)) return false;
  }
  return true;
}

/** Chrome's tie-break among equal priorities. */
const ACTION_RANK: Record<string, number> = { allow: 5, allowAllRequests: 5, block: 4, upgradeScheme: 3, redirect: 2, modifyHeaders: 0 };

function redirectUrl(rule: NetRule, url: string, extensionId: string): string | null {
  const r = rule.action.redirect;
  if (!r) return null;
  if (typeof r.url === 'string') return r.url;
  if (typeof r.extensionPath === 'string') return `chrome-extension://${extensionId}/${r.extensionPath.replace(/^\//, '')}`;
  if (typeof r.regexSubstitution === 'string' && typeof rule.condition.regexFilter === 'string') {
    const re = compile(rule.condition.regexFilter, rule.condition.isUrlFilterCaseSensitive ? '' : 'i');
    const m = re?.exec(url);
    if (!m) return null;
    return r.regexSubstitution.replace(/\\(\d)/g, (_s, d) => m[Number(d)] ?? '');
  }
  if (r.transform) {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    const t = r.transform;
    if (t.scheme) u.protocol = t.scheme + ':';
    if (t.host !== undefined) u.hostname = t.host;
    if (t.port !== undefined) u.port = t.port;
    if (t.path !== undefined) u.pathname = t.path;
    if (t.query !== undefined) u.search = t.query;
    if (t.fragment !== undefined) u.hash = t.fragment;
    if (t.username !== undefined) u.username = t.username;
    if (t.password !== undefined) u.password = t.password;
    if (t.queryTransform) {
      for (const key of t.queryTransform.removeParams || []) u.searchParams.delete(key);
      for (const p of t.queryTransform.addOrReplaceParams || []) {
        if (p.replaceOnly && !u.searchParams.has(p.key)) continue;
        u.searchParams.set(p.key, p.value);
      }
    }
    return u.href;
  }
  return null;
}

/** The winning action of one extension's rules for a navigation, if any. */
export function evaluate(rules: NetRule[], request: NavigationRequest, extensionId: string,
  allowed: (rule: NetRule) => boolean = () => true): NetDecision | null {
  let best: NetRule | null = null;
  for (const rule of rules) {
    if (!rule?.action || rule.action.type === 'modifyHeaders' || !allowed(rule) || !ruleMatches(rule, request)) continue;
    if (!best) { best = rule; continue; }
    const p = rule.priority ?? 1, q = best.priority ?? 1;
    if (p > q || (p === q && (ACTION_RANK[rule.action.type] ?? 0) > (ACTION_RANK[best.action.type] ?? 0))) best = rule;
  }
  if (!best) return null;
  switch (best.action.type) {
    case 'block': return { kind: 'block', rule: best };
    case 'allow': case 'allowAllRequests': return { kind: 'allow', rule: best };
    case 'upgradeScheme': {
      if (!/^http:/i.test(request.url)) return null;
      return { kind: 'redirect', rule: best, url: request.url.replace(/^http:/i, 'https:') };
    }
    case 'redirect': {
      const url = redirectUrl(best, request.url, extensionId);
      return url ? { kind: 'redirect', rule: best, url } : null;
    }
  }
  return null;
}
