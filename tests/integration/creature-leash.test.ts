// mw-e01.17 AC-5: the slice's arena skeleton on its 25 m leash (docs/design/vertical-slice.md §6,
// failure F5), through the game's own wiring (createGameWorld: Rapier physics, the slice's navmesh,
// perception by the light field, awareness and AI with the Forgotten's content behaviour). The
// skeleton is not placed in slice.json until mw-e01.5, so the test spawns it at its post, (2.5, 0,
// 32.5) facing south, with the leash the slice gives it. The player picks a fight in the arena, then
// flees down the corridor into the spawn room: the skeleton gives up at the leash edge (near z = 7.5),
// never enters the spawn room, and is back at its post within 15 s.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import {
  actionButton,
  actionFrame,
  actionVector,
  AlertStateChanged,
  brainOf,
  facingFromYaw,
  PlacementComponent,
  spawnCreature,
  teleportCommand,
  type AlertStateChange,
  type EntityId,
  type Vec3,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const HZ = 60;
const POST: Vec3 = { x: 2.5, y: 0, z: 32.5 };
const LEASH_M = 25;
/** The spawn room's north wall: the room is z ≤ 5. */
const SPAWN_ROOM_Z = 5;
/** How fast the player flees, m/s: a jog, a little quicker than the skeleton's 2.6 m/s lurch. */
const FLEE_SPEED = 3;
/** The way the player flees: out of the arena, through the doorway and down the corridor. */
const START: Vec3 = { x: 1.5, y: 0, z: 29 };
const FLIGHT: readonly Vec3[] = [START, { x: 0, y: 0, z: 24.5 }, { x: 0, y: 0, z: -2 }];

const UP = actionButton(false, false, false);
const IDLE = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: () => UP,
});

const flat = (a: Vec3, b: Vec3) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

/** The point `metres` along `path` (its end once past it). */
function along(path: readonly Vec3[], metres: number): Vec3 {
  let left = metres;
  let [a = START] = path;
  for (const b of path.slice(1)) {
    const leg = flat(a, b);
    if (left <= leg) {
      const t = left / leg;
      return { x: a.x + (b.x - a.x) * t, y: 0, z: a.z + (b.z - a.z) * t };
    }
    left -= leg;
    a = b;
  }
  return a;
}

describe('the arena skeleton’s leash (mw-e01.17)', () => {
  it('AC-5: the player flees down the corridor into the spawn room; within 15 s the skeleton, never having entered it, is back at its post', ({
    task,
  }) => {
    markExercised(task, 'creature', 'forgotten-miner');
    markExercised(task, 'behaviour', 'forgotten');
    const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: HZ, scene: 'slice' });
    const { world, player } = game;
    const sim = world as unknown as World<never>;
    const spawned = spawnCreature(sim, game.creatures.spawn, {
      creature: 'forgotten-miner',
      at: POST,
      facing: facingFromYaw(180),
      point: 'skeleton',
      leash: { radius: LEASH_M },
    });
    if (!spawned.ok) throw new Error('the skeleton did not spawn');
    const skeleton: EntityId = spawned.entity;
    const changes: AlertStateChange[] = [];
    sim.events.on(AlertStateChanged, (e) => {
      if (e.entity === skeleton) changes.push(e);
    });
    const at = (entity: EntityId): Vec3 => {
      const p = world.get(entity, PlacementComponent);
      if (p === undefined) throw new Error('not placed');
      return { x: p.x, y: p.y, z: p.z };
    };
    const state = () => brainOf(sim, skeleton)?.state;
    let furthest = 0;
    let southmost = Infinity;
    const step = (input: unknown) => {
      world.step([input]);
      const here = at(skeleton);
      furthest = Math.max(furthest, flat(here, POST));
      southmost = Math.min(southmost, here.z);
    };

    // The player walks into the arena, in front of the skeleton, and it comes for them.
    step(teleportCommand(player, START));
    let n = 0;
    while (state() !== 'combat') {
      step(IDLE);
      if (++n > 20 * HZ) throw new Error(`the skeleton never fought: ${String(state())}`);
    }

    // They flee: out through the doorway, down the corridor, into the spawn room.
    let fled = 0;
    let inRoom = -1;
    for (let tick = 0; inRoom < 0; tick++) {
      if (tick > 30 * HZ) throw new Error('the player never reached the spawn room');
      fled += FLEE_SPEED / HZ;
      const to = along(FLIGHT, fled);
      step(teleportCommand(player, to));
      if (to.z < SPAWN_ROOM_Z) inRoom = sim.tick;
    }
    // 15 s pass with the player in the spawn room.
    let home = -1;
    for (let tick = 0; tick < 15 * HZ; tick++) {
      step(IDLE);
      if (home < 0 && state() === 'unaware' && flat(at(skeleton), POST) <= 0.5) home = sim.tick;
    }

    const leashed = changes.find((e) => e.cause === 'leash');
    expect(leashed, JSON.stringify(changes)).toMatchObject({ from: 'combat', to: 'searching' });
    expect(southmost).toBeGreaterThan(SPAWN_ROOM_Z); // it never entered the spawn room
    expect(furthest).toBeLessThan(LEASH_M + 0.1); // nor went (more than a stride) past its leash
    expect(home).toBeGreaterThan(0);
    expect((home - inRoom) / HZ).toBeLessThanOrEqual(15);
    expect(state()).toBe('unaware');
    expect(flat(at(skeleton), POST)).toBeLessThanOrEqual(0.5);
  });
});
