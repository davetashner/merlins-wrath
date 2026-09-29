// Hit-reaction state (mw-e04.7): how an entity reacts to hits (its profile: impulse thresholds, mass
// and any replaced tiers, from its CreatureDef) and what it is doing about the last one (the reaction
// playing, its side, the wake-up invulnerability after a knockdown, and how much poise the current
// move's hyperarmor has soaked). Plain frozen data, replaced never mutated, so snapshots, saves and
// replays carry an entity mid-stagger or mid-knockdown. An entity keeps its component while calm so
// reacting is a value change, never a structural one.

import type { CreatureDef, HitDirection, HitReactionKind, HitReactionTier } from '@content/index';
import { defineComponent, type EntityId } from '../../core/component';
import type { World } from '../../core/world';

export type { HitDirection, HitReactionKind, HitReactionTier };

/** Canonical order of reactions, weakest first; a Record, so drift from content fails to compile. */
const KIND_RANK: Readonly<Record<HitReactionKind, number>> = {
  none: 0,
  flinch: 1,
  stagger: 2,
  knockback: 3,
  knockdown: 4,
};

/** Every reaction, weakest first (content's HIT_REACTION_KINDS). */
export const REACTION_KINDS = Object.freeze(
  (Object.keys(KIND_RANK) as HitReactionKind[]).sort((a, b) => KIND_RANK[a] - KIND_RANK[b]),
);

/** How strong `kind` is: a stronger reaction is never cut short by a weaker one. */
export const reactionRank = (kind: HitReactionKind): number => KIND_RANK[kind];

/** Every hit direction (content's HIT_DIRECTIONS); a Record, so drift fails to compile. */
const DIRECTION_ORDER: Readonly<Record<HitDirection, number>> = {
  front: 0,
  back: 1,
  left: 2,
  right: 3,
};

/** Every hit direction quadrant. */
export const REACTION_DIRECTIONS = Object.freeze(
  (Object.keys(DIRECTION_ORDER) as HitDirection[]).sort(
    (a, b) => DIRECTION_ORDER[a] - DIRECTION_ORDER[b],
  ),
);

/**
 * How long each reaction holds the entity, in ticks (the bead's numbers): a flinch 12, a stagger 45,
 * a knockback 60, a knockdown 90 on the ground. The entity may start no move for that long.
 */
export const REACTION_TICKS: Readonly<Record<Exclude<HitReactionKind, 'none'>, number>> =
  Object.freeze({ flinch: 12, stagger: 45, knockback: 60, knockdown: 90 });

/** Invulnerable ticks after waking from a knockdown. */
export const WAKE_IFRAME_TICKS = 20;

/** How an entity reacts to hits (a creature's `reactions` section plus its mass). */
export interface ReactionProfile {
  /** Impulse, N·s, at or above which a hit knocks it back. */
  readonly knockbackImpulse: number;
  /** Impulse, N·s, at or above which a hit knocks it down. */
  readonly knockdownImpulse: number;
  /** Upward speed, m/s, a knockback or knockdown adds so the push leaves the ground. */
  readonly launchSpeed: number;
  /** kg: a character's push is its impulse over this. */
  readonly mass: number;
  /** Tiers it never takes, each replaced by another (a troll: knockdown → knockback). */
  readonly replace: Readonly<Partial<Record<HitReactionTier, HitReactionKind>>>;
}

/**
 * The profile of an entity without a CreatureDef (the player): content's hit-reaction defaults
 * (HIT_REACTION_DEFAULTS, pinned equal by a test) and an 80 kg body (a placeholder until the
 * player's weight classes, e04-armor-weight, set it).
 */
export const DEFAULT_REACTION_PROFILE: ReactionProfile = Object.freeze({
  knockbackImpulse: 300,
  knockdownImpulse: 900,
  launchSpeed: 2,
  mass: 80,
  replace: Object.freeze({}),
});

/** A reaction in progress. */
export interface ActiveReaction {
  readonly kind: Exclude<HitReactionKind, 'none'>;
  readonly direction: HitDirection;
  /** World tick of the hit. */
  readonly startedAt: number;
  /** First world tick it is over (startedAt + 1 + its length: the timeline lock runs out then). */
  readonly endsAt: number;
  /** It interrupted the entity's move (a flinch during active or recovery ticks does not). */
  readonly interrupted: boolean;
}

/** Hyperarmor soaked so far during one run of a move. */
export interface ArmorSoak {
  /** The run's start tick (RunningAction.startedAt): a new run starts a fresh cap. */
  readonly startedAt: number;
  /** Poise absorbed so far, points. */
  readonly absorbed: number;
  /** The cap was exceeded: the rest of this run has no hyperarmor. */
  readonly broken: boolean;
}

/** One entity's hit-reaction state and profile. */
export interface HitReactionState {
  readonly profile: ReactionProfile;
  /** The reaction playing, or null. */
  readonly current: ActiveReaction | null;
  /** Wake-up invulnerability: world ticks in [from, until) (0/0 when none). */
  readonly iframesFrom: number;
  readonly iframesUntil: number;
  /** Hyperarmor soak of the current move run, or null. */
  readonly armor: ArmorSoak | null;
}

/** The hit-reaction component (`combat.hit-reaction`; a snapshot and save key, never renamed). */
export const HitReactionComponent = defineComponent<HitReactionState>('combat.hit-reaction');

/** The profile a creature definition describes (its `reactions` section and mass). */
export function reactionProfileFromCreature(
  creature: Pick<CreatureDef, 'stats' | 'reactions'>,
): ReactionProfile {
  const { knockbackImpulse, knockdownImpulse, launchSpeed, replace } = creature.reactions;
  return Object.freeze({
    knockbackImpulse,
    knockdownImpulse,
    launchSpeed,
    mass: creature.stats.mass,
    replace: Object.freeze({ ...replace }),
  });
}

/**
 * Lets `entity` react to hits with `profile` (default: DEFAULT_REACTION_PROFILE). Throws a
 * RangeError for a non-positive threshold or mass, a negative launch speed, or a knockdown
 * threshold below the knockback one. Register HitReactionComponent first; adding it is structural,
 * so during a step it exists from the end of the tick.
 */
export function giveHitReactions(
  world: World<never>,
  entity: EntityId,
  profile: ReactionProfile = DEFAULT_REACTION_PROFILE,
): void {
  const { knockbackImpulse, knockdownImpulse, launchSpeed, mass } = profile;
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  if (!positive(knockbackImpulse) || !positive(knockdownImpulse) || !positive(mass)) {
    throw new RangeError('reaction impulse thresholds and mass must be finite numbers > 0');
  }
  if (knockdownImpulse < knockbackImpulse) {
    throw new RangeError('knockdownImpulse must be ≥ knockbackImpulse');
  }
  if (!(Number.isFinite(launchSpeed) && launchSpeed >= 0)) {
    throw new RangeError('launchSpeed must be a finite number ≥ 0');
  }
  world.add(
    entity,
    HitReactionComponent,
    Object.freeze({
      profile: Object.freeze({ ...profile, replace: Object.freeze({ ...profile.replace }) }),
      current: null,
      iframesFrom: 0,
      iframesUntil: 0,
      armor: null,
    }),
  );
}

/** `entity`'s reaction in progress, or undefined when it is calm or cannot react. */
export function reactionOf(world: World<never>, entity: EntityId): ActiveReaction | undefined {
  return world.get(entity, HitReactionComponent)?.current ?? undefined;
}

/** Whether `entity` is in its wake-up invulnerability after a knockdown this tick. */
export function hasWakeIframes(world: World<never>, entity: EntityId): boolean {
  const state = world.get(entity, HitReactionComponent);
  return state !== undefined && world.tick >= state.iframesFrom && world.tick < state.iframesUntil;
}
