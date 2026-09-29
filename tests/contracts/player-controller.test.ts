// mw-e02.2: the shipped player tuning (src/content/data/controller/player.json) driving the real
// controller (src/sim/character) meets the movement acceptance criteria. The sim's own unit tests
// pin the mechanics with a fixture copy of the starting numbers; this re-checks AC-1..AC-6 against
// the data file, so a retune that breaks one fails here. Content may import the sim only as types,
// so this cross-layer check lives outside src/.
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGameContent, PLAYER_CONTROLLER_ID } from '@content/index';
import { markExercised } from '@content/testing';
import {
  box,
  controllerParams,
  FakeCollisionWorld,
  IDLE_INPUT,
  initialCharacterState,
  rampAt,
  SimClock,
  stepCharacter,
  type CharacterInput,
  type CharacterState,
  type GreyboxShape,
} from '@sim/index';

const tuning = loadGameContent().get('controller', PLAYER_CONTROLLER_ID);
const params = controllerParams(tuning, new SimClock(60));
const v = (x: number, y: number, z: number) => ({ x, y, z });
/** `value`, failing the test when it is missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}
const FLOOR = box(v(-50, -1, -50), v(50, 0, 50));

function input(move: [number, number], buttons: { jump?: boolean; crouch?: boolean } = {}) {
  const up = { pressed: false, held: false };
  return {
    actions: {
      move: { x: move[0], y: move[1] },
      jump: buttons.jump === true ? { pressed: true, held: true } : up,
      sprint: up,
      crouch: { pressed: false, held: buttons.crouch === true },
    },
    cameraYaw: 0,
  } satisfies CharacterInput;
}
const EAST = input([1, 0]);
const hspeed = (s: CharacterState) => Math.sqrt(s.velocity.x ** 2 + s.velocity.z ** 2);

/** Steps a character in `shapes` from `feet`; returns every state. */
function run(
  shapes: readonly GreyboxShape[],
  feet: { x: number; y: number; z: number },
  inputs: readonly CharacterInput[],
): CharacterState[] {
  const world = new FakeCollisionWorld([FLOOR, ...shapes]);
  let state = initialCharacterState(feet);
  return inputs.map((tick) => (state = stepCharacter(state, tick, { world, tuning, params })));
}
const repeat = (tick: CharacterInput, n: number) => Array<CharacterInput>(n).fill(tick);

describe('shipped player tuning (mw-e02.2)', () => {
  beforeEach(({ task }) => {
    markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
  });

  it('AC-1: reaches run speed ± 0.05 within 0.15 s and stops within 0.10 s', () => {
    expect(tuning.speeds.run).toBe(5);
    const trace = run([], v(0, 0, 0), [
      ...repeat(IDLE_INPUT, 3),
      ...repeat(input([0, 1]), 30),
      ...repeat(IDLE_INPUT, 30),
    ]);
    const moving = trace.slice(3, 33);
    expect(moving.findIndex((s) => Math.abs(hspeed(s) - 5) <= 0.05) + 1).toBeLessThanOrEqual(9);
    expect(trace.slice(33).findIndex((s) => hspeed(s) === 0) + 1).toBeLessThanOrEqual(6);
  });

  it('AC-2: a jump peaks at 1.2 m ± 0.02', () => {
    const trace = run([], v(0, 0, 0), [
      ...repeat(IDLE_INPUT, 3),
      input([0, 0], { jump: true }),
      ...repeat(IDLE_INPUT, 60),
    ]);
    const start = must(trace[2]).position.y;
    const apex = Math.max(...trace.map((s) => s.position.y)) - start;
    expect(Math.abs(apex - 1.2)).toBeLessThanOrEqual(0.02);
    expect(must(trace.at(-1)).grounded).toBe(true);
  });

  it('AC-3: coyote jump 100 ms after walking off a ledge, not at 130 ms', () => {
    const ledge = box(v(-20, 0, -5), v(0, 2, 5));
    const offLedge = run([ledge], v(-3, 2, 0), repeat(EAST, 120));
    const left = offLedge.findIndex((s) => !s.grounded); // first airborne step
    const jumpAt = (ticksAfter: number) =>
      run([ledge], v(-3, 2, 0), [
        ...repeat(EAST, left - 1 + ticksAfter),
        input([1, 0], { jump: true }),
      ]).at(-1);
    expect(jumpAt(6)?.velocity.y).toBeGreaterThan(0);
    expect(jumpAt(8)?.velocity.y).toBeLessThan(0);
  });

  it('AC-4: steps up 0.30 m keeping 90% of its speed; a 0.40 m step blocks', () => {
    const across = (top: number) =>
      run([box(v(2, 0, -5), v(6, top, 5))], v(-4, 0, 0), repeat(EAST, 90));
    const step = across(0.3);
    const speeds = step
      .slice(31)
      .map((s, i) => (s.position.x - must(step[30 + i]).position.x) * 60);
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(4.5);
    expect(must(step.at(-1)).position.y).toBeCloseTo(0.31, 6);
    const wall = across(0.4);
    expect(must(wall.at(-1)).position.x).toBeLessThan(2 - tuning.capsule.radius);
    expect(Math.max(...wall.map((s) => s.position.y))).toBeLessThan(0.02);
  });

  it('AC-5: cannot walk up 50°; walks up 40° at 80% of run speed or better', () => {
    const steep = run([rampAt(v(2, 0, -3), 50, 3, 6)], v(0, 0, 0), repeat(EAST, 120));
    expect(Math.max(...steep.map((s) => s.position.y))).toBeLessThan(0.02);
    const ramp = rampAt(v(2, 0, -3), 40, 3, 6);
    const climb = run([ramp], v(-3, 0, 0), repeat(EAST, 110));
    const onRamp = climb.filter((s) => s.position.y > 0.2 && s.position.y < 2.8);
    expect(onRamp.length).toBeGreaterThan(10);
    expect(onRamp.every((s) => s.grounded && hspeed(s) >= 0.8 * tuning.speeds.run)).toBe(true);
  });

  it('AC-6: stays crouched under a 1.2 m ceiling until clear of it', () => {
    const ceiling = box(v(1, 1.2, -5), v(6, 3, 5));
    const trace = run([ceiling], v(0, 0, 0), [
      ...repeat(input([1, 0], { crouch: true }), 90),
      ...repeat(EAST, 150),
    ]);
    const under = trace.filter((s) => s.position.x > 1 - 0.35 && s.position.x - 0.35 < 6);
    expect(under.length).toBeGreaterThan(30);
    expect(under.every((s) => s.crouched)).toBe(true);
    expect(must(trace.at(-1)).crouched).toBe(false);
  });
});
