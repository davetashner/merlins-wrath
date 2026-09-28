// Damage types and the fixed-point arithmetic of the damage model (mw-e04.1). The type list is owned
// by content (src/content/types/damage.ts, which creature resistances validate against); the sim
// may only import it as a type, so it keeps its own ordered copy, and the Record below makes the
// compiler reject any drift between the two lists in either direction.
//
// Exactness: damage and health are whole hundredths of a point (a block that lets 15% of 30 slash
// through deals exactly 4.5), and every multiplier is applied as whole basis points (1/10000), so
// resolution is integer arithmetic and replays can never drift the way repeated float subtraction
// would. Poise and its regen use the stamina pool's finer 1/6000-point quanta (a 25%/s regen of a
// 50-point bar is 0.2083… points per tick), of which a hundredth is a whole multiple.

import type { DamageTypeName } from '@content/index';

/** A damage type: slash, pierce, blunt, fire, frost, shock, arcane or poison. */
export type DamageType = DamageTypeName;

/** Canonical position of every damage type; a Record, so missing or unknown types fail to compile. */
const TYPE_ORDER: Readonly<Record<DamageType, number>> = {
  slash: 0,
  pierce: 1,
  blunt: 2,
  fire: 3,
  frost: 4,
  shock: 5,
  arcane: 6,
  poison: 7,
};

/** Every damage type in canonical order (the order breakdowns list them in). */
export const DAMAGE_TYPES: readonly DamageType[] = Object.freeze(
  (Object.keys(TYPE_ORDER) as DamageType[]).sort((a, b) => TYPE_ORDER[a] - TYPE_ORDER[b]),
);

/** True for a known damage type name. */
export function isDamageType(name: string): name is DamageType {
  return Object.hasOwn(TYPE_ORDER, name);
}

/** Amounts per damage type, in points. Unlisted types are 0. */
export type DamageAmounts = Readonly<Partial<Record<DamageType, number>>>;

/** Damage and health resolution: whole hundredths of a point. */
export const DAMAGE_UNITS_PER_POINT = 100;

/** Multipliers are applied as whole basis points. */
const BASIS_POINTS = 10_000;

/** Poise quanta per point (the stamina pool's unit); a multiple of DAMAGE_UNITS_PER_POINT. */
export const POISE_QUANTA_PER_POINT = 6000;

/** `points` as whole hundredths (rounded half up). */
export const toUnits = (points: number): number => Math.round(points * DAMAGE_UNITS_PER_POINT);

/** Whole hundredths back to points. */
export const fromUnits = (units: number): number => units / DAMAGE_UNITS_PER_POINT;

/** `points` rounded to the nearest hundredth. */
export const roundPoints = (points: number): number => fromUnits(toUnits(points));

/** `units` (whole hundredths) × `factor`, with the factor rounded to basis points, rounded half up. */
export function scaleUnits(units: number, factor: number): number {
  return Math.round((units * Math.round(factor * BASIS_POINTS)) / BASIS_POINTS);
}

/** `points` as poise quanta (rounded half up). */
export const toPoiseQuanta = (points: number): number =>
  Math.round(points * POISE_QUANTA_PER_POINT);

/** Poise quanta back to points. */
export const fromPoiseQuanta = (quanta: number): number => quanta / POISE_QUANTA_PER_POINT;

/**
 * Why `value` is not a non-negative finite number, or undefined when it is. Shared by packet,
 * component and modifier validation so every entry point words the error the same way.
 */
export function nonNegativeProblem(what: string, value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? undefined
    : `${what} must be a finite number ≥ 0, got ${String(value)}`;
}
