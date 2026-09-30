// What a combatant is made of, as far as harm goes (mw-e04.1): Health, Poise and Resistances, plus
// the marker that tells the damage model which entity the difficulty multipliers speak about. Values
// are frozen and replaced, never mutated, and every component validates its snapshot data on
// restore so a corrupt save fails loudly instead of producing an immortal skeleton.
//
// Poise is the stagger meter: poise damage empties it, emptying it breaks poise (PoiseBroken, e04.7
// turns that into a stagger) and refills it. After `regenDelayTicks` without poise damage it
// regenerates at `regenPercentPerSecond` of max per second — by default 25%/s after 120 ticks (2 s).
// Like stamina, the pause is an absolute "resumes at" tick, so system order within a tick is free.

import type { CreatureDef } from '@content/index';
import { defineComponent, type EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import {
  DAMAGE_TYPES,
  fromPoiseQuanta,
  isDamageType,
  nonNegativeProblem,
  roundPoints,
  toPoiseQuanta,
  type DamageAmounts,
  type DamageType,
} from './types';

/** Largest resistance multiplier (matches the content schema's MAX_RESISTANCE). */
export const MAX_RESISTANCE_MULTIPLIER = 3;

/** Poise regen defaults: 120 ticks (2 s) without poise damage, then 25% of max per second. */
export const DEFAULT_POISE_REGEN = Object.freeze({ delayTicks: 120, percentPerSecond: 25 });

/** Hit points. `current` is exact to the hundredth; 0 means dead (and stays dead). */
export interface Health {
  readonly max: number;
  readonly current: number;
}

/** The stagger meter (see the file header). */
export interface Poise {
  /** Full meter; 0 means any poise damage breaks it. */
  readonly max: number;
  /** Current poise in [0, max]. */
  readonly current: number;
  /** Ticks after poise damage before regen starts. */
  readonly regenDelayTicks: number;
  /** Regen per second once regenerating, as a percentage of `max` (0–100). */
  readonly regenPercentPerSecond: number;
  /** First tick on which regen may run. */
  readonly regenResumesAt: number;
}

/** How a defender's body treats each damage type. */
export interface Resistances {
  /** Multiplier per damage type in [0, 3]: 0 immune, < 1 resists, > 1 vulnerable; unlisted = 1. */
  readonly multipliers: DamageAmounts;
  /** Flat points absorbed per damage type on every hit, after guards (the armor stage). */
  readonly armor: DamageAmounts;
}

function fail(problem: string | undefined): void {
  if (problem !== undefined) throw new RangeError(problem);
}

function fields(what: string, data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) throw new RangeError(`${what} must be an object`);
  return data as Record<string, unknown>;
}

function wholeTick(what: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a whole number of ticks ≥ 0`);
  }
  return value;
}

function restoreHealth(data: unknown): Health {
  const { max, current } = fields('health', data);
  fail(nonNegativeProblem('health.max', max));
  const top = max as number;
  if (top === 0) throw new RangeError('health.max must be > 0');
  if (typeof current !== 'number' || !(current >= 0 && current <= top)) {
    throw new RangeError('health.current must be a number in [0, max]');
  }
  return Object.freeze({ max: roundPoints(top), current: roundPoints(current) });
}

function restorePoise(data: unknown): Poise {
  const f = fields('poise', data);
  fail(nonNegativeProblem('poise.max', f['max']));
  const max = f['max'] as number;
  const { current, regenPercentPerSecond } = f;
  if (typeof current !== 'number' || !(current >= 0 && current <= max)) {
    throw new RangeError('poise.current must be a number in [0, max]');
  }
  if (
    typeof regenPercentPerSecond !== 'number' ||
    !(regenPercentPerSecond >= 0 && regenPercentPerSecond <= 100)
  ) {
    throw new RangeError('poise.regenPercentPerSecond must be a number in [0, 100]');
  }
  return Object.freeze({
    max,
    current,
    regenDelayTicks: wholeTick('poise.regenDelayTicks', f['regenDelayTicks']),
    regenPercentPerSecond,
    regenResumesAt: wholeTick('poise.regenResumesAt', f['regenResumesAt']),
  });
}

function typeMap(what: string, data: unknown, max: number): DamageAmounts {
  const map = fields(what, data);
  const out: Partial<Record<DamageType, number>> = {};
  for (const key of Object.keys(map)) {
    if (!isDamageType(key)) throw new RangeError(`${what}: unknown damage type "${key}"`);
  }
  for (const type of DAMAGE_TYPES) {
    const value = map[type];
    if (value === undefined) continue;
    fail(nonNegativeProblem(`${what}.${type}`, value));
    const n = value as number;
    if (n > max) throw new RangeError(`${what}.${type} must be ≤ ${String(max)}, got ${String(n)}`);
    out[type] = n;
  }
  return Object.freeze(out);
}

function restoreResistances(data: unknown): Resistances {
  const f = fields('resistances', data);
  return Object.freeze({
    multipliers: typeMap('resistances.multipliers', f['multipliers'], MAX_RESISTANCE_MULTIPLIER),
    armor: typeMap('resistances.armor', f['armor'], Number.MAX_VALUE),
  });
}

function restorePlayer(data: unknown): true {
  if (data !== true) throw new RangeError('player combatant marker must be true');
  return true;
}

/** Health (`combat.health`; a snapshot and save key, never renamed). */
export const HealthComponent = defineComponent<Health>('combat.health', {
  deserialize: restoreHealth,
});

/** Poise (`combat.poise`; a snapshot and save key, never renamed). */
export const PoiseComponent = defineComponent<Poise>('combat.poise', {
  deserialize: restorePoise,
});

/** Resistances and armor (`combat.resistances`; a snapshot and save key, never renamed). */
export const ResistancesComponent = defineComponent<Resistances>('combat.resistances', {
  deserialize: restoreResistances,
});

/**
 * Marks the player's combatant (`combat.player`): damage it deals is scaled by the difficulty's
 * `damageDealt`, damage it takes by `damageTaken`. Everyone else's fights are untouched.
 */
export const PlayerCombatantComponent = defineComponent<true>('combat.player', {
  deserialize: restorePlayer,
});

function restoreUndying(data: unknown): true {
  if (data !== true) throw new RangeError('undying marker must be true');
  return true;
}

/** Health an undying combatant keeps, points (or what it has left, if that is less). */
export const UNDYING_FLOOR = 1;

/**
 * Marks a combatant that cannot die (`combat.undying`): the damage model never takes its health below
 * UNDYING_FLOOR, so it never emits Died, while every hit still reports its full damage (the combat
 * sandbox's infinite-health dummy, mw-e04.9). Not one of DAMAGE_COMPONENTS: register it where it is
 * used; the model ignores it in worlds that do not.
 */
export const UndyingComponent = defineComponent<true>('combat.undying', {
  deserialize: restoreUndying,
});

/** Every damage-model component, for `world.register(...DAMAGE_COMPONENTS)`. */
export const DAMAGE_COMPONENTS = Object.freeze([
  HealthComponent,
  PoiseComponent,
  ResistancesComponent,
  PlayerCombatantComponent,
] as const);

/** What a combatant starts with; see `giveCombatant`. */
export interface CombatantSpec {
  /** Max (and starting) health, > 0. */
  readonly health: number;
  /** Max poise (≥ 0); omitted = no poise meter (never staggers from poise). */
  readonly poise?: number;
  /** Poise regen; defaults to DEFAULT_POISE_REGEN. */
  readonly poiseRegen?: { readonly delayTicks: number; readonly percentPerSecond: number };
  /** Multipliers per damage type in [0, 3]; unlisted = 1. */
  readonly resistances?: DamageAmounts;
  /** Flat absorption per damage type. */
  readonly armor?: DamageAmounts;
  /** The player's combatant (difficulty multipliers apply). */
  readonly player?: boolean;
}

/**
 * Makes `entity` a combatant: full health, full poise, its resistances and armor. Validates the spec
 * (RangeError). The damage components must be registered; adding them is structural, so during a
 * step they exist from the end of the tick.
 */
export function giveCombatant(world: World<never>, entity: EntityId, spec: CombatantSpec): void {
  const health = restoreHealth({ max: spec.health, current: spec.health });
  const resistances = restoreResistances({
    multipliers: spec.resistances ?? {},
    armor: spec.armor ?? {},
  });
  const poise =
    spec.poise === undefined
      ? undefined
      : restorePoise({
          max: spec.poise,
          current: spec.poise,
          regenDelayTicks: (spec.poiseRegen ?? DEFAULT_POISE_REGEN).delayTicks,
          regenPercentPerSecond: (spec.poiseRegen ?? DEFAULT_POISE_REGEN).percentPerSecond,
          regenResumesAt: 0,
        });
  world.add(entity, HealthComponent, health);
  world.add(entity, ResistancesComponent, resistances);
  if (poise !== undefined) world.add(entity, PoiseComponent, poise);
  if (spec.player === true) world.add(entity, PlayerCombatantComponent, true);
}

/** The combatant spec a creature definition describes (health, poise, regen and resistances). */
export function combatantFromCreature(
  creature: Pick<CreatureDef, 'stats' | 'resistances' | 'poiseRegen'>,
): CombatantSpec {
  return {
    health: creature.stats.health,
    poise: creature.stats.poise,
    poiseRegen: creature.poiseRegen,
    resistances: creature.resistances,
  };
}

/** `entity`'s health, or undefined when it has none. */
export function healthOf(world: World<never>, entity: EntityId): Health | undefined {
  return world.get(entity, HealthComponent);
}

/** `entity`'s poise, or undefined when it has none. */
export function poiseOf(world: World<never>, entity: EntityId): Poise | undefined {
  return world.get(entity, PoiseComponent);
}

/** Whether `entity` has health and it has reached 0. */
export function isDead(world: World<never>, entity: EntityId): boolean {
  return healthOf(world, entity)?.current === 0;
}

/**
 * `poise` after taking `damage` points on `tick`: the regen pause restarts, and `broken` is true when
 * the meter emptied — it is then refilled to max (the stagger is the consequence, not an empty bar).
 */
export function poiseAfterHit(
  poise: Poise,
  damage: number,
  tick: number,
): { readonly poise: Poise; readonly broken: boolean } {
  const left = toPoiseQuanta(poise.current) - toPoiseQuanta(damage);
  const broken = left <= 0;
  return {
    broken,
    poise: Object.freeze({
      ...poise,
      current: broken ? poise.max : fromPoiseQuanta(left),
      regenResumesAt: tick + poise.regenDelayTicks,
    }),
  };
}

/** Regenerates poise once its pause is over; run it once per tick (anywhere in the order). */
export function poiseSystem<TInput>(): System<TInput> {
  return {
    name: 'poise',
    run: ({ world, tick, clock }) => {
      world.query(PoiseComponent).forEach((entity, poise) => {
        if (tick < poise.regenResumesAt || poise.current >= poise.max) return;
        const perTick = toPoiseQuanta((poise.max * poise.regenPercentPerSecond) / 100 / clock.hz);
        const current = fromPoiseQuanta(
          Math.min(toPoiseQuanta(poise.max), toPoiseQuanta(poise.current) + perTick),
        );
        world.set(entity, PoiseComponent, Object.freeze({ ...poise, current }));
      });
    },
  };
}
