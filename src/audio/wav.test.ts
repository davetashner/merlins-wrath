import { describe, expect, it } from 'vitest';
import { encodeWav, sineTone } from './wav.ts';

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM RIFF header and clamped samples', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2, -2]), 48_000);
    const view = new DataView(wav);
    const text = (at: number) => String.fromCharCode(...new Uint8Array(wav, at, 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(wav.byteLength).toBe(44 + 10);
    expect(view.getUint32(4, true)).toBe(36 + 10);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint32(28, true)).toBe(96_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
    const samples = [0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, 32767, -32767, 32767, -32767]);
  });
});

describe('sineTone', () => {
  it('renders the requested length with silent, faded ends', () => {
    const tone = sineTone(440, 0.1, 48_000);
    expect(tone.length).toBe(4800);
    expect(tone[0]).toBe(0);
    expect(tone.at(-1)).toBeCloseTo(0, 6);
    expect(Math.max(...tone)).toBeCloseTo(0.25, 2);
  });
});
