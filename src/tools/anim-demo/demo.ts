// Animation demo characters for the greybox testbed (mw-e02.20 AC-6). A dev fixture, not gameplay:
// each demo entity loops idle → move → attack → hit-react through real sim state — a mover writes its
// position, speed and turn rate, `requestMove` starts its attack on the action timeline (mw-e04.4) and
// `interruptAction` locks it in a hit reaction — so the animation runtime can be watched (and
// probed by e2e) reacting to the sim exactly as characters will. Nothing here reads animation.
//
//   idle      IDLE_TICKS standing still
//   move      MOVE_TICKS walking one full circle at MOVE_SPEED, back to where it started
//   attack    requests its attack move; ends when the move has ended
//   hit-react interruptAction with HIT_REACT_TICKS of lock; ends when the lock has run out

import {
  defineComponent,
  interruptAction,
  requestMove,
  type ActionTimeline,
  type EntityId,
  type System,
  type World,
} from '@sim/index';
import { ActionTimelineComponent, giveActionTimeline } from '@sim/index';

/** Demo phases, in the order they loop. */
export const ANIM_DEMO_PHASES = ['idle', 'move', 'attack', 'hit-react'] as const;
export type AnimDemoPhase = (typeof ANIM_DEMO_PHASES)[number];

export const IDLE_TICKS = 60;
export const MOVE_TICKS = 120;
/** Walking speed, m/s. */
export const MOVE_SPEED = 1.5;
export const HIT_REACT_TICKS = 36;

const HZ = 60;
const TURN_RATE = (2 * Math.PI) / (MOVE_TICKS / HZ);

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A demo character's state. */
export interface AnimDemo {
  readonly phase: AnimDemoPhase;
  /** Ticks spent in the phase. */
  readonly phaseTick: number;
  /** Where it stands between walks. */
  readonly origin: Vec3;
  readonly position: Vec3;
  /** Facing, radians about +y (0 faces −z). */
  readonly yaw: number;
  readonly startYaw: number;
  /** Horizontal speed and yaw rate this tick. */
  readonly speed: number;
  readonly turnRate: number;
  /** The move its attack requests. */
  readonly attack: string;
}

/** The demo component (`tools.anim-demo`). */
export const AnimDemoComponent = defineComponent<AnimDemo>('tools.anim-demo');

export interface AnimDemoSpawn {
  readonly at: Vec3;
  readonly yaw?: number;
  /** Move id of its attack, e.g. "sword-light-1". */
  readonly attack: string;
}

/**
 * Spawns a demo character with an idle action timeline. The world must have AnimDemoComponent and
 * the action timeline components registered.
 */
export function spawnAnimDemo(world: World<never>, spawn: AnimDemoSpawn): EntityId {
  const entity = world.spawn();
  const yaw = spawn.yaw ?? 0;
  world.add(entity, AnimDemoComponent, {
    phase: 'idle',
    phaseTick: 0,
    origin: spawn.at,
    position: spawn.at,
    yaw,
    startYaw: yaw,
    speed: 0,
    turnRate: 0,
    attack: spawn.attack,
  });
  giveActionTimeline(world, entity);
  return entity;
}

const enter = (demo: AnimDemo, phase: AnimDemoPhase): AnimDemo => ({
  ...demo,
  phase,
  phaseTick: 0,
  position: demo.origin,
  yaw: demo.startYaw,
  speed: 0,
  turnRate: 0,
});

function step(
  world: World<never>,
  entity: EntityId,
  demo: AnimDemo,
  timeline: ActionTimeline,
): AnimDemo {
  const tick = demo.phaseTick + 1;
  switch (demo.phase) {
    case 'idle':
      return tick >= IDLE_TICKS ? enter(demo, 'move') : { ...demo, phaseTick: tick };
    case 'move': {
      if (tick > MOVE_TICKS) {
        requestMove(world, entity, demo.attack);
        return enter(demo, 'attack');
      }
      const yaw = demo.yaw + TURN_RATE / HZ;
      const d = MOVE_SPEED / HZ;
      return {
        ...demo,
        phaseTick: tick,
        yaw,
        speed: MOVE_SPEED,
        turnRate: TURN_RATE,
        position: {
          x: demo.position.x - Math.sin(demo.yaw) * d,
          y: demo.position.y,
          z: demo.position.z - Math.cos(demo.yaw) * d,
        },
      };
    }
    case 'attack':
      // The request is taken on the tick it is made; the phase lasts until the move has ended.
      if (tick > 1 && timeline.current === null) {
        interruptAction(world, entity, HIT_REACT_TICKS);
        return enter(demo, 'hit-react');
      }
      return { ...demo, phaseTick: tick };
    case 'hit-react':
      return timeline.lockTicks === 0 ? enter(demo, 'idle') : { ...demo, phaseTick: tick };
  }
}

/** Runs every demo character; add it before the action timeline system. */
export function animDemoSystem(): System<unknown> {
  return {
    name: 'tools.anim-demo',
    run: ({ world }) => {
      const demos: [EntityId, AnimDemo, ActionTimeline][] = [];
      world.query(AnimDemoComponent, ActionTimelineComponent).forEach((id, demo, timeline) => {
        demos.push([id, demo, timeline]);
      });
      const w = world as World<never>;
      for (const [id, demo, timeline] of demos) {
        w.set(id, AnimDemoComponent, step(w, id, demo, timeline));
      }
    },
  };
}

/** A demo character's drawn transform: its position, turned to its yaw. */
export function animDemoTransform(
  view: Pick<World, 'get'>,
  entity: EntityId,
): { position: Vec3; rotation: { x: number; y: number; z: number; w: number } } | undefined {
  const demo = view.get(entity, AnimDemoComponent);
  if (demo === undefined) return undefined;
  return {
    position: demo.position,
    rotation: { x: 0, y: Math.sin(demo.yaw / 2), z: 0, w: Math.cos(demo.yaw / 2) },
  };
}

/** A demo character's locomotion, for the animation parameters. */
export function animDemoLocomotion(
  view: Pick<World, 'get'>,
  entity: EntityId,
): { speed: number; turnRate: number; grounded: boolean } | undefined {
  const demo = view.get(entity, AnimDemoComponent);
  if (demo === undefined) return undefined;
  return { speed: demo.speed, turnRate: demo.turnRate, grounded: true };
}
