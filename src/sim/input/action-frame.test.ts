import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CharacterInput, MovementActions } from '../character/controller';
import {
  ACTION_FRAME_COMMAND,
  ACTIONS,
  actionButton,
  actionFrame,
  actionFrameOf,
  actionVector,
  BUTTON_ACTIONS,
  IDLE_ACTION_FRAME,
  isActionFrame,
  type ActionFrame,
} from './action-frame';

describe('action registry', () => {
  it('lists every button action of the registry, in order, and no vectors', () => {
    expect(BUTTON_ACTIONS).toEqual([
      'jump',
      'sprint',
      'crouch',
      'interact',
      'lockOn',
      'cycleTarget',
      'primaryAttack',
      'secondaryAttack',
      'ability1',
      'ability2',
      'ability3',
      'ability4',
      'inventory',
      'pause',
    ]);
    expect(ACTIONS.move.kind).toBe('vector');
    expect(ACTIONS.look.kind).toBe('vector');
    expect(Object.isFrozen(BUTTON_ACTIONS)).toBe(true);
  });
});

describe('ActionFrame', () => {
  it('satisfies MovementActions, so a frame plus camera yaw is a CharacterInput', () => {
    expectTypeOf<ActionFrame>().toExtend<MovementActions>();
    const input: CharacterInput = { actions: IDLE_ACTION_FRAME, cameraYaw: 0 };
    expect(input.actions.jump).toEqual({ pressed: false, held: false, released: false });
  });

  it('the idle frame is frozen plain data that round-trips through JSON', () => {
    const frame = IDLE_ACTION_FRAME;
    expect(frame.kind).toBe(ACTION_FRAME_COMMAND);
    expect(frame.move).toEqual({ x: 0, y: 0 });
    expect(frame.look).toEqual({ x: 0, y: 0 });
    for (const action of BUTTON_ACTIONS) {
      expect(frame[action]).toEqual({ pressed: false, held: false, released: false });
    }
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.jump)).toBe(true);
    expect(JSON.parse(JSON.stringify(frame))).toEqual(frame);
  });

  it('actionButton shares one frozen value per edge combination', () => {
    for (const pressed of [false, true]) {
      for (const held of [false, true]) {
        for (const released of [false, true]) {
          const button = actionButton(pressed, held, released);
          expect(button).toEqual({ pressed, held, released });
          expect(actionButton(pressed, held, released)).toBe(button);
          expect(Object.isFrozen(button)).toBe(true);
        }
      }
    }
  });

  it('actionVector normalises -0 to 0 and freezes', () => {
    const v = actionVector(-0, 1);
    expect(Object.is(v.x, 0)).toBe(true);
    expect(Object.isFrozen(v)).toBe(true);
    expect(actionVector(0, 0)).toBe(actionVector(-0, -0));
    expect(actionVector(-2.5, 3)).toEqual({ x: -2.5, y: 3 });
  });

  it('actionFrame fills each button from the callback', () => {
    const frame = actionFrame({
      move: actionVector(0, 1),
      look: actionVector(3, -2),
      buttons: (action) => actionButton(action === 'jump', action === 'jump', false),
    });
    expect(frame.jump).toEqual({ pressed: true, held: true, released: false });
    expect(frame.sprint.held).toBe(false);
    expect(frame.move).toEqual({ x: 0, y: 1 });
    expect(frame.look).toEqual({ x: 3, y: -2 });
  });

  it('isActionFrame and actionFrameOf pick the frame out of mixed tick commands', () => {
    const other = { kind: 'sim.difficulty', set: {} };
    expect(isActionFrame(IDLE_ACTION_FRAME)).toBe(true);
    expect(isActionFrame(other)).toBe(false);
    expect(isActionFrame(null)).toBe(false);
    expect(isActionFrame('input.actions')).toBe(false);
    expect(actionFrameOf([other, IDLE_ACTION_FRAME])).toBe(IDLE_ACTION_FRAME);
    expect(actionFrameOf([other])).toBeUndefined();
  });
});
