// mw-e02.6 AC-5: animation update cost for 20 characters animated from sim locomotion in the greybox
// testbed, over 30 s. Every character is a real controller character (CharacterController +
// CharacterLocomotion, colliding with the testbed through the sim's Rapier world) running a looping
// script — stand, run a circle, jump, run, crouch-walk — so the grey-box humanoid's base layer
// crossfades through idle, move (walk/run blend), jump, fall, land and crouch. All 20 stand within
// 30 m of the camera, so none is spared by LOD. Only the animation work of each frame is timed —
// capture after the step and AnimationDriver.frame() (parameter reads, controller updates, pose
// evaluation, copying poses out) — not the sim step or rendering. Budget: p95 ≤ 1.0 ms per frame on
// the reference machine (High); CI runners are slower, so this is a ceiling, not a measurement. Run
// with `pnpm bench`.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, test } from 'vitest';
import { loadGameContent, PLAYER_CONTROLLER_ID } from '@content/index';
import { AnimationDriver, characterLocomotion, simAnimReader } from '@game/animation/index';
import { RenderSync } from '@game/loop/render-sync';
import { readSceneTransform, SceneLoader } from '@game/scene/index';
import { AnimationController, compileGraph, createPose } from '@render/animation/index';
import {
  CharacterController,
  CharacterLocomotion,
  characterControllerSystem,
  giveLocomotion,
  IDLE_INPUT,
  locomotionSystem,
  RapierCollisionWorld,
  RapierPhysics,
  registerSceneComponents,
  SKIN,
  spawnCharacter,
  World,
  type CharacterInput,
  type EntityId,
} from '@sim/index';

const CHARACTERS = 20;
const SECONDS = 30;
const BUDGET_MS = 1.0;
/** Script length, ticks. */
const LOOP = 240;

const up = { pressed: false, held: false };
const down = { pressed: false, held: true };
const press = { pressed: true, held: true };

/** Character `i`'s input on `tick`: its script, offset so the crowd is spread over the loop. */
function scripted(i: number, tick: number): CharacterInput {
  const t = (tick + i * 37) % LOOP;
  // Circling: the move direction turns a full circle every 2 s.
  const cameraYaw = ((tick % 120) / 120) * 2 * Math.PI + i;
  const move = (y: number) => ({ x: 0, y });
  if (t < 40 || t >= 210) return IDLE_INPUT;
  if (t < 100) return { actions: { ...IDLE_INPUT.actions, move: move(1) }, cameraYaw };
  if (t < 160) {
    const jump = t === 100 ? press : up;
    return { actions: { move: move(1), jump, sprint: up, crouch: up }, cameraYaw };
  }
  return { actions: { move: move(0.8), jump: up, sprint: up, crouch: down }, cameraYaw };
}

describe('locomotion animation update', () => {
  test('mw-e02.6 AC-5: 20 characters animated from sim locomotion cost ≤ 1.0 ms per frame p95 over 30 s', () => {
    const content = loadGameContent();
    const tuning = content.get('controller', PLAYER_CONTROLLER_ID);
    const physics = new RapierPhysics(RAPIER);
    const world = registerSceneComponents(new World<number>({ seed: 1, physics }));
    world.register(CharacterController, CharacterLocomotion);
    const sync = new RenderSync(world);
    new SceneLoader({
      world,
      sync,
      colliders: physics,
      content,
      objects: { staticGeometry: () => ({}), spawn: () => ({}) },
      binding: (object: object) => ({
        object,
        read: readSceneTransform,
        apply: () => undefined,
        dispose: () => undefined,
      }),
    }).load('testbed');
    const entities: EntityId[] = [];
    const index = new Map<EntityId, number>();
    world
      .addSystem(
        characterControllerSystem<number>({
          collision: new RapierCollisionWorld(physics),
          tuning,
          input: ([tick], entity) => scripted(index.get(entity) ?? 0, tick ?? 0),
        }),
      )
      .addSystem(
        locomotionSystem<number>({
          tuning,
          moving: ([tick], entity) => {
            const move = scripted(index.get(entity) ?? 0, tick ?? 0).actions.move;
            return move.x !== 0 || move.y !== 0;
          },
        }),
      );
    const graph = compileGraph(
      content.get('anim-graph', 'greybox-humanoid'),
      content.all('anim-clip'),
    );
    const driver = new AnimationDriver(world);
    const read = simAnimReader({
      moves: new Map(),
      locomotion: characterLocomotion,
      timeline: false,
    });
    for (let i = 0; i < CHARACTERS; i++) {
      // Five columns of four rows in the testbed arena, 2 m apart.
      const entity = spawnCharacter(world, {
        x: -4 + (i % 5) * 2,
        y: SKIN,
        z: 19 + Math.floor(i / 5) * 2,
      });
      giveLocomotion(world, entity);
      index.set(entity, i);
      entities.push(entity);
      const bones = createPose(graph.rig.bones.length);
      driver.add(entity, {
        name: `character-${String(i)}`,
        controller: new AnimationController(graph),
        read,
        apply: (pose) => {
          bones.set(pose);
        },
        locate: () => world.get(entity, CharacterController)?.position,
      });
    }
    const focus = { x: 0, y: 1.6, z: 14 };
    const costs: number[] = [];
    const states = new Set<string>();
    for (let frame = 0; frame < SECONDS * 60; frame++) {
      world.step([frame]);
      const start = performance.now();
      driver.capture();
      driver.frame(0.5, 1 / 60, focus);
      costs.push(performance.now() - start);
      for (const probe of Object.values(driver.probe())) states.add(probe.layers[0]?.state ?? '');
    }
    costs.sort((a, b) => a - b);
    const p95 = costs[Math.floor(costs.length * 0.95)] ?? Infinity;
    console.log(
      `[perf] locomotion animation frame p50/p95 ${String(costs[costs.length >> 1]?.toFixed(3))}/${p95.toFixed(3)} ms for ${String(CHARACTERS)} characters`,
    );
    // Every character animated every frame, through every locomotion state the script reaches.
    expect(driver.lastFrame).toEqual({ updated: CHARACTERS, deferred: 0 });
    expect([...states].sort()).toEqual(['crouch', 'fall', 'idle', 'jump', 'land', 'move']);
    expect(p95).toBeLessThanOrEqual(BUDGET_MS);
  });
});
