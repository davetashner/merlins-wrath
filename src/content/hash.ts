// Content hash (mw-e00.18): one fingerprint of all loaded content, so saves and replays can tell
// whether they were recorded against the same data. It is computed over canonical JSON (object keys
// sorted, entries sorted by type then id), so file names, file order and key order never change it;
// any change to a value, including a schema default, does.

/**
 * Canonical JSON: like `JSON.stringify` but with object keys sorted and `undefined` properties
 * dropped. Class instances (e.g. `ContentRef`) serialise as their own enumerable fields.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const fields = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value);
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** 64-bit FNV-1a over the UTF-8 bytes of `text`, as 16 lowercase hex digits. Not cryptographic. */
export function fnv1a64(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}
