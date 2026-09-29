// mw-e02.21 AC-2: the greybox traversal course of mw-e02.2 (TRAVERSAL_COURSE and TRAVERSAL_LOG, the
// character-course golden in src/tools/replay/character-scenarios.ts), run by the player's controller
// on the sim's Rapier physics instead of the in-memory fake: the course's static geometry and its
// moving platform live in the World's Rapier world, the World steps it every tick, and the controller
// queries it through RapierCollisionWorld. The recorded input log replays twice to the identical
// state hashes it was recorded with; those hashes cover the Rapier state too.
//
// This is an integration test with its own fixture rather than a tests/replays golden: the replay
// CLI runs under plain Node, which cannot load Rapier's non-compat WASM package (only Vite can).
//
// Re-record after an intended change to the controller, the course, the tuning or Rapier:
//   CHARACTER_COURSE_RECORD=1 pnpm vitest run tests/integration/character-course-rapier.test.ts
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { PLAYER_CONTROLLER_ID } from '@content/index';
import { markExercised } from '@content/testing';
import {
  CharacterController,
  characterControllerSystem,
  playReplay,
  RapierCollisionWorld,
  RapierPhysics,
  recordScenario,
  spawnCharacter,
  World,
  type CharacterInput,
  type CharacterState,
  type ReplayScenario,
} from '@sim/index';
import {
  characterCommand,
  playerTuning,
  TRAVERSAL_COURSE as COURSE,
  TRAVERSAL_LOG as LOG,
} from '@tools/replay/character-scenarios';
import { currentContentHash, readReplay, writeReplay } from '@tools/replay/files';

const SEED = 2;

/** `value`, failing the test when it is missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const FIXTURE = 'tests/integration/fixtures/character-course-rapier.replay.json';

function createCourse({ seed, hz }: { seed: number; hz: number }): World<CharacterInput> {
  const physics = new RapierPhysics(RAPIER);
  for (const shape of COURSE) physics.add(shape);
  const collision = new RapierCollisionWorld(physics);
  const world = new World<CharacterInput>({ seed, hz, physics }).register(CharacterController);
  world.addSystem(
    characterControllerSystem({ collision, tuning: playerTuning(), input: (inputs) => inputs[0] }),
  );
  spawnCharacter(world, { x: 0, y: 0, z: 0 });
  return world;
}

const scenario: ReplayScenario<CharacterInput> = {
  name: 'character-course-rapier',
  usesContent: true,
  command: characterCommand,
  ticks: LOG.length,
  create: createCourse,
  drive: ({ tick }) => {
    const input = LOG[tick];
    return input === undefined ? [] : [input];
  },
};

/** Every character state along the log, run live. */
function traceCourse(): CharacterState[] {
  const world = createCourse({ seed: SEED, hz: 60 });
  const [id] = world.query(CharacterController).ids();
  return LOG.map((input) => {
    world.step([input]);
    return must(world.get(id ?? 0, CharacterController));
  });
}

describe('greybox traversal course on Rapier (mw-e02.21)', () => {
  // Known gap (mw-e02.24): Rapier's edges are rounded, as the CollisionWorld contract allows, and
  // the controller's step-up probe then lands on the 0.30 m step's edge with a non-walkable normal,
  // so the player stops at the step. Flip to `it` when mw-e02.24 lands (and re-record the replay).
  it.fails('runs every feature of the course, as it does on the in-memory fake', ({ task }) => {
    markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
    const trace = traceCourse();
    const at = (x: number) => trace.filter((s) => s.position.x > x - 0.5 && s.position.x < x + 0.5);
    expect(at(6).every((s) => s.position.y > 0.29)).toBe(true); // on the step
    expect(Math.max(...at(17).map((s) => s.position.y))).toBeGreaterThan(1.99); // on the ledge
    expect(trace.some((s) => s.jumped && s.position.x > 20 && s.position.y > 2)).toBe(true);
    expect(at(28).every((s) => s.crouched && s.position.y < 0.1)).toBe(true); // in the tunnel
    const slope = trace.filter((s) => s.position.x > 33 && s.position.x < 37);
    expect(slope.every((s) => s.position.y < 0.1)).toBe(true); // never climbed the 50° slope
    expect(trace.some((s) => s.sprinting)).toBe(true);
    expect(trace.some((s) => s.groundBody === COURSE.length)).toBe(true); // rode the platform
    const end = must(trace.at(-1));
    expect(end.position.x).toBeGreaterThan(50);
    expect(end.grounded).toBe(true);
  });

  it(
    'AC-2: the recorded input log replays twice on the Rapier adapter to identical final state hashes',
    { timeout: 30_000 },
    ({ task }) => {
      markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
      const contentHash = currentContentHash();
      if (process.env['CHARACTER_COURSE_RECORD'] === '1') {
        const recorded = recordScenario(scenario, {
          seed: SEED,
          ticks: LOG.length,
          buildSha: 'local',
          contentHash,
          keepStates: false,
        });
        writeReplay(FIXTURE, recorded);
      }
      const replay = readReplay(FIXTURE);
      expect(replay.ticks).toBe(LOG.length);
      const first = playReplay(replay, scenario, { contentHash });
      const second = playReplay(replay, scenario, { contentHash });
      expect(first).toMatchObject({
        status: 'passed',
        finalHash: replay.finalHash,
        checkpoints: replay.checkpoints.length,
      });
      expect(second).toEqual(first);
    },
  );
});
