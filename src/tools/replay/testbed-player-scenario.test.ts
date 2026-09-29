import { describe, expect, it } from 'vitest';
import { ActionSampler } from '@game/input/index';
import { IDLE_ACTION_FRAME } from '@sim/index';
import {
  actionFrameCommand,
  createTestbedWorld,
  scriptedInput,
  TESTBED_SCRIPT,
  TESTBED_TICKS,
  testbedLog,
  testbedPlayerScenario,
} from './testbed-player-scenario';

describe('testbed player scenario (mw-e02.23)', () => {
  it('samples one ActionFrame per tick of the script, and each survives the replay schema', () => {
    const log = testbedLog();
    expect(log).toHaveLength(TESTBED_TICKS);
    expect(TESTBED_TICKS).toBe(TESTBED_SCRIPT.reduce((sum, step) => sum + step.ticks, 0));
    for (const frame of log) {
      expect(actionFrameCommand.parse(JSON.parse(JSON.stringify(frame)))).toEqual(frame);
    }
    expect(log.some((frame) => frame.move.y === 1)).toBe(true);
    expect(log.some((frame) => frame.jump.pressed)).toBe(true);
    expect(log.some((frame) => frame.look.x > 0)).toBe(true);
  });

  it('rejects commands that are not ActionFrames', () => {
    expect(actionFrameCommand.safeParse({ kind: 'input.actions' }).success).toBe(false);
    expect(actionFrameCommand.safeParse({ ...IDLE_ACTION_FRAME, extra: 1 }).success).toBe(false);
  });

  it('keys go down and up at step boundaries; past the script everything is released', () => {
    const sampler = new ActionSampler();
    const drive = scriptedInput([{ ticks: 2, keys: ['KeyW'], lookX: 3 }], sampler);
    drive(0);
    expect(sampler.sample()).toMatchObject({ move: { x: 0, y: 1 }, look: { x: 3, y: 0 } });
    drive(1);
    expect(sampler.sample()).toMatchObject({ move: { x: 0, y: 1 }, look: { x: 3, y: 0 } });
    drive(2);
    expect(sampler.sample()).toEqual(IDLE_ACTION_FRAME);
  });

  it('drives the log, then nothing once it runs out', () => {
    const world = createTestbedWorld({ seed: 1, hz: 60 });
    const ctx = (tick: number) => ({ tick, world, rng: world.random('driver') });
    expect(testbedPlayerScenario.drive(ctx(0))).toHaveLength(1);
    expect(testbedPlayerScenario.drive(ctx(TESTBED_TICKS))).toEqual([]);
  });
});
