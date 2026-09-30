// The testbed player replay (mw-e02.23 AC-4): the player walking the greybox testbed, built through
// the same wiring the game boots (the sim's Rapier physics with physics objects and the scene's
// movable props (mw-e03.39), the scene loader, setupTestbedPlayer with RapierCollisionWorld) and driven by ActionFrames sampled from a scripted key and mouse log by
// the real ActionSampler. Its recording (tests/integration/fixtures/testbed-player.replay.json)
// replays in tests/integration/testbed-player.test.ts on every CI run, so a change to the wiring, the
// testbed scene, the input mapping, the controller or Rapier that moves the player fails at the first
// diverging checkpoint.
//
// Not a tests/replays golden: the replay CLI runs under plain Node, which cannot load Rapier's
// non-compat WASM package (see tests/integration/character-course-rapier.test.ts), so the Rapier
// module is passed in and the recording is re-made by the integration test:
//   TESTBED_PLAYER_RECORD=1 pnpm vitest run tests/integration/testbed-player.test.ts

import { loadGameContent } from '@content/game-content';
import { PLAYER_CAMERA_ID, PLAYER_CONTROLLER_ID } from '@content/index';
import {
  installSandboxRules,
  prepareTestbedCombat,
  startTestbedCombat,
  type TestbedCombat,
  type TestbedCombatants,
} from '@game/combat/index';
import { ActionSampler } from '@game/input/index';
import { RenderSync, type SceneBinding } from '@game/loop/index';
import { installGamePhysics, playerFocus } from '@game/physics-objects';
import { setupTestbedPlayer, type TransformReader } from '@game/player/index';
import { SceneLoader } from '@game/scene/index';
import {
  physicsBodiesOf,
  DAMAGE_COMPONENTS,
  HIT_VOLUME_COMPONENTS,
  installDebugCommands,
  testPropSpawners,
  type EntityId,
  RapierCollisionWorld,
  RapierPhysics,
  RapierSightWorld,
  registerSceneComponents,
  World,
  type ActionFrame,
  type RapierModule,
  type ReplayScenario,
} from '@sim/index';

import { actionFrameCommand } from './action-frame-command';

export { actionFrameCommand };

/** Keys held (KeyboardEvent.code) and mouse counts moved right per tick, for a stretch of ticks. */
export interface ScriptStep {
  readonly ticks: number;
  readonly keys?: readonly string[];
  readonly lookX?: number;
}

/**
 * About twelve seconds in the testbed: through the doorway, a jump, a turn, into a wall and back, then
 * a roll and a backstep (mw-e04.8), the light chain and a walk behind the raised shield (mw-e04.6).
 */
export const TESTBED_SCRIPT: readonly ScriptStep[] = [
  { ticks: 30 },
  { ticks: 90, keys: ['KeyW'] }, // across the room towards the doorway
  { ticks: 1, keys: ['KeyW', 'Space'] },
  { ticks: 45, keys: ['KeyW'] }, // a running jump
  { ticks: 60, keys: ['KeyW', 'ShiftLeft'] }, // sprint through the doorway into the corridor
  { ticks: 20, lookX: 25 }, // turn right, towards the corridor's east wall
  { ticks: 60, keys: ['KeyW'] }, // into the wall: blocked
  { ticks: 40, keys: ['KeyS', 'KeyA'] },
  { ticks: 30, keys: ['KeyC', 'KeyD'] }, // crouch-walk
  { ticks: 1, keys: ['Space'] },
  { ticks: 60 },
  { ticks: 20, lookX: -40 },
  { ticks: 90, keys: ['KeyS'] }, // back out towards the room
  { ticks: 1, keys: ['KeyW', 'KeyR'] }, // roll forward, out of the corner the walk ended in
  { ticks: 40 },
  { ticks: 1, keys: ['KeyR'] }, // no direction held: backstep
  { ticks: 40 },
  { ticks: 1, keys: ['Mouse0'] }, // the light chain (mw-e04.6): three swings…
  { ticks: 29 },
  { ticks: 1, keys: ['Mouse0'] },
  { ticks: 33 },
  { ticks: 1, keys: ['Mouse0'] },
  { ticks: 50 },
  { ticks: 40, keys: ['Mouse2', 'KeyW'] }, // …then the shield up, walking at half speed
];

/**
 * A per-tick driver that replays `script` into `sampler` just before each tick is sampled: keys go
 * down and up at the step boundaries, mouse movement arrives every tick of a step.
 */
export function scriptedInput(
  script: readonly ScriptStep[],
  sampler: ActionSampler,
): (tick: number) => void {
  const steps = script.flatMap((step) => Array.from({ length: step.ticks }, () => step));
  let held: readonly string[] = [];
  return (tick) => {
    const step = steps[tick] ?? { ticks: 1 };
    const keys = step.keys ?? [];
    for (const code of held) if (!keys.includes(code)) sampler.up(code);
    for (const code of keys) if (!held.includes(code)) sampler.down(code);
    held = keys;
    if (step.lookX !== undefined) sampler.look(step.lookX, 0);
  };
}

/** The script's length in ticks. */
export const TESTBED_TICKS = TESTBED_SCRIPT.reduce((sum, step) => sum + step.ticks, 0);

/** The ActionFrames the script samples to, one per tick. */
export function testbedLog(script: readonly ScriptStep[] = TESTBED_SCRIPT): ActionFrame[] {
  const sampler = new ActionSampler();
  const drive = scriptedInput(script, sampler);
  const ticks = script.reduce((sum, step) => sum + step.ticks, 0);
  return Array.from({ length: ticks }, (_, tick) => {
    drive(tick);
    return sampler.sample();
  });
}

const nothing = (): undefined => undefined;

/** A scene object for headless runs: render sync binds it and nothing draws it. */
const headless = (object: object, read: TransformReader): SceneBinding<object> => ({
  object,
  read,
  apply: nothing,
  dispose: nothing,
});

/** A scene with the player, headless (see `createGameWorld`). */
export interface HeadlessGame<TInput> {
  readonly world: World<TInput>;
  readonly player: EntityId;
  readonly combat: TestbedCombat;
  readonly combatants: TestbedCombatants;
}

/** The testbed with the player, wired as src/main.ts wires it, minus the renderer. */
export function createTestbedWorld(
  rapier: RapierModule,
  options: { readonly seed: number; readonly hz: number },
): World<ActionFrame> {
  return createGameWorld<ActionFrame>(rapier, options).world;
}

/**
 * Scene `scene` (default the testbed) with the player, wired as src/main.ts wires it — debug
 * commands with the sandbox's spawners, the combat sandbox rules, physics, the player and combat —
 * minus the renderer. The combat sandbox's e2e-free tests (tests/integration) run on it.
 */
export function createGameWorld<TInput>(
  rapier: RapierModule,
  { seed, hz, scene: sceneId = 'testbed' }: { seed: number; hz: number; scene?: string },
): HeadlessGame<TInput> {
  const content = loadGameContent();
  const physics = new RapierPhysics(rapier);
  const world = registerSceneComponents(new World<TInput>({ seed, hz, physics }));
  const combat = prepareTestbedCombat(content);
  const props = testPropSpawners(content.all('testprop').map((prop) => prop.id));
  installDebugCommands(world, {
    spawners: new Map([...props, ...combat.spawners]),
    damage: combat.damage,
  });
  installSandboxRules(world, combat);
  world.register(...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
  const focus = playerFocus(world);
  installGamePhysics(world, { focus: focus.read });
  const sync = new RenderSync(world);
  const scenes = new SceneLoader({
    world,
    sync,
    colliders: physics,
    content,
    objects: { staticGeometry: () => ({}), spawn: () => ({}) },
    binding: headless,
    physics: {},
  });
  const scene = scenes.load(sceneId);
  const player = setupTestbedPlayer({
    world,
    scene,
    sync,
    tuning: content.get('controller', PLAYER_CONTROLLER_ID),
    cameraTuning: content.get('camera', PLAYER_CAMERA_ID),
    collision: new RapierCollisionWorld(physics),
    object: {},
    binding: headless,
    camera: { position: { set: nothing }, lookAt: nothing, fov: 70, near: 0.1, aspect: 16 / 9 },
    interaction: {
      sight: new RapierSightWorld(physics),
      bodiesOf: (entity) => physicsBodiesOf(world, entity),
    },
    moves: combat.moves,
    melee: combat.melee,
  }).entity;
  focus.entity = player;
  const combatants = startTestbedCombat(world, combat, scene.layout.spawns, player);
  return { world, player, combat, combatants };
}

/** The replay scenario, on the given Rapier module. */
export function testbedPlayerScenario(rapier: RapierModule): ReplayScenario<ActionFrame> {
  let log: readonly ActionFrame[] | undefined;
  return {
    name: 'testbed-player',
    usesContent: true,
    command: actionFrameCommand,
    ticks: TESTBED_TICKS,
    create: (options) => createTestbedWorld(rapier, options),
    drive: ({ tick }) => {
      log ??= testbedLog();
      const frame = log[tick];
      return frame === undefined ? [] : [frame];
    },
  };
}
