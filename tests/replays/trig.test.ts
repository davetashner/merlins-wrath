// The core golden exercises simMath's transcendentals (mw-e00.29). Its trig-driven motion is what
// proves cross-platform bit-identity: the golden is recorded on macOS arm64 and replayed in CI on
// Linux x64 (AC-1, via golden.test.ts). Here simMath.sin is wrapped so a test can nudge its result by
// one ulp, showing that the golden is sensitive to the last bit of a transcendental (AC-2).
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ReplayAssertionError, expectReplay } from '@tools/replay/expect-replay';
import { GOLDEN_REPLAY_DIR } from '@tools/replay/files';

const nudge = vi.hoisted(() => ({ ulps: 0, calls: 0 }));

vi.mock('@sim/math', async (importOriginal) => {
  const math = await importOriginal<typeof import('@sim/math')>();
  const view = new DataView(new ArrayBuffer(8));
  return {
    ...math,
    sin(x: number): number {
      nudge.calls++;
      const y = math.sin(x);
      if (nudge.ulps === 0 || y === 0) return y;
      // Step the bit pattern away from zero: one ulp larger in magnitude.
      view.setFloat64(0, y);
      view.setBigInt64(0, view.getBigInt64(0) + BigInt(nudge.ulps));
      return view.getFloat64(0);
    },
  };
});

const golden = join(GOLDEN_REPLAY_DIR, 'core.json');

describe('core golden and simMath transcendentals', () => {
  it('AC-1: replays the core golden bit-for-bit, driving its motion through simMath.sin', () => {
    nudge.ulps = 0;
    nudge.calls = 0;
    expect(expectReplay(golden).checkpoints).toBe(61);
    expect(nudge.calls).toBeGreaterThan(10_000);
  });

  it('AC-2: reports a divergence when simMath.sin is off by one ulp', () => {
    nudge.ulps = 1;
    try {
      expect(() => expectReplay(golden)).toThrow(ReplayAssertionError);
      expect(() => expectReplay(golden)).toThrow(/determinism failure/);
    } finally {
      nudge.ulps = 0;
    }
  });
});
