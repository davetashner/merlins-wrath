// Canonical decoder for save files (mw-e30.1). Saves are written with the sim's canonical encoder
// (`encodeCanonical`, src/sim/snapshot.ts) so a save body and the state hash share one byte form and
// every number survives exactly (-0, NaN, ±Infinity — which JSON would silently corrupt). The sim only
// ever needs to encode, so the inverse lives here, beside its only consumer. It mirrors the layout
// documented in snapshot.ts (SNAPSHOT_ENCODING_VERSION 1) and is strict: it accepts only bytes the
// encoder could have produced (known tags, in-bounds lengths, strictly ascending object keys, no
// trailing bytes), so a damaged save fails loudly instead of decoding into plausible garbage.

/** The canonical-encoding version this decoder reads (must equal SNAPSHOT_ENCODING_VERSION). */
export const DECODER_ENCODING_VERSION = 1;

/** Thrown when bytes are not a canonical encoding; `offset` is where decoding stopped. */
export class CanonicalDecodeError extends Error {
  override readonly name = 'CanonicalDecodeError';

  constructor(
    readonly offset: number,
    reason: string,
  ) {
    super(`invalid canonical bytes at offset ${String(offset)}: ${reason}`);
  }
}

const TAG_NULL = 0x00;
const TAG_FALSE = 0x01;
const TAG_TRUE = 0x02;
const TAG_NUMBER = 0x03;
const TAG_STRING = 0x04;
const TAG_ARRAY = 0x05;
const TAG_OBJECT = 0x06;

class Reader {
  private at = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset(): number {
    return this.at;
  }

  get done(): boolean {
    return this.at === this.bytes.length;
  }

  private need(count: number): number {
    const start = this.at;
    if (start + count > this.bytes.length) throw new CanonicalDecodeError(start, 'truncated');
    this.at += count;
    return start;
  }

  u8(): number {
    return this.view.getUint8(this.need(1));
  }

  u32(): number {
    return this.view.getUint32(this.need(4));
  }

  f64(): number {
    return this.view.getFloat64(this.need(8));
  }

  /** A string body: u32 code-unit count, then each code unit big-endian. */
  string(): string {
    const count = this.u32();
    const start = this.need(count * 2);
    const units = new Array<number>(count);
    for (let i = 0; i < count; i++) units[i] = this.view.getUint16(start + i * 2);
    // Chunked so very long strings never exceed the engine's argument limit.
    let text = '';
    for (let i = 0; i < count; i += 8192) {
      text += String.fromCharCode(...units.slice(i, i + 8192));
    }
    return text;
  }
}

function value(reader: Reader): unknown {
  const offset = reader.offset;
  const tag = reader.u8();
  switch (tag) {
    case TAG_NULL:
      return null;
    case TAG_FALSE:
      return false;
    case TAG_TRUE:
      return true;
    case TAG_NUMBER:
      return reader.f64();
    case TAG_STRING:
      return reader.string();
    case TAG_ARRAY: {
      const length = reader.u32();
      const items: unknown[] = [];
      for (let i = 0; i < length; i++) items.push(value(reader));
      return items;
    }
    case TAG_OBJECT:
      return object(reader);
    default:
      throw new CanonicalDecodeError(offset, `unknown tag 0x${tag.toString(16)}`);
  }
}

function object(reader: Reader): Record<string, unknown> {
  const count = reader.u32();
  const result: Record<string, unknown> = {};
  let previous: string | undefined;
  for (let i = 0; i < count; i++) {
    const offset = reader.offset;
    const key = reader.string();
    if (previous !== undefined && !(previous < key)) {
      throw new CanonicalDecodeError(offset, 'object keys are not strictly ascending');
    }
    previous = key;
    // defineProperty, so a "__proto__" key stays an own data property instead of a prototype.
    Object.defineProperty(result, key, {
      value: value(reader),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

/**
 * Decodes canonical bytes (as written by `encodeCanonical`) back to the plain value: null, booleans,
 * numbers (bit-exact, NaN canonical), strings, arrays and plain objects.
 * @throws CanonicalDecodeError when the bytes are not exactly one canonical value.
 */
export function decodeCanonical(bytes: Uint8Array): unknown {
  const reader = new Reader(bytes);
  const result = value(reader);
  if (!reader.done) throw new CanonicalDecodeError(reader.offset, 'trailing bytes');
  return result;
}
