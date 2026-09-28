// The "core" replay scenario (mw-e00.17): a small world that leans on every core sim mechanism a
// replay has to reproduce — input commands, several systems in order, named RNG streams, events
// with handlers that spawn and destroy, deferred structural changes and float arithmetic — so its
// golden replay (tests/replays/core.json) catches nondeterminism in the sim core itself. It is test
// scaffolding, not game rules: game features bring their own scenarios.
//
// It deliberately avoids simMath transcendentals: Node 24's Math.sin/cos differ in the last bit
// between macOS arm64 and Linux x64, so a trig-driven golden recorded on a laptop fails in CI
// (mw-e00.28 makes simMath bit-identical across platforms). + - * / are exact everywhere.

import { z } from 'zod';
import { defineComponent, type EntityId } from '../../core/component';
import { defineEvent } from '../../core/events';
import { World } from '../../core/world';
import type { DriveContext, ReplayScenario } from '../scenario';

/** Arena half-width: bodies bounce off ±ARENA on both axes. */
const ARENA = 10;
/** Spawn commands are ignored at this population, so the world stays small. */
const MAX_BODIES = 12;
/** Every body loses 1 hp this often (ticks). */
const DECAY_EVERY = 30;

const Position = defineComponent<{ x: number; y: number }>('Position');
const Velocity = defineComponent<{ x: number; y: number }>('Velocity');
const Health = defineComponent<{ hp: number }>('Health');

/** The scenario's component types (tests perturb them to prove divergence is caught). */
export const coreComponents = { Position, Velocity, Health } as const;

const Died = defineEvent<{ id: EntityId; x: number; y: number }>('Died');

const coordinate = z.number().min(-ARENA).max(ARENA);

/** The scenario's sim commands. `target` indexes the live bodies in id order (modulo their count). */
export const coreCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('spawn'), x: coordinate, y: coordinate }),
  z.object({
    type: z.literal('push'),
    target: z.number().int().nonnegative(),
    dx: z.number(),
    dy: z.number(),
  }),
  z.object({
    type: z.literal('hit'),
    target: z.number().int().nonnegative(),
    amount: z.number().int().positive(),
  }),
]);
export type CoreCommand = z.infer<typeof coreCommand>;

function spawnBody(world: World<CoreCommand>, x: number, y: number, hp: number): void {
  const id = world.spawn();
  world.add(id, Position, { x, y });
  world.add(id, Velocity, { x: 0, y: 0 });
  world.add(id, Health, { hp });
}

/** Bounces a coordinate/velocity pair off the arena walls. */
function bounce(p: number, v: number): [number, number] {
  if (p > ARENA) return [2 * ARENA - p, -v];
  if (p < -ARENA) return [-2 * ARENA - p, -v];
  return [p, v];
}

type Body = readonly [EntityId, { x: number; y: number }, { x: number; y: number }, { hp: number }];

/** Deals damage to a body in place; a body reaching 0 hp announces its death once. */
function damage(world: World<CoreCommand>, [id, position, , health]: Body, amount: number): void {
  if (health.hp <= 0) return; // already dying this tick
  health.hp -= amount;
  if (health.hp <= 0) world.events.emit(Died, { id, x: position.x, y: position.y });
}

function createCoreWorld({ seed, hz }: { seed: number; hz: number }): World<CoreCommand> {
  const world = new World<CoreCommand>({ seed, hz }).register(Position, Velocity, Health);
  const bodies = world.query(Position, Velocity, Health);

  // A death may split into two smaller bodies, which go live at the end of the tick.
  world.events.on(Died, ({ id, x, y }) => {
    world.destroy(id);
    const split = world.random('split');
    if (world.entityCount < MAX_BODIES && split.chance(0.5)) {
      for (let i = 0; i < 2; i++) spawnBody(world, x, y, split.int(1, 4));
    }
  });

  world
    .addSystem({
      name: 'commands',
      run({ inputs }) {
        const live: Body[] = [];
        bodies.forEach((...body) => live.push(body));
        for (const command of inputs) {
          if (command.type === 'spawn') {
            if (world.entityCount < MAX_BODIES) spawnBody(world, command.x, command.y, 5);
            continue;
          }
          const body = live[command.target % Math.max(live.length, 1)];
          if (body === undefined) continue;
          if (command.type === 'hit') {
            damage(world, body, command.amount);
          } else {
            body[2].x += command.dx;
            body[2].y += command.dy;
          }
        }
      },
    })
    .addSystem({
      name: 'wander',
      run({ tick }) {
        const rng = world.random('wander');
        bodies.forEach((id, _position, velocity) => {
          // A triangle-wave gust per body plus a random nudge on each axis.
          const phase = ((tick + id * 17) % 80) / 40; // 0..2
          const gust = 0.2 * (phase < 1 ? phase : 2 - phase);
          world.set(id, Velocity, {
            x: velocity.x * 0.95 + gust * (rng.float() * 2 - 1),
            y: velocity.y * 0.95 + gust * (rng.float() * 2 - 1),
          });
        });
      },
    })
    .addSystem({
      name: 'move',
      run({ clock }) {
        const dt = 1 / clock.hz;
        bodies.forEach((id, position, velocity) => {
          const [x, vx] = bounce(position.x + velocity.x * dt, velocity.x);
          const [y, vy] = bounce(position.y + velocity.y * dt, velocity.y);
          world.set(id, Position, { x, y });
          world.set(id, Velocity, { x: vx, y: vy });
        });
      },
    })
    .addSystem({
      name: 'decay',
      run({ tick }) {
        if (tick % DECAY_EVERY !== DECAY_EVERY - 1) return;
        bodies.forEach((...body) => {
          damage(world, body, 1);
        });
      },
    });

  const setup = world.random('setup');
  for (let i = 0; i < 4; i++) {
    spawnBody(world, setup.int(-ARENA, ARENA), setup.int(-ARENA, ARENA), setup.int(3, 8));
  }
  return world;
}

/** Scripted player: a spawn, push or hit roughly every 20 ticks. */
function driveCore({ rng }: DriveContext<CoreCommand>): CoreCommand[] {
  if (!rng.chance(0.05)) return [];
  const target = rng.int(0, 11);
  return [
    rng.weighted<CoreCommand>([
      { value: { type: 'spawn', x: rng.int(-ARENA, ARENA), y: rng.int(-ARENA, ARENA) }, weight: 2 },
      { value: { type: 'push', target, dx: rng.int(-3, 3), dy: rng.int(-3, 3) }, weight: 3 },
      { value: { type: 'hit', target, amount: rng.int(1, 3) }, weight: 3 },
    ]),
  ];
}

export const coreScenario: ReplayScenario<CoreCommand> = {
  name: 'core',
  usesContent: false,
  command: coreCommand,
  create: createCoreWorld,
  drive: driveCore,
};
