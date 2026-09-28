// simMath (mw-e00.15, mw-e00.28): portable fdlibm ports checked against the engine's Math. Math is only
// the accuracy and semantics reference here; the bits themselves are pinned by math.golden.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as simMath from './math';
import golden from './math.golden.json';
import { Rng } from './rng';

const view = new DataView(new ArrayBuffer(16));

/** Distance in units in the last place between two doubles (0 when equal or both NaN). */
function ulps(a: number, b: number): number {
  if (Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))) return 0;
  view.setFloat64(0, a);
  view.setFloat64(8, b);
  // Map sign-magnitude bit patterns onto a monotonic integer line.
  const ordered = (bits: bigint): bigint => (bits < 0n ? -(bits & 0x7fffffffffffffffn) : bits);
  const d = ordered(view.getBigInt64(0)) - ordered(view.getBigInt64(8));
  return Number(d < 0n ? -d : d);
}

const rng = Rng.create(2800).stream('simMath');
const uniform = (lo: number, hi: number): number => lo + rng.float() * (hi - lo);

/** A random finite double drawn from all bit patterns, so every exponent is equally likely. */
function anyFinite(): number {
  for (;;) {
    view.setUint32(0, rng.nextU32());
    view.setUint32(4, rng.nextU32());
    const x = view.getFloat64(0);
    if (Number.isFinite(x)) return x;
  }
}

const N = 10_000;

/** N argument lists, cycling through the generators. */
function sample(generators: (() => number[])[]): number[][] {
  return Array.from({ length: N }, (_, i) => {
    const generate = generators[i % generators.length];
    return generate ? generate() : [];
  });
}

interface Failure {
  args: number[];
  ours: number;
  engine: number;
}

/** Argument lists where simMath and Math differ by more than 1 ulp (collected, never asserted in the loop). */
function beyondOneUlp(
  inputs: number[][],
  ours: (args: number[]) => number,
  engine: (args: number[]) => number,
): Failure[] {
  const failures: Failure[] = [];
  for (const args of inputs) {
    const a = ours(args);
    const b = engine(args);
    if (ulps(a, b) > 1) failures.push({ args, ours: a, engine: b });
  }
  return failures;
}

const arg = (args: number[], i: number): number => args[i] ?? NaN;

// [name, simMath version, Math version, input generators]
const cases: [string, (a: number[]) => number, (a: number[]) => number, (() => number[])[]][] = [
  ...(['sin', 'cos', 'tan'] as const).map(
    (name): [string, (a: number[]) => number, (a: number[]) => number, (() => number[])[]] => [
      name,
      (a) => simMath[name](arg(a, 0)),
      (a) => Math[name](arg(a, 0)),
      [
        () => [uniform(-Math.PI, Math.PI)],
        () => [uniform(-100, 100)],
        () => [uniform(-1e6, 1e6)],
        () => [anyFinite()],
      ],
    ],
  ),
  [
    'exp',
    (a) => simMath.exp(arg(a, 0)),
    (a) => Math.exp(arg(a, 0)),
    [() => [uniform(-2, 2)], () => [uniform(-750, 710)], () => [uniform(-1e-6, 1e-6)]],
  ],
  [
    'log',
    (a) => simMath.log(arg(a, 0)),
    (a) => Math.log(arg(a, 0)),
    [() => [uniform(0, 4)], () => [Math.abs(anyFinite())], () => [uniform(0.999, 1.001)]],
  ],
  [
    'pow',
    (a) => simMath.pow(arg(a, 0), arg(a, 1)),
    (a) => Math.pow(arg(a, 0), arg(a, 1)),
    [
      () => [uniform(0, 10), uniform(-30, 30)],
      () => [uniform(-10, 10), Math.round(uniform(-40, 40))],
      () => [uniform(0.99, 1.01), uniform(-5e4, 5e4)],
      () => [anyFinite(), anyFinite()],
    ],
  ],
  [
    'atan2',
    (a) => simMath.atan2(arg(a, 0), arg(a, 1)),
    (a) => Math.atan2(arg(a, 0), arg(a, 1)),
    [() => [uniform(-10, 10), uniform(-10, 10)], () => [anyFinite(), anyFinite()]],
  ],
  [
    'hypot',
    (a) => simMath.hypot(...a),
    (a) => Math.hypot(...a),
    [
      () => [uniform(-10, 10), uniform(-10, 10)],
      () => [anyFinite(), anyFinite()],
      () => [uniform(-10, 10), uniform(-10, 10), uniform(-10, 10)],
    ],
  ],
];

describe('simMath accuracy against Math (mw-e00.28)', () => {
  it.each(cases)(
    'AC-2: %s of 10,000 random inputs is within 1 ulp of Math',
    (_name, ours, engine, generators) => {
      const inputs = sample(generators);
      expect(inputs).toHaveLength(N);
      expect(beyondOneUlp(inputs, ours, engine)).toEqual([]);
    },
  );

  it('matches ECMAScript special-value semantics exactly (NaN, ±0, ±Infinity results)', () => {
    const engine: Record<keyof typeof simMath, (a: number[]) => number> = {
      sin: (a) => Math.sin(arg(a, 0)),
      cos: (a) => Math.cos(arg(a, 0)),
      tan: (a) => Math.tan(arg(a, 0)),
      exp: (a) => Math.exp(arg(a, 0)),
      log: (a) => Math.log(arg(a, 0)),
      pow: (a) => Math.pow(arg(a, 0), arg(a, 1)),
      atan2: (a) => Math.atan2(arg(a, 0), arg(a, 1)),
      hypot: (a) => Math.hypot(...a),
    };
    const ours: Record<keyof typeof simMath, (a: number[]) => number> = {
      sin: (a) => simMath.sin(arg(a, 0)),
      cos: (a) => simMath.cos(arg(a, 0)),
      tan: (a) => simMath.tan(arg(a, 0)),
      exp: (a) => simMath.exp(arg(a, 0)),
      log: (a) => simMath.log(arg(a, 0)),
      pow: (a) => simMath.pow(arg(a, 0), arg(a, 1)),
      atan2: (a) => simMath.atan2(arg(a, 0), arg(a, 1)),
      hypot: (a) => simMath.hypot(...a),
    };
    const hex = (h: string): number => {
      view.setBigUint64(0, BigInt(`0x${h}`));
      return view.getFloat64(0);
    };
    const differences: string[] = [];
    for (const name of Object.keys(engine) as (keyof typeof simMath)[]) {
      for (const row of golden[name]) {
        const args = row.slice(0, -1).map(hex);
        const expected = engine[name](args);
        const special = !Number.isFinite(expected) || expected === 0;
        const actual = ours[name](args);
        const same =
          Object.is(actual, expected) || (Number.isNaN(actual) && Number.isNaN(expected));
        if (special && !same) {
          differences.push(
            `${name}(${args.join(', ')}) = ${String(actual)}, Math: ${String(expected)}`,
          );
        }
      }
    }
    expect(differences).toEqual([]);
  });

  it('agree with Math exactly on easy values', () => {
    expect(simMath.sin(0)).toBe(0);
    expect(Object.is(simMath.sin(-0), -0)).toBe(true);
    expect(simMath.cos(0)).toBe(1);
    expect(simMath.exp(0)).toBe(1);
    expect(simMath.log(1)).toBe(0);
    expect(simMath.pow(2, 10)).toBe(1024);
    expect(simMath.pow(-3, 3)).toBe(-27);
    expect(simMath.atan2(1, 1)).toBe(Math.PI / 4);
    expect(simMath.hypot(3, 4)).toBe(5);
    expect(simMath.hypot()).toBe(0);
  });
});

describe('simMath independence from the engine (mw-e00.28)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never calls Math transcendentals, whose results are platform-dependent', () => {
    const banned = ['sin', 'cos', 'tan', 'atan', 'atan2', 'exp', 'log', 'pow', 'hypot'] as const;
    const spies = banned.map((name) => vi.spyOn(Math, name));
    for (const x of [0.1, 1, 3, 100, 1e6, 1e22]) {
      simMath.sin(x);
      simMath.cos(x);
      simMath.tan(x);
      simMath.exp(x / 1e20);
      simMath.log(x);
      simMath.pow(x, 0.3);
      simMath.atan2(x, 2);
      simMath.hypot(x, 2, 3);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
