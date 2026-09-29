import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { initialCharacterState, type CharacterInput, type ButtonState } from './controller';
import { NOCLIP_BOOST, stepNoclip } from './noclip';

const TUNING = { speeds: { run: 5, sprint: 8, crouch: 2 } } as unknown as Frozen<ControllerTuning>;
const DT = { dt: 0.5 };
const UP: ButtonState = { pressed: false, held: false };
const HELD: ButtonState = { pressed: false, held: true };

function input(
  move: [number, number],
  held: { jump?: boolean; crouch?: boolean; sprint?: boolean } = {},
  cameraYaw = 0,
): CharacterInput {
  return {
    actions: {
      move: { x: move[0], y: move[1] },
      jump: held.jump === true ? HELD : UP,
      crouch: held.crouch === true ? HELD : UP,
      sprint: held.sprint === true ? HELD : UP,
    },
    cameraYaw,
  };
}

describe('stepNoclip', () => {
  const start = { ...initialCharacterState({ x: 0, y: 1, z: 0 }), grounded: true, jumpAge: 3 };

  it('flies forward (−z at yaw 0) at sprint speed and leaves the character airborne at rest', () => {
    const next = stepNoclip(start, input([0, 1]), TUNING, DT);
    expect(next.position.x).toBeCloseTo(0, 12);
    expect(next.position.y).toBe(1);
    expect(next.position.z).toBeCloseTo(-4, 12);
    expect(next).toMatchObject({
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      groundBody: null,
      airTicks: 0,
      jumpAge: -1,
      traversal: null,
    });
  });

  it('rises on Jump, sinks on Crouch, and Sprint boosts', () => {
    expect(stepNoclip(start, input([0, 0], { jump: true }), TUNING, DT).position.y).toBe(5);
    expect(stepNoclip(start, input([0, 0], { crouch: true }), TUNING, DT).position.y).toBe(-3);
    const fast = stepNoclip(start, input([1, 0], { sprint: true }), TUNING, DT);
    expect(fast.position.x).toBeCloseTo(4 * NOCLIP_BOOST, 12);
  });

  it('never goes faster diagonally: the direction is capped at unit length', () => {
    const next = stepNoclip(start, input([1, 1], { jump: true }), TUNING, DT);
    const d = { x: next.position.x, y: next.position.y - 1, z: next.position.z };
    expect(Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z)).toBeCloseTo(4, 12);
  });

  it('turns with the camera yaw', () => {
    const next = stepNoclip(start, input([0, 1], {}, Math.PI / 2), TUNING, DT);
    expect(next.position.x).toBeCloseTo(-4, 12);
    expect(next.position.z).toBeCloseTo(0, 12);
  });
});
