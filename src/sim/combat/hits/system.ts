// The hit-volume system (mw-e04.2): each tick, every open hitbox sweeps from its previous pose to this
// tick's pose and is tested against every living entity's hurtboxes. A target is struck at most once
// per hitbox window; the hurtbox that wins region priority names the region, multiplier and armor of
// the hit. Allies (by the ally rule) are skipped unless the hitbox has friendly fire, so a creature
// lured into a swing meant for the player can hit its packmate. A dead attacker's hitboxes close
// without hitting; a destroyed one's vanish with it.
//
// Order: attackers in ascending id, their hitboxes in the order opened, targets in ascending id —
// so hits (and the events after them) are identical on every client.
//
// Debug draw: `hitVolumeDebug` reads the shapes the system last tested straight from sim state, for
// the testbed overlay (the render draws these shapes; it never feeds poses back).

import type { RuntimeMove } from '@content/index';
import type { EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import { factionOf, relation } from '../../factions/runtime';
import { isFriendlyStance } from '../../factions/stance';
import type { FactionTable } from '../../factions/table';
import {
  at,
  boundPieces,
  pieceBounds,
  composePose,
  pieceOf,
  piecesOverlap,
  placeShape,
  sweepPieces,
  unionBounds,
  yawQuat,
  type BoundedPiece,
  type GeomBounds,
  type GeomShape,
  type Piece,
  type Pose,
} from '../../geom';
import { encodeCanonical, xxHash32 } from '../../snapshot';
import { PlacementComponent } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { HealthComponent } from '../damage/components';
import type { DamagePacketInput } from '../damage/packet';
import {
  HIT_REGIONS,
  HitboxComponent,
  HurtboxComponent,
  socketPose,
  type HitboxSpec,
  type HitRegion,
  type Hurtbox,
  type LiveHitbox,
  type SocketTrack,
} from './components';
import { HitboxHit, type HitboxHitInfo } from './events';

/** Whether `target` is `attacker`'s ally (skipped by hitboxes without friendly fire). */
export type AllyRule = (world: World<never>, attacker: EntityId, target: EntityId) => boolean;

/** Nobody is an ally: every hitbox strikes everyone (worlds without factions). */
export const noAllies: AllyRule = () => false;

/** Allies are members of the same faction (needs the faction components registered). */
export const sameFaction: AllyRule = (world, attacker, target) => {
  const faction = factionOf(world, attacker);
  return faction !== undefined && faction === factionOf(world, target);
};

/** Allies are those the attacker regards as ally or friendly under `table` (live stances). */
export function alliesByStance(table: FactionTable): AllyRule {
  return (world, attacker, target) => isFriendlyStance(relation(world, table, attacker, target));
}

/** Options of the hit-volume system. */
export interface HitVolumeOptions {
  /**
   * Who counts as an ally (skipped unless the hitbox has friendly fire): `sameFaction`,
   * `alliesByStance(table)`, or `noAllies` in a world without factions.
   */
  readonly isAlly: AllyRule;
}

/** Whether `entity` can act or be struck: alive, and not at 0 health when it has health. */
function living(world: World<never>, entity: EntityId): boolean {
  const health = world.get(entity, HealthComponent);
  return health === undefined || health.current > 0;
}

/** `entity`'s frame: its placement turned to face `facing` (unit horizontal); undefined unplaced. */
export function entityFrame(world: World<never>, entity: EntityId, facing: Vec3): Pose | undefined {
  const at = world.get(entity, PlacementComponent);
  if (at === undefined) return undefined;
  return { position: { x: at.x, y: at.y, z: at.z }, rotation: yawQuat(facing) };
}

/** `hitbox`'s world shape at track key `key` (clamped to the track), in the attacker `frame`. */
export function hitboxShapeAt(frame: Pose, hitbox: LiveHitbox, key: number): GeomShape {
  const { keys } = hitbox.track;
  const socket = at(keys, Math.min(key, keys.length - 1));
  return placeShape(hitbox.shape, composePose(frame, socket));
}

/** A hurtbox placed in the world. */
export interface PlacedHurtbox {
  readonly entity: EntityId;
  readonly hurtbox: Hurtbox;
  readonly shape: GeomShape;
}

/** `entity`'s hurtboxes in world space, in their authored order; empty without placement/hurtboxes. */
export function hurtboxShapes(world: World<never>, entity: EntityId): readonly PlacedHurtbox[] {
  const set = world.get(entity, HurtboxComponent);
  if (set === undefined) return [];
  const frame = entityFrame(world, entity, set.facing);
  if (frame === undefined) return [];
  return set.boxes.map((hurtbox) => ({
    entity,
    hurtbox,
    shape: placeShape(hurtbox.shape, composePose(frame, socketPose(set, hurtbox.socket))),
  }));
}

interface Target {
  readonly entity: EntityId;
  readonly bounds: GeomBounds;
  readonly boxes: readonly {
    readonly hurtbox: Hurtbox;
    readonly piece: Piece;
    readonly bounds: GeomBounds;
  }[];
}

function targetsOf(world: World<never>): readonly Target[] {
  const out: Target[] = [];
  for (const entity of world.query(HurtboxComponent, PlacementComponent).ids()) {
    if (!living(world, entity)) continue;
    const boxes = hurtboxShapes(world, entity).map(({ hurtbox, shape }) => {
      const piece = pieceOf(shape);
      return { hurtbox, piece, bounds: pieceBounds(piece) };
    });
    const [first, ...rest] = boxes;
    if (first === undefined) continue;
    const bounds = rest.reduce((acc, box) => unionBounds(acc, box.bounds), first.bounds);
    out.push({ entity, bounds, boxes });
  }
  return out;
}

const priority = (region: HitRegion): number => HIT_REGIONS.indexOf(region);

/**
 * `boundsOverlap`, module-local: the broad phase runs for every hitbox × target pair, and a call
 * across a module boundary costs more than these six comparisons under Vitest's module runner.
 */
const meet = (a: GeomBounds, b: GeomBounds): boolean =>
  a.min.x <= b.max.x &&
  b.min.x <= a.max.x &&
  a.min.y <= b.max.y &&
  b.min.y <= a.max.y &&
  a.min.z <= b.max.z &&
  b.min.z <= a.max.z;

/** The struck hurtbox that wins region priority, or undefined when the sweep misses `target`. */
function resolve(
  pieces: readonly BoundedPiece[],
  bounds: GeomBounds,
  target: Target,
): Hurtbox | undefined {
  let best: Hurtbox | undefined;
  for (const { hurtbox, piece, bounds: box } of target.boxes) {
    if (best !== undefined) {
      const order = priority(hurtbox.region) - priority(best.region);
      if (order > 0 || (order === 0 && hurtbox.multiplier <= best.multiplier)) continue;
    }
    if (!meet(bounds, box)) continue;
    const hit = pieces.some((p) => meet(p.bounds, box) && piecesOverlap(p.piece, piece));
    if (hit) best = hurtbox;
  }
  return best;
}

function sweep(
  world: World<never>,
  isAlly: AllyRule,
  attacker: EntityId,
  frame: Pose,
  hitbox: LiveHitbox,
  targets: readonly Target[],
): LiveHitbox {
  const activeTick = hitbox.elapsed + 1;
  const from = hitbox.pose ?? hitboxShapeAt(frame, hitbox, 0);
  const to = hitboxShapeAt(frame, hitbox, activeTick);
  const { pieces, bounds } = boundPieces(sweepPieces(from, to));
  const struck: EntityId[] = [];
  for (const target of targets) {
    const { entity } = target;
    if (!meet(bounds, target.bounds)) continue;
    if (entity === attacker || hitbox.hit.includes(entity)) continue;
    if (!hitbox.friendlyFire && isAlly(world, attacker, entity)) continue;
    const hurtbox = resolve(pieces, bounds, target);
    if (hurtbox === undefined) continue;
    struck.push(entity);
    const hit: HitboxHitInfo = {
      tick: world.tick,
      attacker,
      hitbox: hitbox.id,
      activeTick,
      target: entity,
      hurtbox: hurtbox.id,
      region: hurtbox.region,
      multiplier: hurtbox.multiplier,
      armored: hurtbox.armored,
      direction: hitbox.aim,
    };
    world.events.emit(HitboxHit, hit);
  }
  const hit =
    struck.length === 0
      ? hitbox.hit
      : Object.freeze([...hitbox.hit, ...struck].sort((a, b) => a - b));
  return Object.freeze({ ...hitbox, elapsed: activeTick, sweptFrom: from, pose: to, hit });
}

/**
 * The hit-volume system: sweeps every open hitbox one active tick and emits HitboxHit per target
 * struck. Spent hitboxes (their window swept) are dropped on the next run, so debug draw still shows
 * the last sweep on its own tick. Register HIT_VOLUME_COMPONENTS, PlacementComponent and the damage
 * components (health: the dead neither strike nor are struck) first.
 */
export function hitVolumeSystem<TInput>(options: HitVolumeOptions): System<TInput> {
  const { isAlly } = options;
  return {
    name: 'hit-volumes',
    run: ({ world }) => {
      const w: World<never> = world;
      const attackers = w.query(HitboxComponent).ids();
      if (attackers.length === 0) return;
      // Hurtboxes are placed once per tick, and only when some hitbox is open.
      let targets: readonly Target[] | undefined;
      for (const attacker of [...attackers]) {
        const set = w.get(attacker, HitboxComponent);
        if (set === undefined || set.live.length === 0) continue;
        const open = set.live.filter((h) => h.elapsed < h.activeTicks);
        let live: readonly LiveHitbox[] = [];
        if (living(w, attacker)) {
          live = open.map((hitbox) => {
            const frame = entityFrame(w, attacker, hitbox.aim);
            if (frame === undefined) return hitbox;
            targets ??= targetsOf(w);
            return sweep(w, isAlly, attacker, frame, hitbox, targets);
          });
        }
        w.set(attacker, HitboxComponent, Object.freeze({ live: Object.freeze(live) }));
      }
    },
  };
}

/** A hitbox's latest sweep, for debug draw. */
export interface HitboxDebug {
  readonly attacker: EntityId;
  readonly id: string;
  /** Active tick (1-based) of the sweep. */
  readonly activeTick: number;
  readonly from: GeomShape;
  readonly to: GeomShape;
}

/** A hurtbox as the system tests it, for debug draw. */
export interface HurtboxDebug {
  readonly entity: EntityId;
  readonly id: string;
  readonly region: HitRegion;
  readonly armored: boolean;
  readonly shape: GeomShape;
}

/** Everything the hit-volume system tests this tick, in its test order. */
export interface HitVolumeDebug {
  readonly tick: number;
  readonly hitboxes: readonly HitboxDebug[];
  readonly hurtboxes: readonly HurtboxDebug[];
}

/**
 * The shapes to debug-draw after a step: each hitbox's latest sweep (from and to) and every living
 * entity's hurtboxes. Pure: reads sim state only.
 */
export function hitVolumeDebug(world: World<never>): HitVolumeDebug {
  const hitboxes: HitboxDebug[] = [];
  world.query(HitboxComponent).forEach((attacker, set) => {
    for (const h of set.live) {
      if (h.pose === null || h.sweptFrom === null) continue;
      hitboxes.push({ attacker, id: h.id, activeTick: h.elapsed, from: h.sweptFrom, to: h.pose });
    }
  });
  const hurtboxes: HurtboxDebug[] = [];
  for (const entity of world.query(HurtboxComponent, PlacementComponent).ids()) {
    if (!living(world, entity)) continue;
    for (const { hurtbox, shape } of hurtboxShapes(world, entity)) {
      const { id, region, armored } = hurtbox;
      hurtboxes.push({ entity, id, region, armored, shape });
    }
  }
  return { tick: world.tick, hitboxes, hurtboxes };
}

/**
 * A 32-bit hash of shapes (canonical encoding, xxHash32), as hex: the overlay hashes what it drew,
 * the sim what it tested, and the two must match every frame.
 */
export function hashShapes(shapes: readonly GeomShape[]): string {
  return xxHash32(encodeCanonical(shapes)).toString(16).padStart(8, '0');
}

/** Every shape of a debug frame in draw order: hitbox sweeps (from, to), then hurtboxes. */
export function debugShapes(debug: HitVolumeDebug): readonly GeomShape[] {
  return [...debug.hitboxes.flatMap((h) => [h.from, h.to]), ...debug.hurtboxes.map((h) => h.shape)];
}

/** The damage a move's template deals, with who, what and where the hit filled in. */
export type HitTemplate = Omit<
  DamagePacketInput,
  'instigator' | 'source' | 'direction' | 'region' | 'regionMultiplier'
>;

/**
 * The damage packet for `hit`: `template` from the attacker (the source defaults to the attacker,
 * e.g. pass the sword entity), in the hit's direction, with its region and multiplier.
 */
export function hitPacket(
  hit: HitboxHitInfo,
  template: HitTemplate,
  source: EntityId = hit.attacker,
): DamagePacketInput {
  return {
    ...template,
    instigator: hit.attacker,
    source,
    direction: hit.direction,
    region: hit.region,
    regionMultiplier: hit.multiplier,
  };
}

/** Socket tracks by id: the compiled `socket-track` content (`compileSocketTracks`, mw-e04.26). */
export type SocketTrackLookup = ReadonlyMap<string, SocketTrack>;

/**
 * The socket track `move`'s hitbox names, from `tracks`. Throws when the move has no hitbox or the
 * track is missing (content loading already rejects a move naming a missing track).
 */
export function moveTrack(move: RuntimeMove, tracks: SocketTrackLookup): SocketTrack {
  const { hitbox } = move;
  if (hitbox === null) throw new Error(`move "${move.id}" has no hitbox`);
  const track = tracks.get(hitbox.track);
  if (track === undefined) {
    throw new Error(`move "${move.id}" names socket track "${hitbox.track}", which is not loaded`);
  }
  return track;
}

/**
 * The hitbox spec of `move` (its hit volume, active ticks and friendly fire) driven by `track`,
 * facing `aim`; its id defaults to the move id. Throws when the move has no hitbox.
 */
export function hitboxFromMove(
  move: RuntimeMove,
  track: SocketTrack,
  aim: Vec3,
  id: string = move.id,
): HitboxSpec {
  const { hitbox } = move;
  if (hitbox === null) throw new Error(`move "${move.id}" has no hitbox`);
  return {
    id,
    shape: hitbox.shape,
    track,
    activeTicks: move.active,
    aim,
    friendlyFire: hitbox.friendlyFire ?? false,
  };
}
