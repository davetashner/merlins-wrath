import { describe, expect, it } from 'vitest';
import {
  biquad,
  envelopeAt,
  hashSeed,
  PLACEHOLDER_RATE,
  prng,
  render,
  trimTail,
  vary,
  waveAt,
  type Recipe,
} from './synth.ts';

const peakOf = (samples: Float32Array): number =>
  samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

describe('placeholder synth (mw-e28.2)', () => {
  it('the PRNG is seeded and uniform in [0, 1); hashSeed is FNV-1a', () => {
    const a = prng(7);
    const b = prng(7);
    const draws = Array.from({ length: 1000 }, () => a());
    expect(draws).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...draws)).toBeLessThan(1);
    expect(hashSeed('')).toBe(0x811c9dc5);
    expect(hashSeed('sfx-impact-wood-01')).not.toBe(hashSeed('sfx-impact-wood-02'));
  });

  it('envelopes: silent before onset, linear attack, flat hold, exponential decay', () => {
    const env = { attack: 0.1, hold: 0.1, decay: 0.1 };
    expect(envelopeAt(env, -0.01)).toBe(0);
    expect(envelopeAt(env, 0.05)).toBeCloseTo(0.5);
    expect(envelopeAt(env, 0.15)).toBe(1);
    expect(envelopeAt(env, 0.3)).toBeCloseTo(Math.exp(-1));
    expect(envelopeAt({ attack: 0, decay: 0.1 }, 0)).toBe(1);
  });

  it('waveforms span [-1, 1]', () => {
    expect(waveAt('sine', 0.25)).toBeCloseTo(1);
    expect(waveAt('triangle', 0.5)).toBe(1);
    expect(waveAt('triangle', 0)).toBe(-1);
    expect(waveAt('square', 0.25)).toBe(1);
    expect(waveAt('square', 0.75)).toBe(-1);
    expect(waveAt('saw', 0)).toBe(-1);
  });

  it('biquads pass DC (lowpass), block DC (highpass, bandpass), and clamp below Nyquist', () => {
    const dc = ([b0, b1, b2, a1, a2]: number[]) =>
      ((b0 ?? 0) + (b1 ?? 0) + (b2 ?? 0)) / (1 + (a1 ?? 0) + (a2 ?? 0));
    expect(dc(biquad('lowpass', 500, 0.7, 16_000))).toBeCloseTo(1);
    expect(dc(biquad('highpass', 500, 0.7, 16_000))).toBeCloseTo(0);
    expect(dc(biquad('bandpass', 500, 0.7, 16_000))).toBeCloseTo(0);
    expect(biquad('lowpass', 1e6, 0.7, 16_000)).toEqual(biquad('lowpass', 7200, 0.7, 16_000));
  });

  it('renders every layer kind deterministically, peak-normalised, faded at the start', () => {
    const recipe: Recipe = {
      duration: 0.3,
      peakDb: -6,
      layers: [
        { kind: 'click', gain: 1 },
        { kind: 'click', gain: 1, start: 0.29 }, // runs past the end: cut off
        {
          kind: 'noise',
          filter: 'bandpass',
          freq: 500,
          to: 2000,
          gain: 1,
          attack: 0.01,
          decay: 0.05,
          grain: 0.5,
        },
        {
          kind: 'noise',
          filter: 'lowpass',
          freq: 800,
          q: 2,
          gain: 1,
          attack: 0,
          decay: 0.05,
          start: 0.1,
        },
        { kind: 'tone', freq: 200, to: 100, wave: 'saw', gain: 1, attack: 0.001, decay: 0.05 },
        { kind: 'tone', freq: 440, gain: 1, attack: 0.001, decay: 0.05, start: 0.05 },
      ],
    };
    const samples = render(recipe, 42);
    expect(samples).toEqual(render(recipe, 42));
    expect(samples).not.toEqual(render(recipe, 43));
    expect(peakOf(samples)).toBeCloseTo(Math.pow(10, -6 / 20), 5);
    expect(samples[0]).toBe(0);
    expect(samples.length).toBeLessThanOrEqual(Math.round(0.3 * PLACEHOLDER_RATE));
    expect(render(recipe, 42, 8000).length).toBeLessThanOrEqual(0.3 * 8000);
  });

  it('a silent recipe stays silent; one-shots lose their tail; loops keep their length', () => {
    expect(peakOf(render({ duration: 0.1, peakDb: -3, layers: [] }, 1))).toBe(0);
    const ring = { kind: 'tone', freq: 300, gain: 1, attack: 0.001, decay: 0.01 } as const;
    const oneShot = render({ duration: 1, peakDb: -3, layers: [ring] }, 1);
    expect(oneShot.length).toBeLessThan(PLACEHOLDER_RATE / 5);
    expect(Math.abs(oneShot.at(-1) ?? 1)).toBe(0);
    const loop = render({ duration: 1, peakDb: -3, loop: true, layers: [ring] }, 1);
    expect(loop.length).toBe(PLACEHOLDER_RATE);
  });

  it('trimTail keeps everything above the floor and never grows the buffer', () => {
    const loud = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    expect(trimTail(loud, 0.5, 1000).length).toBe(4);
    const quiet = new Float32Array([0.5, 0, 0, 0, 0, 0, 0, 0]);
    expect(trimTail(quiet, 0.5, 1000).length).toBe(3);
  });

  it('variants nudge frequencies, sweeps, decays and gains by at most the spread', () => {
    const recipe: Recipe = {
      duration: 0.2,
      peakDb: -3,
      layers: [
        { kind: 'click', gain: 1 },
        { kind: 'tone', freq: 100, gain: 1, attack: 0, decay: 0.1 },
        { kind: 'noise', filter: 'lowpass', freq: 1000, to: 2000, gain: 1, attack: 0, decay: 0.1 },
      ],
    };
    const varied = vary(recipe, prng(3), 0.1);
    const [click, tone, noise] = varied.layers;
    expect(click?.gain).toBeGreaterThanOrEqual(0.9);
    expect(click?.gain).toBeLessThanOrEqual(1.1);
    if (tone?.kind !== 'tone' || noise?.kind !== 'noise') throw new Error('layer kinds kept');
    expect(tone.to).toBeUndefined();
    expect(Math.abs(tone.freq - 100)).toBeLessThanOrEqual(10);
    expect(noise.to !== undefined && noise.to / noise.freq).toBeCloseTo(2);
    expect(Math.abs(noise.decay - 0.1)).toBeLessThanOrEqual(0.01);
    expect(varied.duration).toBe(0.2);
  });
});
