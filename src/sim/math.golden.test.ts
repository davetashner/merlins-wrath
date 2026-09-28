// mw-e00.28 AC-1: simMath's outputs are pinned bit for bit. math.golden.json was generated on macOS
// arm64; CI runs this on Linux x64, so a pass there proves the implementation is platform-independent.
// The table covers special values (±0, ±Infinity, NaN, subnormals), branch boundaries and huge
// arguments that need full π/2 range reduction.
import { describe, expect, it } from 'vitest';
import * as simMath from './math';
import golden from './math.golden.json';

const view = new DataView(new ArrayBuffer(8));

function fromHex(hex: string): number {
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

function toHex(x: number): string {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}

const functions: Record<keyof typeof simMath, (args: number[]) => number> = {
  sin: (args) => simMath.sin(args[0] ?? NaN),
  cos: (args) => simMath.cos(args[0] ?? NaN),
  tan: (args) => simMath.tan(args[0] ?? NaN),
  exp: (args) => simMath.exp(args[0] ?? NaN),
  log: (args) => simMath.log(args[0] ?? NaN),
  pow: (args) => simMath.pow(args[0] ?? NaN, args[1] ?? NaN),
  atan2: (args) => simMath.atan2(args[0] ?? NaN, args[1] ?? NaN),
  hypot: (args) => simMath.hypot(...args),
};
const names = Object.keys(functions) as (keyof typeof simMath)[];

/** Rows whose output differs from the table, formatted so a new row's bits can be copied. */
function mismatches(name: keyof typeof simMath): string[] {
  const out: string[] = [];
  for (const row of golden[name]) {
    const inputs = row.slice(0, -1);
    const expected = row.at(-1) ?? '';
    const actual = functions[name](inputs.map(fromHex));
    const matches = Number.isNaN(fromHex(expected))
      ? Number.isNaN(actual)
      : toHex(actual) === expected;
    if (!matches)
      out.push(`${name}(${inputs.join(', ')}) = ${toHex(actual)}, table says ${expected}`);
  }
  return out;
}

describe('simMath golden bit patterns (mw-e00.28)', () => {
  it('AC-1: the table has rows for every simMath function', () => {
    expect(Object.keys(simMath).sort()).toEqual([...names].sort());
    for (const name of names) expect(golden[name].length).toBeGreaterThan(0);
  });

  it.each(names)('AC-1: %s reproduces every golden output bit pattern', (name) => {
    expect(mismatches(name)).toEqual([]);
  });
});
