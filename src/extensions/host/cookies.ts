// chrome.cookies on the Web Viewer session (Electron's session.cookies). As in
// Chrome, an extension needs the "cookies" permission and host access to a
// cookie's URL to read, write or be told about it.
import type { CookieDetails } from '../shared/protocol';
import { ChannelCapabilities, hasHostAccess } from './grants';
import { text } from '../shared/text';
import { tr } from '../i18n/strings';
import type * as Electron from 'electron';

const STORE_ID = '0';
type SameSite = CookieDetails['sameSite'];
const SAME_SITE: readonly string[] = ['no_restriction', 'lax', 'strict', 'unspecified'] satisfies SameSite[];
const isSameSite = (v: unknown): v is SameSite => typeof v === 'string' && SAME_SITE.includes(v);

/** Electron's Cookie → chrome.cookies.Cookie. */
export function toChromeCookie(c: Electron.Cookie): CookieDetails {
  const cookie: CookieDetails = {
    name: c.name ?? '', value: c.value ?? '', domain: c.domain ?? '',
    hostOnly: !!c.hostOnly, path: c.path ?? '/', secure: !!c.secure, httpOnly: !!c.httpOnly,
    sameSite: c.sameSite ?? 'unspecified', session: !!c.session, storeId: STORE_ID
  };
  if (!cookie.session && typeof c.expirationDate === 'number') cookie.expirationDate = c.expirationDate;
  return cookie;
}

/** A URL a cookie applies to, for host-permission checks. */
export function cookieUrl(cookie: { domain: string; path: string; secure: boolean }): string {
  const host = cookie.domain.replace(/^\./, '');
  return `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`;
}

/** Host access to a cookie: its URL over http or https (Chrome checks the cookie's domain). */
export function canAccessCookie(capabilities: ChannelCapabilities, cookie: { domain: string; path: string; secure: boolean }): boolean {
  const host = cookie.domain.replace(/^\./, '');
  const path = cookie.path || '/';
  return hasHostAccess(capabilities, `https://${host}${path}`) || (!cookie.secure && hasHostAccess(capabilities, `http://${host}${path}`));
}

function requireUrl(capabilities: ChannelCapabilities, raw: unknown): string {
  if (!capabilities.cookies) throw new Error(tr('error.noPermission', { permission: 'cookies' }));
  if (typeof raw !== 'string' || raw.length > 8192) throw new Error('Invalid url.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid url: ' + raw); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid url: ' + raw);
  if (!hasHostAccess(capabilities, url.href)) throw new Error(`No host permissions for cookies at url: "${url.href}".`);
  return url.href;
}

const storeOk = (storeId: unknown) => storeId === undefined || storeId === STORE_ID;
const limited = (v: unknown, max = 4096) => typeof v === 'string' && v.length <= max ? v : undefined;

export async function getCookie(cookies: Electron.Cookies, capabilities: ChannelCapabilities, params: Record<string, unknown>): Promise<CookieDetails | null> {
  const url = requireUrl(capabilities, params.url);
  const name = limited(params.name);
  if (name === undefined || !storeOk(params.storeId)) return null;
  const list = await cookies.get({ url, name });
  // Chrome returns the one with the longest path, then the earliest created.
  list.sort((a, b) => (b.path ?? '').length - (a.path ?? '').length);
  return list.length ? toChromeCookie(list[0]) : null;
}

export async function getAllCookies(cookies: Electron.Cookies, capabilities: ChannelCapabilities, params: Record<string, unknown>): Promise<CookieDetails[]> {
  if (!capabilities.cookies) throw new Error(tr('error.noPermission', { permission: 'cookies' }));
  if (!storeOk(params.storeId)) return [];
  const filter: Electron.CookiesGetFilter = {};
  if (params.url !== undefined) filter.url = requireUrl(capabilities, params.url);
  for (const key of ['name', 'domain', 'path'] as const) { const v = limited(params[key]); if (v !== undefined) filter[key] = v; }
  for (const key of ['secure', 'session'] as const) if (typeof params[key] === 'boolean') filter[key] = params[key];
  const list = await cookies.get(filter);
  return list.map(toChromeCookie).filter(c => canAccessCookie(capabilities, c));
}

export async function setCookie(cookies: Electron.Cookies, capabilities: ChannelCapabilities, params: Record<string, unknown>): Promise<CookieDetails | null> {
  const url = requireUrl(capabilities, params.url);
  if (!storeOk(params.storeId)) throw new Error('Invalid cookie store id.');
  const details: Electron.CookiesSetDetails = { url };
  for (const key of ['name', 'value', 'domain', 'path'] as const) { const v = limited(params[key]); if (v !== undefined) details[key] = v; }
  for (const key of ['secure', 'httpOnly'] as const) if (typeof params[key] === 'boolean') details[key] = params[key];
  if (typeof params.expirationDate === 'number' && Number.isFinite(params.expirationDate)) details.expirationDate = params.expirationDate;
  if (isSameSite(params.sameSite)) details.sameSite = params.sameSite;
  // A domain cookie may not widen access beyond what the extension may touch.
  if (typeof details.domain === 'string' && !canAccessCookie(capabilities, { domain: details.domain, path: text(details.path, '/'), secure: !!details.secure })) {
    throw new Error(`No host permissions for cookies at domain: "${details.domain}".`);
  }
  await cookies.set(details);
  const name = text(details.name);
  const list = await cookies.get({ url, name });
  return list.length ? toChromeCookie(list[0]) : null;
}

export async function removeCookie(cookies: Electron.Cookies, capabilities: ChannelCapabilities, params: Record<string, unknown>): Promise<{ url: string; name: string; storeId: string } | null> {
  const url = requireUrl(capabilities, params.url);
  const name = limited(params.name);
  if (name === undefined || !storeOk(params.storeId)) return null;
  await cookies.remove(url, name);
  return { url, name, storeId: STORE_ID };
}
