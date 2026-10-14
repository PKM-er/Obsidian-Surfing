// What an extension may receive from or ask of the host, derived from the
// manifest the user approved at install time (read by the host from disk,
// never from the extension's own messages). Everything an extension context
// receives over the channel is readable by all of its contexts, so data the
// extension is not entitled to must be withheld here, not in the compat layer.
import { matchPattern } from '../shared/url-match';
import type { NetRule } from '../shared/net-request';
import { compileRe2 } from '../shared/re2';
import type { ChromeManifest } from '../types';

export interface ChannelCapabilities {
  webNavigation: boolean;
  contextMenus: boolean;
  /** "tabs": url/title/favIconUrl of every tab. */
  tabs: boolean;
  /** "declarativeNetRequest" (block/allow/upgradeScheme anywhere). */
  netRequest: boolean;
  /** "declarativeNetRequestWithHostAccess" (every action needs host access). */
  netRequestWithHostAccess: boolean;
  /** "activeTab": the tab the user invoked the extension on. */
  activeTab: boolean;
  cookies: boolean;
  notifications: boolean;
  /** Host permission patterns (MV3 host_permissions, MV2 pattern permissions). */
  hosts: string[];
}

const HOST_PATTERN = /^(<all_urls>|(\*|[a-z][a-z0-9+.-]*):\/\/.*)$/i;

export function capabilitiesOf(manifest: ChromeManifest | null): ChannelCapabilities {
  const strings = (list: unknown) => Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  const permissions = strings(manifest?.permissions);
  const named = new Set(permissions.filter(p => !HOST_PATTERN.test(p)));
  // MV2 lists host patterns among permissions; MV3 has host_permissions.
  const hosts = [...new Set([...permissions.filter(p => HOST_PATTERN.test(p)), ...strings(manifest?.host_permissions)])];
  return {
    webNavigation: named.has('webNavigation'),
    contextMenus: named.has('contextMenus'),
    tabs: named.has('tabs'),
    netRequest: named.has('declarativeNetRequest'),
    netRequestWithHostAccess: named.has('declarativeNetRequestWithHostAccess'),
    activeTab: named.has('activeTab'),
    cookies: named.has('cookies'),
    notifications: named.has('notifications'),
    hosts
  };
}

export function sameCapabilities(a: ChannelCapabilities, b: ChannelCapabilities): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Chrome's host access: a host permission pattern matches the URL. */
export function hasHostAccess(capabilities: ChannelCapabilities, url: string | undefined): boolean {
  return !!url && capabilities.hosts.some(pattern => matchPattern(pattern, url));
}

/** Chrome exposes a tab's url/title/favIconUrl with "tabs" or host access to its URL. */
export function canSeeTab(capabilities: ChannelCapabilities, url: string | undefined): boolean {
  return capabilities.tabs || hasHostAccess(capabilities, url);
}

/**
 * Chrome's host-permission rule for one declarativeNetRequest rule on a
 * request: redirect and modifyHeaders always need host access to the request
 * URL; with only declarativeNetRequestWithHostAccess, every action does.
 */
export function netRuleAllowed(capabilities: ChannelCapabilities, rule: NetRule, url: string): boolean {
  if (!capabilities.netRequest && !capabilities.netRequestWithHostAccess) return false;
  const type = rule.action?.type;
  const needsHost = type === 'redirect' || type === 'modifyHeaders' || !capabilities.netRequest;
  return !needsHost || hasHostAccess(capabilities, url);
}

/**
 * Where a declarativeNetRequest redirect may send a Web Viewer tab: web pages
 * and the redirecting extension's own pages. Never javascript:, file:, data:,
 * Obsidian's app:// pages or another extension's pages.
 */
export function redirectTargetAllowed(target: string, extensionId: string): boolean {
  let url: URL;
  try { url = new URL(target); } catch { return false; }
  if (url.protocol === 'http:' || url.protocol === 'https:') return true;
  return url.protocol === 'chrome-extension:' && url.hostname === extensionId;
}

const MAX_REGEX_LENGTH = 2048;

/**
 * Chrome compiles regexFilter with RE2 and rejects the rule when RE2 cannot
 * (backreferences, lookaround, oversized patterns). The host matches with the
 * same linear-time semantics (shared/re2.ts), so no pattern can stall
 * Obsidian's UI thread.
 */
export function supportedRegexFilter(source: string): boolean {
  return source.length <= MAX_REGEX_LENGTH && compileRe2(source) !== null;
}

/** Usable navigation rules from an extension's announcement; anything malformed is dropped. */
export function sanitizeNetRules(rules: unknown[], max: number): NetRule[] {
  const out: NetRule[] = [];
  for (const raw of rules) {
    if (out.length >= max) break;
    const rule = raw as NetRule;
    if (!rule || !Number.isInteger(rule.id) || !rule.action || typeof rule.action.type !== 'string' ||
      !rule.condition || typeof rule.condition !== 'object') continue;
    const regex = rule.condition.regexFilter;
    if (regex !== undefined && (typeof regex !== 'string' || !supportedRegexFilter(regex))) continue;
    const filter = rule.condition.urlFilter;
    if (filter !== undefined && (typeof filter !== 'string' || filter.length > MAX_REGEX_LENGTH)) continue;
    out.push(rule);
  }
  return out;
}
