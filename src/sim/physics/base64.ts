// Base64 (RFC 4648, standard alphabet, padded) for binary engine state inside plain-data snapshots
// (mw-e03.35). The sim has no DOM `btoa`/`atob` or Node `Buffer`, and both would differ between
// hosts anyway; this is a few lines of integer arithmetic that behave the same everywhere.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DECODE = new Map(Array.from({ length: 64 }, (_, index) => [ALPHABET.charAt(index), index]));

/** The base64 text of `bytes`. */
export function encodeBase64(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const byte = (at: number): number => (at < bytes.length ? view.getUint8(at) : 0);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const bits = (byte(i) << 16) | (byte(i + 1) << 8) | byte(i + 2);
    out += ALPHABET.charAt(bits >>> 18);
    out += ALPHABET.charAt((bits >>> 12) & 63);
    out += i + 1 < bytes.length ? ALPHABET.charAt((bits >>> 6) & 63) : '=';
    out += i + 2 < bytes.length ? ALPHABET.charAt(bits & 63) : '=';
  }
  return out;
}

/**
 * The bytes of base64 `text` (padded, standard alphabet).
 * @throws RangeError when `text` is not canonical padded base64.
 */
export function decodeBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0) throw new RangeError('base64 length must be a multiple of 4');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  for (let i = 0, at = 0; i < text.length; i += 4) {
    let bits = 0;
    for (let j = 0; j < 4; j++) {
      const char = text.charAt(i + j);
      const inPadding = char === '=' && i + 4 === text.length && j >= 4 - padding;
      const value = inPadding ? 0 : DECODE.get(char);
      if (value === undefined) throw new RangeError(`invalid base64 character at ${String(i + j)}`);
      bits = (bits << 6) | value;
    }
    for (let k = 16; k >= 0 && at < out.length; k -= 8) out[at++] = (bits >>> k) & 0xff;
  }
  return out;
}
