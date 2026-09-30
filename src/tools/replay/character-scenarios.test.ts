import { describe, expect, it } from 'vitest';
import { PLAYER_CONTROLLER_ID } from '@content/index';
import { markExercised } from '@content/testing';
import { CharacterController, replayScenarios, Rng, type CharacterState } from '@sim/index';
import {
  basicGolden,
  characterGoldens,
  characterScenario,
  courseGolden,
  createCharacterWorld,
  EAST_YAW,
  frame,
  inputLog,
  playerTuning,
  stressGolden,
  type CharacterGolden,
} from './character-scenarios';
import { goldenScenarios } from './scenarios';

/** Every character state along a golden's log, run live. */
function trace(golden: CharacterGolden): CharacterState[] {
  const world = createCharacterWorld(golden, { seed: 1, hz: 60 });
  const [id] = world.query(CharacterController).ids();
  return golden.log.map((input) => {
    world.step([input]);
    const state = world.get(id ?? 0, CharacterController);
    if (state === undefined) throw new Error('no character');
    return state;
  });
}
const speed = (s: CharacterState) => Math.hypot(s.velocity.x, s.velocity.z);

describe('character golden scenarios (mw-e02.7)', () => {
  it('builds commands from held moves, pressing jump only where given', () => {
    expect(frame({})).toEqual({
      actions: {
        move: { x: 0, y: 0 },
        jump: { pressed: false, held: false },
        sprint: { pressed: false, held: false },
        crouch: { pressed: false, held: false },
      },
      cameraYaw: EAST_YAW,
    });
    const log = inputLog([
      [2, { forward: 1, sprint: true }],
      [1, { right: -1, jump: true, crouch: true, yaw: 0 }],
    ]);
    expect(log).toHaveLength(3);
    expect(log[0]?.actions.sprint.held).toBe(true);
    expect(log[2]).toMatchObject({
      actions: { move: { x: -1, y: 0 }, jump: { pressed: true }, crouch: { held: true } },
      cameraYaw: 0,
    });
    // A drop presses crouch (mw-e02.12: letting go of a ledge).
    expect(frame({ drop: true }).actions.crouch).toEqual({ pressed: true, held: true });
  });

  it('registers every character golden next to the sim scenarios', () => {
    expect(characterGoldens.map((g) => g.name)).toEqual([
      'character-basic',
      'character-course',
      'character-stress',
      'character-mantle',
    ]);
    for (const golden of characterGoldens) {
      expect(goldenScenarios[golden.name]?.name).toBe(golden.name);
      expect(goldenScenarios[golden.name]?.ticks).toBe(golden.log.length);
    }
    for (const [name, scenario] of Object.entries(replayScenarios)) {
      expect(goldenScenarios[name]).toBe(scenario);
    }
  });

  it('drives its log one command per tick, then nothing', () => {
    const scenario = characterScenario(basicGolden);
    const world = scenario.create({ seed: 1, hz: 60 });
    const rng = Rng.create(1);
    expect(scenario.usesContent).toBe(true);
    expect(scenario.drive({ tick: 0, world, rng })).toEqual([basicGolden.log[0]]);
    expect(scenario.drive({ tick: basicGolden.ticks, world, rng })).toEqual([]);
  });

  it('loads the shipped player tuning once', ({ task }) => {
    markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
    expect(playerTuning()).toBe(playerTuning());
    expect(playerTuning().speeds.run).toBeGreaterThan(0);
  });

  it('the basic log runs, walks, sprints, crouches, jumps and turns on a flat floor', ({
    task,
  }) => {
    markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
    const { speeds } = playerTuning();
    const states = trace(basicGolden);
    expect(Math.max(...states.map(speed))).toBeCloseTo(speeds.sprint, 6);
    expect(states.some((s) => Math.abs(speed(s) - speeds.run) < 1e-9)).toBe(true);
    expect(states.some((s) => s.crouched)).toBe(true);
    expect(states.some((s) => s.jumped && !s.grounded)).toBe(true);
    const end = states.at(-1);
    expect(end?.grounded).toBe(true);
    expect(end && speed(end)).toBe(0);
  });

  it('the stress log changes direction every few ticks and reaches the arena walls', ({ task }) => {
    markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
    const changes = stressGolden.log.filter(
      (input, i) =>
        i > 0 &&
        JSON.stringify(input.actions.move) !==
          JSON.stringify(stressGolden.log[i - 1]?.actions.move),
    ).length;
    expect(changes).toBeGreaterThan(stressGolden.ticks / 12);
    const states = trace(stressGolden);
    // Pinned against the ±6 m walls by the capsule radius, never through them.
    const reach = Math.max(
      ...states.map((s) => Math.max(Math.abs(s.position.x), Math.abs(s.position.z))),
    );
    expect(reach).toBeGreaterThan(5.6);
    expect(reach).toBeLessThan(5.66);
    expect(states.some((s) => s.crouched)).toBe(true);
    expect(states.some((s) => s.sprinting)).toBe(true);
    expect(states.some((s) => !s.grounded)).toBe(true);
  });

  it('the course golden is the traversal course', () => {
    expect(courseGolden.ticks).toBe(965);
  });
});
