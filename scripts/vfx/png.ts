// A minimal PNG codec for the placeholder VFX textures (mw-e29.2): 8-bit RGBA, no interlace, every
// row unfiltered, one IDAT chunk compressed with zlib at a fixed level, so the same pixels always
// encode to the same bytes on one Node build. `decodePng` reads back what `encodePng` writes (and
// any PNG of that shape), so the check can compare pixels rather than compressed bytes: zlib builds
// may compress identical data differently across platforms.

import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** `items[i]` for an index known to be in range. */
const at = <T>(items: ArrayLike<T>, i: number): T => items[i] as T;

/** CRC-32 (ISO 3309) lookup table. */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 of `bytes`. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = at(CRC_TABLE, (c ^ byte) & 0xff) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An RGBA image: `width × height × 4` bytes, rows top to bottom. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

/** Encodes an RGBA image as a PNG. */
export function encodePng({ width, height, pixels }: RgbaImage): Uint8Array {
  if (pixels.length !== width * height * 4) {
    throw new RangeError(
      `expected ${String(width * height * 4)} bytes, got ${String(pixels.length)}`,
    );
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA, deflate, no filter method extras, no interlace
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const data = new Uint8Array(deflateSync(raw, { level: 9 }));
  const parts = [
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', data),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Decodes an 8-bit RGBA, non-interlaced PNG whose rows are unfiltered (what `encodePng` writes). */
export function decodePng(bytes: Uint8Array): RgbaImage {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  for (let offset = SIGNATURE.length; offset + 8 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const [depth, colour, , , interlace] = data.subarray(8, 13);
      if (depth !== 8 || colour !== 6 || interlace !== 0) {
        throw new Error('only 8-bit RGBA non-interlaced PNGs are supported');
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  if (raw.length !== (stride + 1) * height) throw new Error('PNG data is truncated');
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    if (raw[y * (stride + 1)] !== 0) throw new Error('only unfiltered PNG rows are supported');
    pixels.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, pixels };
}

/**
 * Whether two PNGs hold the same image: same size and every channel within ±1, so a last-bit
 * difference in Math between Node builds (or a different zlib) doesn't read as drift.
 */
export function samePng(a: Uint8Array, b: Uint8Array): boolean {
  let x: RgbaImage;
  let y: RgbaImage;
  try {
    x = decodePng(a);
    y = decodePng(b);
  } catch {
    return false;
  }
  if (x.width !== y.width || x.height !== y.height) return false;
  for (let i = 0; i < x.pixels.length; i++) {
    if (Math.abs(at(x.pixels, i) - at(y.pixels, i)) > 1) return false;
  }
  return true;
}
