import { describe, expect, expectTypeOf, it } from 'vitest';
import { DEFAULT_TICK_RATE_HZ, SimClock, type ReadonlyClock } from './clock';

describe('SimClock', () => {
  it('starts at tick 0 at 60 Hz and only moves when advanced', () => {
    const clock = new SimClock();
    expect(clock.hz).toBe(DEFAULT_TICK_RATE_HZ);
    expect(clock.tick).toBe(0);
    expect(clock.advance()).toBe(1);
    expect(clock.tick).toBe(1);
  });

  it('derives whole milliseconds from ticks (60 Hz steps are not whole milliseconds)', () => {
    const clock = new SimClock(60, 1);
    expect(clock.elapsedMs()).toBe(16);
    expect(new SimClock(60, 60).elapsedMs()).toBe(1000);
    expect(new SimClock(60, 3).elapsedMs()).toBe(50);
    expect(new SimClock(50, 7).elapsedMs()).toBe(140);
  });

  it('converts design durations to ticks, rounding half up', () => {
    const clock = new SimClock(60);
    expect(clock.ticksFor(500)).toBe(30);
    expect(clock.ticksFor(0)).toBe(0);
    expect(clock.ticksFor(25)).toBe(2); // 1.5 ticks rounds up
    expect(clock.ticksFor(24)).toBe(1); // 1.44 ticks rounds down
    for (const ms of [-1, 1.5, Number.NaN]) expect(() => clock.ticksFor(ms)).toThrow(RangeError);
  });

  it('serializes and restores exactly', () => {
    const clock = new SimClock(30, 12);
    clock.advance();
    const restored = SimClock.restore(structuredClone(clock.serialize()));
    expect(restored.serialize()).toEqual({ tick: 13, hz: 30 });
  });

  it.each([
    [0, 0],
    [1001, 0],
    [59.5, 0],
    [60, -1],
    [60, 0.5],
  ])('rejects hz %s / tick %s', (hz, tick) => {
    expect(() => new SimClock(hz, tick)).toThrow(RangeError);
  });

  it('systems get a read-only view: advance is not part of ReadonlyClock', () => {
    expectTypeOf<ReadonlyClock>().not.toHaveProperty('advance');
    expectTypeOf<SimClock>().toHaveProperty('advance');
    expectTypeOf<SimClock>().toExtend<ReadonlyClock>();
  });
});
