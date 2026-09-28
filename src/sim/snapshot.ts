// Canonical sim state encoding, hashing and diffing (mw-e00.16). Replays, save verification and
// desync debugging all need one fingerprint of world state that is identical for identical state,
// however that state was built. `World.snapshot()` already yields plain data in ascending entity-id
// order with sorted component and stream names; this module turns any such plain value into one
// canonical byte string, hashes it with xxHash32 (integer ops only, so browser and Node agree), and
// names the first differing entity/component/field when two snapshots disagree.
//
// Canonical form (SNAPSHOT_ENCODING_VERSION 1), a tag-length-value byte string:
//   null 0x00 · false 0x01 · true 0x02
//   number 0x03 + 8 bytes: the IEEE-754 binary64 bits, big-endian. Every number (integer or not, any
//     magnitude) is encoded exactly by its bits. -0 and +0 stay distinct (they behave differently:
//     1 / -0 is -Infinity). Every NaN is canonicalised to 0x7ff8_0000_0000_0000: payloads can differ
//     between engines and operations and carry no game meaning.
//   string 0x04 + u32 UTF-16 code-unit count + each code unit as u16 big-endian.
//   array 0x05 + u32 length + each element.
//   object 0x06 + u32 key count + (key as a string body, value) pairs, keys sorted by code unit, so
//     key insertion order never matters (component fields have no declared schema order, so sorted
//     order is the canonical one). Only plain objects (prototype Object.prototype or null) and their
//     own enumerable string keys are encoded.
// Anything else — undefined, functions, symbols, bigints, class instances (Map, Set, Date…), array
// holes and cycles — throws CanonicalEncodingError naming the path, rather than being silently
// dropped the way JSON.stringify would. A snapshot is prefixed with a 4-byte format tag "VBS" + 1;
// its body is exactly the canonical form of the WorldSnapshot object (written by a fast path).

import type { EntityId } from './core/component';
import type { World, WorldSnapshot } from './core/world';
import { DEFAULT_DIFFICULTY } from './difficulty';

/** Bumped whenever the canonical byte layout changes (it invalidates every stored hash). */
export const SNAPSHOT_ENCODING_VERSION = 1;

/** Thrown for values the canonical form cannot represent; `path` locates the offending value. */
export class CanonicalEncodingError extends Error {
  override readonly name = 'CanonicalEncodingError';

  constructor(
    /** Where the value sits, e.g. `$.components.Position[3][1].x` (`$` is the root). */
    readonly path: string,
    reason: string,
  ) {
    super(`cannot canonically encode ${path}: ${reason}`);
  }
}

const TAG_NULL = 0x00;
const TAG_FALSE = 0x01;
const TAG_TRUE = 0x02;
const TAG_NUMBER = 0x03;
const TAG_STRING = 0x04;
const TAG_ARRAY = 0x05;
const TAG_OBJECT = 0x06;

/** Code-unit order for map entries with unique keys; locale-independent. */
const byKey = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number =>
  a < b ? -1 : 1;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** One path segment as it reads in a JS accessor chain. */
function segment(key: string | number): string {
  if (typeof key === 'number') return `[${String(key)}]`;
  return IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Own enumerable keys in code-unit order. Most objects are written with their keys already in order,
 * and checking is far cheaper than sorting, so sort only when needed.
 */
function sortedKeys(value: object): string[] {
  const keys = Object.keys(value);
  let previous = ''; // no key sorts before ''
  for (const key of keys) {
    if (previous > key) return keys.sort();
    previous = key;
  }
  return keys;
}

/** A growable byte buffer with the few big-endian writes the encoding needs. */
class ByteWriter {
  private bytes = new Uint8Array(1 << 16);
  private data = new DataView(this.bytes.buffer);
  length = 0;

  private reserve(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < needed) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes);
    this.bytes = next;
    this.data = new DataView(next.buffer);
  }

  u8(value: number): void {
    this.reserve(1);
    this.bytes[this.length++] = value;
  }

  /** A tag byte and a u32 count (array length, key count). */
  header(tag: number, count: number): void {
    this.reserve(5);
    this.bytes[this.length] = tag;
    this.data.setUint32(this.length + 1, count);
    this.length += 5;
  }

  /** TAG_NUMBER and the binary64 bits, NaN canonicalised. */
  number(value: number): void {
    this.reserve(9);
    this.bytes[this.length] = TAG_NUMBER;
    if (Number.isNaN(value)) {
      this.data.setUint32(this.length + 1, 0x7ff8_0000);
      this.data.setUint32(this.length + 5, 0);
    } else {
      this.data.setFloat64(this.length + 1, value);
    }
    this.length += 9;
  }

  /** A string body (no tag): u32 code-unit count, then each code unit big-endian. */
  string(value: string): void {
    this.reserve(4 + value.length * 2);
    const bytes = this.bytes;
    this.data.setUint32(this.length, value.length);
    let at = this.length + 4;
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      bytes[at++] = unit >>> 8;
      bytes[at++] = unit & 0xff;
    }
    this.length = at;
  }

  /** The bytes written so far, as a view (no copy) valid until the next write. */
  view(): Uint8Array {
    return this.bytes.subarray(0, this.length);
  }
}

/** An encoding failure on its way up; frames append their key so the path costs nothing on success. */
class EncodeFailure extends Error {
  /** Path segments, innermost first. */
  readonly segments: (string | number)[] = [];
}

/** Adds `segments` (outermost first) to a failure passing through; other errors pass untouched. */
function within(error: unknown, ...segments: (string | number)[]): void {
  if (error instanceof EncodeFailure) error.segments.push(...segments.reverse());
}

/** Depth-first canonical encoder. Keeps the current ancestors (a short array) to reject cycles. */
class Encoder {
  readonly out = new ByteWriter();
  private readonly ancestors: object[] = [];

  value(value: unknown): void {
    switch (typeof value) {
      case 'boolean':
        this.out.u8(value ? TAG_TRUE : TAG_FALSE);
        break;
      case 'number':
        this.out.number(value);
        break;
      case 'string':
        this.out.u8(TAG_STRING);
        this.out.string(value);
        break;
      case 'object':
        if (value === null) this.out.u8(TAG_NULL);
        else this.object(value);
        break;
      default:
        throw new EncodeFailure(`${typeof value} is not serialisable`);
    }
  }

  /**
   * A WorldSnapshot, byte-identical to `value(snapshot)` but without the generic per-row overhead:
   * rows and id lists are written directly (this is the state-hash hot path).
   */
  snapshot(snapshot: WorldSnapshot): void {
    const out = this.out;
    // clock, components, [difficulty], entities, nextEntity, rng, seed — in code-unit order
    const { difficulty } = snapshot;
    out.header(TAG_OBJECT, difficulty === undefined ? 6 : 7);
    this.field('clock', snapshot.clock);
    out.string('components');
    const components = Object.entries(snapshot.components).sort(byKey);
    out.header(TAG_OBJECT, components.length);
    for (const [name, rows] of components) {
      out.string(name);
      out.header(TAG_ARRAY, rows.length);
      rows.forEach(([id, data], i) => {
        out.header(TAG_ARRAY, 2);
        out.number(id);
        try {
          this.value(data);
        } catch (error) {
          within(error, 'components', name, i, 1);
          throw error;
        }
      });
    }
    if (difficulty !== undefined) this.field('difficulty', difficulty);
    this.field('entities', snapshot.entities);
    this.field('nextEntity', snapshot.nextEntity);
    this.field('rng', snapshot.rng);
    this.field('seed', snapshot.seed);
  }

  private field(key: string, value: unknown): void {
    this.out.string(key);
    this.child(key, value);
  }

  private object(value: object): void {
    if (this.ancestors.includes(value)) throw new EncodeFailure('cycle detected');
    this.ancestors.push(value);
    if (Array.isArray(value)) {
      this.out.header(TAG_ARRAY, value.length);
      for (let i = 0; i < value.length; i++) this.child(i, value[i]);
    } else if (isPlainObject(value)) {
      const keys = sortedKeys(value);
      this.out.header(TAG_OBJECT, keys.length);
      for (const key of keys) {
        this.out.string(key);
        this.child(key, value[key]);
      }
    } else {
      const kind = (value.constructor as { name?: string } | undefined)?.name ?? 'exotic';
      throw new EncodeFailure(`${kind} is not a plain object or array`);
    }
    this.ancestors.pop();
  }

  private child(key: string | number, value: unknown): void {
    try {
      this.value(value);
    } catch (error) {
      within(error, key);
      throw error;
    }
  }
}

/** Runs an encoding, turning an internal failure into a CanonicalEncodingError with its path. */
function encodeWith(write: (encoder: Encoder) => void): ByteWriter {
  const encoder = new Encoder();
  try {
    write(encoder);
  } catch (error) {
    if (!(error instanceof EncodeFailure)) throw error;
    const path = `$${error.segments.reverse().map(segment).join('')}`;
    throw new CanonicalEncodingError(path, error.message);
  }
  return encoder.out;
}

/**
 * The canonical bytes of a plain value (see the file header for the exact layout). Equal values give
 * equal bytes regardless of object key insertion order.
 * @throws CanonicalEncodingError for values with no canonical form.
 */
export function encodeCanonical(value: unknown): Uint8Array {
  return encodeWith((encoder) => {
    encoder.value(value);
  })
    .view()
    .slice();
}

const SNAPSHOT_MAGIC = [0x56, 0x42, 0x53, SNAPSHOT_ENCODING_VERSION]; // "VBS" + version

/**
 * The canonical bytes of a world snapshot: the 4-byte tag "VBS" + SNAPSHOT_ENCODING_VERSION, then the
 * snapshot's fields as a canonical value. Save files reuse this (mw-e30.1).
 * @throws CanonicalEncodingError when a component row holds a value with no canonical form.
 */
export function encodeSnapshot(snapshot: WorldSnapshot): Uint8Array {
  return snapshotBytes(snapshot).slice();
}

/** Canonical snapshot bytes as a view into the encoder's buffer (hashing needs no copy). */
function snapshotBytes(snapshot: WorldSnapshot): Uint8Array {
  return encodeWith((encoder) => {
    for (const byte of SNAPSHOT_MAGIC) encoder.out.u8(byte);
    encoder.snapshot(snapshot);
  }).view();
}

const P1 = 0x9e37_79b1;
const P2 = 0x85eb_ca77;
const P3 = 0xc2b2_ae3d;
const P4 = 0x27d4_eb2f;
const P5 = 0x1656_67b1;

const rotl = (x: number, k: number): number => (x << k) | (x >>> (32 - k));

const round = (acc: number, input: number): number =>
  Math.imul(rotl((acc + Math.imul(input, P2)) | 0, 13), P1);

/**
 * xxHash32 of `bytes` (unsigned 32-bit result), bit-exact with the reference implementation. Pure
 * integer arithmetic: no Node crypto or WebCrypto, so it runs identically everywhere.
 */
export function xxHash32(bytes: Uint8Array, seed = 0): number {
  const len = bytes.length;
  const view = new DataView(bytes.buffer, bytes.byteOffset, len);
  const word = (at: number): number => view.getUint32(at, true); // little-endian, as the reference
  let i = 0;
  let h: number;
  if (len >= 16) {
    let v1 = (seed + P1 + P2) | 0;
    let v2 = (seed + P2) | 0;
    let v3 = seed | 0;
    let v4 = (seed - P1) | 0;
    for (const limit = len - 16; i <= limit; i += 16) {
      v1 = round(v1, word(i));
      v2 = round(v2, word(i + 4));
      v3 = round(v3, word(i + 8));
      v4 = round(v4, word(i + 12));
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) | 0;
  } else {
    h = (seed + P5) | 0;
  }
  h = (h + len) | 0;
  for (; i + 4 <= len; i += 4) {
    h = Math.imul(rotl((h + Math.imul(word(i), P3)) | 0, 17), P4);
  }
  for (; i < len; i++) {
    h = Math.imul(rotl((h + Math.imul(view.getUint8(i), P5)) | 0, 11), P1);
  }
  h = Math.imul(h ^ (h >>> 15), P2);
  h = Math.imul(h ^ (h >>> 13), P3);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A snapshot's state hash: xxHash32 of its canonical bytes as 8 lowercase hex digits. */
export function hashSnapshot(snapshot: WorldSnapshot): string {
  return xxHash32(snapshotBytes(snapshot)).toString(16).padStart(8, '0');
}

/**
 * The state hash of a world's current state: `hashSnapshot(world.snapshot())`, but taken from a
 * shared (uncopied) snapshot, since hashing only reads it.
 */
export function hashWorld(world: Pick<World, 'snapshot'>): string {
  return hashSnapshot(world.snapshot({ shared: true }));
}

/** The first place two snapshots disagree; `a`/`b` are the differing values (undefined = absent). */
export interface SnapshotDifference {
  readonly section:
    'seed' | 'clock' | 'difficulty' | 'nextEntity' | 'entities' | 'components' | 'rng';
  /** Human-readable location, e.g. `components.Position[7].x` or `entities[12]`. */
  readonly path: string;
  /** The entity involved, for `entities` and `components` differences. */
  readonly entity?: EntityId;
  /** The component involved, for `components` differences. */
  readonly component?: string;
  /** The RNG stream involved, for `rng` differences. */
  readonly stream?: string;
  /**
   * Field path inside the component value, clock/RNG state or difficulty (`x`, `pos.y`, `[2]`,
   * `damageTaken`); `''` when the
   * whole value differs (e.g. present in one snapshot only). Absent for `seed`, `nextEntity` and
   * `entities`.
   */
  readonly field?: string;
  readonly a: unknown;
  readonly b: unknown;
}

interface ValueDifference {
  readonly field: string;
  readonly a: unknown;
  readonly b: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Code-unit-sorted union of two key lists. */
const unionKeys = (a: readonly string[], b: readonly string[]): string[] =>
  [...new Set([...a, ...b])].sort();

/**
 * First difference between two plain values under the canonical rules (all NaNs equal, -0 ≠ +0,
 * key order irrelevant), with its field path, or undefined when they encode identically.
 */
function firstValueDifference(a: unknown, b: unknown, at = ''): ValueDifference | undefined {
  if (Object.is(a, b)) return undefined;
  const differ = { field: at.startsWith('.') ? at.slice(1) : at, a, b };
  if (!isObject(a) || !isObject(b)) return differ;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return differ;
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) {
      const found = firstValueDifference(a[i], b[i], at + segment(i));
      if (found) return found;
    }
    return a.length === b.length ? undefined : differ;
  }
  for (const key of unionKeys(Object.keys(a), Object.keys(b))) {
    const found = firstValueDifference(a[key], b[key], at + segment(key));
    if (found) return found;
  }
  return undefined;
}

/** The lowest id only one of two entity lists contains, and which side has it. */
function firstEntityDifference(
  a: readonly EntityId[],
  b: readonly EntityId[],
): { id: EntityId; inA: boolean } | undefined {
  const inA = new Set(a);
  const inB = new Set(b);
  for (const id of [...new Set([...a, ...b])].sort((x, y) => x - y)) {
    if (inA.has(id) !== inB.has(id)) return { id, inA: inA.has(id) };
  }
  return undefined;
}

/** `.x` / `[2]` / `` suffix for a field path as reported in SnapshotDifference.field. */
const fieldSuffix = (field: string): string =>
  field === '' || field.startsWith('[') ? field : `.${field}`;

type Rows = readonly (readonly [EntityId, unknown])[];

function firstRowDifference(name: string, a: Rows, b: Rows): SnapshotDifference | undefined {
  const inA = new Map(a);
  const inB = new Map(b);
  const ids = [...new Set([...inA.keys(), ...inB.keys()])].sort((x, y) => x - y);
  for (const entity of ids) {
    const found = firstValueDifference(inA.get(entity), inB.get(entity));
    if (found) {
      return {
        section: 'components',
        path: `components${segment(name)}[${String(entity)}]${fieldSuffix(found.field)}`,
        entity,
        component: name,
        field: found.field,
        a: found.a,
        b: found.b,
      };
    }
  }
  return undefined;
}

/**
 * The first difference between two snapshots, checked in a fixed order — seed, clock, difficulty
 * (effective values, so an absent multiplier reads as its neutral 1), nextEntity,
 * entities, components (by name, then entity id, then field), RNG streams — or undefined when they
 * would hash identically. Built for desync debugging and replay failure reports.
 */
export function diffSnapshots(a: WorldSnapshot, b: WorldSnapshot): SnapshotDifference | undefined {
  if (!Object.is(a.seed, b.seed)) return { section: 'seed', path: 'seed', a: a.seed, b: b.seed };
  const clock = firstValueDifference(a.clock, b.clock);
  if (clock) return { section: 'clock', path: `clock${fieldSuffix(clock.field)}`, ...clock };
  const difficulty = firstValueDifference(
    { ...DEFAULT_DIFFICULTY, ...a.difficulty },
    { ...DEFAULT_DIFFICULTY, ...b.difficulty },
  );
  if (difficulty) {
    return { section: 'difficulty', path: `difficulty.${difficulty.field}`, ...difficulty };
  }
  if (!Object.is(a.nextEntity, b.nextEntity)) {
    return { section: 'nextEntity', path: 'nextEntity', a: a.nextEntity, b: b.nextEntity };
  }
  const entity = firstEntityDifference(a.entities, b.entities);
  if (entity) {
    return {
      section: 'entities',
      path: `entities[${String(entity.id)}]`,
      entity: entity.id,
      a: entity.inA,
      b: !entity.inA,
    };
  }
  for (const name of unionKeys(Object.keys(a.components), Object.keys(b.components))) {
    const found = firstRowDifference(name, a.components[name] ?? [], b.components[name] ?? []);
    if (found) return found;
  }
  for (const name of unionKeys(Object.keys(a.rng), Object.keys(b.rng))) {
    const found = firstValueDifference(a.rng[name], b.rng[name]);
    if (found) {
      const path = `rng${segment(name)}${fieldSuffix(found.field)}`;
      return { section: 'rng', path, stream: name, ...found };
    }
  }
  return undefined;
}
