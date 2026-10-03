// Keys on locks (mw-e03.18, mw-e17.5): the keyring mechanisms use in the game. A key item opens a
// lock when its `key.opens` lists the lock id, or its `key.opensTag` is one of the lock's tags (a
// master key, mw-e17.2). Only keys on the actor's keyring count (the inventory's keyring view,
// mw-e17.3), in acquisition order: the first that fits is the one used. There is no menu: Interact on
// a locked door tries the keyring by itself, and without a fitting key the Unlock prompt is greyed
// with the lock's hint (system.ts gates it). A single-use key (`key.singleUse`) is used up when it
// opens its lock, even a quest key: opening its lock is the effect it exists for (ADR-0003's forced
// removal); a reusable key stays on the ring.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import type { InventoryRules } from '../inventory/inventory';
import type { LockSpec } from './components';

/** What a key item says it opens. */
export interface KeyData {
  readonly opens: readonly string[];
  readonly opensTag?: string | undefined;
  /** Used up when it opens a lock. */
  readonly singleUse?: boolean | undefined;
}

/** The lock a key is tried on: its id and the tags a master key opens. */
export type KeyedLock = Pick<LockSpec, 'tags'> & { readonly lock: string };

/** A key on an actor's keyring that fits a lock. */
export interface KeyMatch {
  /** The key item's definition id. */
  readonly key: string;
  /** The inventory instance it is in. */
  readonly instanceId: number;
  readonly singleUse: boolean;
}

/** An actor's keys, as mechanisms try them. */
export interface Keyring {
  /** The first key on `actor`'s keyring that opens `lock`, or undefined. */
  find(world: World<never>, actor: EntityId, lock: KeyedLock): KeyMatch | undefined;
  /** `match` opened its lock: uses it up when it is single-use. Returns whether it was used up. */
  use(world: World<never>, actor: EntityId, match: KeyMatch): boolean;
}

/** Whether `key` opens a lock with `lock` id and `tags`. */
export function keyFits(key: KeyData, lock: KeyedLock): boolean {
  return (
    key.opens.includes(lock.lock) ||
    (key.opensTag !== undefined && lock.tags.includes(key.opensTag))
  );
}

/** The keyring over each actor's inventory in `rules`. */
export function keyring(rules: InventoryRules): Keyring {
  return {
    find(world, actor, lock) {
      for (const item of rules.query(world, actor, { view: 'keyring' })) {
        const key = rules.def(item.defId).key;
        if (key === undefined || !keyFits(key, lock)) continue;
        return { key: item.defId, instanceId: item.instanceId, singleUse: key.singleUse === true };
      }
      return undefined;
    },
    use(world, actor, match) {
      if (!match.singleUse) return false;
      const request = { instanceId: match.instanceId, count: 1, force: true };
      return rules.remove(world, actor, request).ok;
    },
  };
}
