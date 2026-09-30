import type { Frozen, LockOnTuning } from '@content/index';
import { describe, expect, it } from 'vitest';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { box, type GreyboxBox } from '../character/greybox';
import { CharacterController } from '../character/system';
import { SimClock } from '../clock';
import { DAMAGE_COMPONENTS, HealthComponent } from '../combat/damage/components';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  actionButton,
  actionFrame,
  actionVector,
  stickVector,
  type ActionFrame,
  type ButtonAction,
} from '../input/action-frame';
import { installPlayer, PlayerLook, ViewAnchor, wrapYaw } from '../player/player';
import { registerSceneComponents, SceneTransformComponent } from '../scene/loader';
import type { SceneSpawnPlacement } from '../scene/layout';
import { hashWorld } from '../snapshot';
import { FakeSightWorld } from '../sight/fake-sight-world';
import { LineOfSight } from '../sight/line-of-sight';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { giveTargetable, LockOnComponent, NO_LOCK, TargetableComponent } from './components';
import {
  bearing,
  flickDirection,
  installLockOn,
  lockedTarget,
  lockOnParams,
  lookAtRest,
  placedTargetPosition,
  sceneTargetPosition,
  Targeting,
  turnTowards,
  viewForward,
  zeroHealth,
  type DefeatedCheck,
  type TargetLocator,
} from './lock-on';

/** The shipped player profile's numbers (src/content/data/lock-on/player.json). */
const TUNING: Frozen<LockOnTuning> = {
  selectRange: 20,
  coneAngle: 60,
  breakRange: 25,
  lostSightMs: 1000,
  switchRange: 10,
  eyeHeight: 1.5,
  minVisibility: 0.5,
  distanceWeight: 0.5,
  priorityWeight: 0.25,
  turnRate: 720,
  flick: { stickThreshold: 0.7, stickRest: 0.3, mouseCounts: 40, mouseRest: 5 },
  framing: { time: 0.2, targetWeight: 0.5, pitchOffset: -10 },
};

const CONTROLLER = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
};

/** A training dummy: chest, head and a low fallback point. */
const DUMMY = {
  points: [
    { id: 'chest', at: [0, 1.3, 0] },
    { id: 'head', at: [0, 1.7, 0] },
    { id: 'base', at: [0, 0.4, 0] },
  ],
  priority: 0,
} as const;

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

const START: SceneSpawnPlacement = {
  id: 'player-start',
  position: v(0, 0, 0),
  yaw: 0,
  rotation: IDENTITY,
  prop: undefined,
  tags: ['player-start'],
  targetable: undefined,
};

interface FrameSpec {
  move?: [number, number];
  look?: number;
  stick?: number;
  pressed?: ButtonAction[];
}

function frame({ move = [0, 0], look = 0, stick = 0, pressed = [] }: FrameSpec = {}): ActionFrame {
  return actionFrame({
    move: actionVector(move[0], move[1]),
    look: actionVector(look, 0),
    lookStick: stickVector(stick, 0),
    buttons: (action) => actionButton(pressed.includes(action), pressed.includes(action), false),
  });
}

const IDLE = frame();
const LOCK = frame({ pressed: ['lockOn'] });
const CYCLE = frame({ pressed: ['cycleTarget'] });

/**
 * The player at the origin looking along −z (level) on a flat floor, with lock-on over `walls`
 * (sight only: the player never walks into them in these tests).
 */
function arena(
  walls: readonly GreyboxBox[] = [],
  {
    locate,
    defeated = zeroHealth,
  }: { locate?: TargetLocator; defeated?: DefeatedCheck | null } = {},
) {
  const world = registerSceneComponents(new World<ActionFrame>({ seed: 7 }));
  world.register(...DAMAGE_COMPONENTS);
  const collision = new FakeCollisionWorld([box(v(-60, -1, -60), v(60, 0, 60))]);
  const player = installPlayer(world, { spawns: [START], collision, tuning: CONTROLLER });
  world.set(player, PlayerLook, { yaw: 0, pitch: 0 });
  const sight = new FakeSightWorld(walls);
  installLockOn(world, player, {
    tuning: TUNING,
    sight: new LineOfSight({ world: sight }),
    ...(locate !== undefined && { locate }),
    ...(defeated !== null && { defeated }),
  });
  world.step([IDLE]); // settle onto the floor
  const target = (x: number, z: number, profile: Parameters<typeof giveTargetable>[2] = DUMMY) => {
    const id = world.spawn();
    world.add(id, SceneTransformComponent, { position: v(x, 0, z), rotation: IDENTITY });
    giveTargetable(world, id, profile);
    world.add(id, HealthComponent, { max: 10, current: 10 });
    return id;
  };
  const lock = () => world.get(player, LockOnComponent)?.target;
  const steps = (input: ActionFrame, ticks = 1) => {
    for (let i = 0; i < ticks; i++) world.step([input]);
  };
  const move = (id: EntityId, x: number, z: number) => {
    world.set(id, SceneTransformComponent, { position: v(x, 0, z), rotation: IDENTITY });
  };
  const feet = () => (world.get(player, CharacterController) as { position: Vec3 }).position;
  return { world, player, sight, target, lock, steps, move, feet };
}

describe('lock-on picking (mw-e02.16)', () => {
  it('AC-1: picks the target nearest the camera forward axis, weighted by distance', () => {
    const { target, lock, steps } = arena();
    target(-3, -10); // 17° off, 10.4 m
    const ahead = target(0, -15); // dead ahead, 15 m
    target(4, -6); // 34° off, 7.2 m
    steps(LOCK);
    expect(lock()).toBe(ahead);
  });

  it('AC-1: distance breaks the tie between targets at the same angle; closer wins', () => {
    const { target, lock, steps } = arena();
    target(6, -12); // spawned first: a lower id than `near`
    const near = target(3, -6); // the same bearing as the first, half as far
    steps(LOCK);
    expect(lock()).toBe(near);
  });

  it('AC-1: deterministic: the same scene in any spawn order picks the same place, and the same hash', () => {
    const places: [number, number][] = [
      [-3, -10],
      [0, -15],
      [4, -6],
    ];
    const run = (order: number[]) => {
      const a = arena();
      const ids = order.map((i) => {
        const [x, z] = places[i] ?? [0, 0];
        return a.target(x, z);
      });
      a.steps(LOCK);
      return { picked: order[ids.indexOf(a.lock() ?? -1)], world: a.world };
    };
    expect(run([0, 1, 2]).picked).toBe(1);
    expect(run([2, 0, 1]).picked).toBe(1);
    expect(hashWorld(run([0, 1, 2]).world)).toBe(hashWorld(run([0, 1, 2]).world));
  });

  it('AC-1: exact ties go to the lower entity id', () => {
    const { target, lock, steps } = arena();
    const left = target(-3, -10);
    target(3, -10);
    steps(LOCK);
    expect(lock()).toBe(left);
  });

  it('prefers higher priority at a similar angle and distance', () => {
    const { target, lock, steps } = arena();
    target(-1, -10);
    const bell = target(1, -10, { ...DUMMY, priority: 2 });
    steps(LOCK);
    expect(lock()).toBe(bell);
  });

  it('ignores targets outside 20 m, outside the 60° cone, hidden, defeated or itself', () => {
    const wall = box(v(-6, 0, -9), v(-4, 3, -8));
    const { world, player, target, lock, steps } = arena([wall]);
    target(0, -21); // too far (eye to chest ≈ 21 m)
    target(-12, -6); // 63° off
    target(-5, -10); // behind the wall
    const dead = target(1, -5);
    world.set(dead, HealthComponent, { max: 10, current: 0 });
    giveTargetable(world, player, DUMMY); // the player itself
    steps(LOCK);
    expect(lock()).toBeNull();
    expect(world.has(player, ViewAnchor)).toBe(false);
  });

  it('a lock point hidden behind a low wall falls back to the next one in sight', () => {
    const low = box(v(-2, 0, -6), v(2, 1.9, -5.5)); // hides chest and head
    const { target, lock, steps, sight } = arena([low]);
    const id = target(0, -10);
    steps(LOCK);
    expect(lock()).toBeNull(); // the base point is below the wall too
    sight.set(1, box(v(-2, 0, -6), v(2, 1.45, -5.5))); // now only the chest line is blocked
    steps(LOCK);
    expect(lock()).toBe(id);
  });

  it('pressing lock on again releases the lock and the view anchor', () => {
    const { world, player, target, lock, steps } = arena();
    target(0, -8);
    steps(LOCK);
    steps(IDLE);
    expect(world.get(player, ViewAnchor)?.point).toEqual(v(0, 1.3, -8));
    steps(LOCK);
    expect(lock()).toBeNull();
    steps(IDLE);
    expect(world.has(player, ViewAnchor)).toBe(false);
  });

  it('turns the player to face the target at the turn rate, and holds its view against look input', () => {
    const { world, player, target, steps } = arena();
    target(8, -8); // 45° to the right: look yaw −π/4
    steps(LOCK);
    const yaw = () => world.get(player, PlayerLook)?.yaw;
    expect(yaw()).toBeCloseTo(-Math.PI / 15, 12); // 720°/s = 12° per tick
    steps(frame({ look: 3 }), 10); // small mouse moves: below a flick, and ignored
    expect(yaw()).toBeCloseTo(-Math.PI / 4, 12);
  });

  it('keeps no lock and changes nothing on ticks without an action frame', () => {
    const { world, player, target, lock } = arena();
    target(0, -8);
    world.step([]);
    expect(lock()).toBeNull();
    expect(world.get(player, LockOnComponent)).toEqual(NO_LOCK);
  });
});

describe('lock-on cycling (mw-e02.16)', () => {
  it('AC-2: cycle right moves to the next target clockwise, wrapping around', () => {
    const { target, lock, steps } = arena();
    const west = target(-4, -10);
    const centre = target(0, -10);
    const east = target(4, -10);
    steps(LOCK);
    expect(lock()).toBe(centre);
    steps(CYCLE);
    expect(lock()).toBe(east);
    steps(IDLE, 10); // turn to face it
    steps(CYCLE);
    expect(lock()).toBe(west); // wrapped past the rightmost
  });

  it('AC-2: with no other target, the lock stays on A', () => {
    const { target, lock, steps } = arena();
    const a = target(0, -10);
    steps(LOCK);
    steps(CYCLE);
    expect(lock()).toBe(a);
    steps(frame({ stick: -1 }));
    expect(lock()).toBe(a);
  });

  it('a right-stick flick cycles either way, once per flick', () => {
    const { target, lock, steps } = arena();
    const west = target(-4, -10);
    const centre = target(0, -10);
    const east = target(4, -10);
    steps(LOCK);
    steps(frame({ stick: -0.9 }));
    expect(lock()).toBe(west);
    steps(frame({ stick: -0.9 }), 5); // held over: not another flick
    expect(lock()).toBe(west);
    steps(frame({ stick: 0.5 })); // not at rest yet (above 0.3): still not armed
    steps(frame({ stick: 0.9 }));
    expect(lock()).toBe(west);
    steps(IDLE); // back to rest: armed
    steps(frame({ stick: 0.9 }));
    expect(lock()).toBe(centre);
    steps(IDLE);
    steps(frame({ stick: 0.9 }));
    expect(lock()).toBe(east);
  });

  it('a fast mouse swipe cycles too; slow mouse movement does not', () => {
    const { target, lock, steps } = arena();
    const west = target(-4, -10);
    const centre = target(0, -10);
    steps(LOCK);
    steps(frame({ look: 39 }));
    expect(lock()).toBe(centre);
    steps(IDLE);
    steps(frame({ look: -40 }));
    expect(lock()).toBe(west);
  });

  it('skips targets out of sight, and gives up when the current one cannot be located', () => {
    const wall = box(v(3, 0, -9), v(5, 3, -8));
    const located = new Set<EntityId>();
    const { target, lock, steps } = arena([wall], {
      locate: (world, id) => (located.has(id) ? sceneTargetPosition(world, id) : undefined),
    });
    const centre = target(0, -10);
    target(4, -10); // hidden
    const west = target(-4, -10);
    for (const id of [centre, west]) located.add(id);
    steps(LOCK);
    steps(CYCLE);
    expect(lock()).toBe(west);
    located.delete(west);
    steps(CYCLE); // cannot be located any more: the lock releases
    expect(lock()).toBeNull();
  });
});

describe('lock-on breaking (mw-e02.16)', () => {
  // The target walks from open ground to behind a wall and back.
  const wall = box(v(1.5, 0, -8), v(6.5, 3, -7.5));

  it('AC-3: 1.0 s without line of sight breaks the lock', () => {
    const { world, player, target, lock, steps, move } = arena([wall]);
    const id = target(0, -10);
    steps(LOCK);
    move(id, 4, -10); // behind the wall
    steps(IDLE, 59);
    expect(lock()).toBe(id);
    expect(world.get(player, LockOnComponent)?.unseenTicks).toBe(59);
    steps(IDLE);
    expect(lock()).toBeNull();
  });

  it('AC-3 (edge): sight returning at 0.8 s keeps the lock', () => {
    const { world, player, target, lock, steps, move } = arena([wall]);
    const id = target(0, -10);
    steps(LOCK);
    move(id, 4, -10);
    steps(IDLE, 48);
    move(id, 0, -10);
    steps(IDLE);
    expect(world.get(player, LockOnComponent)?.unseenTicks).toBe(0);
    move(id, 4, -10);
    steps(IDLE, 59);
    expect(lock()).toBe(id); // the count started over
  });

  it('breaks at once when the target is farther than 25 m', () => {
    const { target, lock, steps, move } = arena();
    const id = target(0, -10);
    steps(LOCK);
    move(id, 0, -24);
    steps(IDLE);
    expect(lock()).toBe(id); // beyond the 20 m pick range but within 25 m: kept
    move(id, 0, -26);
    steps(IDLE);
    expect(lock()).toBeNull();
  });

  it('AC-4: a locked target that dies hands the lock to the best target within 10 m', () => {
    const { world, target, lock, steps } = arena();
    const a = target(0, -6);
    const near = target(5, -6); // 7.9 m, 40° off
    target(-3, -12); // 12.4 m: too far to switch to
    steps(LOCK);
    expect(lock()).toBe(a);
    world.set(a, HealthComponent, { max: 10, current: 0 });
    steps(IDLE);
    expect(lock()).toBe(near);
  });

  it('AC-4: switching ignores the pick cone (the next foe may be beside the player)', () => {
    const { world, target, lock, steps } = arena();
    const a = target(0, -6);
    const beside = target(6, 1); // 99° off the view
    steps(LOCK);
    world.destroy(a); // gone entirely
    steps(IDLE);
    expect(lock()).toBe(beside);
  });

  it('AC-4 (edge): with no other target within 10 m the lock releases', () => {
    const { world, player, target, lock, steps } = arena();
    const a = target(0, -6);
    target(0, -14);
    steps(LOCK);
    world.remove(a, TargetableComponent);
    steps(IDLE);
    expect(lock()).toBeNull();
    steps(IDLE);
    expect(world.has(player, ViewAnchor)).toBe(false);
  });
});

describe('lock-on strafing (mw-e02.16)', () => {
  it('AC-5: move = (1, 0) circles the target, keeping the distance within 5% per second', () => {
    const { target, steps, feet } = arena();
    target(0, -5);
    steps(LOCK);
    steps(IDLE, 30); // face it
    const distance = () => Math.sqrt(feet().x ** 2 + (feet().z + 5) ** 2);
    const start = distance();
    let previous = start;
    const right = frame({ move: [1, 0] });
    for (let second = 0; second < 4; second++) {
      steps(right, 60);
      const now = distance();
      expect(Math.abs(now - previous) / previous).toBeLessThan(0.05);
      previous = now;
    }
    expect(Math.abs(distance() - start) / start).toBeLessThan(0.05);
    // It went round: well away from where it started, and to the target's right first.
    expect(Math.sqrt(feet().x ** 2 + feet().z ** 2)).toBeGreaterThan(3);
  });
});

describe('lock-on helpers (mw-e02.16)', () => {
  it('converts tuning to per-tick values', () => {
    const p = lockOnParams(TUNING, new SimClock(60));
    expect(p.cone).toBeCloseTo(Math.PI / 3, 12);
    expect(p.lostSightTicks).toBe(60);
    expect(p.turnStep).toBeCloseTo((4 * Math.PI) / 60, 12);
  });

  it('bearing, viewForward and turnTowards agree on yaw (0 looks along −z, positive turns left)', () => {
    expect(bearing(v(0, 0, 0), v(0, 5, -3))).toBe(0);
    expect(bearing(v(0, 0, 0), v(-3, 0, 0))).toBeCloseTo(Math.PI / 2, 12);
    expect(bearing(v(1, 0, 1), v(1, 5, 1))).toBeUndefined();
    const f = viewForward(Math.PI / 2, 0);
    expect(f.x).toBeCloseTo(-1, 12);
    expect(viewForward(0, Math.PI / 2).y).toBeCloseTo(1, 12);
    expect(turnTowards(0, 1, 0.25)).toBe(0.25);
    expect(turnTowards(0, -1, 0.25)).toBe(-0.25);
    expect(turnTowards(0, 0.1, 0.25)).toBe(0.1);
    expect(turnTowards(3, -3, 0.1)).toBeCloseTo(wrapYaw(3.1), 12); // the short way, across ±π
  });

  it('flicks need to be armed; rest re-arms them', () => {
    const { flick } = TUNING;
    expect(flickDirection(frame({ stick: 0.8 }), true, flick)).toBe(1);
    expect(flickDirection(frame({ stick: -0.8 }), true, flick)).toBe(-1);
    expect(flickDirection(frame({ look: 50 }), true, flick)).toBe(1);
    expect(flickDirection(frame({ look: -50 }), true, flick)).toBe(-1);
    expect(flickDirection(frame({ stick: 0.8 }), false, flick)).toBeUndefined();
    expect(flickDirection(frame({ look: 10 }), true, flick)).toBeUndefined();
    expect(lookAtRest(frame({ stick: 0.3, look: 5 }), flick)).toBe(true);
    expect(lookAtRest(frame({ stick: 0.31 }), flick)).toBe(false);
    expect(lookAtRest(frame({ look: 6 }), flick)).toBe(false);
  });

  it('a locker without a body or view is skipped; a target directly above cannot be cycled from', () => {
    const { world, target, lock, steps, player } = arena();
    const bodiless = world.spawn();
    world.add(bodiless, LockOnComponent, NO_LOCK);
    steps(LOCK);
    expect(world.get(bodiless, LockOnComponent)).toEqual(NO_LOCK);

    const targeting = new Targeting(
      world,
      lockOnParams(TUNING, world.clock),
      { ray: () => 1 },
      sceneTargetPosition,
      zeroHealth,
    );
    // Looking straight down at a target right where the player stands.
    world.set(player, PlayerLook, { yaw: 0.5, pitch: -1.55 });
    const view = targeting.viewpoint(player);
    if (view === undefined) throw new Error('no view');
    const under = target(0, 0);
    const other = target(0, -5);
    expect(targeting.cycle(view, under, 1)).toBeUndefined();
    // Cycling from elsewhere skips a target directly below (no bearing).
    expect(targeting.cycle(view, other, 1)).toBeUndefined();
    expect(targeting.lockPoint(other, { points: [], priority: 0 })).toBeUndefined();
    expect(targeting.mainPoint(player)).toBeUndefined(); // not targetable
    // Locked on to it, the player keeps its yaw (there is no direction to turn to).
    steps(LOCK);
    expect(lock()).toBe(under);
    expect(world.get(player, PlayerLook)?.yaw).toBe(0.5);
  });

  it('a target straight behind the current one is next in either direction', () => {
    const { target, lock, steps } = arena();
    const near = target(3, -6);
    const far = target(6, -12);
    steps(LOCK);
    expect(lock()).toBe(near);
    steps(CYCLE);
    expect(lock()).toBe(far);
    steps(frame({ stick: -1 }));
    expect(lock()).toBe(near);
  });

  it('the default defeated check never defeats anything', () => {
    const { world, target, lock, steps } = arena([], { defeated: null });
    const a = target(0, -6);
    world.set(a, HealthComponent, { max: 10, current: 0 });
    steps(LOCK);
    expect(lock()).toBe(a);
  });
});

describe('lock-on on moving targets (mw-e02.32)', () => {
  it('the default locator follows a placement (a knocked-back dummy), else the scene position', () => {
    const { world, target, lock, steps, player } = arena();
    if (!world.isRegistered(PlacementComponent)) world.register(PlacementComponent);
    const scenic = target(4, -6);
    const placed = world.spawn();
    placeEntity(world, placed, v(0, 0, -4), 0.35);
    giveTargetable(world, placed, DUMMY);
    world.step([IDLE]);
    expect(placedTargetPosition(world, scenic)).toEqual(v(4, 0, -6));
    expect(placedTargetPosition(world, placed)).toMatchObject(v(0, 0, -4));
    steps(LOCK);
    expect(lock()).toBe(placed);
    expect(lockedTarget(world, player)).toBe(placed);
    placeEntity(world, placed, v(-1, 0, -5), 0.35); // knocked back
    steps(IDLE);
    expect(world.get(player, ViewAnchor)?.point).toEqual(v(-1, 1.3, -5));
    steps(LOCK); // released
    expect(lockedTarget(world, player)).toBeUndefined();
    expect(lockedTarget(world, scenic)).toBeUndefined(); // not a locker
  });

  it('without placements registered, the default locator reads the scene position', () => {
    const world = registerSceneComponents(new World({ seed: 1 }));
    const id = world.spawn();
    world.add(id, SceneTransformComponent, { position: v(3, 0, 4), rotation: IDENTITY });
    expect(world.isRegistered(PlacementComponent)).toBe(false);
    expect(placedTargetPosition(world, id)).toEqual(v(3, 0, 4));
  });
});
