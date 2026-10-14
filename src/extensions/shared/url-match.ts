// Chrome extension URL matching, shared by the host (contextMenus URL
// patterns) and the compat layer (webNavigation event filters).

/**
 * `*` matches any run of characters; everything else is literal. Greedy
 * two-pointer matching: O(pattern × text) in the worst case, never the
 * exponential/polynomial backtracking of an equivalent RegExp (patterns come
 * from extensions and are matched in Obsidian's UI thread).
 */
export function wildcardMatch(pattern: string, text: string): boolean {
  let p = 0, t = 0, star = -1, resume = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] !== '*' && pattern[p] === text[t]) { p++; t++; }
    else if (p < pattern.length && pattern[p] === '*') { star = p++; resume = t; }
    else if (star >= 0) { p = star + 1; t = ++resume; }
    else return false;
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}

/** Chrome match pattern, e.g. `*://*.example.com/*` or `<all_urls>`. */
export function matchPattern(pattern: string, url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (pattern === '<all_urls>') return /^(https?|wss?|ftp|file|data|urn):$/.test(parsed.protocol);
  const m = /^(\*|https?|wss?|file|ftp|urn|chrome-extension):\/\/(\*|\*\.[^/*]+|[^/*]*)(\/.*)$/.exec(pattern);
  if (!m) return false;
  const [, scheme, host, path] = m;
  const protocol = parsed.protocol.slice(0, -1);
  if (scheme === '*' ? !['http', 'https', 'ws', 'wss'].includes(protocol) : scheme !== protocol) return false;
  if (host !== '*') {
    if (host.startsWith('*.')) {
      const base = host.slice(2).toLowerCase();
      if (parsed.hostname !== base && !parsed.hostname.endsWith('.' + base)) return false;
    } else if (parsed.hostname !== host.toLowerCase()) return false;
  }
  return wildcardMatch(path, parsed.pathname + parsed.search);
}

export function matchAny(patterns: unknown, url: string | undefined): boolean {
  if (!Array.isArray(patterns) || !patterns.length) return true;
  if (!url) return false;
  return patterns.some(p => typeof p === 'string' && matchPattern(p, url));
}

/** chrome.events.UrlFilter; every specified criterion must match. */
export interface UrlFilter {
  hostContains?: string; hostEquals?: string; hostPrefix?: string; hostSuffix?: string;
  pathContains?: string; pathEquals?: string; pathPrefix?: string; pathSuffix?: string;
  queryContains?: string; queryEquals?: string; queryPrefix?: string; querySuffix?: string;
  urlContains?: string; urlEquals?: string; urlMatches?: string; originAndPathMatches?: string;
  urlPrefix?: string; urlSuffix?: string;
  schemes?: string[]; ports?: Array<number | [number, number]>;
}

export function urlFilterMatches(filter: UrlFilter, raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  const host = u.hostname, path = u.pathname, query = u.search.replace(/^\?/, '');
  const url = u.href.replace(/#.*$/, '');
  const str = (value: string | undefined, test: (s: string) => boolean) => value === undefined || test(value);
  const port = u.port ? Number(u.port) : ({ 'http:': 80, 'https:': 443, 'ws:': 80, 'wss:': 443, 'ftp:': 21 } as Record<string, number>)[u.protocol];
  const regex = (source: string | undefined, target: string) => {
    if (source === undefined) return true;
    try { return new RegExp(source).test(target); } catch { return false; }
  };
  return str(filter.hostContains, s => host.includes(s)) &&
    str(filter.hostEquals, s => host === s) &&
    str(filter.hostPrefix, s => host.startsWith(s)) &&
    str(filter.hostSuffix, s => host.endsWith(s)) &&
    str(filter.pathContains, s => path.includes(s)) &&
    str(filter.pathEquals, s => path === s) &&
    str(filter.pathPrefix, s => path.startsWith(s)) &&
    str(filter.pathSuffix, s => path.endsWith(s)) &&
    str(filter.queryContains, s => query.includes(s)) &&
    str(filter.queryEquals, s => query === s) &&
    str(filter.queryPrefix, s => query.startsWith(s)) &&
    str(filter.querySuffix, s => query.endsWith(s)) &&
    str(filter.urlContains, s => url.includes(s)) &&
    str(filter.urlEquals, s => url === s) &&
    str(filter.urlPrefix, s => url.startsWith(s)) &&
    str(filter.urlSuffix, s => url.endsWith(s)) &&
    regex(filter.urlMatches, url) &&
    regex(filter.originAndPathMatches, u.origin + path) &&
    (!Array.isArray(filter.schemes) || filter.schemes.includes(u.protocol.slice(0, -1))) &&
    (!Array.isArray(filter.ports) || filter.ports.some(p =>
      Array.isArray(p) ? port >= p[0] && port <= p[1] : port === p));
}

/** `{url: UrlFilter[]}` as passed to webNavigation addListener; absent = all. */
export function eventFilterMatches(filter: unknown, url: unknown): boolean {
  const list = (filter as { url?: unknown } | undefined)?.url;
  if (!Array.isArray(list)) return true;
  return typeof url === 'string' && list.some(f => f && typeof f === 'object' && urlFilterMatches(f as UrlFilter, url));
}

/** Does a granted host permission pattern cover a requested one (Chrome's permissions.contains)? */
export function patternCovers(granted: string, requested: string): boolean {
  if (granted === requested) return true;
  const parse = (p: string) => {
    if (p === '<all_urls>') return { scheme: '<all>', host: '*', path: '/*' };
    const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/(\*|\*\.[^/*]+|[^/*]*)(\/.*)$/.exec(p);
    return m ? { scheme: m[1], host: m[2].toLowerCase(), path: m[3] } : null;
  };
  const g = parse(granted), r = parse(requested);
  if (!g || !r) return false;
  const web = ['http', 'https', 'ws', 'wss'];
  const schemeOk = g.scheme === '<all>'
    ? r.scheme === '<all>' || r.scheme === '*' || [...web, 'ftp', 'file', 'urn'].includes(r.scheme)
    : g.scheme === '*' ? r.scheme === '*' || web.includes(r.scheme) : g.scheme === r.scheme;
  if (!schemeOk) return false;
  const hostOk = g.host === '*' ||
    (g.host.startsWith('*.') && (r.host === g.host || r.host === g.host.slice(2) ||
      (r.host.startsWith('*.') ? r.host.endsWith(g.host.slice(1)) : r.host.endsWith(g.host.slice(1))))) ||
    g.host === r.host;
  if (!hostOk) return false;
  return wildcardMatch(g.path, r.path);
}
