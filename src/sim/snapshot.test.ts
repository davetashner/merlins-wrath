import { describe, expect, it } from 'vitest';
import {
  CanonicalEncodingError,
  defineComponent,
  diffSnapshots,
  encodeCanonical,
  encodeSnapshot,
  hashSnapshot,
  hashWorld,
  SNAPSHOT_ENCODING_VERSION,
  World,
  xxHash32,
  type WorldSnapshot,
} from '@sim/index';

interface Vec {
  x: number;
  y: number;
}
const Position = defineComponent<Vec>('Position');
const Heat = defineComponent<{ t: number; tags: string[] }>('Heat');
const Door = defineComponent<{ open: boolean; key: string | null }>('Door');

/** A number from its IEEE-754 bits (hi and lo 32-bit words). */
function fromBits(hi: number, lo: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, hi);
  view.setUint32(4, lo);
  return view.getFloat64(0);
}

function bitsOf(n: number): [number, number] {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, n);
  return [view.getUint32(0), view.getUint32(4)];
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** `[<hole>, 3]` without a sparse-array literal. */
function holey(): number[] {
  const list: number[] = [];
  list[1] = 3;
  return list;
}

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));

function baseWorld(): World {
  return new World({ seed: 42 }).register(Position, Heat, Door);
}

function snapshotOf(build: (w: World) => void): WorldSnapshot {
  const w = baseWorld();
  build(w);
  return w.snapshot();
}

describe('state hash', () => {
  it('AC-1: worlds with identical state built in different insertion orders hash equal', () => {
    const a = baseWorld();
    for (let i = 0; i < 6; i++) a.spawn();
    a.add(1, Position, { x: 1.5, y: -2 });
    a.add(2, Position, { x: 0.1, y: 0.2 });
    a.add(2, Heat, { t: 20, tags: ['wet', 'cold'] });
    a.add(5, Door, { open: false, key: 'brass' });
    a.destroy(3);
    a.random('ai').nextU32();
    a.random('loot').int(1, 6);

    const b = baseWorld();
    for (let i = 0; i < 6; i++) b.spawn();
    b.random('loot').int(1, 6); // streams created in the other order
    b.random('ai').nextU32();
    b.add(5, Door, { key: 'brass', open: false }); // object keys in the other order
    b.add(3, Position, { x: 9, y: 9 }); // added then dropped with the entity
    b.destroy(3);
    b.add(2, Heat, { tags: ['wet', 'cold'], t: 20 });
    b.add(4, Position, { x: 0, y: 0 }); // swap-remove churn in the dense store
    b.add(2, Position, { y: 0.2, x: 0.1 });
    b.add(1, Position, { y: -2, x: 1.5 });
    b.remove(4, Position);

    expect(hashWorld(b)).toBe(hashWorld(a));
    expect(encodeSnapshot(b.snapshot())).toEqual(encodeSnapshot(a.snapshot()));
    expect(diffSnapshots(a.snapshot(), b.snapshot())).toBeUndefined();

    b.random('ai').nextU32();
    expect(hashWorld(b)).not.toBe(hashWorld(a));
  });

  it('AC-2: a component float 1 ULP apart changes the hash and the diff names entity, component, field', () => {
    const next = (n: number): number => {
      const [hi, lo] = bitsOf(n);
      return lo === 0xffff_ffff ? fromBits(hi + 1, 0) : fromBits(hi, lo + 1);
    };
    const base = (x: number): WorldSnapshot =>
      snapshotOf((w) => {
        for (let i = 0; i < 3; i++) w.spawn();
        w.add(1, Position, { x: 1, y: 1 });
        w.add(3, Position, { x, y: 1 });
      });
    const a = base(0.1);
    const b = base(next(0.1));
    expect(next(0.1)).not.toBe(0.1);
    expect(next(fromBits(0x3ff0_0000, 0xffff_ffff))).toBe(fromBits(0x3ff0_0001, 0));

    expect(hashSnapshot(b)).not.toBe(hashSnapshot(a));
    expect(diffSnapshots(a, b)).toEqual({
      section: 'components',
      path: 'components.Position[3].x',
      entity: 3,
      component: 'Position',
      field: 'x',
      a: 0.1,
      b: next(0.1),
    });
  });

  it('AC-3: NaN payloads are canonicalised; -0 and +0 stay distinct', () => {
    const quiet = fromBits(0x7ff8_0000, 1);
    const negativePayload = fromBits(0xfff0_0000, 0xdead);
    expect(bitsOf(quiet)).not.toEqual(bitsOf(negativePayload)); // two genuinely different NaNs

    const canonicalNaN = '037ff8000000000000';
    expect(hex(encodeCanonical(quiet))).toBe(canonicalNaN);
    expect(hex(encodeCanonical(negativePayload))).toBe(canonicalNaN);
    expect(hex(encodeCanonical(NaN))).toBe(canonicalNaN);
    expect(hex(encodeCanonical(0))).toBe('030000000000000000');
    expect(hex(encodeCanonical(-0))).toBe('038000000000000000');

    const withX = (x: number): WorldSnapshot =>
      snapshotOf((w) => {
        w.spawn();
        w.add(1, Position, { x, y: 0 });
      });
    expect(hashSnapshot(withX(quiet))).toBe(hashSnapshot(withX(negativePayload)));
    expect(diffSnapshots(withX(quiet), withX(negativePayload))).toBeUndefined();
    expect(hashSnapshot(withX(-0))).not.toBe(hashSnapshot(withX(0)));
    expect(diffSnapshots(withX(0), withX(-0))).toMatchObject({ field: 'x', a: 0, b: -0 });
  });

  it('pins the hash of a fixed snapshot, so encoding changes are deliberate', () => {
    const snap = snapshotOf((w) => {
      w.spawn();
      w.spawn();
      w.add(1, Position, { x: 0.5, y: -3 });
      w.add(2, Door, { open: true, key: null });
      w.random('ai').nextU32();
    });
    expect(SNAPSHOT_ENCODING_VERSION).toBe(1);
    expect(hashSnapshot(snap)).toBe('6d339797');
    expect(hashSnapshot(structuredClone(snap))).toBe(hashSnapshot(snap));
    expect(hashSnapshot(JSON.parse(JSON.stringify(snap)) as WorldSnapshot)).toBe(
      hashSnapshot(snap),
    );
  });

  it('encodes a snapshot exactly as its format tag plus the generic canonical form', () => {
    const snap = snapshotOf((w) => {
      w.spawn();
      w.add(1, Heat, { t: 1, tags: ['a'] });
      w.random('z').nextU32();
    });
    const expected = new Uint8Array([0x56, 0x42, 0x53, 1, ...encodeCanonical(snap)]);
    expect(encodeSnapshot(snap)).toEqual(expected);
    const { Door: door = [], Heat: heat = [], Position: position = [] } = snap.components;
    const reordered = { ...snap, components: { Position: position, Heat: heat, Door: door } };
    expect(encodeSnapshot(reordered)).toEqual(expected);
  });

  it('hashWorld reads a shared snapshot and does not disturb the world', () => {
    const w = baseWorld();
    w.spawn();
    w.add(1, Position, { x: 1, y: 2 });
    const before = w.snapshot();
    expect(hashWorld(w)).toBe(hashSnapshot(before));
    expect(w.snapshot()).toEqual(before);
    expect(hashWorld(w)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('canonical encoding', () => {
  it('encodes each kind with its tag and big-endian lengths', () => {
    expect(hex(encodeCanonical(null))).toBe('00');
    expect(hex(encodeCanonical(false))).toBe('01');
    expect(hex(encodeCanonical(true))).toBe('02');
    expect(hex(encodeCanonical(1))).toBe('033ff0000000000000');
    expect(hex(encodeCanonical('Aé'))).toBe('0400000002004100e9');
    expect(hex(encodeCanonical([true]))).toBe('050000000102');
    expect(hex(encodeCanonical({ b: null, a: true }))).toBe(
      '06000000020000000100610200000001006200',
    );
    expect(hex(encodeCanonical(Object.assign(Object.create(null) as object, { k: 0 })))).toBe(
      hex(encodeCanonical({ k: 0 })),
    );
  });

  it('encodes large integers and non-integers exactly by their bits', () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(hex(encodeCanonical(big))).toBe('03433fffffffffffff');
    expect(hex(encodeCanonical(2 ** 53 + 2))).toBe('034340000000000001');
    expect(hex(encodeCanonical(Infinity))).toBe('037ff0000000000000');
    expect(encodeCanonical(0.1 + 0.2)).not.toEqual(encodeCanonical(0.3));
  });

  it('is independent of key insertion order at every depth', () => {
    const a = { outer: { x: 1, y: [{ p: 1, q: 2 }] }, z: 'z' };
    const b = { z: 'z', outer: { y: [{ q: 2, p: 1 }], x: 1 } };
    expect(encodeCanonical(b)).toEqual(encodeCanonical(a));
    expect(encodeCanonical([1, 2])).not.toEqual(encodeCanonical([2, 1]));
  });

  it('grows its buffer for large values', () => {
    const long = 'x'.repeat(100_000); // 200 KB of code units: more than one doubling
    const bytes = encodeCanonical({ long, after: 1 });
    expect(bytes.length).toBe(1 + 4 + (4 + 10 + 9) + (4 + 8 + 1 + 4 + 200_000));
    expect(encodeCanonical({ after: 1, long })).toEqual(bytes);
  });

  it.each([
    ['undefined', { a: undefined }, '$.a', 'undefined is not serialisable'],
    ['a function', [1, () => 1], '$[1]', 'function is not serialisable'],
    ['a symbol', { 'odd key': Symbol('s') }, '$["odd key"]', 'symbol is not serialisable'],
    ['a bigint', { n: [{ m: 1n }] }, '$.n[0].m', 'bigint is not serialisable'],
    ['an array hole', holey(), '$[0]', 'undefined is not serialisable'],
    ['a Map', { m: new Map() }, '$.m', 'Map is not a plain object or array'],
    [
      'an object without a constructor',
      Object.create(Object.create(null) as object) as object,
      '$',
      'exotic is not a plain object or array',
    ],
  ])('rejects %s with a typed error naming the path', (_label, value, path, reason) => {
    const attempt = (): Uint8Array => encodeCanonical(value);
    expect(attempt).toThrow(CanonicalEncodingError);
    expect(attempt).toThrow(`cannot canonically encode ${path}: ${reason}`);
    try {
      attempt();
    } catch (error) {
      expect(error).toMatchObject({ name: 'CanonicalEncodingError', path });
    }
  });

  it('rejects cycles but allows shared (acyclic) references', () => {
    const cyclic: { self?: unknown; list: unknown[] } = { list: [] };
    cyclic.list.push(cyclic);
    expect(() => encodeCanonical(cyclic)).toThrow('cannot canonically encode $.list[0]: cycle');
    const shared = { v: 1 };
    expect(encodeCanonical([shared, shared])).toEqual(encodeCanonical([{ v: 1 }, { v: 1 }]));
  });

  it('lets errors other than encoding failures through unchanged', () => {
    const boom = new Error('getter failed');
    const value = {
      get x(): number {
        throw boom;
      },
    };
    expect(() => encodeCanonical({ nested: value })).toThrow(boom);
  });

  it('names the component row when a snapshot holds an unserialisable value', () => {
    const Bad = defineComponent<{ f: unknown }>('Bad', { serialize: (v) => v });
    const w = new World({ seed: 1 }).register(Bad);
    w.spawn();
    w.add(w.spawn(), Bad, { f: new Set() });
    expect(() => hashWorld(w)).toThrow(
      'cannot canonically encode $.components.Bad[0][1].f: Set is not a plain object or array',
    );
    const Throws = defineComponent<number>('Throws', {
      serialize: () => ({
        get x(): number {
          throw new TypeError('no');
        },
      }),
    });
    const t = new World({ seed: 1 }).register(Throws);
    t.add(t.spawn(), Throws, 1);
    expect(() => encodeSnapshot(t.snapshot())).toThrow(TypeError);
  });
});

describe('xxHash32', () => {
  it.each([
    ['', 0, 0x02cc_5d05],
    ['a', 0, 0x550d_7456],
    ['abc', 0, 0x32d1_53ff],
    ['Nobody inspects the spammish repetition', 0, 0xe229_3b2f],
    ['abcdefghijklmnopqrstuvwxyz0123456789', 0x9747_b28c, 0x5bd1_16a0],
    ['', 0xffff_ffff, 0x9061_da9d],
  ])('matches the reference for %j (seed %i)', (text, seed, expected) => {
    expect(xxHash32(ascii(text), seed)).toBe(expected);
  });

  it('matches the reference on a long binary input, with the default seed', () => {
    const bytes = new Uint8Array(512).map((_, i) => i & 0xff);
    expect(xxHash32(bytes)).toBe(0xf319_d2c7);
  });
});

describe('diffSnapshots', () => {
  const two = (build: (w: World) => void): WorldSnapshot =>
    snapshotOf((w) => {
      w.spawn();
      w.spawn();
      build(w);
    });

  it('reports the seed, clock and next entity id first', () => {
    const base = snapshotOf(() => undefined);
    expect(diffSnapshots(base, { ...base, seed: 7 })).toEqual({
      section: 'seed',
      path: 'seed',
      a: 42,
      b: 7,
    });
    expect(diffSnapshots(base, { ...base, clock: { tick: 3, hz: 60 } })).toEqual({
      section: 'clock',
      path: 'clock.tick',
      field: 'tick',
      a: 0,
      b: 3,
    });
    expect(diffSnapshots(base, { ...base, nextEntity: 9 })).toEqual({
      section: 'nextEntity',
      path: 'nextEntity',
      a: 1,
      b: 9,
    });
  });

  it('reports the lowest entity alive in only one snapshot', () => {
    const base = snapshotOf(() => undefined);
    const a = { ...base, nextEntity: 9, entities: [1, 2, 5] };
    expect(diffSnapshots(a, { ...a, entities: [1, 3, 5] })).toMatchObject({
      section: 'entities',
      path: 'entities[2]',
      entity: 2,
      a: true,
      b: false,
    });
    expect(diffSnapshots(a, { ...a, entities: [1, 2, 4, 5] })).toMatchObject({
      entity: 4,
      a: false,
      b: true,
    });
  });

  it('reports a component present on an entity in only one snapshot', () => {
    const a = two((w) => {
      w.add(1, Position, { x: 1, y: 1 });
    });
    const b = two((w) => {
      w.add(1, Position, { x: 1, y: 1 });
      w.add(2, Position, { x: 2, y: 2 });
    });
    expect(diffSnapshots(a, b)).toEqual({
      section: 'components',
      path: 'components.Position[2]',
      entity: 2,
      component: 'Position',
      field: '',
      a: undefined,
      b: { x: 2, y: 2 },
    });
  });

  it('reports a component type present in only one snapshot', () => {
    const a = two((w) => {
      w.add(1, Position, { x: 1, y: 1 });
    });
    const rest = Object.fromEntries(Object.entries(a.components).filter(([n]) => n !== 'Position'));
    const b: WorldSnapshot = { ...a, components: rest };
    expect(diffSnapshots(b, a)).toMatchObject({ component: 'Position', entity: 1, field: '' });
    expect(diffSnapshots(a, b)).toMatchObject({ component: 'Position', entity: 1, field: '' });
  });

  it('walks nested fields: array elements, array lengths, shapes and missing keys', () => {
    const heat = (value: unknown): WorldSnapshot => {
      const snap = two(() => undefined);
      return { ...snap, components: { ...snap.components, Heat: [[2, value]] } };
    };
    const diff = (a: unknown, b: unknown): unknown => {
      const found = diffSnapshots(heat(a), heat(b));
      return found && { path: found.path, field: found.field, a: found.a, b: found.b };
    };
    expect(diff({ t: 1, tags: ['a', 'b'] }, { t: 1, tags: ['a', 'c'] })).toEqual({
      path: 'components.Heat[2].tags[1]',
      field: 'tags[1]',
      a: 'b',
      b: 'c',
    });
    expect(diff({ tags: ['a'] }, { tags: ['a', 'b'] })).toEqual({
      path: 'components.Heat[2].tags',
      field: 'tags',
      a: ['a'],
      b: ['a', 'b'],
    });
    expect(diff([1, [2]], [1, [3]])).toEqual({
      path: 'components.Heat[2][1][0]',
      field: '[1][0]',
      a: 2,
      b: 3,
    });
    expect(diff({ list: [1] }, { list: { 0: 1 } })).toMatchObject({ field: 'list' });
    expect(diff({ list: { 0: 1 } }, { list: [1] })).toMatchObject({ field: 'list' });
    expect(diff({ v: null }, { v: {} })).toMatchObject({ field: 'v', a: null, b: {} });
    expect(diff({ a: 1 }, { a: 1, 'b c': 2 })).toEqual({
      path: 'components.Heat[2]["b c"]',
      field: '["b c"]',
      a: undefined,
      b: 2,
    });
    expect(diff({ t: 1, tags: [] }, { tags: [], t: 1 })).toBeUndefined();
    expect(diff([1, 2], [1, 2])).toBeUndefined();
  });

  it('reports RNG stream differences last', () => {
    const w = baseWorld();
    w.random('ai');
    const a = w.snapshot();
    w.random('ai').nextU32();
    const b = w.snapshot();
    const diff = diffSnapshots(a, b);
    expect(diff).toMatchObject({ section: 'rng', stream: 'ai' });
    expect(diff?.path).toMatch(/^rng\.ai\.state\[\d\]$/);
    w.random('zz');
    expect(diffSnapshots(b, w.snapshot())).toMatchObject({
      section: 'rng',
      path: 'rng.zz',
      stream: 'zz',
      field: '',
      a: undefined,
    });
  });
});
