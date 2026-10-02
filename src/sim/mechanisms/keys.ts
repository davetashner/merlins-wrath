// Keys on locks (mw-e03.18): the key finder mechanisms use by default in the game. A key item opens a
// lock when its `key.opens` lists the lock id, or its `key.opensTag` is one of the lock's tags (a
// master key, mw-e17.2). Only keys on the actor's keyring count (the inventory's keyring view,
// mw-e17.3), in acquisition order: the first that fits is the one used. Consuming single-use keys and
// the keyring's prompt hints are mw-e17.5's.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import type { InventoryRules } from '../inventory/inventory';
import type { LockSpec } from './components';
import type { KeyFinder } from './system';

/** What a key item says it opens. */
export interface KeyData {
  readonly opens: readonly string[];
  readonly opensTag?: string | undefined;
}

/** Whether `key` opens a lock with `lock` id and `tags`. */
export function keyFits(
  key: KeyData,
  lock: Pick<LockSpec, 'tags'> & { readonly lock: string },
): boolean {
  return (
    key.opens.includes(lock.lock) ||
    (key.opensTag !== undefined && lock.tags.includes(key.opensTag))
  );
}

/** A key finder over `actor`'s keyring in `rules`' inventory. */
export function keyringFinder(rules: InventoryRules): KeyFinder {
  return (world: World<never>, actor: EntityId, lock) => {
    for (const item of rules.query(world, actor, { view: 'keyring' })) {
      const key = rules.def(item.defId).key;
      if (key !== undefined && keyFits(key, lock)) return item.defId;
    }
    return undefined;
  };
}
