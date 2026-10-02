// Lookups whose keys are present by construction (compiled tables, in-range indices). Lint forbids
// `!` and noUncheckedIndexedAccess can't see the invariant, so the assertion lives here once.

import type { ComponentType, EntityId } from '../core/component';
import type { World } from '../core/world';

/** `items[index]` for an index known to be in range. */
export function at<T>(items: readonly T[], index: number): T {
  return items[index] as T;
}

/** `map.get(key)` for a key known to be present. */
export function got<K, V>(map: { get(key: K): V | undefined }, key: K): V {
  return map.get(key) as V;
}

/** `world.get` that answers undefined when `type` is not registered with `world`. */
export function getIf<T>(world: World<never>, entity: EntityId, type: ComponentType<T>) {
  return world.isRegistered(type) ? world.get(entity, type) : undefined;
}
