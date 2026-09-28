// Derived property queries and state invariants (mw-e03.1). Rules ask derived questions ("can this
// burn right now?") rather than re-deriving them from raw properties in every system, so the answer
// is defined once. Invariants name combinations of properties that no rule should ever leave behind
// (frozen yet above its freezing point); tests and the debug overlay check them between ticks.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { entitiesWithProperty, readProperty } from './components';
import type { WorldPropertyKey, WorldPropertyValues } from './spec';

/** Properties whose value is a boolean flag. */
type FlagKey = {
  [K in WorldPropertyKey]: WorldPropertyValues[K] extends boolean ? K : never;
}[WorldPropertyKey];

/** Wetness above this puts fire out and stops ignition. */
export const SOAKED_WETNESS = 0.5;

/** Density of water, kg/m³: anything less dense floats. */
export const WATER_DENSITY = 1000;

/** Whether `entity` can catch fire right now: flammable, not soaked (wetness ≤ 0.5) and not frozen. */
export function isFlammableNow(world: World<never>, entity: EntityId): boolean {
  return (
    readProperty(world, entity, 'flammable') &&
    readProperty(world, entity, 'wetness') <= SOAKED_WETNESS &&
    !readProperty(world, entity, 'frozen')
  );
}

/** Whether `entity` floats in water (density below water's). */
export function floats(world: World<never>, entity: EntityId): boolean {
  return readProperty(world, entity, 'density') < WATER_DENSITY;
}

/** One broken invariant on one entity. */
export interface PropertyViolation {
  readonly entity: EntityId;
  /** Stable rule id, e.g. `frozen-above-freeze-point`. */
  readonly rule: string;
  readonly message: string;
}

interface Invariant {
  readonly rule: string;
  /** Only entities that have this property (set to true) can break the rule. */
  readonly when: FlagKey;
  /** The problem with `entity`, or undefined when it is consistent. */
  readonly check: (world: World<never>, entity: EntityId) => string | undefined;
}

/** Every invariant, checked in this order per entity. */
const INVARIANTS: readonly Invariant[] = [
  {
    rule: 'frozen-above-freeze-point',
    when: 'frozen',
    check: (world, entity) => {
      const temperature = readProperty(world, entity, 'temperature');
      const freezePoint = readProperty(world, entity, 'freezePoint');
      return temperature > freezePoint
        ? `frozen at ${String(temperature)} °C, above its freeze point ${String(freezePoint)} °C`
        : undefined;
    },
  },
  {
    rule: 'burning-while-frozen',
    when: 'burning',
    check: (world, entity) =>
      readProperty(world, entity, 'frozen') ? 'burning and frozen at once' : undefined,
  },
  {
    rule: 'burning-not-flammable',
    when: 'burning',
    check: (world, entity) =>
      readProperty(world, entity, 'flammable') ? undefined : 'burning but not flammable',
  },
  {
    rule: 'transparent-and-opaque',
    when: 'transparent',
    check: (world, entity) =>
      readProperty(world, entity, 'opaque') ? 'both transparent and opaque' : undefined,
  },
];

/** Invariant rule ids, for tests and tooling. */
export const PROPERTY_INVARIANT_RULES: readonly string[] = INVARIANTS.map((i) => i.rule);

/**
 * Every entity whose properties are inconsistent, sorted by entity id then rule order. Call between
 * ticks (tests, debug overlay); an empty list means the world is consistent.
 */
export function findPropertyViolations(world: World<never>): PropertyViolation[] {
  const found: PropertyViolation[] = [];
  for (const { rule, when, check } of INVARIANTS) {
    for (const entity of entitiesWithProperty(world, when)) {
      const message = readProperty(world, entity, when) ? check(world, entity) : undefined;
      if (message !== undefined) {
        found.push({ entity, rule, message: `entity ${String(entity)} ${message}` });
      }
    }
  }
  // Stable sort: violations of one entity stay in rule order.
  return found.sort((a, b) => a.entity - b.entity);
}
