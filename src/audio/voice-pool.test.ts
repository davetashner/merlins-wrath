import { describe, expect, it } from 'vitest';
import { MAX_VOICES, pickVictim, type VoiceRank } from './voice-pool.ts';

const v = (priority: number, distance: number, seq: number): VoiceRank => ({
  priority,
  distance,
  seq,
});

describe('pickVictim', () => {
  it('budgets 48 voices on High and 24 on Low', () => {
    expect(MAX_VOICES).toEqual({ high: 48, low: 24 });
  });

  it('rejects when there is nothing to steal', () => {
    expect(pickVictim<VoiceRank>([], { priority: 100, distance: 0 })).toBeUndefined();
  });

  it('AC-2: picks the lowest priority, then the farthest, then the oldest', () => {
    const low = v(10, 5, 3);
    const lowFar = v(10, 20, 4);
    const lowFarOld = v(10, 20, 1);
    const voices = [v(50, 30, 0), low, lowFar, lowFarOld, v(90, 40, 2)];
    expect(pickVictim(voices, { priority: 11, distance: 0 })).toBe(lowFarOld);
  });

  it('AC-2: steals only when the request outranks the candidate', () => {
    const voices = [v(50, 10, 0), v(50, 20, 1)];
    expect(pickVictim(voices, { priority: 49, distance: 0 })).toBeUndefined();
    expect(pickVictim(voices, { priority: 50, distance: 20 })).toBeUndefined();
    expect(pickVictim(voices, { priority: 50, distance: 19 })).toBe(voices[1]);
    expect(pickVictim(voices, { priority: 51, distance: 100 })).toBe(voices[1]);
  });
});
