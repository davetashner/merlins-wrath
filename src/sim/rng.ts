// Seeded, serializable randomness for the sim (mw-e00.14). The sim never touches Math.random: every
// consumer draws from a named stream derived from the world seed, so adding draws in one system
// (rng.stream('ai')) never shifts another's sequence (rng.stream('loot')). The generator is
// xoshiro128** on four 32-bit words, using only integer operations that JavaScript specifies exactly.

/** Thrown when asked to choose from nothing (an empty list, or weights that sum to zero). */
export class EmptyChoiceError extends Error {
  override readonly name = 'EmptyChoiceError';
}

/**
 * Everything needed to resume a stream exactly: its seed (for deriving sub-streams) and its four state
 * words. Typed loosely because it comes back from saves and JSON; `restore` validates it.
 */
export interface RngState {
  readonly seed: number;
  readonly state: readonly number[];
}

export interface Weighted<T> {
  readonly value: T;
  /** Non-negative integer weight. */
  readonly weight: number;
}

const TWO_32 = 0x1_0000_0000;

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/** murmur3's 32-bit finalizer: a bijective avalanche mix. */
function fmix32(h: number): number {
  let x = h >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85eb_ca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2_ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** FNV-1a over UTF-16 code units: stable, platform-independent name hashing. */
function fnv1a(text: string): number {
  let h = 0x811c_9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x0100_0193) >>> 0;
  return h;
}

/** Expands a 32-bit seed into a non-zero 128-bit state (splitmix-style golden-ratio walk). */
function expand(seed: number): [number, number, number, number] {
  const step = (i: number): number => fmix32((seed + Math.imul(i, 0x9e37_79b9)) >>> 0);
  // fmix32 is a bijection and the four inputs differ, so at most one word can be zero.
  return [step(1), step(2), step(3), step(4)];
}

const isU32 = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) >= 0 && (n as number) < TWO_32;

export class Rng {
  readonly seed: number;
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  private constructor(seed: number, [s0, s1, s2, s3]: readonly [number, number, number, number]) {
    this.seed = seed;
    this.s0 = s0;
    this.s1 = s1;
    this.s2 = s2;
    this.s3 = s3;
  }

  /** A root generator for a world seed (any 32-bit unsigned integer). */
  static create(seed: number): Rng {
    if (!isU32(seed))
      throw new RangeError(`seed must be a 32-bit unsigned integer, got ${String(seed)}`);
    return new Rng(seed, expand(seed));
  }

  /** Resumes a generator from `serialize()` output. */
  static restore(saved: RngState): Rng {
    const { seed, state } = saved;
    if (!isU32(seed) || state.length !== 4 || !state.every(isU32) || state.every((w) => w === 0)) {
      throw new RangeError('invalid RngState');
    }
    return new Rng(seed, state as readonly [number, number, number, number]); // validated above
  }

  /**
   * An independent sub-stream named `name`, derived from this generator's seed (not its current
   * state), so it is the same no matter how many draws happened before.
   */
  stream(name: string): Rng {
    return Rng.create(fmix32(fmix32(this.seed ^ 0x5bd1_e995) ^ fnv1a(name)));
  }

  serialize(): RngState {
    return { seed: this.seed, state: [this.s0, this.s1, this.s2, this.s3] };
  }

  /** Next raw 32-bit unsigned value (xoshiro128**). */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform float in [0, 1) with 32 bits of resolution. */
  float(): number {
    return this.nextU32() / TWO_32;
  }

  /** Uniform integer in [min, max], inclusive, without modulo bias. */
  int(min: number, max: number): number {
    if (
      !Number.isSafeInteger(min) ||
      !Number.isSafeInteger(max) ||
      max < min ||
      max - min >= TWO_32
    ) {
      throw new RangeError(
        `int(${String(min)}, ${String(max)}): need safe integers with 0 <= max - min < 2^32`,
      );
    }
    const range = max - min + 1;
    const limit = TWO_32 - (TWO_32 % range); // largest multiple of range that fits in 2^32
    let u = this.nextU32();
    while (u >= limit) u = this.nextU32();
    return min + (u % range);
  }

  /** True with probability p (0 never, 1 always). */
  chance(p: number): boolean {
    if (!(p >= 0 && p <= 1)) throw new RangeError(`chance(${String(p)}): p must be in [0, 1]`);
    return this.float() < p;
  }

  /** One element, uniformly. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new EmptyChoiceError('pick() from an empty list');
    return items[this.int(0, items.length - 1)] as T; // index is in range by construction
  }

  /** A shuffled copy (Fisher–Yates); the input is not modified. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }

  /** One value, with probability proportional to its integer weight. */
  weighted<T>(entries: readonly Weighted<T>[]): T {
    let total = 0;
    for (const { weight } of entries) {
      if (!Number.isSafeInteger(weight) || weight < 0) {
        throw new RangeError(
          `weighted(): weights must be non-negative integers, got ${String(weight)}`,
        );
      }
      total += weight;
    }
    if (total === 0) throw new EmptyChoiceError('weighted() with no positive weight');
    const values = entries.map((e) => e.value);
    let r = this.int(0, total - 1);
    for (const entry of entries.slice(0, -1)) {
      if (r < entry.weight) return entry.value;
      r -= entry.weight;
    }
    // r < total, so falling through the others means it lands in the last entry's bucket.
    return values[values.length - 1] as T;
  }
}
