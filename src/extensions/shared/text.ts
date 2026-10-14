/**
 * The text of an untrusted value: strings, numbers, booleans and URLs as
 * themselves, anything else as `fallback` (never "[object Object]").
 */
export function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof URL === 'function' && value instanceof URL) return value.href;
  return fallback;
}
