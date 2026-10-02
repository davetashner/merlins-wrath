// Procedural placeholder VFX textures (mw-e29.2): the shapes a particle or decal needs to read in
// the testbed until approved art lands. Every recipe is a pure function of the pixel, its flipbook
// frame and a seeded value-noise field, so a sheet is fully determined by its spec and seed.
// Particle textures are white (the effect's colour curve tints them) with the shape in alpha; decals
// carry their own colour. Shapes follow the base set in the asset plan (soft circle, spark streak,
// smoke noise, ring, shard, flame flipbook), the six spell VFX templates and the four decals.

import { prng } from '../audio/synth.ts';

/** What a sheet looks like. */
export type TextureKind =
  | 'soft-circle'
  | 'spark-streak'
  | 'smoke-noise'
  | 'ring'
  | 'shard'
  | 'flame'
  | 'cast-windup'
  | 'projectile-head'
  | 'projectile-trail'
  | 'impact'
  | 'area-ring'
  | 'beam'
  | 'scorch'
  | 'frost'
  | 'wet'
  | 'arrow-hole';

/** One placeholder texture: its final asset id, shape and sheet layout. */
export interface TextureSpec {
  readonly id: string;
  readonly kind: TextureKind;
  /** Pixels per frame cell (square). */
  readonly cell: number;
  /** Flipbook grid; 1 × 1 for a plain texture. */
  readonly cols: number;
  readonly rows: number;
}

/** A pixel: colour 0–1 and alpha 0–1. */
type Rgba = readonly [number, number, number, number];

/** Seeded 2-D value noise in [0, 1] with smooth interpolation, plus a 4-octave sum. */
export class ValueNoise {
  readonly #lattice: Float32Array;
  static readonly SIZE = 64;

  constructor(seed: number) {
    const next = prng(seed);
    this.#lattice = Float32Array.from({ length: ValueNoise.SIZE * ValueNoise.SIZE }, next);
  }

  #at(x: number, y: number): number {
    const s = ValueNoise.SIZE;
    const i = (((y % s) + s) % s) * s + (((x % s) + s) % s);
    return at(this.#lattice, i);
  }

  /** Noise at (x, y), one lattice cell per unit. */
  sample(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const top = lerp(this.#at(x0, y0), this.#at(x0 + 1, y0), fx);
    const bottom = lerp(this.#at(x0, y0 + 1), this.#at(x0 + 1, y0 + 1), fx);
    return lerp(top, bottom, fy);
  }

  /** Four octaves, each twice the frequency and half the weight, normalised to [0, 1]. */
  fbm(x: number, y: number): number {
    let sum = 0;
    let weight = 0.5;
    let scale = 1;
    for (let octave = 0; octave < 4; octave++) {
      sum += this.sample(x * scale + octave * 17, y * scale + octave * 31) * weight;
      weight /= 2;
      scale *= 2;
    }
    return sum / 0.9375;
  }
}

/** `items[i]` for an index known to be in range. */
const at = <T>(items: ArrayLike<T>, i: number): T => items[i] as T;
const smooth = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
/** 0 at or below `edge0`, 1 at or above `edge1`, smooth between. */
const step = (edge0: number, edge1: number, x: number): number =>
  smooth(clamp01((x - edge0) / (edge1 - edge0)));
const white = (alpha: number): Rgba => [1, 1, 1, clamp01(alpha)];
const tinted = (r: number, g: number, b: number, alpha: number): Rgba => [r, g, b, clamp01(alpha)];

/** Inputs of one pixel: centred cell coordinates (u right, v up, both −1…1) and the frame. */
interface Pixel {
  readonly u: number;
  readonly v: number;
  /** Frame index / frame count, 0…1. */
  readonly t: number;
  readonly noise: ValueNoise;
}

/** A soft dot: brightest in the middle, gone at the rim. */
function softCircle({ u, v }: Pixel): Rgba {
  const d = Math.hypot(u, v);
  return white((1 - clamp01(d)) ** 2);
}

const RECIPES: Readonly<Record<TextureKind, (p: Pixel) => Rgba>> = {
  'soft-circle': softCircle,
  'spark-streak': ({ u, v }) => {
    const d = Math.hypot(u, v * 6);
    return white((1 - clamp01(d)) ** 1.5);
  },
  'smoke-noise': ({ u, v, noise }) => {
    const d = Math.hypot(u, v);
    const n = noise.fbm(u * 3 + 8, v * 3 + 8);
    return white((1 - step(0.35, 1, d + (n - 0.5) * 0.6)) * (0.35 + 0.65 * n));
  },
  ring: ({ u, v }) => {
    const d = Math.hypot(u, v);
    return white(Math.exp(-(((d - 0.7) / 0.12) ** 2)));
  },
  shard: ({ u, v, noise }) => {
    const edge =
      Math.abs(u) * 0.9 + Math.abs(v) * 2.6 + (noise.sample(u * 6 + 3, v * 6 + 5) - 0.5) * 0.25;
    const facet = u > 0 === v > 0 ? 1 : 0.7; // two shades read as a broken face
    return tinted(facet, facet, facet, 1 - step(0.85, 0.95, edge));
  },
  flame: ({ u, v, t, noise }) => {
    // A licking tongue rising from the bottom: wide at the base, ragged at the tip, noise scrolling
    // upwards over the frames.
    const h = (v + 1) / 2; // 0 bottom → 1 top
    const sway = (noise.fbm(h * 2 + 4, t * 4) - 0.5) * 0.5 * h;
    const width = 0.85 * (1 - h) ** 0.8 * (0.75 + 0.5 * noise.fbm(u * 2 + 9, (h - t) * 4 + 9));
    const body = 1 - step(width * 0.6, width, Math.abs(u - sway));
    const base = step(0, 0.12, h);
    const core = 1 - step(0, width * 0.7, Math.abs(u - sway));
    return tinted(1, 0.85 + 0.15 * core, 0.6 + 0.4 * core, body * base);
  },
  'cast-windup': ({ u, v }) => {
    const d = Math.hypot(u, v);
    return white(Math.exp(-(((d - 0.6) / 0.15) ** 2)) + 0.4 * (1 - clamp01(d / 0.5)) ** 2);
  },
  'projectile-head': ({ u, v }) => {
    const d = Math.hypot(u, v);
    return white((1 - clamp01(d)) ** 3 + (1 - step(0, 0.25, d)) * 0.5);
  },
  'projectile-trail': ({ u, v }) => {
    const along = (u + 1) / 2; // tail at the left, head at the right
    return white(along ** 1.5 * Math.exp(-((v / (0.15 + 0.35 * along)) ** 2)));
  },
  impact: ({ u, v, noise }) => {
    const d = Math.hypot(u, v);
    const angle = Math.atan2(v, u);
    const rays = noise.sample(Math.cos(angle) * 4 + 20, Math.sin(angle) * 4 + 20);
    const reach = 0.35 + 0.6 * rays ** 2;
    return white((1 - step(reach * 0.5, reach, d)) * (0.5 + 0.5 * (1 - clamp01(d))));
  },
  'area-ring': ({ u, v }) => {
    const d = Math.hypot(u, v);
    return white(Math.exp(-(((d - 0.9) / 0.06) ** 2)) + (d < 0.9 ? 0.12 : 0));
  },
  beam: ({ u, v }) => white(Math.exp(-((u / 0.25) ** 2)) * (1 - step(0.8, 1, Math.abs(v)))),
  scorch: ({ u, v, noise }) => {
    const d = Math.hypot(u, v) + (noise.fbm(u * 2 + 40, v * 2 + 40) - 0.5) * 0.5;
    return tinted(0.1, 0.08, 0.06, (1 - step(0.4, 0.9, d)) * 0.9);
  },
  frost: ({ u, v, noise }) => {
    const d = Math.hypot(u, v) + (noise.fbm(u * 4 + 50, v * 4 + 50) - 0.5) * 0.6;
    const crystals = noise.sample(u * 12 + 60, v * 12 + 60);
    return tinted(0.81, 0.9, 0.95, (1 - step(0.5, 0.95, d)) * (0.4 + 0.6 * crystals));
  },
  wet: ({ u, v, noise }) => {
    const d = Math.hypot(u, v) + (noise.fbm(u * 1.5 + 70, v * 1.5 + 70) - 0.5) * 0.7;
    return tinted(0.13, 0.19, 0.23, (1 - step(0.55, 0.85, d)) * 0.6);
  },
  'arrow-hole': ({ u, v, noise }) => {
    const d = Math.hypot(u, v);
    const angle = Math.atan2(v, u);
    const crack = noise.sample(Math.cos(angle) * 3 + 80, Math.sin(angle) * 3 + 80) ** 6;
    const hole = 1 - step(0.12, 0.2, d);
    const splinter = crack > 0.25 ? 1 - step(0.2, 0.75, d) : 0;
    return tinted(0.06, 0.05, 0.04, Math.max(hole, splinter * 0.8));
  },
};

/** Renders a spec's sheet: RGBA bytes, rows top to bottom, frame 0 in the top-left cell. */
export function renderTexture(spec: TextureSpec, seed: number): Uint8Array {
  const width = spec.cell * spec.cols;
  const height = spec.cell * spec.rows;
  const frames = spec.cols * spec.rows;
  const pixels = new Uint8Array(width * height * 4);
  const noise = new ValueNoise(seed);
  const recipe = RECIPES[spec.kind];
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / spec.cell);
    const v = 1 - (((y % spec.cell) + 0.5) / spec.cell) * 2;
    for (let x = 0; x < width; x++) {
      const column = Math.floor(x / spec.cell);
      const u = (((x % spec.cell) + 0.5) / spec.cell) * 2 - 1;
      const t = (row * spec.cols + column) / frames;
      const [r, g, b, a] = recipe({ u, v, t, noise });
      const i = (y * width + x) * 4;
      pixels[i] = Math.round(r * 255);
      pixels[i + 1] = Math.round(g * 255);
      pixels[i + 2] = Math.round(b * 255);
      pixels[i + 3] = Math.round(a * 255);
    }
  }
  return pixels;
}
