// Gameplay maths for the sim (mw-e00.15, mw-e00.28). Determinism policy: every function here returns
// the same bits for the same inputs on every platform and JS engine. The engines' Math.sin/cos/tan/
// atan2/exp/log/pow/hypot are implementation-defined (Node 24's differ in the last bit between macOS
// arm64 and Linux x64), so these are pure-JS ports of Sun's fdlibm 5.3 built only from IEEE-754
// correctly rounded operations: + − × ÷ and Math.sqrt, exact bit access to doubles, exact BigInt
// arithmetic. JS has no FMA contraction and no extended precision, so each step rounds identically
// everywhere. Accuracy is under 1 ulp. math.golden.json pins the output bits and CI re-checks them on
// Linux x64. Sim code reaches transcendentals only through here (ESLint enforces it).
//
// Deviations from fdlibm, each keeping every branch reachable and tested: arguments above 2^19·π/2
// are reduced exactly with BigInt (Payne–Hanek over fdlibm's 2/π table) instead of
// __kernel_rem_pio2; branches that cannot be reached from these entry points are removed; hypot is
// V8's own Math.hypot algorithm (see there). Everything lives in one module on purpose: calls across
// ES modules go through export getters under Vitest, which would distort the AC-3 benchmark.
//
// ====================================================
// Copyright (C) 1993, 2004 by Sun Microsystems, Inc. All rights reserved.
//
// Developed at SunPro, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this
// software is freely granted, provided that this notice
// is preserved.
// ====================================================

// ===================================================================================================
// Double word access. fdlibm works on the high and low 32-bit words of a double; a big-endian
// DataView yields the same words on every platform.

const view = new DataView(new ArrayBuffer(8));

/** The high 32 bits (sign, exponent, top 20 mantissa bits) of `x`, as a signed int32. */
function highWord(x: number): number {
  view.setFloat64(0, x);
  return view.getInt32(0);
}

/** The low 32 mantissa bits of `x`, as an unsigned int32. */
function lowWord(x: number): number {
  view.setFloat64(0, x);
  return view.getUint32(4);
}

/** The double whose high and low words are `hi` and `lo` (both taken modulo 2^32). */
function fromWords(hi: number, lo: number): number {
  view.setInt32(0, hi);
  view.setInt32(4, lo);
  return view.getFloat64(0);
}

/** `x` with its high word replaced by `hi` (fdlibm's `__HI(x) = hi`). */
function withHighWord(x: number, hi: number): number {
  view.setFloat64(0, x);
  view.setInt32(0, hi);
  return view.getFloat64(0);
}

/** `x` with its low word cleared (fdlibm's `__LO(x) = 0`): keeps the top 21 mantissa bits. */
function clearLowWord(x: number): number {
  view.setFloat64(0, x);
  view.setInt32(4, 0);
  return view.getFloat64(0);
}

/** 2^k exactly, for integer k in [-1022, 1023]. */
function pow2(k: number): number {
  return fromWords((k + 1023) << 20, 0);
}

// ===================================================================================================
// sin, cos, tan (s_sin.c, s_cos.c, s_tan.c, k_sin.c, k_cos.c, k_tan.c, e_rem_pio2.c).

// ---------------------------------------------------------------------------------------------------
// Argument reduction (e_rem_pio2.c): x = n·π/2 + (rem.y0 + rem.y1), |rem.y0 + rem.y1| ≤ π/4.

const INVPIO2 = 6.36619772367581382433e-1; // 0x3FE45F30 6DC9C883
const PIO2_1 = 1.57079632673412561417; // 0x3FF921FB 54400000: first 33 bits of π/2
const PIO2_1T = 6.07710050650619224932e-11; // 0x3DD0B461 1A626331: π/2 − PIO2_1
const PIO2_2 = 6.0771005063039659766e-11; // 0x3DD0B461 1A600000: second 33 bits of π/2
const PIO2_2T = 2.02226624879595063154e-21; // 0x3BA3198A 2E037073: π/2 − (PIO2_1 + PIO2_2)
const PIO2_3 = 2.0222662487111664558e-21; // 0x3BA3198A 2E000000: third 33 bits of π/2
const PIO2_3T = 8.47842766036889956997e-32; // 0x397B839A 252049C1: π/2 − (PIO2_1 + PIO2_2 + PIO2_3)

// High words of n·π/2 for n = 1..32: arguments sharing one may cancel badly in the quick path.
const NPIO2_HW = Int32Array.of(
  0x3ff921fb,
  0x400921fb,
  0x4012d97c,
  0x401921fb,
  0x401f6a7a,
  0x4022d97c,
  0x4025fdbb,
  0x402921fb,
  0x402c463a,
  0x402f6a7a,
  0x4031475c,
  0x4032d97c,
  0x40346b9c,
  0x4035fdbb,
  0x40378fdb,
  0x403921fb,
  0x403ab41b,
  0x403c463a,
  0x403dd85a,
  0x403f6a7a,
  0x40407e4c,
  0x4041475c,
  0x4042106c,
  0x4042d97c,
  0x4043a28c,
  0x40446b9c,
  0x404534ac,
  0x4045fdbb,
  0x4046c6cb,
  0x40478fdb,
  0x404858eb,
  0x404921fb,
);

// floor(2/π · 2^1584): fdlibm's two_over_pi table (66 × 24 bits) as one integer.
const TWO_OVER_PI_BITS = 1584;
const TWO_OVER_PI = BigInt(
  '0xA2F9836E4E441529FC2757D1F534DDC0DB6295993C439041FE5163ABDEBBC561B7246E3A424DD2E006492EEA09D1' +
    '921CFE1DEB1CB129A73EE88235F52EBB4484E99C7026B45F7E413991D639835339F49C845F8BBDF9283B1FF897FFDE' +
    '05980FEF2F118B5A0A6D1F6D367ECF27CB09B74F463F669E5FEA2D7527BAC7EBE5F17B3D0739F78A5292EA6BFB5FB1' +
    '1F8D5D0856033046FC7B6BABF0CFBC209AF4361DA9E391615EE61B086599855F14A068408DFFD8804D73273106061556' +
    'CA73A8C960E27BC08C6B',
);
// Fraction bits kept after multiplying by 2/π. The closest a double comes to a multiple of π/2 is
// about 2^-61 (relative to the quarter turn), so 192 bits leave > 120 significant bits.
const FRAC_BITS = 192;
const FRAC_ONE = 1n << BigInt(FRAC_BITS);
const FRAC_HALF = FRAC_ONE >> 1n;
const FRAC_MASK = FRAC_ONE - 1n;
const FRAC_AND_OCTANT_MASK = (FRAC_ONE << 3n) - 1n;
// floor(π/2 · 2^192).
const PIO2_BITS = 192;
const PIO2_BIG = BigInt('0x1921fb54442d18469898cc51701b839a252049c1114cf98e8');
const REDUCED_SCALE = pow2(-(FRAC_BITS + PIO2_BITS));

// remPio2's two-part result (a reused object is cheaper here than module-level `let`s).
const rem = { y0: 0, y1: 0 };

/**
 * Reduces finite `x` with |x| > π/4 (high word `hx`, `ix` = hx & 0x7fffffff) modulo π/2 into
 * rem.y0 + rem.y1 and returns the quadrant count n (only n mod 4 matters to callers).
 */
function remPio2(x: number, hx: number, ix: number): number {
  if (ix < 0x4002d97c) {
    // |x| < 3π/4: n = ±1.
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) {
        // 33 + 53 bits of π is good enough.
        rem.y0 = z - PIO2_1T;
        rem.y1 = z - rem.y0 - PIO2_1T;
      } else {
        // Near π/2: use 33 + 33 + 53 bits.
        z -= PIO2_2;
        rem.y0 = z - PIO2_2T;
        rem.y1 = z - rem.y0 - PIO2_2T;
      }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) {
      rem.y0 = z + PIO2_1T;
      rem.y1 = z - rem.y0 + PIO2_1T;
    } else {
      z += PIO2_2;
      rem.y0 = z + PIO2_2T;
      rem.y1 = z - rem.y0 + PIO2_2T;
    }
    return -1;
  }
  if (ix <= 0x413921fb) return remPio2Medium(x, hx, ix);
  return remPio2Large(x, hx, ix);
}

/** |x| ≤ 2^19·π/2: Cody–Waite reduction with up to three pieces of π/2. */
function remPio2Medium(x: number, hx: number, ix: number): number {
  let t = Math.abs(x);
  const n = (t * INVPIO2 + 0.5) | 0;
  let r = t - n * PIO2_1;
  let w = n * PIO2_1T; // First round, good to 85 bits.
  if (n < 32 && ix !== NPIO2_HW[n - 1]) {
    rem.y0 = r - w; // Quick check: no cancellation.
  } else {
    const j = ix >> 20;
    rem.y0 = r - w;
    let i = j - ((highWord(rem.y0) >> 20) & 0x7ff);
    if (i > 16) {
      // Second iteration, good to 118 bits.
      t = r;
      w = n * PIO2_2;
      r = t - w;
      w = n * PIO2_2T - (t - r - w);
      rem.y0 = r - w;
      i = j - ((highWord(rem.y0) >> 20) & 0x7ff);
      if (i > 49) {
        // Third iteration, 151 bits: covers every possible case.
        t = r;
        w = n * PIO2_3;
        r = t - w;
        w = n * PIO2_3T - (t - r - w);
        rem.y0 = r - w;
      }
    }
  }
  rem.y1 = r - rem.y0 - w;
  if (hx < 0) {
    rem.y0 = -rem.y0;
    rem.y1 = -rem.y1;
    return -n;
  }
  return n;
}

/** |x| > 2^19·π/2: exact Payne–Hanek reduction in BigInt arithmetic. */
function remPio2Large(x: number, hx: number, ix: number): number {
  // |x| = m · 2^e with m a 53-bit integer.
  const e = (ix >> 20) - 1075;
  const m = (BigInt((ix & 0xfffff) | 0x100000) << 32n) | BigInt(lowWord(x));
  // |x|·2/π = m·TWO_OVER_PI·2^(e − 1584); keep 3 integer bits (the octant) and FRAC_BITS of fraction.
  const scaled =
    ((m * TWO_OVER_PI) >> BigInt(TWO_OVER_PI_BITS - FRAC_BITS - e)) & FRAC_AND_OCTANT_MASK;
  let n = Number(scaled >> BigInt(FRAC_BITS));
  let frac = scaled & FRAC_MASK;
  if (frac >= FRAC_HALF) {
    // Round to the nearest quadrant so the remainder lies in [−π/4, π/4].
    frac -= FRAC_ONE;
    n += 1;
  }
  const product = frac * PIO2_BIG; // remainder · 2^(FRAC_BITS + PIO2_BITS)
  const head = Number(product); // Correctly rounded, hence identical everywhere.
  rem.y0 = head * REDUCED_SCALE;
  rem.y1 = Number(product - BigInt(head)) * REDUCED_SCALE;
  if (hx < 0) {
    rem.y0 = -rem.y0;
    rem.y1 = -rem.y1;
    return -n;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------
// Kernels on [−π/4, π/4] (k_sin.c, k_cos.c, k_tan.c). x + y is the reduced argument, |y| ≪ |x|.

// Word-boundary thresholds as doubles: |x| < fromWords(h, 0) ⇔ (high word of |x|) < h, which saves
// re-reading the high word in the kernels.
const TWO_M27 = fromWords(0x3e400000, 0); // 2^-27
const COS_SMALL = fromWords(0x3fd33333, 0); // ≈ 0.3
const COS_LARGE = fromWords(0x3fe90001, 0); // just above 0.78125

const S1 = -1.66666666666666324348e-1; // 0xBFC55555 55555549
const S2 = 8.33333333332248946124e-3; // 0x3F811111 1110F8A6
const S3 = -1.98412698298579493134e-4; // 0xBF2A01A0 19C161D5
const S4 = 2.75573137070700676789e-6; // 0x3EC71DE3 57B1FE7D
const S5 = -2.50507602534068634195e-8; // 0xBE5AE5E6 8A2B9CEB
const S6 = 1.58969099521155010221e-10; // 0x3DE5D93A 5ACFD57C

/** sin(x + y); `hasTail` false means y is exactly 0 (fdlibm's iy = 0). */
function kernelSin(x: number, y: number, hasTail: boolean): number {
  if (Math.abs(x) < TWO_M27) return x; // fdlibm: ix < 0x3e400000
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (!hasTail) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 4.16666666666666019037e-2; // 0x3FA55555 5555554C
const C2 = -1.38888888888741095749e-3; // 0xBF56C16C 16C15177
const C3 = 2.48015872894767294178e-5; // 0x3EFA01A0 19CB1590
const C4 = -2.75573143513906633035e-7; // 0xBE927E4F 809C52AD
const C5 = 2.0875723212981748279e-9; // 0x3E21EE9E BDB4B1C4
const C6 = -1.13596475577881948265e-11; // 0xBDA8FAE9 BE8838D4

/** cos(x + y). */
function kernelCos(x: number, y: number): number {
  const ax = Math.abs(x);
  if (ax < TWO_M27) return 1; // fdlibm: ix < 0x3e400000
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ax < COS_SMALL) return 1 - (0.5 * z - (z * r - x * y)); // fdlibm: ix < 0x3fd33333 (|x| < 0.3)
  // qx = 0.28125 for |x| > 0.78125, else |x|/4 truncated to its high word.
  const qx = ax >= COS_LARGE ? 0.28125 : fromWords((highWord(x) & 0x7fffffff) - 0x00200000, 0);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

// Taylor-like coefficients of tan on [0, 0.67434] (T[0..12] in k_tan.c).
const T0 = 3.33333333333334091986e-1; // 0x3FD55555 55555563
const T1 = 1.33333333333201242699e-1; // 0x3FC11111 1110FE7A
const T2 = 5.39682539762260521377e-2; // 0x3FABA1BA 1BB341FE
const T3 = 2.18694882948595424599e-2; // 0x3F9664F4 8406D637
const T4 = 8.86323982359930005737e-3; // 0x3F8226E3 E96E8493
const T5 = 3.59207910759131235356e-3; // 0x3F6D6D22 C9560328
const T6 = 1.45620945432529025516e-3; // 0x3F57DBC8 FEE08315
const T7 = 5.88041240820264096874e-4; // 0x3F4344D8 F2F26501
const T8 = 2.46463134818469906812e-4; // 0x3F3026F7 1A8D1068
const T9 = 7.817944429395570923e-5; // 0x3F147E88 A03792A6
const T10 = 7.14072491382608190305e-5; // 0x3F12B80F 32F0A7E9
const T11 = -1.85586374855275456654e-5; // 0xBEF375CB DB605373
const T12 = 2.59073051863633712884e-5; // 0x3EFB2A70 74BF7AD4
const PIO4 = 7.85398163397448278999e-1; // 0x3FE921FB 54442D18
const PIO4LO = 3.06161699786838301793e-17; // 0x3C81A626 33145C07

/**
 * tan(x + y) when `odd` is false, −1/tan(x + y) when true (fdlibm's iy = 1 / −1). k_tan.c's
 * `x == 0 && iy == −1` branch is dropped: no finite double reduces to exactly 0 with n odd.
 */
function kernelTan(x: number, y: number, odd: boolean): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix < 0x3e300000) {
    // |x| < 2^-28
    if (!odd) return x;
    return negInverse(x + y, x, y);
  }
  const big = ix >= 0x3fe59428; // |x| ≥ 0.6744: use tan(π/4 − x) for accuracy.
  if (big) {
    if (hx < 0) {
      x = -x;
      y = -y;
    }
    x = PIO4 - x + (PIO4LO - y);
    y = 0;
  }
  const z = x * x;
  let w = z * z;
  // x^5·(T1 + x^4·T3 + … + x^20·T11) + x^5·(x^2·(T2 + x^4·T4 + … + x^22·T12)).
  let r = T1 + w * (T3 + w * (T5 + w * (T7 + w * (T9 + w * T11))));
  const v = z * (T2 + w * (T4 + w * (T6 + w * (T8 + w * (T10 + w * T12)))));
  const s = z * x;
  r = y + z * (s * (r + v) + y);
  r += T0 * s;
  w = x + r;
  if (big) {
    const iy = odd ? -1 : 1;
    return (1 - ((hx >> 30) & 2)) * (iy - 2 * (x - ((w * w) / (w + iy) - r)));
  }
  if (!odd) return w;
  return negInverse(w, x, r);
}

/** −1/w computed carefully, where w = a + b rounded (k_tan.c). */
function negInverse(w: number, a: number, b: number): number {
  const z = clearLowWord(w);
  const v = b - (z - a); // z + v = a + b
  const q = -1 / w;
  const t = clearLowWord(q);
  const s = 1 + t * z;
  return t + q * (s + t * v);
}

// ---------------------------------------------------------------------------------------------------
// Public functions.

/** Sine of `x` (radians), bit-identical on every platform. */
export function sin(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, false); // |x| ≲ π/4
  if (ix >= 0x7ff00000) return x - x; // NaN or ±Infinity
  switch (remPio2(x, hx, ix) & 3) {
    case 0:
      return kernelSin(rem.y0, rem.y1, true);
    case 1:
      return kernelCos(rem.y0, rem.y1);
    case 2:
      return -kernelSin(rem.y0, rem.y1, true);
    default:
      return -kernelCos(rem.y0, rem.y1);
  }
}

/** Cosine of `x` (radians), bit-identical on every platform. */
export function cos(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  switch (remPio2(x, hx, ix) & 3) {
    case 0:
      return kernelCos(rem.y0, rem.y1);
    case 1:
      return -kernelSin(rem.y0, rem.y1, true);
    case 2:
      return -kernelCos(rem.y0, rem.y1);
    default:
      return kernelSin(rem.y0, rem.y1, true);
  }
}

/** Tangent of `x` (radians), bit-identical on every platform. */
export function tan(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelTan(x, 0, false);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x, hx, ix);
  return kernelTan(rem.y0, rem.y1, (n & 1) === 1);
}

// ===================================================================================================
// exp, log (e_exp.c, e_log.c).

const HUGE = 1.0e300;
const TWOM1000 = 9.3326361850321887899e-302; // 2^-1000
const O_THRESHOLD = 7.09782712893383973096e2; // 0x40862E42 FEFA39EF
const U_THRESHOLD = -7.4513321910194110842e2; // 0xC0874910 D52D3051
// ln2 split so that k·LN2_HI is exact for |k| < 2^11 (shared by e_exp.c and e_log.c).
const LN2_HI = 6.9314718036912381649e-1; // 0x3FE62E42 FEE00000
const LN2_LO = 1.90821492927058770002e-10; // 0x3DEA39EF 35793C76
const INVLN2 = 1.442695040888963387; // 0x3FF71547 652B82FE
const P1 = 1.66666666666666019037e-1; // 0x3FC55555 5555553E
const P2 = -2.77777777770155933842e-3; // 0xBF66C16C 16BEBD93
const P3 = 6.61375632143793436117e-5; // 0x3F11566A AF25DE2C
const P4 = -1.6533902205465251539e-6; // 0xBEBBBD41 C5D26BF1
const P5 = 4.13813679705723846039e-8; // 0x3E663769 72BEA4D0

/** e^x, bit-identical on every platform. */
export function exp(x: number): number {
  const hxSigned = highWord(x);
  const negative = hxSigned < 0;
  const hx = hxSigned & 0x7fffffff;

  // Non-finite, overflowing and underflowing arguments.
  if (hx >= 0x40862e42) {
    // |x| ≥ 709.78…
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | lowWord(x)) !== 0) return x + x; // NaN
      return negative ? 0 : x; // exp(±Infinity) = Infinity, 0
    }
    if (x > O_THRESHOLD) return HUGE * HUGE; // overflow
    if (x < U_THRESHOLD) return TWOM1000 * TWOM1000; // underflow
  }

  // Argument reduction: x = k·ln2 + r, |r| ≤ ln2/2, carried as hi − lo.
  let hi = 0;
  let lo = 0;
  let k = 0;
  if (hx > 0x3fd62e42) {
    // |x| > ln2/2
    if (hx < 0x3ff0a2b2) {
      // |x| < 1.5·ln2
      hi = negative ? x + LN2_HI : x - LN2_HI;
      lo = negative ? -LN2_LO : LN2_LO;
      k = negative ? -1 : 1;
    } else {
      k = (INVLN2 * x + (negative ? -0.5 : 0.5)) | 0;
      hi = x - k * LN2_HI; // k·LN2_HI is exact here.
      lo = k * LN2_LO;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    // |x| < 2^-28
    return 1 + x;
  }

  // x is now in the primary range.
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - (lo - (x * c) / (2 - c) - hi);
  if (k >= -1021) return withHighWord(y, highWord(y) + (k << 20)); // y·2^k
  return withHighWord(y, highWord(y) + ((k + 1000) << 20)) * TWOM1000; // subnormal result
}

const TWO54 = 1.8014398509481984e16; // 2^54
const LG1 = 6.66666666666673513e-1; // 0x3FE55555 55555593
const LG2 = 3.999999999940941908e-1; // 0x3FD99999 9997FA04
const LG3 = 2.857142874366239149e-1; // 0x3FD24924 94229359
const LG4 = 2.222219843214978396e-1; // 0x3FCC71C5 1D8E78AF
const LG5 = 1.818357216161805012e-1; // 0x3FC74664 96CB03DE
const LG6 = 1.531383769920937332e-1; // 0x3FC39A09 D078C69F
const LG7 = 1.479819860511658591e-1; // 0x3FC2F112 DF3E5244

/** Natural logarithm of `x`, bit-identical on every platform. */
export function log(x: number): number {
  let hx = highWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    // x < 2^-1022: zero, negative, NaN with the sign bit set, or subnormal.
    if (((hx & 0x7fffffff) | lowWord(x)) === 0) return -Infinity; // log(±0)
    if (hx < 0) return NaN; // log(negative)
    k -= 54;
    x *= TWO54; // Scale the subnormal up.
    hx = highWord(x);
  }
  if (hx >= 0x7ff00000) return x + x; // Infinity or NaN
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  x = withHighWord(x, hx | (i ^ 0x3ff00000)); // Normalize x or x/2 into [sqrt(2)/2, sqrt(2)).
  k += i >> 20;
  const f = x - 1;
  const dk = k;
  if ((0x000fffff & (2 + hx)) < 3) {
    // |f| < 2^-20
    if (f === 0) return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO;
    const r = f * f * (0.5 - 0.3333333333333333 * f);
    if (k === 0) return f - r;
    return dk * LN2_HI - (r - dk * LN2_LO - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const r = t2 + t1;
  if (((hx - 0x6147a) | (0x6b851 - hx)) > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + r));
    return dk * LN2_HI - (hfsq - (s * (hfsq + r) + dk * LN2_LO) - f);
  }
  if (k === 0) return f - s * (f - r);
  return dk * LN2_HI - (s * (f - r) - dk * LN2_LO - f);
}

// ===================================================================================================
// pow (e_pow.c). fdlibm 5.3's special cases already match ECMAScript's Math.pow, e.g.
// (±1)^±Infinity and 1^NaN are NaN.

const DP_H1 = 5.84962487220764160156e-1; // 0x3FE2B803 40000000: log2(1.5) high
const DP_L1 = 1.35003920212974897128e-8; // 0x3E4CFDEB 43CFD006: log2(1.5) low
const TWO53 = 9007199254740992; // 2^53
const TINY = 1.0e-300;
// Polynomial for (3/2)·(log(x) − 2s − (2/3)s^3).
const L1 = 5.99999999999994648725e-1; // 0x3FE33333 33333303
const L2 = 4.28571428578550184252e-1; // 0x3FDB6DB6 DB6FABFF
const L3 = 3.33333329818377432918e-1; // 0x3FD55555 518F264D
const L4 = 2.72728123808534006489e-1; // 0x3FD17460 A91D4101
const L5 = 2.30660745775561754067e-1; // 0x3FCD864A 93C9DB65
const L6 = 2.06975017800338417784e-1; // 0x3FCA7E28 4A454EEF
const POW_LG2 = 6.93147180559945286227e-1; // 0x3FE62E42 FEFA39EF
const POW_LG2_H = 6.93147182464599609375e-1; // 0x3FE62E43 00000000
const POW_LG2_L = -1.90465429995776804525e-9; // 0xBE205C61 0CA86C39
const OVT = 8.008566259537294e-17; // −(1024 − log2(ovfl + 0.5 ulp))
const CP = 9.61796693925975554329e-1; // 0x3FEEC709 DC3A03FD = 2/(3·ln2)
const CP_H = 9.61796700954437255859e-1; // 0x3FEEC709 E0000000 = (float)CP
const CP_L = -7.02846165095275826516e-9; // 0xBE3E2FE0 145B01F5 = tail of CP_H
const IVLN2 = 1.442695040888963387; // 0x3FF71547 652B82FE = 1/ln2
const IVLN2_H = 1.44269502162933349609; // 0x3FF71547 60000000 = 24 bits of 1/ln2
const IVLN2_L = 1.92596299112661746887e-8; // 0x3E54AE0B F85DDF44 = 1/ln2 tail
const TWOM54 = 5.551115123125783e-17; // 2^-54

/** Classifies y for x < 0: 0 = not an integer, 1 = odd integer, 2 = even integer. */
function integerKind(iy: number, ly: number): number {
  if (iy >= 0x43400000) return 2; // |y| ≥ 2^53: even
  if (iy < 0x3ff00000) return 0; // |y| < 1
  const k = (iy >> 20) - 0x3ff; // exponent
  if (k > 20) {
    const j = ly >>> (52 - k);
    return (j << (52 - k)) >>> 0 === ly ? 2 - (j & 1) : 0;
  }
  if (ly !== 0) return 0;
  const j = iy >> (20 - k);
  return j << (20 - k) === iy ? 2 - (j & 1) : 0;
}

/** x raised to the power y, bit-identical on every platform. */
export function pow(x: number, y: number): number {
  const hx = highWord(x);
  const lx = lowWord(x);
  const hy = highWord(y);
  const ly = lowWord(y);
  let ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;

  if ((iy | ly) === 0) return 1; // x^±0 = 1, even for NaN
  if (Number.isNaN(x) || Number.isNaN(y)) return x + y; // NaN

  const yisint = hx < 0 ? integerKind(iy, ly) : 0;

  // Special values of y.
  if (ly === 0) {
    if (iy === 0x7ff00000) {
      // y is ±Infinity
      if (((ix - 0x3ff00000) | lx) === 0) return y - y; // (±1)^±Infinity is NaN
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0; // (|x| > 1)^±Infinity = Infinity, 0
      return hy < 0 ? -y : 0; // (|x| < 1)^∓Infinity = Infinity, 0
    }
    if (iy === 0x3ff00000) return hy < 0 ? 1 / x : x; // y is ±1
    if (hy === 0x40000000) return x * x; // y is 2
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x); // y is 0.5 and x ≥ +0
  }

  let ax = Math.abs(x);
  // Special values of x: ±0, ±Infinity, ±1.
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    let z = hy < 0 ? 1 / ax : ax;
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0)
        z = NaN; // (−1)^non-integer
      else if (yisint === 1) z = -z; // (x < 0)^odd = −(|x|^odd)
    }
    return z;
  }

  const xNegative = hx < 0;
  if (xNegative && yisint === 0) return NaN; // (x < 0)^non-integer
  const s = xNegative && yisint === 1 ? -1 : 1; // Sign of the result.

  let t1: number;
  let t2: number;
  if (iy > 0x41e00000) {
    // |y| > 2^31
    if (iy > 0x43f00000) {
      // |y| > 2^64: must overflow or underflow.
      if (ix <= 0x3fefffff) return hy < 0 ? HUGE * HUGE : TINY * TINY;
      return hy > 0 ? HUGE * HUGE : TINY * TINY;
    }
    // Overflow or underflow unless x is close to one.
    if (ix < 0x3fefffff) return hy < 0 ? s * HUGE * HUGE : s * TINY * TINY;
    if (ix > 0x3ff00000) return hy > 0 ? s * HUGE * HUGE : s * TINY * TINY;
    // |1 − x| ≤ 2^-20, so log(x) ≈ x − x²/2 + x³/3 − x⁴/4.
    const d = ax - 1; // d has 20 trailing zeros
    const w = d * d * (0.5 - d * (0.3333333333333333 - d * 0.25));
    const u = IVLN2_H * d; // IVLN2_H has 21 significant bits
    const v = d * IVLN2_L - w * IVLN2;
    t1 = clearLowWord(u + v);
    t2 = v - (t1 - u);
  } else {
    let n = 0;
    if (ix < 0x00100000) {
      // Subnormal x.
      ax *= TWO53;
      n -= 53;
      ix = highWord(ax);
    }
    n += (ix >> 20) - 0x3ff;
    const j = ix & 0x000fffff;
    // Pick the interval: k = 0 for |x| < sqrt(3/2), 1 for |x| < sqrt(3), else halve.
    ix = j | 0x3ff00000;
    let k = 0;
    if (j > 0x3988e) {
      if (j < 0xbb67a) {
        k = 1;
      } else {
        n += 1;
        ix -= 0x00100000;
      }
    }
    ax = withHighWord(ax, ix);
    const bp = k === 0 ? 1 : 1.5;
    const dpH = k === 0 ? 0 : DP_H1;
    const dpL = k === 0 ? 0 : DP_L1;

    // ss = sH + sL = (x − 1)/(x + 1) or (x − 1.5)/(x + 1.5).
    let u = ax - bp;
    let v = 1 / (ax + bp);
    const ss = u * v;
    const sH = clearLowWord(ss);
    // tH = ax + bp, high part.
    let tH = fromWords(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
    let tL = ax - (tH - bp);
    const sL = v * (u - sH * tH - sH * tL);
    // log(ax)
    let s2 = ss * ss;
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += sL * (sH + ss);
    s2 = sH * sH;
    tH = clearLowWord(3 + s2 + r);
    tL = r - (tH - 3 - s2);
    // u + v = ss·(1 + …)
    u = sH * tH;
    v = sL * tH + tL * ss;
    // 2/(3·log2)·(ss + …)
    const pH = clearLowWord(u + v);
    const pL = v - (pH - u);
    const zH = CP_H * pH; // CP_H + CP_L = 2/(3·log2)
    const zL = CP_L * pH + pL * CP + dpL;
    // log2(ax) = (ss + …)·2/(3·log2) = n + dpH + zH + zL
    t1 = clearLowWord(zH + zL + dpH + n);
    t2 = zL - (t1 - n - dpH - zH);
  }

  // Split y into y1 + y2 and compute (y1 + y2)·(t1 + t2).
  const y1 = clearLowWord(y);
  const pL = (y - y1) * t1 + y * t2;
  let pH = y1 * t1;
  let z = pL + pH;
  let j = highWord(z);
  const i = lowWord(z);
  if (j >= 0x40900000) {
    // z ≥ 1024
    if (((j - 0x40900000) | i) !== 0) return s * HUGE * HUGE; // z > 1024: overflow
    if (pL + OVT > z - pH) return s * HUGE * HUGE; // overflow
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    // z ≤ −1075
    if (((j - 0xc090cc00) | i) !== 0) return s * TINY * TINY; // z < −1075: underflow
    if (pL <= z - pH) return s * TINY * TINY; // underflow
  }

  // 2^(pH + pL)
  const iz = j & 0x7fffffff;
  let k = (iz >> 20) - 0x3ff;
  let n = 0;
  if (iz > 0x3fe00000) {
    // |z| > 0.5: n = [z + 0.5]
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff; // new k for n
    const whole = fromWords(n & ~(0x000fffff >> k), 0);
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    pH -= whole;
  }
  const t = clearLowWord(pL + pH);
  const u = t * POW_LG2_H;
  const v = (pL - (t - pH)) * POW_LG2 + t * POW_LG2_L;
  z = u + v;
  const w = v - (z - u);
  const tt = z * z;
  const tp = z - tt * (P1 + tt * (P2 + tt * (P3 + tt * (P4 + tt * P5))));
  const r = (z * tp) / (tp - 2) - (w + z * w);
  z = 1 - (r - z);
  j = highWord(z) + (n << 20);
  if (j >> 20 <= 0) {
    // Subnormal result: scalbn(z, n) with a single rounding.
    z = withHighWord(z, (highWord(z) & 0x800fffff) | (((j >> 20) + 54) << 20)) * TWOM54;
  } else {
    z = withHighWord(z, j);
  }
  return s * z;
}

// ===================================================================================================
// atan2 (e_atan2.c, s_atan.c). atan is specialised to the finite, non-negative ratios atan2 feeds
// it; e_atan2.c's x == 1 shortcut to atan(y) is dropped because the general path returns the same bits.

const ATAN_HALF_HI = 4.63647609000806093515e-1; // 0x3FDDAC67 0561BB4F: atan(0.5) high
const ATAN_HALF_LO = 2.26987774529616870924e-17; // 0x3C7A2B7F 222F65E2: atan(0.5) low
const ATAN_ONE_HI = 7.85398163397448278999e-1; // 0x3FE921FB 54442D18: atan(1) high
const ATAN_ONE_LO = 3.06161699786838301793e-17; // 0x3C81A626 33145C07: atan(1) low
const ATAN_1P5_HI = 9.82793723247329054082e-1; // 0x3FEF730B D281F69B: atan(1.5) high
const ATAN_1P5_LO = 1.39033110312309984516e-17; // 0x3C700788 7AF0CBBD: atan(1.5) low
const ATAN_INF_HI = 1.570796326794896558; // 0x3FF921FB 54442D18: atan(∞) high
const ATAN_INF_LO = 6.12323399573676603587e-17; // 0x3C91A626 33145C07: atan(∞) low
const AT0 = 3.33333333333329318027e-1; // 0x3FD55555 5555550D
const AT1 = -1.99999999998764832476e-1; // 0xBFC99999 9998EBC4
const AT2 = 1.42857142725034663711e-1; // 0x3FC24924 920083FF
const AT3 = -1.1111110405462355788e-1; // 0xBFBC71C6 FE231671
const AT4 = 9.09088713343650656196e-2; // 0x3FB745CD C54C206E
const AT5 = -7.69187620504482999495e-2; // 0xBFB3B0F2 AF749A6D
const AT6 = 6.66107313738753120669e-2; // 0x3FB10D66 A0D03D51
const AT7 = -5.83357013379057348645e-2; // 0xBFADDE2D 52DEFD9A
const AT8 = 4.97687799461593236017e-2; // 0x3FA97B4B 24760DEB
const AT9 = -3.6531572744216915527e-2; // 0xBFA2B444 2C6A6C2F
const AT10 = 1.62858201153657823623e-2; // 0x3F90AD3A E322DA11

/** (s1 + s2) of s_atan.c: atan(x) ≈ x − x·atanPoly(x) on [−7/16, 7/16]. */
function atanPoly(x: number): number {
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  return s1 + s2;
}

/** atan(x) for finite x ≥ +0 below 2^66 (s_atan.c without its sign and huge-argument paths). */
function atanPositive(x: number): number {
  const ix = highWord(x);
  if (ix < 0x3fdc0000) {
    // x < 0.4375
    if (ix < 0x3e200000) return x; // x < 2^-29
    return x - x * atanPoly(x);
  }
  let hi: number;
  let lo: number;
  let t: number;
  if (ix < 0x3ff30000) {
    if (ix < 0x3fe60000) {
      // 7/16 ≤ x < 11/16
      hi = ATAN_HALF_HI;
      lo = ATAN_HALF_LO;
      t = (2 * x - 1) / (2 + x);
    } else {
      // 11/16 ≤ x < 19/16
      hi = ATAN_ONE_HI;
      lo = ATAN_ONE_LO;
      t = (x - 1) / (x + 1);
    }
  } else if (ix < 0x40038000) {
    // 19/16 ≤ x < 39/16
    hi = ATAN_1P5_HI;
    lo = ATAN_1P5_LO;
    t = (x - 1.5) / (1 + 1.5 * x);
  } else {
    // 39/16 ≤ x
    hi = ATAN_INF_HI;
    lo = ATAN_INF_LO;
    t = -1 / x;
  }
  return hi - (t * atanPoly(t) - lo - t);
}

const PI_O_4 = 7.85398163397448279e-1; // 0x3FE921FB 54442D18
const PI_O_2 = 1.570796326794896558; // 0x3FF921FB 54442D18
const PI = 3.141592653589793116; // 0x400921FB 54442D18
const PI_LO = 1.2246467991473532e-16; // 0x3CA1A626 33145C07

/** The angle of the point (x, y) from the positive x axis, in (−π, π]; bit-identical everywhere. */
export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return x + y;
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  const hy = highWord(y);
  const iy = hy & 0x7fffffff;
  const xNegative = hx < 0;
  const yNegative = hy < 0;

  if ((iy | lowWord(y)) === 0) {
    // y = ±0: atan2(±0, +x) = ±0, atan2(±0, −x) = ±π.
    if (!xNegative) return y;
    return yNegative ? -PI : PI;
  }
  if ((ix | lowWord(x)) === 0) return yNegative ? -PI_O_2 : PI_O_2; // x = ±0
  if (ix === 0x7ff00000) {
    // x = ±Infinity
    if (iy === 0x7ff00000) {
      if (xNegative) return yNegative ? -3 * PI_O_4 : 3 * PI_O_4;
      return yNegative ? -PI_O_4 : PI_O_4;
    }
    if (xNegative) return yNegative ? -PI : PI;
    return yNegative ? -0 : 0;
  }
  if (iy === 0x7ff00000) return yNegative ? -PI_O_2 : PI_O_2; // y = ±Infinity

  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60)
    z = PI_O_2 + 0.5 * PI_LO; // |y/x| > 2^60
  else if (xNegative && k < -60)
    z = 0; // |y|/x < −2^60
  else z = atanPositive(Math.abs(y / x));
  if (!xNegative) return yNegative ? -z : z;
  return yNegative ? z - PI_LO - PI : PI - (z - PI_LO);
}

// ===================================================================================================
// hypot. V8's own Math.hypot algorithm (Torque MathHypot) in plain JS: scale every term by the
// largest magnitude, so nothing overflows or underflows early, then sum the squares with Kahan
// compensation. It uses only correctly rounded operations, so it gives the same bits everywhere and
// exactly V8's Math.hypot. fdlibm's e_hypot.c was measured too: slightly more accurate (< 1 ulp
// against ~1.3 ulp) but up to 2 ulp from Math.hypot, which fails AC-2 against Math.

/** sqrt(sum of squares of the arguments), as Math.hypot; bit-identical on every platform. */
export function hypot(...values: number[]): number {
  let max = 0;
  for (const value of values) {
    const magnitude = Math.abs(value);
    if (magnitude === Infinity) return Infinity; // Infinity wins over NaN.
    max = Math.max(max, magnitude); // NaN propagates.
  }
  if (Number.isNaN(max)) return NaN;
  if (max === 0) return 0;
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const n = Math.abs(value) / max;
    const summand = n * n - compensation;
    const preliminary = sum + summand;
    compensation = preliminary - sum - summand;
    sum = preliminary;
  }
  return Math.sqrt(sum) * max;
}
