import { describe, expect, it } from 'vitest';
import { FakeAudioContext, FakeBuffer, FakeSource } from './fake-context.ts';

// The test double's own edge cases, so tests built on it can trust it.
describe('FakeAudioContext', () => {
  it('turns a throwing decoder into a rejection', async () => {
    const ctx = new FakeAudioContext({
      decode: () => {
        throw new Error('bad bytes');
      },
    });
    await expect(ctx.decodeAudioData(new ArrayBuffer(1))).rejects.toThrow('bad bytes');
  });

  it('buffers expose duration and refuse missing channels', () => {
    const buffer = new FakeBuffer(1, 24_000, 48_000);
    expect(buffer.duration).toBe(0.5);
    expect(() => buffer.getChannelData(1)).toThrow(RangeError);
  });

  it('ending a source without a handler is a no-op', () => {
    const source = new FakeSource();
    expect(() => {
      source.end();
    }).not.toThrow();
  });
});
