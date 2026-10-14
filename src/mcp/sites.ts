// Site patterns and the access decision for a hostname. Pure: no Obsidian or
// Electron here, so the rules can be tested on their own.

export type SiteAccess = "ask" | "allow";

export interface SiteRules {
	siteAccess: SiteAccess;
	approvedSites: string[];
	blockedSites: string[];
}

/** The lowercase hostname of a URL, or "" when it has none (about:blank, data:, junk). */
export function hostOf(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
		return parsed.hostname.toLowerCase().replace(/\.$/, "");
	} catch {
		return "";
	}
}

/** What a user typed in a site list ("https://Example.com/x", "*.example.com") as a pattern. */
export function normalizePattern(entry: string): string {
	let pattern = entry.trim().toLowerCase();
	if (!pattern) return "";
	if (pattern.includes("://")) {
		const host = hostOf(pattern);
		if (host) return host;
		pattern = pattern.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
	}
	pattern = pattern.replace(/[/?#].*$/, "").replace(/:\d+$/, "");
	return pattern.replace(/\.$/, "");
}

/**
 * Does a hostname match a pattern? "example.com" matches that host only;
 * "*.example.com" matches the host itself and every subdomain.
 */
export function hostMatches(host: string, pattern: string): boolean {
	const wanted = normalizePattern(pattern);
	if (!host || !wanted) return false;
	if (wanted.startsWith("*.")) {
		const base = wanted.slice(2);
		return !!base && (host === base || host.endsWith("." + base));
	}
	return host === wanted;
}

/**
 * Blocking is wider than approving: a blocked "example.com" also blocks its
 * subdomains, so a site cannot be reached through a sibling host.
 */
export function isBlockedHost(host: string, blockedSites: string[]): boolean {
	if (!host) return false;
	return blockedSites.some((entry) => {
		const pattern = normalizePattern(entry);
		if (!pattern) return false;
		const base = pattern.startsWith("*.") ? pattern.slice(2) : pattern;
		return !!base && (host === base || host.endsWith("." + base));
	});
}

export function isApprovedHost(host: string, approvedSites: string[]): boolean {
	return approvedSites.some((pattern) => hostMatches(host, pattern));
}

export type Decision = "blocked" | "allowed" | "ask";

/**
 * What to do before a tool reads or acts on a page of `host`. A page without
 * a host (a blank tab) needs no approval. Hosts revoked for this session ask
 * again, whatever the settings say.
 */
export function decideAccess(
	host: string,
	rules: SiteRules,
	session: { approved: ReadonlySet<string>; revoked: ReadonlySet<string> },
): Decision {
	if (!host) return "allowed";
	if (isBlockedHost(host, rules.blockedSites)) return "blocked";
	if (session.revoked.has(host)) return "ask";
	if (rules.siteAccess === "allow") return "allowed";
	if (session.approved.has(host)) return "allowed";
	if (isApprovedHost(host, rules.approvedSites)) return "allowed";
	return "ask";
}

/** Only web pages can be opened or navigated to by an agent. */
export function isWebUrl(url: string): boolean {
	return hostOf(url) !== "";
}

/** Turn what an agent passes as `url` into an absolute http(s) URL, or null. */
export function toWebUrl(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[^/]*:\d+(\/|$)/.test(trimmed)
		? trimmed
		: "https://" + trimmed;
	try {
		const parsed = new URL(candidate);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
		return parsed.href;
	} catch {
		return null;
	}
}
