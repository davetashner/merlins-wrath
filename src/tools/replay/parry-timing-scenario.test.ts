import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { IDLE_ACTION_FRAME } from '@sim/index';
import { actionFrameCommand } from './action-frame-command';
import { FIRST_SWEEP_TICK } from './dodge-timing-scenario';
import {
  PARRY_PRESS,
  PARRY_TIMING_TICKS,
  PARRY_WINDOW,
  parryFirstTickScenario,
  parryFrame,
  parryLastTickScenario,
  parryOneLateScenario,
  parryTimingLog,
} from './parry-timing-scenario';
import { goldenScenarios } from './scenarios';

describe('parry timing scenarios (mw-e04.12)', () => {
  it('are registered under their golden names', ({ task }) => {
    expect(goldenScenarios['parry-first-tick']).toBe(parryFirstTickScenario);
    expect(goldenScenarios['parry-last-tick']).toBe(parryLastTickScenario);
    expect(goldenScenarios['parry-one-tick-late']).toBe(parryOneLateScenario);
    for (const move of ['shield-parry', 'training-dummy-swing']) markExercised(task, 'move', move);
  });

  it('press the parry so the first sweep meets the window’s first tick, its last, or one tick early', () => {
    expect(FIRST_SWEEP_TICK - PARRY_PRESS.firstTick).toBe(PARRY_WINDOW.first);
    expect(FIRST_SWEEP_TICK - PARRY_PRESS.lastTick).toBe(PARRY_WINDOW.last);
    expect(FIRST_SWEEP_TICK - PARRY_PRESS.oneLate).toBe(PARRY_WINDOW.first - 1);
    const log = parryTimingLog(PARRY_PRESS.firstTick);
    expect(log).toHaveLength(PARRY_TIMING_TICKS);
    expect(log.findIndex((f) => f.ability3.pressed)).toBe(PARRY_PRESS.firstTick);
    expect(log.filter((f) => f !== IDLE_ACTION_FRAME)).toEqual([parryFrame()]);
    const parry = parryFrame();
    expect(actionFrameCommand.parse(JSON.parse(JSON.stringify(parry)))).toEqual(parry);
  });

  it('drives its log, then nothing once it runs out', () => {
    const world = parryOneLateScenario.create({ seed: 1, hz: 60 });
    const ctx = (tick: number) => ({ tick, world, rng: world.random('driver') });
    expect(parryOneLateScenario.drive(ctx(PARRY_PRESS.oneLate))).toEqual([parryFrame()]);
    expect(parryOneLateScenario.drive(ctx(0))).toEqual([IDLE_ACTION_FRAME]);
    expect(parryOneLateScenario.drive(ctx(PARRY_TIMING_TICKS))).toEqual([]);
  });
});
