// Character controller golden replays (mw-e02.7): replay scenarios that run the player's kinematic
// controller, with the shipped tuning, over greybox collision in the in-memory collision world. Their
// goldens (tests/replays/character-*.json, a checkpoint hash every 60 ticks) replay on every CI run,
// so any change to how the controller moves the player fails CI at the first diverging checkpoint.
//
//   character-basic   flat floor: idle, run in every direction, walk, sprint, crouch, jumps, turning
//   character-course  the mw-e02.2 traversal course: step, 40° ramp, ledge, coyote jump, crawl
//                     tunnel, 50° slope (blocked), 0.40 m wall jump, moving platform
//   character-stress  an obstacle arena with rapid, seeded-random direction, camera and button changes
//
// The scenarios live in tools, not src/sim/replay/scenarios, because they read the tuning from game
// content, which the sim may import only as types. src/tools/replay/scenarios.ts registers them.
//
// After an intended change to the controller or its tuning: `pnpm replay:rebless` (re-runs each
// golden's recorded inputs and rewrites the hashes, printing the first changed checkpoint and field).
// After changing an input script below: `pnpm replay:record <name> --force`.

import { z } from 'zod';
import { loadGameContent } from '@content/game-content';
import { PLAYER_CONTROLLER_ID, type ControllerTuning, type Frozen } from '@content/index';
import {
  box,
  CharacterController,
  characterControllerSystem,
  FakeCollisionWorld,
  rampAt,
  spawnCharacter,
  World,
  type CharacterInput,
  Rng,
  type GreyboxShape,
  type ReplayScenario,
} from '@sim/index';

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const button = z.strictObject({ pressed: z.boolean(), held: z.boolean() });

/** One tick's input for the player, as stored in replay files. */
export const characterCommand = z.strictObject({
  actions: z.strictObject({
    move: z.strictObject({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }),
    jump: button,
    sprint: button,
    crouch: button,
  }),
  cameraYaw: z.number(),
}) satisfies z.ZodType<CharacterInput>;

/** Camera yaw looking east (+x): "forward" runs the traversal course. */
export const EAST_YAW = -Math.PI / 2;

/** A held input over a stretch of ticks; everything defaults to released. */
export interface Move {
  readonly forward?: number;
  readonly right?: number;
  readonly jump?: boolean;
  readonly sprint?: boolean;
  readonly crouch?: boolean;
  readonly yaw?: number;
}

/** The command for one tick of `move` (jump is pressed on the tick it is given). */
export function frame({
  forward = 0,
  right = 0,
  jump = false,
  sprint = false,
  crouch = false,
  yaw = EAST_YAW,
}: Move): CharacterInput {
  return characterCommand.parse({
    actions: {
      move: { x: right, y: forward },
      jump: { pressed: jump, held: jump },
      sprint: { pressed: false, held: sprint },
      crouch: { pressed: false, held: crouch },
    },
    cameraYaw: yaw,
  });
}

/** Expands `[ticks, move]` segments into one command per tick. */
export function inputLog(segments: readonly (readonly [number, Move])[]): CharacterInput[] {
  return segments.flatMap(([ticks, move]) => Array.from({ length: ticks }, () => frame(move)));
}

/** What a character golden runs: collision geometry, a spawn point and an input log. */
export interface CharacterGolden {
  readonly name: string;
  readonly course: readonly GreyboxShape[];
  readonly spawn: Vec3;
  /** Length of the input log, in 60 Hz ticks. */
  readonly ticks: number;
  /** The player's input on each tick of the script. */
  readonly log: readonly CharacterInput[];
}

let shippedTuning: Frozen<ControllerTuning> | undefined;

/** The player's controller tuning as shipped in content (loaded once). */
export function playerTuning(): Frozen<ControllerTuning> {
  shippedTuning ??= loadGameContent().get('controller', PLAYER_CONTROLLER_ID);
  return shippedTuning;
}

/** The world a character golden runs in: moving platforms advance, then the player steps. */
export function createCharacterWorld(
  golden: CharacterGolden,
  { seed, hz }: { readonly seed: number; readonly hz: number },
  tuning: Frozen<ControllerTuning> = playerTuning(),
): World<CharacterInput> {
  const collision = new FakeCollisionWorld(golden.course);
  const world = new World<CharacterInput>({ seed, hz }).register(CharacterController);
  world
    .addSystem({
      name: 'platforms',
      run: ({ clock }) => {
        collision.advance(1 / clock.hz);
      },
    })
    .addSystem(characterControllerSystem({ collision, tuning, input: (inputs) => inputs[0] }));
  spawnCharacter(world, golden.spawn);
  return world;
}

/**
 * The replay scenario for a character golden. `tuning` overrides the shipped tuning (tests use it
 * to prove a tuning change is caught).
 */
export function characterScenario(
  golden: CharacterGolden,
  tuning?: Frozen<ControllerTuning>,
): ReplayScenario<CharacterInput> {
  return {
    name: golden.name,
    usesContent: true,
    command: characterCommand,
    ticks: golden.ticks,
    create: (options) => createCharacterWorld(golden, options, tuning),
    drive: ({ tick }) => {
      const input = golden.log[tick];
      return input === undefined ? [] : [input];
    },
  };
}

/** A golden whose input is a fixed log. */
function logGolden(
  name: string,
  course: readonly GreyboxShape[],
  spawn: Vec3,
  log: readonly CharacterInput[],
): CharacterGolden {
  return { name, course, spawn, ticks: log.length, log };
}

// --- character-basic ------------------------------------------------------------------------------

const FLAT: readonly GreyboxShape[] = [box(v(-40, -1, -40), v(40, 0, 40))];
const NORTH_YAW = 0;
const SOUTH_WEST_YAW = (3 * Math.PI) / 4;

export const basicGolden = logGolden(
  'character-basic',
  FLAT,
  v(0, 0, 0),
  inputLog([
    [20, {}], // settle
    [60, { forward: 1 }], // accelerate to run speed and hold it
    [30, {}], // decelerate to a stop
    [60, { right: 1 }],
    [60, { forward: -1, right: -1 }], // diagonal, clamped to unit length
    [60, { forward: 0.5 }], // half deflection walks
    [90, { forward: 1, sprint: true }],
    [60, { forward: 1, crouch: true }], // crouch-walk
    [30, { crouch: true }],
    [20, {}], // stand up
    [1, { jump: true }], // standing jump
    [50, {}],
    [30, { forward: 1 }],
    [1, { forward: 1, jump: true }], // running jump
    [50, { forward: 1 }],
    [60, { forward: 1, yaw: NORTH_YAW }], // the camera turns: forward follows it
    [60, { forward: 1, right: 1, yaw: SOUTH_WEST_YAW }],
    [1, { forward: 1, sprint: true, jump: true, yaw: SOUTH_WEST_YAW }], // sprint jump
    [60, { forward: 1, sprint: true, yaw: SOUTH_WEST_YAW }],
    [40, {}],
  ]),
);

// --- character-course (mw-e02.2 AC-7) -------------------------------------------------------------

/** A 40° ramp climbing 2 m (its geometry goes through simMath, so it is the same everywhere). */
const RAMP = rampAt(v(12, 0, -12), 40, 2, 24);

/** The greybox traversal course, east along +x from the origin. */
export const TRAVERSAL_COURSE: readonly GreyboxShape[] = [
  box(v(-10, -1, -12), v(80, 0, 12)), // floor
  box(v(4, 0, -12), v(8, 0.3, 12)), // 0.30 m step up, then down
  RAMP, // 40° ramp up to…
  box(v(RAMP.max.x, 0, -12), v(20, 2, 12)), // …a 2 m ledge
  box(v(26, 1.2, -12), v(30, 3, 12)), // 1.2 m crawl tunnel
  rampAt(v(34, 0, -3), 50, 3, 6), // 50° slope, only 6 m wide
  box(v(42, 0, -12), v(43, 0.4, 12)), // 0.40 m wall to jump
  { ...box(v(45, 0, -8), v(49, 0.3, -2)), velocity: v(0.25, 0, 0) }, // moving platform
];

/** The traversal course input log: [ticks, input] segments, 60 Hz. */
export const TRAVERSAL_LOG: readonly CharacterInput[] = inputLog([
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
]);

export const courseGolden = logGolden(
  'character-course',
  TRAVERSAL_COURSE,
  v(0, 0, 0),
  TRAVERSAL_LOG,
);

// --- character-stress -----------------------------------------------------------------------------

/** A walled 12 m arena cluttered with pillars, a step, ramps and a moving platform to collide with. */
const ARENA: readonly GreyboxShape[] = [
  box(v(-8, -1, -8), v(8, 0, 8)), // floor
  box(v(-7, 0, -7), v(7, 3, -6)), // walls
  box(v(-7, 0, 6), v(7, 3, 7)),
  box(v(-7, 0, -6), v(-6, 3, 6)),
  box(v(6, 0, -6), v(7, 3, 6)),
  box(v(-3, 0, -3), v(-1.5, 3, -1.5)), // pillars
  box(v(2, 0, 1.5), v(3, 3, 3.5)),
  box(v(-5, 0, 1.5), v(-2, 0.3, 5)), // a step
  rampAt(v(1, 0, -5), 35, 1.5, 3), // a walkable ramp…
  rampAt(v(-5.5, 0, -5.5), 55, 2, 2), // …and one too steep
  { ...box(v(-1, 0, 3.5), v(1, 0.25, 5.5)), velocity: v(0.05, 0, 0) }, // moving platform
];

/** Stick directions the stress script flicks between (analog and full deflection). */
const STICK: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
  [0.7, 0.7],
  [-0.7, -0.7],
  [0.3, -0.9],
  [-0.5, 0.2],
  [0, 0],
];

/** The stress script's own seed: its input log is fixed, whatever seed a replay runs with. */
const STRESS_SEED = 0xc0ffee;

/**
 * Rapid direction changes: every 2–10 ticks (sometimes a 20–40 tick dash) a new stick direction, camera yaw and buttons, drawn
 * from a seeded stream. Jump is pressed only on the tick of a change.
 */
function stressLog(ticks: number): CharacterInput[] {
  const rng = Rng.create(STRESS_SEED).stream('character-stress');
  const segments: [number, Move][] = [];
  for (let tick = 0; tick < ticks;) {
    const [right, forward] = rng.pick(STICK);
    const move: Move = {
      right,
      forward,
      yaw: rng.int(0, 15) * (Math.PI / 8),
      sprint: rng.chance(0.4),
      crouch: rng.chance(0.2),
    };
    // Mostly 2–10 ticks; now and then a longer dash so the player reaches the walls.
    const length = Math.min(rng.chance(0.1) ? rng.int(20, 40) : rng.int(2, 10), ticks - tick);
    segments.push([1, { ...move, jump: rng.chance(0.08) }], [length - 1, move]);
    tick += length;
  }
  return inputLog(segments);
}

export const stressGolden = logGolden('character-stress', ARENA, v(0, 0, 0), stressLog(1800));

/** Every character golden. */
export const characterGoldens: readonly CharacterGolden[] = [
  basicGolden,
  courseGolden,
  stressGolden,
];
