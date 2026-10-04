// Shop counters (mw-ju8.9): a scene spawn that names a merchant (`merchant` in the scene file) is a
// counter. Using it (whatever affordance the spawn declares, e.g. "Trade") emits a typed
// `shop.open` request carrying the merchant id; nothing here knows how a shop is shown. The shop
// screen (mw-e20.10) subscribes to `shopOpenRequested` and opens that merchant's stock, exactly as
// the container window subscribes to `container.searched`. Counters are plain data on the level, so
// nothing is saved: the spawn-to-merchant map is rebuilt from the scene on every load.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { interacted } from '../interaction/system';

/** The player (or any actor) used a shop counter: show this merchant's shop. */
export interface ShopOpenRequest {
  readonly tick: number;
  /** Who used the counter. */
  readonly actor: EntityId;
  /** The counter's entity. */
  readonly entity: EntityId;
  /** The merchant whose shop to open (a `merchant` content id). */
  readonly merchant: string;
}

export const shopOpenRequested = defineEvent<ShopOpenRequest>('shop.open');

/** A loaded scene spawn that may be a shop counter (as `LoadedScene.spawns` lists them). */
export interface ShopCounterSpawn {
  readonly entity: EntityId;
  readonly spawn: { readonly merchant?: string | undefined };
}

/**
 * Makes every spawn of `spawns` that names a merchant a shop counter: Interact on it emits
 * `shopOpenRequested`. Call between steps, after the scene's interactables exist; a scene with no
 * counters installs nothing. Returns the function that removes the listener.
 */
export function installShopCounters<TInput>(
  world: World<TInput>,
  spawns: readonly ShopCounterSpawn[],
): () => void {
  const merchants = new Map<EntityId, string>();
  for (const { entity, spawn } of spawns) {
    if (spawn.merchant !== undefined) merchants.set(entity, spawn.merchant);
  }
  if (merchants.size === 0) return () => undefined;
  return world.events.on(interacted, ({ actor, target }) => {
    const merchant = merchants.get(target);
    if (merchant === undefined) return;
    world.events.emit(shopOpenRequested, { tick: world.tick, actor, entity: target, merchant });
  });
}
