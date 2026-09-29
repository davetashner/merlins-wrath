import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { IDLE_ACTION_FRAME } from '@sim/index';
import { actionFrameCommand } from './action-frame-command';
import {
  DODGE_PRESS,
  DODGE_TIMING_TICKS,
  dodgeEarlyScenario,
  dodgeOnTimeScenario,
  dodgeTimingLog,
  dummySwing,
  FIRST_SWEEP_TICK,
  rollFrame,
} from './dodge-timing-scenario';
import { goldenScenarios } from './scenarios';

describe('dodge timing scenarios (mw-e04.8)', () => {
  it('are registered under their golden names', ({ task }) => {
    expect(goldenScenarios['dodge-on-time']).toBe(dodgeOnTimeScenario);
    expect(goldenScenarios['dodge-early']).toBe(dodgeEarlyScenario);
    for (const move of ['dodge-roll', 'training-dummy-swing']) markExercised(task, 'move', move);
  });

  it('press the roll so its last i-frame meets the first sweep, or one tick before', () => {
    expect(DODGE_PRESS.onTime + 14).toBe(FIRST_SWEEP_TICK);
    expect(DODGE_PRESS.early + 15).toBe(FIRST_SWEEP_TICK);
    const log = dodgeTimingLog(DODGE_PRESS.onTime);
    expect(log).toHaveLength(DODGE_TIMING_TICKS);
    expect(log.findIndex((f) => f.dodge.pressed)).toBe(DODGE_PRESS.onTime);
    expect(log.filter((f) => f !== IDLE_ACTION_FRAME)).toEqual([rollFrame()]);
    const roll = rollFrame();
    expect(actionFrameCommand.parse(JSON.parse(JSON.stringify(roll)))).toEqual(roll);
  });

  it('drives its log, then nothing once it runs out', () => {
    const world = dodgeEarlyScenario.create({ seed: 1, hz: 60 });
    const ctx = (tick: number) => ({ tick, world, rng: world.random('driver') });
    expect(dodgeEarlyScenario.drive(ctx(DODGE_PRESS.early))).toEqual([rollFrame()]);
    expect(dodgeEarlyScenario.drive(ctx(0))).toEqual([IDLE_ACTION_FRAME]);
    expect(dodgeEarlyScenario.drive(ctx(DODGE_TIMING_TICKS))).toEqual([]);
  });

  it('needs a dummy swing that can hit', () => {
    expect(() => dummySwing(new Map())).toThrow(/training-dummy-swing/);
  });
});
