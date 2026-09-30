// A tiny deterministic synthesiser for placeholder sounds (mw-e28.2): layers of filtered noise,
// tones and clicks under simple envelopes, rendered to mono float samples. Placeholders only need to
// read as "a clang", "a footstep on gravel" or "a whoosh" until the final assets arrive (audio bible
// §9.3), so this is deliberately small. Every random draw comes from a seeded PRNG, so a recipe and
// seed always render the same samples.

/**
 * Sample rate of placeholder files. Final assets are 48 kHz (audio bible §5.4); placeholders are
 * stand-ins, a third of the size at this rate (8 kHz of bandwidth), and the AudioContext resamples
 * them on decode.
 */
export const PLACEHOLDER_RATE = 16_000;

/** When a layer sounds, relative to the start of the sound, and how it fades. */
export interface Envelope {
  /** Onset in seconds (default 0). */
  readonly start?: number;
  /** Linear rise in seconds (0 = instant). */
  readonly attack: number;
  /** Flat top after the attack, in seconds (default 0). */
  readonly hold?: number;
  /** Exponential decay time constant in seconds after the hold. */
  readonly decay: number;
}

export type FilterKind = 'lowpass' | 'bandpass' | 'highpass';

/** Filtered white noise: the body of impacts, whooshes, breaths and steps. */
export interface NoiseLayer extends Envelope {
  readonly kind: 'noise';
  readonly filter: FilterKind;
  /** Filter frequency in Hz at the layer's onset. */
  readonly freq: number;
  /** Filter frequency at the end of the sound (exponential sweep); default: no sweep. */
  readonly to?: number;
  /** Filter Q (default 0.9). */
  readonly q?: number;
  readonly gain: number;
  /** 0–1: chops the noise into random 4 ms grains (gravel, straw, rattles); default: continuous. */
  readonly grain?: number;
}

export type Wave = 'sine' | 'triangle' | 'square' | 'saw';

/** A pitched tone: thumps, rings, chimes and twangs. */
export interface ToneLayer extends Envelope {
  readonly kind: 'tone';
  readonly freq: number;
  /** Frequency at the end of the sound (exponential sweep); default: no sweep. */
  readonly to?: number;
  readonly wave?: Wave;
  readonly gain: number;
}

/** A 3 ms bright noise tick: the transient on top of an impact or a UI click. */
export interface ClickLayer {
  readonly kind: 'click';
  readonly start?: number;
  readonly gain: number;
}

export type Layer = NoiseLayer | ToneLayer | ClickLayer;

/** One sound: its length, layers and the peak level it is normalised to. */
export interface Recipe {
  readonly duration: number;
  readonly layers: readonly Layer[];
  /** Peak level in dBFS after normalisation (SFX −3, audio bible §5.1; quieter for UI, sneaking). */
  readonly peakDb: number;
  /** A loop keeps its full length (its seam is the file's ends); one-shots lose their silent tail. */
  readonly loop?: boolean;
}

/** A seeded PRNG (mulberry32): uniform floats in [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** FNV-1a hash of a string, e.g. an asset id as its seed. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Envelope gain `t` seconds after the layer's onset. */
export function envelopeAt(env: Envelope, t: number): number {
  if (t < 0) return 0;
  if (t < env.attack) return t / env.attack;
  const after = t - env.attack - (env.hold ?? 0);
  return after <= 0 ? 1 : Math.exp(-after / env.decay);
}

/** Frequency of an exponential sweep from `from` to `to` at fraction `u` of the way. */
function sweep(from: number, to: number | undefined, u: number): number {
  return to === undefined ? from : from * Math.pow(to / from, u);
}

/** One cycle of a waveform at phase `p` in [0, 1). */
export function waveAt(wave: Wave, p: number): number {
  switch (wave) {
    case 'sine':
      return Math.sin(2 * Math.PI * p);
    case 'triangle':
      return 1 - 4 * Math.abs(p - 0.5);
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'saw':
      return 2 * p - 1;
  }
}

/** Biquad coefficients [b0, b1, b2, a1, a2]. */
export type Coeffs = [number, number, number, number, number];

/** RBJ biquad coefficients, normalised by a0. */
export function biquad(kind: FilterKind, freq: number, q: number, rate: number): Coeffs {
  const w = (2 * Math.PI * Math.min(freq, rate * 0.45)) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  let b: [number, number, number];
  if (kind === 'lowpass') b = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else if (kind === 'highpass') b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  else b = [alpha, 0, -alpha];
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

/** How often a swept filter recomputes its coefficients, in samples. */
const SWEEP_BLOCK = 16;
/** Grain length for `grain` noise, in seconds. */
const GRAIN_S = 0.004;

/** A layer being rendered: called once per sample index, in order, it returns that sample. */
type Voice = (i: number) => number;

function noiseVoice(layer: NoiseLayer, span: number, rate: number, rand: () => number): Voice {
  const start = Math.round((layer.start ?? 0) * rate);
  const q = layer.q ?? 0.9;
  const grainLen = Math.max(1, Math.round(GRAIN_S * rate));
  let [b0, b1, b2, a1, a2] = biquad(layer.filter, layer.freq, q, rate);
  let [x1, x2, y1, y2] = [0, 0, 0, 0];
  let gate = 1;
  return (index) => {
    const i = index - start;
    if (i < 0) return 0;
    if (layer.to !== undefined && i % SWEEP_BLOCK === 0) {
      const freq = sweep(layer.freq, layer.to, i / (span - start));
      [b0, b1, b2, a1, a2] = biquad(layer.filter, freq, q, rate);
    }
    if (layer.grain !== undefined && i % grainLen === 0) gate = rand() < layer.grain ? 1 : 0.05;
    const x = rand() * 2 - 1;
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    [x2, x1, y2, y1] = [x1, x, y1, y];
    return y * gate * layer.gain * envelopeAt(layer, i / rate);
  };
}

function toneVoice(layer: ToneLayer, span: number, rate: number): Voice {
  const start = Math.round((layer.start ?? 0) * rate);
  let phase = 0;
  return (index) => {
    const i = index - start;
    if (i < 0) return 0;
    const value = waveAt(layer.wave ?? 'sine', phase) * layer.gain * envelopeAt(layer, i / rate);
    phase = (phase + sweep(layer.freq, layer.to, i / (span - start)) / rate) % 1;
    return value;
  };
}

/** Click length in seconds. */
const CLICK_S = 0.003;

function clickVoice(layer: ClickLayer, rate: number, rand: () => number): Voice {
  const start = Math.round((layer.start ?? 0) * rate);
  const len = Math.round(CLICK_S * rate);
  let last = 0;
  return (index) => {
    const i = index - start;
    if (i < 0 || i >= len) return 0;
    const x = rand() * 2 - 1;
    // First difference: a bright, thin tick rather than a dull thump.
    const value = (x - last) * 0.5 * layer.gain * (1 - i / len);
    last = x;
    return value;
  };
}

/** Fade length at both ends, so no file starts or ends on a click. */
const EDGE_FADE_S = 0.002;

/** Renders a recipe to mono samples, faded at both ends and peak-normalised to `peakDb`. */
export function render(
  recipe: Recipe,
  seed: number,
  rate: number = PLACEHOLDER_RATE,
): Float32Array {
  const length = Math.round(recipe.duration * rate);
  const rand = prng(seed);
  const voices = recipe.layers.map((layer): Voice => {
    if (layer.kind === 'noise') return noiseVoice(layer, length, rate, rand);
    if (layer.kind === 'tone') return toneVoice(layer, length, rate);
    return clickVoice(layer, rate, rand);
  });
  const fade = Math.max(1, Math.round(EDGE_FADE_S * rate));
  const mixed = Float32Array.from({ length }, (_, i) => {
    const edge = Math.min(1, i / fade, (length - 1 - i) / fade);
    return voices.reduce((sum, voice) => sum + voice(i), 0) * edge;
  });
  const peak = mixed.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  if (peak === 0) return mixed;
  const scale = Math.pow(10, recipe.peakDb / 20) / peak;
  const scaled = mixed.map((value) => value * scale);
  return recipe.loop === true ? scaled : trimTail(scaled, peak * scale, rate);
}

/** Tail below this level (dB under the peak) is cut; it would be inaudible under the mix anyway. */
export const TAIL_FLOOR_DB = -48;

/** Cuts a decayed tail (keeps the length for loops), ending on a short fade. */
export function trimTail(samples: Float32Array, peak: number, rate: number): Float32Array {
  const floor = peak * Math.pow(10, TAIL_FLOOR_DB / 20);
  const last = samples.findLastIndex((value) => Math.abs(value) > floor);
  const fade = Math.max(1, Math.round(EDGE_FADE_S * rate));
  const end = Math.min(samples.length, last + 1 + fade);
  return samples.slice(0, end).map((value, i) => value * Math.min(1, (end - 1 - i) / fade));
}

/**
 * A round-robin variant of a recipe: frequencies, decays and gains nudged by up to ±`amount`
 * (a fraction), so repeats of one sound don't read as a machine gun.
 */
export function vary(recipe: Recipe, rand: () => number, amount: number): Recipe {
  const nudge = (value: number): number => value * (1 + (rand() * 2 - 1) * amount);
  const layers = recipe.layers.map((layer): Layer => {
    if (layer.kind === 'click') return { ...layer, gain: nudge(layer.gain) };
    const pitch = nudge(1);
    const shaped = { ...layer, freq: layer.freq * pitch, decay: nudge(layer.decay) };
    const swept = layer.to === undefined ? shaped : { ...shaped, to: layer.to * pitch };
    return { ...swept, gain: nudge(layer.gain) };
  });
  return { ...recipe, layers };
}
