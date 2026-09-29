// mw-e02.2 AC-7: the player's kinematic controller, with the shipped tuning (content), runs a greybox
// traversal course in the in-memory collision world — a step, a 40° ramp to a ledge, a coyote jump
// off it, a 1.2 m crawl tunnel, a 50° slope to go around, a 0.40 m wall to jump, a moving platform.
// The recorded input log replays twice to the identical state hashes it was recorded with. The course
// and its log are the character-course golden replay (src/tools/replay/character-scenarios.ts,
// tests/replays/character-course.json, mw-e02.7).
//
// Re-record after an intended change to the controller or the tuning: pnpm replay:rebless
// (after changing the course or the log: pnpm replay:record character-course --force).
import { describe, expect, it } from 'vitest';
import { PLAYER_CONTROLLER_ID } from '@content/index';
import { markExercised } from '@content/testing';
import { CharacterController, playReplay, type CharacterState } from '@sim/index';
import {
  characterScenario,
  courseGolden,
  createCharacterWorld,
  TRAVERSAL_COURSE,
  TRAVERSAL_LOG,
} from '@tools/replay/character-scenarios';
import { currentContentHash, GOLDEN_REPLAY_DIR, readReplay } from '@tools/replay/files';

const GOLDEN = `${GOLDEN_REPLAY_DIR}/character-course.json`;
const COURSE = TRAVERSAL_COURSE;
const LOG = TRAVERSAL_LOG;
const scenario = characterScenario(courseGolden);

/** `value`, failing the test when it is missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

/** Every character state along the log, run live. */
function traceCourse(): CharacterState[] {
  const world = createCharacterWorld(courseGolden, { seed: 2, hz: 60 });
  const [id] = world.query(CharacterController).ids();
  return LOG.map((input) => {
    world.step([input]);
    return must(world.get(id ?? 0, CharacterController));
  });
}

describe('greybox traversal course (mw-e02.2)', () => {
  it('runs every feature of the course with the shipped tuning', ({ task }) => {
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
    'AC-7: the recorded input log replays twice to identical final state hashes',
    { timeout: 30_000 },
    ({ task }) => {
      markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
      const replay = readReplay(GOLDEN);
      expect(replay.ticks).toBe(LOG.length);
      const contentHash = currentContentHash();
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
