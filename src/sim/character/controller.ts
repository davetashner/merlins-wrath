// The player's kinematic character controller (mw-e02.2). One pure function, `stepCharacter`, turns
// the character's state plus this tick's movement actions and camera yaw into the next state,
// resolving collisions through a CollisionWorld. Replays, AI and tests share exactly the rules the
// player feels. Every number comes from content (`controller` tuning); only + − × ÷, sqrt and simMath
// are used, on the sim's fixed step, so the same inputs give the same bits everywhere.
//
// Per tick:
//  1. Stance: crouch while crouch is held; on release stand up only if the standing capsule fits.
//  2. Horizontal velocity moves towards the input's target at a constant rate: run speed per
//     accelTime speeding up, per decelTime slowing down; in the air only airControl of the
//     acceleration applies and, with no input, momentum is kept.
//  3. Jump: a press is buffered for jumpBufferMs; it fires when grounded, or up to coyoteMs after
//     walking off a ledge (not after a jump). Launch speed √(2·g·apex) reaches jumpApex exactly.
//  4. Gravity (exact for constant acceleration, capped at maxFallSpeed) while airborne.
//  5. Moving-platform carry: standing on a moving collider moves the character with it first.
//  6. Collide and slide. Grounded movement follows the ground plane keeping its horizontal speed;
//     walls and steep slopes (beyond slopeLimit) block horizontally, and grounded characters try to
//     step up them by up to stepHeight. Steep slopes are slid down, never climbed.
//  7. Ground check: the capsule is swept down from stepHeight above its feet (lifting it out of
//     ground that rose into it) to just below them, or to stepHeight below while it stays on the
//     ground (snapping it down stairs and ramps); walkable ground there grounds it, SKIN above.
//
// Rounded edges: a CollisionWorld may round box edges (Rapier does; the fake's are square, and the
// contract pins only face contacts). A capsule sweeping down onto a rounded edge meets it with a
// normal between the two faces, often steeper than the slope limit. So a steep, upward-facing
// contact still supports the capsule when a short ray down at the rim of its footprint, on the
// contact's side, finds a walkable face there, as a square edge would (Mover.support). The capsule
// rests where it met the edge, so it rolls smoothly up onto steps and off ledges. The ray finds the
// face itself, so steep slopes stay steep, and a step onto an edge must top out within stepHeight
// of the feet, so walls a little taller than a step stay walls.

import type { ControllerTuning, Frozen } from '@content/index';
import type { ReadonlyClock } from '../clock';
import { cos, sin } from '../math';
import type { Vec3 } from '../stimulus/shapes';
import type { BodyId, Capsule, CollisionHit, CollisionWorld } from './collision-world';
import { radians } from './greybox';
import type { TraversalHook, TraversalMode } from './traversal';
import { add, clip, dot, DOWN, flat, length, normalize, scale, sub, UP, vec, ZERO } from './vec';

/** Gap kept between the capsule and everything it touches, metres. */
export const SKIN = 0.01;
/** Moves shorter than this are dropped, metres. */
const MIN_MOVE = 1e-6;
/** Collide-and-slide passes per move (each pass handles one contact). */
const MAX_SLIDES = 4;
/** Glancing contacts closer to parallel than this (cosine) back off as if at this angle. */
const GLANCE = 0.1;
/** Normal-y slack when comparing against the slope limit. */
const SLOPE_EPS = 1e-9;

/** A digital action's state this tick (the ActionFrame button shape, mw-e02.1). */
export interface ButtonState {
  /** Went down this tick. */
  readonly pressed: boolean;
  /** Is down this tick. */
  readonly held: boolean;
}

/**
 * The movement part of an ActionFrame (mw-e02.1): `move` is the analog move vector, x to the right
 * and y forward, length at most 1 (longer vectors are scaled down); partial deflection walks.
 */
export interface MovementActions {
  readonly move: { readonly x: number; readonly y: number };
  readonly jump: ButtonState;
  readonly sprint: ButtonState;
  readonly crouch: ButtonState;
}

/**
 * What drives the controller for one tick: the movement actions plus the camera yaw, radians about
 * +y. Yaw 0 looks along −z; positive yaw turns left (counter-clockwise seen from above).
 */
export interface CharacterInput {
  readonly actions: MovementActions;
  readonly cameraYaw: number;
}

const UP_BUTTON: ButtonState = { pressed: false, held: false };

/** No input: stick centred, every button up. */
export const IDLE_INPUT: CharacterInput = {
  actions: { move: { x: 0, y: 0 }, jump: UP_BUTTON, sprint: UP_BUTTON, crouch: UP_BUTTON },
  cameraYaw: 0,
};

/** The controller's per-character state: plain data, snapshotted and hashed every tick. */
export interface CharacterState {
  /** Feet position (the bottom of the capsule), metres. */
  readonly position: Vec3;
  /** Velocity, m/s. */
  readonly velocity: Vec3;
  /** Standing on walkable ground. */
  readonly grounded: boolean;
  /** Unit normal of the ground stood on (up when airborne). */
  readonly groundNormal: Vec3;
  /** The collider stood on, or null when airborne. */
  readonly groundBody: BodyId | null;
  readonly crouched: boolean;
  readonly sprinting: boolean;
  /** Ticks since the character was last grounded (0 while grounded). */
  readonly airTicks: number;
  /** Left the ground by jumping (so no coyote jump until it lands). */
  readonly jumped: boolean;
  /** Ticks since an unconsumed jump press, or −1 when none is buffered. */
  readonly jumpAge: number;
  /** The traversal mode in control, or null during ordinary locomotion. */
  readonly traversal: TraversalMode | null;
}

/** The movement state other systems read (animation, stealth, noise). */
export interface MovementState {
  readonly grounded: boolean;
  readonly airborne: boolean;
  readonly crouched: boolean;
  readonly sprinting: boolean;
}

/** Values derived once from tuning and the tick rate. */
export interface ControllerParams {
  /** Fixed step, seconds. */
  readonly dt: number;
  /** Launch speed that reaches `jumpApex`, m/s. */
  readonly jumpSpeed: number;
  /** Ground normals with y at least this are walkable (cos of the slope limit). */
  readonly minGroundY: number;
  readonly coyoteTicks: number;
  readonly jumpBufferTicks: number;
  /** Ground acceleration and deceleration, m/s². */
  readonly accel: number;
  readonly decel: number;
}

/** Derives the per-tick constants for `tuning` at the clock's tick rate. */
export function controllerParams(
  tuning: Frozen<ControllerTuning>,
  clock: Pick<ReadonlyClock, 'hz' | 'ticksFor'>,
): ControllerParams {
  return {
    dt: 1 / clock.hz,
    jumpSpeed: Math.sqrt(2 * tuning.gravity * tuning.jumpApex),
    minGroundY: cos(radians(tuning.slopeLimit)),
    coyoteTicks: clock.ticksFor(tuning.coyoteMs),
    jumpBufferTicks: clock.ticksFor(tuning.jumpBufferMs),
    accel: tuning.speeds.run / tuning.accelTime,
    decel: tuning.speeds.run / tuning.decelTime,
  };
}

/** A character standing still with its feet at `feet`; the first tick finds the ground. */
export function initialCharacterState(feet: Vec3): CharacterState {
  return {
    position: feet,
    velocity: ZERO,
    grounded: false,
    groundNormal: UP,
    groundBody: null,
    crouched: false,
    sprinting: false,
    airTicks: 0,
    jumped: false,
    jumpAge: -1,
    traversal: null,
  };
}

/** Grounded, airborne, crouched and sprinting flags. */
export function movementState(state: CharacterState): MovementState {
  return {
    grounded: state.grounded,
    airborne: !state.grounded,
    crouched: state.crouched,
    sprinting: state.sprinting,
  };
}

/** The character's current collision capsule (crouching lowers its top). */
export function capsuleOf(state: CharacterState, tuning: Frozen<ControllerTuning>): Capsule {
  const { radius, height, crouchHeight } = tuning.capsule;
  return { radius, height: state.crouched ? crouchHeight : height };
}

/** Everything a tick of the controller reads besides the character and its input. */
export interface ControllerContext {
  readonly world: CollisionWorld;
  readonly tuning: Frozen<ControllerTuning>;
  readonly params: ControllerParams;
  /** Traversal modes in priority order (none until climbing, mantling and swimming exist). */
  readonly hooks?: readonly TraversalHook[];
}

/** Simulates one fixed tick of the character. Pure: the inputs are not modified. */
export function stepCharacter(
  state: CharacterState,
  input: CharacterInput,
  context: ControllerContext,
): CharacterState {
  const { world, tuning, params, hooks = [] } = context;
  const ctx = { state, input, world, tuning, params };
  const hook =
    state.traversal === null
      ? hooks.find((h) => h.shouldEnter(ctx))
      : hooks.find((h) => h.mode === state.traversal);
  if (hook !== undefined) return hook.step(ctx);
  return locomotion({ ...state, traversal: null }, input, world, tuning, params);
}

/** `from` moved towards `to` by at most `maxDelta`. */
function moveTowards(from: Vec3, to: Vec3, maxDelta: number): Vec3 {
  const gap = sub(to, from);
  const distance = length(gap);
  return distance <= maxDelta ? to : add(from, scale(gap, maxDelta / distance));
}

/** Ordinary walking, running, jumping and falling. */
function locomotion(
  state: CharacterState,
  input: CharacterInput,
  world: CollisionWorld,
  tuning: Frozen<ControllerTuning>,
  params: ControllerParams,
): CharacterState {
  const { actions } = input;
  const { dt } = params;
  const mover = new Mover(world, tuning, params);

  // 1. Stance.
  const standing: Capsule = { radius: tuning.capsule.radius, height: tuning.capsule.height };
  const crouched =
    actions.crouch.held || (state.crouched && !mover.roomToStand(state.position, standing));
  const capsule = capsuleOf({ ...state, crouched }, tuning);

  // 2. Horizontal velocity.
  const raw = actions.move;
  const deflection = Math.min(1, Math.sqrt(raw.x * raw.x + raw.y * raw.y));
  const moving = deflection > 0;
  const sprinting = actions.sprint.held && !crouched && moving;
  const top = crouched
    ? tuning.speeds.crouch
    : sprinting
      ? tuning.speeds.sprint
      : tuning.speeds.run;
  const yawSin = sin(input.cameraYaw);
  const yawCos = cos(input.cameraYaw);
  const right = vec(yawCos, 0, -yawSin);
  const forward = vec(-yawSin, 0, -yawCos);
  const wish = normalize(add(scale(right, raw.x), scale(forward, raw.y)));
  const target = scale(wish, top * deflection);
  const current = flat(state.velocity);
  let horizontal = current;
  if (state.grounded) {
    const rate = length(target) >= length(current) ? params.accel : params.decel;
    horizontal = moveTowards(current, target, rate * dt);
  } else if (moving) {
    horizontal = moveTowards(current, target, params.accel * tuning.airControl * dt);
  }

  // 3. Jump (buffered press; grounded or within coyote time of walking off).
  const jumpAge = actions.jump.pressed
    ? 0
    : state.jumpAge >= 0 && state.jumpAge < params.jumpBufferTicks
      ? state.jumpAge + 1
      : -1;
  const canJump = state.grounded || (!state.jumped && state.airTicks < params.coyoteTicks);
  const jumping = jumpAge >= 0 && canJump;
  const onGround = state.grounded && !jumping;

  // 4. Vertical velocity and this tick's rise or fall.
  let vy = 0;
  let dy = 0;
  if (!onGround) {
    const vy0 = jumping ? params.jumpSpeed : state.velocity.y;
    vy = Math.max(vy0 - tuning.gravity * dt, -tuning.maxFallSpeed);
    dy = ((vy0 + vy) / 2) * dt;
  }

  // 5. Moving-platform carry.
  let position = state.position;
  if (state.grounded && state.groundBody !== null) {
    const carry = scale(world.bodyVelocity(state.groundBody), dt);
    position = mover.move(position, carry, capsule, false).position;
  }

  // 6. Collide and slide (grounded movement follows the ground).
  let displacement = vec(horizontal.x * dt, dy, horizontal.z * dt);
  if (onGround) displacement = alongGround(displacement, state.groundNormal);
  const moved = mover.move(position, displacement, capsule, onGround);
  position = moved.position;
  let velocity = vec(horizontal.x, vy, horizontal.z);
  for (const normal of moved.blockers) velocity = mover.slide(velocity, normal);

  // 7. Ground check and snap.
  let ground: { normal: Vec3; body: BodyId } | undefined;
  if (velocity.y <= 0) {
    // Probing from stepHeight up also lifts the feet back out of ground that rose into them (a lift
    // moving up before the character lands on it).
    const lift = tuning.stepHeight;
    const reach = lift + (onGround ? tuning.stepHeight : 0) + 2 * SKIN;
    const from = add(position, vec(0, lift, 0));
    const hit = world.sweepCapsule(capsule, from, DOWN, reach);
    const support = hit === undefined ? undefined : mover.support(hit, from, capsule);
    if (hit !== undefined && support !== undefined) {
      position = add(from, scale(DOWN, hit.distance - SKIN));
      ground = { normal: support.normal, body: hit.body };
      velocity = vec(velocity.x, 0, velocity.z);
    }
  }
  const grounded = ground !== undefined;
  return {
    position,
    velocity,
    grounded,
    groundNormal: ground?.normal ?? UP,
    groundBody: ground?.body ?? null,
    crouched,
    sprinting,
    airTicks: grounded ? 0 : state.airTicks + 1,
    jumped: !grounded && (state.jumped || jumping),
    jumpAge: jumping ? -1 : jumpAge,
    traversal: null,
  };
}

/**
 * How far to travel along `direction` (at most `distance`) towards `hit`, stopping SKIN short of
 * the surface measured along its normal, so glancing hits keep the same gap as head-on ones.
 */
function travelTo(hit: CollisionHit, direction: Vec3, distance: number): number {
  const backoff = SKIN / Math.max(-dot(direction, hit.normal), GLANCE);
  return Math.min(distance, Math.max(0, hit.distance - backoff));
}

/** `d` tilted onto the ground plane `n`, keeping its horizontal part (full speed up and down slopes). */
function alongGround(d: Vec3, n: Vec3): Vec3 {
  return vec(d.x, -(n.x * d.x + n.z * d.z) / n.y, d.z);
}

/** Collision resolution for one tick: collide and slide, step up, stand-up checks. */
class Mover {
  constructor(
    private readonly world: CollisionWorld,
    private readonly tuning: Frozen<ControllerTuning>,
    private readonly params: ControllerParams,
  ) {}

  /** Ground with this normal can be stood on. */
  walkable(n: Vec3): boolean {
    return n.y + SLOPE_EPS >= this.params.minGroundY;
  }

  /**
   * Whether a capsule swept down from `from` can stand where it met `hit`: the ground normal, or
   * undefined when it cannot. A walkable contact is the ground itself (`top` undefined). A steeper
   * contact facing upwards may be a rounded edge: a ray down at the rim of the capsule's footprint
   * on the contact's side, from the height of its lower sphere's centre to just below its feet,
   * finds the face beside the edge. When that face is walkable the capsule stands on the edge, with
   * that face's normal as its ground and `top` its height. A steep face stays steep: the ray meets
   * that same face.
   */
  support(
    hit: CollisionHit,
    from: Vec3,
    capsule: Capsule,
  ): { normal: Vec3; top: number | undefined } | undefined {
    const n = hit.normal;
    if (this.walkable(n)) return { normal: n, top: undefined };
    if (n.y <= 0) return undefined;
    const { radius } = capsule;
    const feet = add(from, scale(DOWN, hit.distance));
    const rim = add(feet, scale(normalize(flat(n)), SKIN - radius));
    const face = this.world.raycast(add(rim, vec(0, radius, 0)), DOWN, radius + SKIN);
    if (face === undefined || !this.walkable(face.normal)) return undefined;
    return { normal: face.normal, top: face.point.y };
  }

  /** Whether the standing capsule fits at `feet` (lifted and slimmed by the skin, so contact is fine). */
  roomToStand(feet: Vec3, standing: Capsule): boolean {
    const probe = { radius: standing.radius - SKIN, height: standing.height - SKIN };
    return !this.world.overlapCapsule(probe, add(feet, vec(0, SKIN, 0)));
  }

  /**
   * `a` with its motion into a surface of normal `n` removed. Steep slopes act as walls for
   * horizontal motion (so they are never climbed) while vertical motion slides along them.
   */
  slide(a: Vec3, n: Vec3): Vec3 {
    if (n.y <= 0 || this.walkable(n)) return clip(a, n);
    const wall = normalize(flat(n));
    return add(clip(flat(a), wall), clip(vec(0, a.y, 0), n));
  }

  /**
   * Moves the capsule by `displacement`, sliding along what it hits. `grounded` movement follows
   * walkable slopes and tries to step up walls. Returns where it ended and the normals that blocked
   * it (for removing velocity into them).
   */
  move(
    from: Vec3,
    displacement: Vec3,
    capsule: Capsule,
    grounded: boolean,
  ): { position: Vec3; blockers: Vec3[] } {
    let position = from;
    let remaining = displacement;
    const blockers: Vec3[] = [];
    for (let pass = 0; pass < MAX_SLIDES; pass++) {
      const distance = length(remaining);
      if (distance < MIN_MOVE) break;
      const direction = scale(remaining, 1 / distance);
      const hit = this.world.sweepCapsule(capsule, position, direction, distance + SKIN);
      if (hit === undefined) {
        position = add(position, remaining);
        break;
      }
      const n = hit.normal;
      const travel = travelTo(hit, direction, distance);
      position = add(position, scale(direction, travel));
      remaining = scale(direction, distance - travel);
      if (grounded && this.walkable(n)) {
        remaining = alongGround(remaining, n);
        continue;
      }
      if (grounded && n.y >= 0) {
        const stepped = this.stepUp(position, flat(remaining), capsule);
        if (stepped !== undefined) {
          position = stepped;
          break;
        }
      }
      blockers.push(n);
      remaining = this.slide(remaining, n);
    }
    return { position, blockers };
  }

  /**
   * Tries to climb a step: up by at most stepHeight, forward by `ahead`, then down onto walkable
   * ground. Returns the new feet position, or undefined when there is no step to stand on. Landing
   * on a rounded edge (see `support`) counts only when the face beyond it is at most stepHeight
   * above the feet: the raised capsule can reach over the edge of a wall a little taller than that.
   */
  private stepUp(from: Vec3, ahead: Vec3, capsule: Capsule): Vec3 | undefined {
    const distance = length(ahead);
    if (distance < MIN_MOVE) return undefined;
    const { stepHeight } = this.tuning;
    const above = this.world.sweepCapsule(capsule, from, UP, stepHeight + SKIN);
    const rise = above === undefined ? stepHeight : Math.max(0, above.distance - SKIN);
    const raised = add(from, vec(0, rise, 0));
    const direction = scale(ahead, 1 / distance);
    const blocked = this.world.sweepCapsule(capsule, raised, direction, distance + SKIN);
    const advance = blocked === undefined ? distance : travelTo(blocked, direction, distance);
    if (advance < MIN_MOVE) return undefined;
    const forward = add(raised, scale(direction, advance));
    const landing = this.world.sweepCapsule(capsule, forward, DOWN, rise + SKIN);
    if (landing === undefined) return undefined;
    const support = this.support(landing, forward, capsule);
    if (support === undefined) return undefined;
    if (support.top !== undefined && support.top - from.y > stepHeight) return undefined;
    return add(forward, scale(DOWN, Math.max(0, landing.distance - SKIN)));
  }
}
