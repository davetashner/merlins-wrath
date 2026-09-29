// mw-e02.2 AC-7: the player's kinematic controller, with the shipped tuning (content), runs a greybox
// traversal course in the in-memory collision world — a step, a 40° ramp to a ledge, a coyote jump
// off it, a 1.2 m crawl tunnel, a 50° slope to go around, a 0.40 m wall to jump, a moving platform.
// The recorded input log (fixtures/character-course.replay.json) replays twice to the identical
// state hashes it was recorded with. Content may import the sim only as types, so this cross-layer
// check lives outside src/.
//
// Re-record after an intended change to the controller, the course or the tuning:
//   CHARACTER_COURSE_RECORD=1 pnpm vitest run tests/integration/character-course.test.ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalJson, fnv1a64, loadGameContent, PLAYER_CONTROLLER_ID } from '@content/index';
import { markExercised } from '@content/testing';
import {
  box,
  CharacterController,
  characterControllerSystem,
  FakeCollisionWorld,
  playReplay,
  rampAt,
  recordScenario,
  spawnCharacter,
  World,
  type CharacterInput,
  type CharacterState,
  type GreyboxShape,
  type ReplayScenario,
} from '@sim/index';
import { readReplay, writeReplay } from '@tools/replay/files';

const FIXTURE = 'tests/integration/fixtures/character-course.replay.json';
const SEED = 2;
const content = loadGameContent();
const tuning = content.get('controller', PLAYER_CONTROLLER_ID);
const contentHash = fnv1a64(canonicalJson(content.all('controller')));

/** `value`, failing the test when it is missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}
const v = (x: number, y: number, z: number) => ({ x, y, z });

/** A 40° ramp climbing 2 m (its geometry goes through simMath, so it is the same everywhere). */
const RAMP = rampAt(v(12, 0, -12), 40, 2, 24);

/** The greybox course, east along +x from the origin. */
const COURSE: readonly GreyboxShape[] = [
  box(v(-10, -1, -12), v(80, 0, 12)), // floor
  box(v(4, 0, -12), v(8, 0.3, 12)), // 0.30 m step up, then down
  RAMP, // 40° ramp up to…
  box(v(RAMP.max.x, 0, -12), v(20, 2, 12)), // …a 2 m ledge
  box(v(26, 1.2, -12), v(30, 3, 12)), // 1.2 m crawl tunnel
  rampAt(v(34, 0, -3), 50, 3, 6), // 50° slope, only 6 m wide
  box(v(42, 0, -12), v(43, 0.4, 12)), // 0.40 m wall to jump
  { ...box(v(45, 0, -8), v(49, 0.3, -2)), velocity: v(0.25, 0, 0) }, // moving platform
];

const button = z.strictObject({ pressed: z.boolean(), held: z.boolean() });
const characterCommand = z.strictObject({
  actions: z.strictObject({
    move: z.strictObject({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }),
    jump: button,
    sprint: button,
    crouch: button,
  }),
  cameraYaw: z.number(),
}) satisfies z.ZodType<CharacterInput>;

/** The camera looks east (yaw −90°), so "forward" runs the course. */
const EAST_YAW = -Math.PI / 2;

interface Move {
  forward?: number;
  right?: number;
  jump?: boolean;
  sprint?: boolean;
  crouch?: boolean;
}

function frame({ forward = 0, right = 0, jump = false, sprint = false, crouch = false }: Move) {
  return characterCommand.parse({
    actions: {
      move: { x: right, y: forward },
      jump: { pressed: jump, held: jump },
      sprint: { pressed: false, held: sprint },
      crouch: { pressed: false, held: crouch },
    },
    cameraYaw: EAST_YAW,
  });
}

/** The input log: [ticks, input] segments, 60 Hz. */
const SEGMENTS: readonly (readonly [number, Move])[] = [
  [10, {}],
  [230, { forward: 1 }], // over the step, up the ramp, along the ledge top
  [23, { forward: 1 }], // off the ledge…
  [1, { forward: 1, jump: true }], // …and a coyote jump
  [40, { forward: 1 }],
  [30, { forward: 1, crouch: true }], // into the tunnel
  [110, { forward: 1, crouch: true }],
  [20, { forward: 1 }], // out; stands once clear
  [60, { forward: 1 }], // blocked by the 50° slope
  [60, { forward: 0.3, right: -1 }], // step round it to the north
  [90, { forward: 1, sprint: true }],
  [1, { forward: 1, sprint: true, jump: true }], // over the 0.40 m wall
  [60, { forward: 1, sprint: true }],
  [40, { forward: 1 }], // onto the moving platform
  [120, {}], // ride it
  [30, { forward: 1 }],
  [40, {}],
];
const LOG: readonly CharacterInput[] = SEGMENTS.flatMap(([ticks, move]) =>
  Array.from({ length: ticks }, () => frame(move)),
);

function createCourse({ seed, hz }: { seed: number; hz: number }): World<CharacterInput> {
  const collision = new FakeCollisionWorld(COURSE);
  const world = new World<CharacterInput>({ seed, hz }).register(CharacterController);
  world
    .addSystem({
      name: 'platforms',
      run: ({ clock }) => {
        collision.advance(1 / clock.hz);
      },
    })
    .addSystem(characterControllerSystem({ collision, tuning, input: (inputs) => inputs[0] }));
  spawnCharacter(world, v(0, 0, 0));
  return world;
}

const scenario: ReplayScenario<CharacterInput> = {
  name: 'character-course',
  usesContent: true,
  command: characterCommand,
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
      expect(first).toEqual({
        status: 'passed',
        finalHash: replay.finalHash,
        checkpoints: replay.checkpoints.length,
        contentChanged: false,
      });
      expect(second).toEqual(first);
    },
  );
});
