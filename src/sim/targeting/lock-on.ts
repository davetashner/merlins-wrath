// Lock-on (mw-e02.16): picking, keeping, cycling and breaking a lock on a Targetable, as rules of the
// game. The lock decides what the player faces and strafes around, so it lives here (replays
// reproduce it); the camera's framing of player and target is presentation (src/game/camera).
//
// Each tick, for every locker (a player with a LockOn), after the character controller has moved it:
//  1. The current target is checked. A target that is gone, no longer targetable or defeated hands
//     the lock to the best other target within switchRange (no cone: it may be anywhere around), or
//     releases it. One farther than breakRange releases it. One out of sight counts unseen ticks;
//     lostSightMs of them in a row release it, and sight returning sooner resets the count.
//  2. Input. Lock on toggles: with no lock it picks the best target, with one it releases. While
//     locked, cycle target (or a flick of the right stick or mouse, once look input has come back to
//     rest since the last flick) moves the lock to the next target clockwise (right) or
//     anticlockwise (left) around the player, wrapping; with no other target the lock stays.
//  3. The lock is written back, the ViewAnchor follows the target's main lock point (so look input
//     stops turning the view and the controller strafes around it next tick), and the player's view
//     yaw turns towards the target at turnRate.
//
// Picking ("best"): of the targets with a lock point in sight (at least minVisibility of its sight
// line from the eye clear), within selectRange and within coneAngle of the camera forward (the
// PlayerLook view direction), the lowest score angle ÷ coneAngle + distanceWeight × distance ÷
// selectRange − priorityWeight × priority wins, ties to the lower entity id. Distances and angles
// are measured from the eye (eyeHeight above the feet) to the first lock point in sight.
//
// "Screen angle" for cycling is the bearing around the player seen from above, which is the order
// targets appear across the screen from a camera behind the player.

import type { Frozen, LockOnTuning } from '@content/index';
import { CharacterController } from '../character/system';
import { radians } from '../character/greybox';
import type { EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { HealthComponent } from '../combat/damage/components';
import { actionFrameOf, type ActionFrame } from '../input/action-frame';
import { atan2, cos, sin } from '../math';
import { PlayerLook, ViewAnchor, wrapYaw } from '../player/player';
import { SceneTransformComponent } from '../scene/loader';
import type { LineOfSight } from '../sight/line-of-sight';
import type { Vec3 } from '../stimulus/shapes';
import {
  LockOnComponent,
  NO_LOCK,
  TargetableComponent,
  type LockOn,
  type Targetable,
} from './components';

const TAU = 2 * Math.PI;

/** Where a targetable entity's origin is now, or undefined when it has none. */
export type TargetLocator = <T>(world: World<T>, entity: EntityId) => Vec3 | undefined;

/** Whether a targetable entity is defeated (dead): it can no longer be locked on to. */
export type DefeatedCheck = <T>(world: World<T>, entity: EntityId) => boolean;

/** The default locator: a scene entity's static position (SceneTransform must be registered). */
export const sceneTargetPosition: TargetLocator = (world, entity) =>
  world.get(entity, SceneTransformComponent)?.position;

/** Defeated at zero health (the damage model's Health must be registered). */
export const zeroHealth: DefeatedCheck = (world, entity) =>
  world.get(entity, HealthComponent)?.current === 0;

/** Never defeated (the default: nothing can die yet). */
const neverDefeated: DefeatedCheck = () => false;

/** Lock-on tuning in sim units (radians, ticks). */
export interface LockOnParams {
  readonly selectRange: number;
  /** Half-angle of the pick cone, radians. */
  readonly cone: number;
  readonly breakRange: number;
  readonly lostSightTicks: number;
  readonly switchRange: number;
  readonly eyeHeight: number;
  readonly minVisibility: number;
  readonly distanceWeight: number;
  readonly priorityWeight: number;
  /** Largest yaw turn per tick, radians. */
  readonly turnStep: number;
  readonly flick: Frozen<LockOnTuning['flick']>;
}

/** Derives the per-tick values from `tuning` at the clock's tick rate. */
export function lockOnParams(
  tuning: Frozen<LockOnTuning>,
  clock: { readonly hz: number; ticksFor(ms: number): number },
): LockOnParams {
  return {
    selectRange: tuning.selectRange,
    cone: radians(tuning.coneAngle),
    breakRange: tuning.breakRange,
    lostSightTicks: clock.ticksFor(tuning.lostSightMs),
    switchRange: tuning.switchRange,
    eyeHeight: tuning.eyeHeight,
    minVisibility: tuning.minVisibility,
    distanceWeight: tuning.distanceWeight,
    priorityWeight: tuning.priorityWeight,
    turnStep: radians(tuning.turnRate) / clock.hz,
    flick: tuning.flick,
  };
}

/** A target as seen from a locker this tick. */
export interface Sighting {
  readonly entity: EntityId;
  /** The first lock point in sight, world metres. */
  readonly point: Vec3;
  /** Eye to point, metres. */
  readonly distance: number;
  /** Between the camera forward and the point, radians. */
  readonly angle: number;
  /** Pick score (lower is better). */
  readonly score: number;
}

/** Where a locker stands and looks this tick. */
export interface Viewpoint {
  readonly self: EntityId;
  /** Feet position. */
  readonly feet: Vec3;
  readonly eye: Vec3;
  /** Unit camera forward. */
  readonly forward: Vec3;
  /** The look it came from. */
  readonly look: PlayerLook;
}

/** Which way to cycle: 1 right (clockwise seen from above), −1 left. */
export type CycleDirection = 1 | -1;

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const lengthOf = (a: Vec3): number => Math.sqrt(dot(a, a));

/** The view direction for a look yaw and pitch (yaw 0 pitch 0 looks along −z). */
export function viewForward(yaw: number, pitch: number): Vec3 {
  const flat = cos(pitch);
  return { x: -sin(yaw) * flat + 0, y: sin(pitch) + 0, z: -cos(yaw) * flat + 0 };
}

/** Angle between unit `a` and `b` (any length), radians in [0, π]. */
function angleBetween(a: Vec3, b: Vec3): number {
  const c = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  return atan2(lengthOf(c), dot(a, b));
}

/** The look yaw facing from `from` towards `to` horizontally (undefined when directly above/below). */
export function bearing(from: Vec3, to: Vec3): number | undefined {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx === 0 && dz === 0) return undefined;
  return atan2(-dx, -dz) + 0;
}

/** `angle` wrapped into [0, 2π). */
function positive(angle: number): number {
  return angle - TAU * Math.floor(angle / TAU);
}

/** The lock-on rules over one world: target validity, sight, picking and cycling. */
export class Targeting<T> {
  constructor(
    private readonly world: World<T>,
    private readonly params: LockOnParams,
    private readonly sight: Pick<LineOfSight, 'ray'>,
    private readonly locate: TargetLocator,
    private readonly defeated: DefeatedCheck,
  ) {}

  /** The locker's viewpoint, or undefined when it has no body or view. */
  viewpoint(self: EntityId): Viewpoint | undefined {
    const character = this.world.get(self, CharacterController);
    const look = this.world.get(self, PlayerLook);
    if (character === undefined || look === undefined) return undefined;
    const feet = character.position;
    return {
      self,
      feet,
      eye: { x: feet.x, y: feet.y + this.params.eyeHeight, z: feet.z },
      forward: viewForward(look.yaw, look.pitch),
      look,
    };
  }

  /** Whether `entity` can be locked on to at all: alive, targetable, located and not defeated. */
  lockable(entity: EntityId): Targetable | undefined {
    const { world } = this;
    if (!world.isAlive(entity)) return undefined;
    const targetable = world.get(entity, TargetableComponent);
    if (targetable === undefined || this.defeated(world, entity)) return undefined;
    return targetable;
  }

  /** The world position of `entity`'s lock point `index`, or undefined when it cannot be located. */
  lockPoint(entity: EntityId, targetable: Targetable, index = 0): Vec3 | undefined {
    const origin = this.locate(this.world, entity);
    const offset = targetable.points[index];
    if (origin === undefined || offset === undefined) return undefined;
    return { x: origin.x + offset.x, y: origin.y + offset.y, z: origin.z + offset.z };
  }

  /** The main lock point of `entity` if it can be locked on to and located, else undefined. */
  mainPoint(entity: EntityId): Vec3 | undefined {
    const targetable = this.lockable(entity);
    return targetable && this.lockPoint(entity, targetable);
  }

  /** The first of `entity`'s lock points in sight from `eye`, or undefined when none is. */
  pointInSight(eye: Vec3, entity: EntityId, targetable: Targetable): Vec3 | undefined {
    for (let i = 0; i < targetable.points.length; i++) {
      const point = this.lockPoint(entity, targetable, i);
      if (point === undefined) return undefined;
      if (this.sight.ray(eye, point) >= this.params.minVisibility) return point;
    }
    return undefined;
  }

  /**
   * Every lockable target in sight within `range` (and the pick cone, when `cone`), other than the
   * locker and `exclude`, in ascending entity id order.
   */
  sightings(view: Viewpoint, range: number, cone: boolean, exclude: EntityId | null): Sighting[] {
    const { params } = this;
    const found: Sighting[] = [];
    this.world.query(TargetableComponent).forEach((entity) => {
      if (entity === view.self || entity === exclude) return;
      const targetable = this.lockable(entity);
      if (targetable === undefined) return;
      const point = this.pointInSight(view.eye, entity, targetable);
      if (point === undefined) return;
      const to = sub(point, view.eye);
      const distance = lengthOf(to);
      if (distance > range) return;
      const angle = angleBetween(view.forward, to);
      if (cone && angle > params.cone) return;
      const score =
        angle / params.cone +
        (params.distanceWeight * distance) / params.selectRange -
        params.priorityWeight * targetable.priority;
      found.push({ entity, point, distance, angle, score });
    });
    return found;
  }

  /** The best target to pick (see the file header), or undefined when there is none. */
  pick(
    view: Viewpoint,
    range: number,
    cone: boolean,
    exclude: EntityId | null,
  ): EntityId | undefined {
    let best: Sighting | undefined;
    for (const sighting of this.sightings(view, range, cone, exclude)) {
      if (best === undefined || sighting.score < best.score) best = sighting;
    }
    return best?.entity;
  }

  /**
   * The next target from `current` in `direction` around the locker (see the file header), or
   * undefined when there is no other target to cycle to.
   */
  cycle(view: Viewpoint, current: EntityId, direction: CycleDirection): EntityId | undefined {
    const point = this.mainPoint(current);
    const from = point && bearing(view.feet, point);
    if (from === undefined) return undefined;
    let best: EntityId | undefined;
    let bestOffset = Infinity;
    for (const sighting of this.sightings(view, this.params.selectRange, true, current)) {
      const to = bearing(view.feet, sighting.point);
      if (to === undefined) continue;
      // Clockwise seen from above is decreasing yaw.
      const offset = positive(direction === 1 ? from - to : to - from) || TAU;
      if (offset < bestOffset) {
        best = sighting.entity;
        bestOffset = offset;
      }
    }
    return best;
  }
}

/** The flick direction this tick, if look input flicked sideways while armed. */
export function flickDirection(
  frame: Pick<ActionFrame, 'look' | 'lookStick'>,
  armed: boolean,
  flick: LockOnParams['flick'],
): CycleDirection | undefined {
  if (!armed) return undefined;
  const stick = frame.lookStick.x;
  if (Math.abs(stick) >= flick.stickThreshold) return stick > 0 ? 1 : -1;
  const mouse = frame.look.x;
  if (Math.abs(mouse) >= flick.mouseCounts) return mouse > 0 ? 1 : -1;
  return undefined;
}

/** Whether sideways look input is at rest this tick (re-arms flicks). */
export function lookAtRest(
  frame: Pick<ActionFrame, 'look' | 'lookStick'>,
  flick: LockOnParams['flick'],
): boolean {
  return (
    Math.abs(frame.lookStick.x) <= flick.stickRest && Math.abs(frame.look.x) <= flick.mouseRest
  );
}

/** `yaw` turned towards `goal` by at most `step` radians. */
export function turnTowards(yaw: number, goal: number, step: number): number {
  const gap = wrapYaw(goal - yaw);
  return wrapYaw(yaw + Math.max(-step, Math.min(step, gap)));
}

export interface LockOnOptions {
  readonly tuning: Frozen<LockOnTuning>;
  /** Line of sight from the locker's eye to lock points (LineOfSight over the physics world). */
  readonly sight: Pick<LineOfSight, 'ray'>;
  /** Where targets are; defaults to sceneTargetPosition. */
  readonly locate?: TargetLocator;
  /** Which targets are defeated; defaults to none (pass zeroHealth once targets have Health). */
  readonly defeated?: DefeatedCheck;
}

/** The lock after this tick's validity checks (step 1 of the file header). */
function keep<T>(targeting: Targeting<T>, view: Viewpoint, lock: LockOn, p: LockOnParams): LockOn {
  const { target } = lock;
  if (target === null) return lock;
  const targetable = targeting.lockable(target);
  if (targetable === undefined) {
    const next = targeting.pick(view, p.switchRange, false, target) ?? null;
    return { ...lock, target: next, unseenTicks: 0 };
  }
  const main = targeting.lockPoint(target, targetable);
  if (main === undefined || lengthOf(sub(main, view.eye)) > p.breakRange) {
    return { ...lock, target: null, unseenTicks: 0 };
  }
  if (targeting.pointInSight(view.eye, target, targetable) !== undefined) {
    return { ...lock, unseenTicks: 0 };
  }
  const unseenTicks = lock.unseenTicks + 1;
  return unseenTicks >= p.lostSightTicks
    ? { ...lock, target: null, unseenTicks: 0 }
    : { ...lock, unseenTicks };
}

/** The lock after this tick's input (step 2 of the file header). */
function steer<T>(
  targeting: Targeting<T>,
  view: Viewpoint,
  lock: LockOn,
  frame: ActionFrame | undefined,
  p: LockOnParams,
): LockOn {
  if (frame === undefined) return lock;
  const flick = flickDirection(frame, lock.armed, p.flick);
  const armed = flick === undefined && (lock.armed || lookAtRest(frame, p.flick));
  if (frame.lockOn.pressed) {
    const target =
      lock.target === null ? (targeting.pick(view, p.selectRange, true, null) ?? null) : null;
    return { target, unseenTicks: 0, armed };
  }
  const direction = frame.cycleTarget.pressed ? 1 : flick;
  if (lock.target === null || direction === undefined) return { ...lock, armed };
  const next = targeting.cycle(view, lock.target, direction);
  return next === undefined ? { ...lock, armed } : { target: next, unseenTicks: 0, armed };
}

/** The lock-on system (see the file header). Add it after the character controller. */
export function lockOnSystem<T>(options: LockOnOptions): System<T> {
  const locate = options.locate ?? sceneTargetPosition;
  const defeated = options.defeated ?? neverDefeated;
  let params: LockOnParams | undefined;
  return {
    name: 'lock-on',
    run({ world, inputs, clock }) {
      params ??= lockOnParams(options.tuning, clock);
      const p = params;
      const targeting = new Targeting(world, p, options.sight, locate, defeated);
      const frame = actionFrameOf(inputs);
      world.query(LockOnComponent).forEach((self, current) => {
        const view = targeting.viewpoint(self);
        if (view === undefined) return;
        const lock = steer(targeting, view, keep(targeting, view, current, p), frame, p);
        world.set(self, LockOnComponent, lock);
        const point = lock.target === null ? undefined : targeting.mainPoint(lock.target);
        if (point === undefined) {
          if (world.has(self, ViewAnchor)) world.remove(self, ViewAnchor);
          return;
        }
        const anchor = Object.freeze({ point });
        if (world.has(self, ViewAnchor)) world.set(self, ViewAnchor, anchor);
        else world.add(self, ViewAnchor, anchor);
        const { look } = view;
        const goal = bearing(view.feet, point) ?? look.yaw;
        world.set(self, PlayerLook, { ...look, yaw: turnTowards(look.yaw, goal, p.turnStep) });
      });
    },
  };
}

/**
 * Gives `player` lock-on: registers the lock-on components, adds the system (after whatever is
 * already there, so after the player's controller) and starts the player unlocked. Once per world,
 * between steps, after `installPlayer`.
 */
export function installLockOn<T>(world: World<T>, player: EntityId, options: LockOnOptions): void {
  world.register(TargetableComponent, LockOnComponent);
  world.addSystem(lockOnSystem(options));
  world.add(player, LockOnComponent, NO_LOCK);
}
