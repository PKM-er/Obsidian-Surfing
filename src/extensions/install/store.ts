// Chrome Web Store helpers. Downloads only from Google delivery hosts.
import * as https from 'node:https';
import { MAX_ARCHIVE } from './archive';
import { tr } from '../i18n/strings';

export const STORE_URL = 'https://chromewebstore.google.com/';
export const STORE_ID = /^[a-p]{32}$/;

export function getStoreId(url: string | null | undefined): string | null {
  try {
    const u = new URL(String(url));
    if (u.hostname !== 'chromewebstore.google.com' || !u.pathname.startsWith('/detail/')) return null;
    const matches = u.pathname.split('/').filter(x => STORE_ID.test(x));
    return matches.length ? matches[matches.length - 1] : null;
  } catch { return null; }
}

function isGoogleDeliveryHost(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return hostname === 'google.com' || hostname.endsWith('.google.com') ||
    hostname === 'googleusercontent.com' || hostname.endsWith('.googleusercontent.com') ||
    hostname === 'gvt1.com' || hostname.endsWith('.gvt1.com') ||
    hostname === 'gstatic.com' || hostname.endsWith('.gstatic.com');
}

export function crxDownloadUrl(id: string, chromeVersion: string): string {
  const url = new URL('https://clients2.google.com/service/update2/crx');
  url.searchParams.set('response', 'redirect');
  url.searchParams.set('prodversion', chromeVersion);
  // CRX3 only: its signatures (developer + store publisher) are verified on install.
  url.searchParams.set('acceptformat', 'crx3');
  url.searchParams.set('x', 'id=' + id + '&uc');
  return url.href;
}

export function downloadCrx(urlString: string, redirectCount = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    if (url.protocol !== 'https:' || !isGoogleDeliveryHost(url) || redirectCount > 7) {
      return reject(new Error(tr('store.unsafeRedirect')));
    }
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/142.0.0.0' }, timeout: 25000 }, response => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        const redirect = new URL(response.headers.location, url).href;
        response.resume();
        downloadCrx(redirect, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) { response.resume(); reject(new Error(tr('store.http', { status: String(status) }))); return; }
      const size = Number(response.headers['content-length']);
      if (Number.isFinite(size) && size > MAX_ARCHIVE) { response.destroy(new Error(tr('store.tooLarge'))); return; }
      let total = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_ARCHIVE) { response.destroy(new Error(tr('store.tooLarge'))); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.subarray(0, 4).toString('ascii') !== 'Cr24') reject(new Error(tr('store.notCrx')));
        else resolve(buf);
      });
    });
    req.on('timeout', () => req.destroy(new Error(tr('store.timeout'))));
    req.on('error', reject);
  });
}
