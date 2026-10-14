// Renderer-safe asynchronous ZIP/CRX extraction; no Node Worker required
// (Obsidian's renderer V8 platform may refuse to create worker_threads).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';
import type { ChromeManifest } from '../types';
import { tr, StringKey } from '../i18n/strings';

const inflateRaw = promisify(zlib.inflateRaw) as (buf: Buffer, options: zlib.ZlibOptions) => Promise<Buffer>;
export const MAX_ARCHIVE = 80 * 1024 * 1024;
const MAX_UNPACKED = 250 * 1024 * 1024;
const MAX_ITEM = 75 * 1024 * 1024;
const MAX_FILES = 4500;

/** Lets Obsidian's UI run between chunks of work (a macrotask turn; also works standalone in Node). */
const yieldToUi = () => new Promise<void>(resolve => setImmediate(resolve));

let crcTable: number[] | undefined;
async function crc32(buf: Buffer): Promise<number> {
  const table = crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 255] ^ (crc >>> 8);
    // Yield every 4 MiB to keep Obsidian's UI responsive for large entries.
    if ((i & 0x3fffff) === 0x3fffff) await yieldToUi();
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function need(ok: unknown, message: StringKey, vars?: Record<string, string | number>): asserts ok { if (!ok) throw new Error(tr(message, vars)); }
function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0, shift = 0;
  for (let i = 0; i < 10; i++) {
    need(pos < buf.length, 'crx.protobufIncomplete');
    const x = buf[pos++];
    if (shift < 53) result += (x & 127) * Math.pow(2, shift);
    if (!(x & 128)) return [result, pos];
    shift += 7;
  }
  throw new Error(tr('crx.varintTooLong'));
}
function protobufFields(buf: Buffer): Array<{ field: number; value: Buffer }> {
  const fields: Array<{ field: number; value: Buffer }> = [];
  let p = 0;
  while (p < buf.length) {
    let tag: number;
    [tag, p] = readVarint(buf, p);
    const field = Math.floor(tag / 8), type = tag % 8;
    if (type === 2) {
      let len: number;
      [len, p] = readVarint(buf, p);
      need(Number.isSafeInteger(len) && len >= 0 && p + len <= buf.length, 'crx.protobufLength');
      fields.push({ field, value: buf.subarray(p, p + len) });
      p += len;
    } else if (type === 0) {
      [, p] = readVarint(buf, p);
    } else if (type === 1 || type === 5) {
      p += type === 1 ? 8 : 4;
      need(p <= buf.length, 'crx.protobufTruncated');
    } else throw new Error(tr('crx.protobufWireType'));
  }
  return fields;
}
function idForBytes(h: Uint8Array): string {
  return Array.from(h, b => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join('');
}
export function idForKey(key: Buffer): string {
  return idForBytes(crypto.createHash('sha256').update(key).digest().subarray(0, 16));
}

/**
 * SHA-256 of the Chrome Web Store publisher key (Chromium's
 * components/crx_file/crx_verifier.cc kPublisherKeyHash). Every CRX the store
 * serves carries an ECDSA proof by this key; it was matched against a live
 * download from clients2.google.com.
 */
export const STORE_PUBLISHER_KEY_HASH = '61f7f2a6bfcf74cd0bc1fe2497cc9b04254c658f79f2145392867ea8366367cf';
const CRX3_SIGNATURE_CONTEXT = Buffer.concat([Buffer.from('CRX3 SignedData', 'ascii'), Buffer.from([0])]);
const VERIFY_CHUNK = 4 * 1024 * 1024;

/** How strictly a CRX signature is checked. */
export interface CrxPolicy {
  /** The store ID the developer key must derive (store installs). */
  expectedId: string | null;
  /** Also require a valid proof by the Chrome Web Store publisher key. */
  requirePublisherProof: boolean;
  /** Test hook: the SHA-256 (hex) of the trusted publisher key. */
  publisherKeyHash?: string;
}

/** Verifies one signature over `parts`, yielding between chunks so the UI stays responsive. */
async function verifySignature(hash: 'sha1' | 'sha256', keyType: 'rsa' | 'ec', key: Buffer, signature: Buffer, parts: Buffer[]): Promise<boolean> {
  let publicKey: crypto.KeyObject;
  try { publicKey = crypto.createPublicKey({ key, format: 'der', type: 'spki' }); } catch { return false; }
  if (publicKey.asymmetricKeyType !== keyType) return false;
  const verifier = crypto.createVerify(hash);
  for (const part of parts) {
    for (let i = 0; i < part.length; i += VERIFY_CHUNK) {
      verifier.update(part.subarray(i, i + VERIFY_CHUNK));
      if (part.length > VERIFY_CHUNK) await yieldToUi();
    }
  }
  try { return verifier.verify(publicKey, signature); } catch { return false; }
}

/**
 * Parses a CRX and verifies its signatures the way Chrome does: the proof by
 * the key that derives the extension ID must be valid, and store downloads
 * also need a valid Chrome Web Store publisher proof. Plain ZIPs pass through.
 */
async function decodeCrx(buf: Buffer, policy: CrxPolicy): Promise<{ zip: Buffer; key: Buffer | null }> {
  const expectedStoreId = policy.expectedId;
  if (buf.subarray(0, 4).toString('ascii') !== 'Cr24') {
    need(!expectedStoreId && !policy.requirePublisherProof, 'crx.storeNotCrx');
    return { zip: buf, key: null };
  }
  need(buf.length >= 16, 'crx.headerIncomplete');
  const version = buf.readUInt32LE(4);
  if (version === 2) {
    // Chrome no longer accepts CRX2 from the store; only local imports remain.
    need(!policy.requirePublisherProof, 'crx.storeNeedsCrx3');
    const pubLen = buf.readUInt32LE(8), sigLen = buf.readUInt32LE(12);
    const start = 16 + pubLen + sigLen;
    need(start <= buf.length && pubLen <= 1024 * 1024 && sigLen <= 1024 * 1024, 'crx.crx2Length');
    const key = buf.subarray(16, 16 + pubLen);
    if (expectedStoreId) need(idForKey(key) === expectedStoreId, 'crx.crx2KeyMismatch');
    const zip = buf.subarray(start);
    need(await verifySignature('sha1', 'rsa', key, buf.subarray(16 + pubLen, start), [zip]), 'crx.crx2Signature');
    return { zip, key };
  }
  need(version === 3, 'crx.version');
  const headerSize = buf.readUInt32LE(8);
  need(headerSize > 0 && headerSize < 4 * 1024 * 1024 && 12 + headerSize < buf.length, 'crx.crx3HeaderSize');
  const header = buf.subarray(12, 12 + headerSize);
  const zip = buf.subarray(12 + headerSize);
  const fields = protobufFields(header);
  // CrxFileHeader: sha256_with_rsa = 2, sha256_with_ecdsa = 3 (AsymmetricKeyProof {public_key = 1, signature = 2}).
  const proofs = fields.filter(x => x.field === 2 || x.field === 3).map(x => {
    const inner = protobufFields(x.value);
    return { keyType: x.field === 2 ? 'rsa' as const : 'ec' as const,
      key: inner.find(y => y.field === 1)?.value ?? null, signature: inner.find(y => y.field === 2)?.value ?? null };
  }).filter((p): p is { keyType: 'rsa' | 'ec'; key: Buffer; signature: Buffer } => !!p.key && !!p.signature);
  const signedField = fields.find(x => x.field === 10000);
  need(signedField, 'crx.crx3NoSignedData');
  const signedIdBytes = protobufFields(signedField.value).find(x => x.field === 1)?.value;
  need(signedIdBytes && signedIdBytes.length === 16, 'crx.crx3SignedIdFormat');
  const signedId = idForBytes(signedIdBytes);
  if (expectedStoreId) need(signedId === expectedStoreId, 'crx.crx3SignedIdMismatch');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedField.value.length, 0);
  const signedParts = [CRX3_SIGNATURE_CONTEXT, length, signedField.value, zip];
  const developer = proofs.filter(p => idForKey(p.key) === signedId);
  need(developer.length, 'crx.crx3NoMatchingKey');
  let key: Buffer | null = null;
  for (const proof of developer) {
    if (await verifySignature('sha256', proof.keyType, proof.key, proof.signature, signedParts)) { key = proof.key; break; }
  }
  need(key, 'crx.crx3DeveloperSignature');
  if (policy.requirePublisherProof) {
    const trusted = policy.publisherKeyHash ?? STORE_PUBLISHER_KEY_HASH;
    const publisher = proofs.filter(p => crypto.createHash('sha256').update(p.key).digest('hex') === trusted);
    let ok = false;
    for (const proof of publisher) {
      if (await verifySignature('sha256', proof.keyType, proof.key, proof.signature, signedParts)) { ok = true; break; }
    }
    need(ok, 'crx.crx3StoreSignature');
  }
  return { zip, key };
}
function safeName(rawName: string): string[] {
  need(rawName && !rawName.includes('\u0000'), 'zip.invalidPath');
  const name = rawName.replace(/\\/g, '/');
  need(!name.startsWith('/') && !/^[a-zA-Z]:/.test(name), 'zip.absolutePath');
  const parts = name.split('/').filter(x => x && x !== '.');
  need(parts.every(x => x !== '..'), 'zip.pathTraversal');
  // Names Windows would reinterpret: alternate data streams (a:b), device
  // names (NUL, COM1.txt) and trailing dots/spaces that alias another file.
  // eslint-disable-next-line no-control-regex -- control characters in entry names are exactly what is rejected here
  need(parts.every(x => !/[\x00-\x1f:*?"<>|]/.test(x) && !/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(x) && !/[. ]$/.test(x)),
    'zip.invalidName');
  return parts;
}
async function extractZip(buf: Buffer, destination: string): Promise<{ root: string; written: number }> {
  need(buf.length >= 22 && buf.length <= MAX_ARCHIVE, 'zip.sizeOrIncomplete');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  need(eocd >= 0, 'zip.noCentralDirectory');
  const count = buf.readUInt16LE(eocd + 10), centralSize = buf.readUInt32LE(eocd + 12), centralOffset = buf.readUInt32LE(eocd + 16);
  need(count <= MAX_FILES && centralSize !== 0xffffffff && centralOffset !== 0xffffffff, 'zip.tooManyFiles');
  need(centralOffset + centralSize <= eocd, 'zip.centralOutOfBounds');
  let p = centralOffset, total = 0, written = 0;
  await fs.promises.mkdir(destination, { recursive: true });
  for (let i = 0; i < count; i++) {
    need(p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50, 'zip.centralCorrupt');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const check = buf.readUInt32LE(p + 16), compressed = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const attrs = buf.readUInt32LE(p + 38), off = buf.readUInt32LE(p + 42);
    need(p + 46 + nameLen + extra + comment <= buf.length, 'zip.nameOutOfBounds');
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extra + comment;
    need(!(flags & 1), 'zip.encrypted');
    const unixType = (attrs >>> 16) & 0xf000;
    need(unixType !== 0xa000 && unixType !== 0x6000, 'zip.symlink');
    need(compressed <= MAX_ARCHIVE && size <= MAX_ITEM && total + size <= MAX_UNPACKED, 'zip.tooLarge');
    total += size;
    const parts = safeName(name);
    if (parts.length === 0) continue;
    const target = path.join(destination, ...parts);
    need(target.startsWith(destination + path.sep), 'zip.outOfBounds');
    if (name.endsWith('/')) { await fs.promises.mkdir(target, { recursive: true }); continue; }
    need(off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50, 'zip.localHeaderCorrupt');
    const dataAt = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    need(dataAt + compressed <= buf.length, 'zip.dataOutOfBounds');
    let data: Buffer;
    const input = buf.subarray(dataAt, dataAt + compressed);
    if (method === 0) data = input;
    else if (method === 8) data = await inflateRaw(input, { maxOutputLength: size + 1 });
    else throw new Error(tr('zip.unsupportedMethod', { method }));
    need(data.length === size && (await crc32(data)) === check, 'zip.checksum', { name });
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, data, { flag: 'wx' });
    written++;
  }
  let root = destination;
  // Some third-party archives contain one top-level folder.
  if (!fs.existsSync(path.join(root, 'manifest.json'))) {
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory());
    if (dirs.length === 1 && fs.existsSync(path.join(root, dirs[0].name, 'manifest.json'))) root = path.join(root, dirs[0].name);
  }
  need(fs.existsSync(path.join(root, 'manifest.json')), 'archive.noManifest');
  return { root, written };
}

export interface UnpackedArchive { root: string; count: number; manifest: ChromeManifest; derivedId: string | null }

export async function unpackArchive({ archive, directory, expectedId = null, requirePublisherProof = false, publisherKeyHash }:
  { archive: string; directory: string; expectedId?: string | null; requirePublisherProof?: boolean; publisherKeyHash?: string }): Promise<UnpackedArchive> {
  const info = await fs.promises.stat(archive);
  need(info.isFile() && info.size <= MAX_ARCHIVE, 'archive.tooLarge');
  await fs.promises.mkdir(directory, { recursive: true });
  const { zip, key } = await decodeCrx(await fs.promises.readFile(archive), { expectedId, requirePublisherProof, publisherKeyHash });
  const result = await extractZip(zip, directory);
  const file = path.join(result.root, 'manifest.json');
  const manifest = JSON.parse(await fs.promises.readFile(file, 'utf8')) as ChromeManifest;
  need(manifest && [2, 3].includes(manifest.manifest_version) && typeof manifest.version === 'string', 'archive.invalidManifest');
  if (key) {
    if (manifest.key) need(idForKey(Buffer.from(manifest.key, 'base64')) === idForKey(key), 'archive.keyMismatch');
    else {
      manifest.key = key.toString('base64');
      await fs.promises.writeFile(file, JSON.stringify(manifest, null, 2));
    }
  }
  return { root: result.root, count: result.written, manifest, derivedId: key ? idForKey(key) : null };
}
