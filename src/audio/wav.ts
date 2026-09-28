// Minimal 16-bit PCM WAV encoder (mw-e28.1). Lets tests, testbeds and the placeholder generator
// (mw-e28.2) make real, decodable audio files in code instead of committing binaries.

/** Encodes mono float samples in [-1, 1] as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(clamped * 0x7fff), true);
  });
  return bytes;
}

/** A sine tone with 5 ms fades, e.g. for a test cue. */
export function sineTone(frequency: number, seconds: number, sampleRate: number): Float32Array {
  const length = Math.round(seconds * sampleRate);
  const fade = Math.max(1, Math.round(sampleRate * 0.005));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const envelope = Math.min(1, i / fade, (length - 1 - i) / fade);
    out[i] = 0.25 * envelope * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return out;
}
