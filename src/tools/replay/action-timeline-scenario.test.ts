import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { IDLE_ACTION_FRAME } from '@sim/index';
import {
  ACTION_TIMELINE_BINDINGS,
  ACTION_TIMELINE_TICKS,
  actionTimelineLog,
  actionTimelineScenario,
  pressFrame,
  shippedMoveTable,
} from './action-timeline-scenario';
import { actionFrameCommand } from './action-frame-command';
import { goldenScenarios } from './scenarios';

describe('action timeline scenario (mw-e04.4)', () => {
  it('is registered, and binds moves that ship', ({ task }) => {
    expect(goldenScenarios['action-timeline']).toBe(actionTimelineScenario);
    for (const move of Object.values(ACTION_TIMELINE_BINDINGS)) {
      expect(shippedMoveTable().has(move)).toBe(true);
      markExercised(task, 'move', move);
    }
    for (const move of ['sword-light-2', 'sword-light-3', 'dodge-roll']) {
      markExercised(task, 'move', move);
    }
  });

  it('expands the script into one frame per tick, each surviving the replay schema', () => {
    const log = actionTimelineLog();
    expect(log).toHaveLength(ACTION_TIMELINE_TICKS);
    expect(log.filter((f) => f.primaryAttack.pressed)).toHaveLength(3);
    expect(log.filter((f) => f.dodge.pressed && f.move.y === 1)).toHaveLength(1);
    const press = pressFrame('dodge');
    expect(actionFrameCommand.parse(JSON.parse(JSON.stringify(press)))).toEqual(press);
    // A frame recorded before slow walk existed (mw-e02.10) reads it as up.
    const older: Record<string, unknown> = { ...press };
    delete older['slowWalk'];
    expect(actionFrameCommand.parse(JSON.parse(JSON.stringify(older)))).toEqual(press);
    expect(pressFrame('primaryAttack').move).toEqual({ x: 0, y: 0 });
    expect(log[0]).toBe(IDLE_ACTION_FRAME);
  });

  it('drives the log, then nothing once it runs out', () => {
    const world = actionTimelineScenario.create({ seed: 1, hz: 60 });
    const ctx = (tick: number) => ({ tick, world, rng: world.random('driver') });
    expect(actionTimelineScenario.drive(ctx(0))).toEqual([IDLE_ACTION_FRAME]);
    expect(actionTimelineScenario.drive(ctx(ACTION_TIMELINE_TICKS))).toEqual([]);
  });
});
