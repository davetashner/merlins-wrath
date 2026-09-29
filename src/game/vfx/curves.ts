// Particle curves (mw-e29.1): an effect's size, colour and alpha over a particle's life are baked into
// small lookup tables when the effect is compiled, so the per-particle work each frame is one table
// read instead of a key search, and nothing is allocated while effects run.

import { at } from './indexing.ts';

/** A number over a particle's life (content `VfxScalarCurve`, read-only). */
export type ScalarCurve = number | readonly { readonly t: number; readonly v: number }[];

/** A colour over a particle's life (content `VfxColourCurve`, read-only). */
export type ColourCurve = string | readonly { readonly t: number; readonly color: string }[];

/** Samples per baked curve; linear interpolation between them is invisible at particle sizes. */
export const CURVE_SAMPLES = 32;

/** Linear interpolation of time-ordered keys at `t`, clamped to the first and last key. */
function interpolate<K extends { readonly t: number }>(
  keys: readonly K[],
  t: number,
  value: (key: K) => number,
): number {
  const first = at(keys, 0); // curves have at least one key (schema)
  if (t <= first.t) return value(first);
  for (let i = 1; i < keys.length; i++) {
    const b = at(keys, i);
    if (t <= b.t) {
      const a = at(keys, i - 1);
      // a.t < t here (an earlier key would have matched otherwise), so the span is never 0.
      return value(a) + ((value(b) - value(a)) * (t - a.t)) / (b.t - a.t);
    }
  }
  return value(at(keys, keys.length - 1));
}

/** Bakes a number curve into CURVE_SAMPLES values from t = 0 to t = 1. */
export function bakeScalar(curve: ScalarCurve): Float32Array {
  const table = new Float32Array(CURVE_SAMPLES);
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    const t = i / (CURVE_SAMPLES - 1);
    table[i] = typeof curve === 'number' ? curve : interpolate(curve, t, (k) => k.v);
  }
  return table;
}

/** `#RRGGBB` → [r, g, b] in 0–1 (sRGB). */
export function parseHexColour(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/** Bakes a colour curve into CURVE_SAMPLES rgb triples (sRGB 0–1), interleaved. */
export function bakeColour(curve: ColourCurve): Float32Array {
  const table = new Float32Array(CURVE_SAMPLES * 3);
  const keys =
    typeof curve === 'string'
      ? [{ t: 0, rgb: parseHexColour(curve) }]
      : curve.map((k) => ({ t: k.t, rgb: parseHexColour(k.color) }));
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    const t = i / (CURVE_SAMPLES - 1);
    for (let c = 0; c < 3; c++) table[i * 3 + c] = interpolate(keys, t, (k) => at(k.rgb, c));
  }
  return table;
}

/** Index into a baked table for life fraction `t` (clamped to 0–1). */
export function sampleIndex(t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.round(clamped * (CURVE_SAMPLES - 1));
}
