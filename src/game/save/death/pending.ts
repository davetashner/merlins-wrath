// The hand-off across a reload (mw-e30.7). Loading a save tears the whole world down and builds it
// again: the page navigates to the save's area with a pending load in session storage, the fresh
// world loads that area, and boot then loads the save into it before the first sim step. Restart
// area navigates the same way without a pending load. Session storage keeps the hand-off to this tab
// and drops it when the tab closes; it is consumed on read, so a later refresh never reloads again.

import { isSlotId, type SlotId } from '../slots/ids';

/** Session storage key of the pending load. */
export const PENDING_LOAD_KEY = 'vesper.pending-load';

/** A load the next boot performs. */
export interface PendingLoad {
  readonly slot: SlotId;
  /** The area the save was made in; boot loads only into that area. Undefined: any. */
  readonly areaId: string | undefined;
  /** Wall-clock milliseconds when the player chose it, to time the reload; undefined: unknown. */
  readonly requestedAt?: number | undefined;
  /**
   * Set when the load is a respawn after a death (mw-e01.8): the respawn rule that sent the player
   * back (null: the fallback). Boot announces player.respawned once the save has loaded.
   */
  readonly respawn?: { readonly rule: string | null } | undefined;
}

/** The part of `Storage` the hand-off uses. */
export type PendingLoadStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Records a load for the next boot. */
export function writePendingLoad(storage: PendingLoadStorage, load: PendingLoad): void {
  // Undefined fields are left out of the JSON.
  storage.setItem(PENDING_LOAD_KEY, JSON.stringify(load));
}

/** Clears any pending load (Restart area). */
export function clearPendingLoad(storage: PendingLoadStorage): void {
  storage.removeItem(PENDING_LOAD_KEY);
}

/**
 * Reads and removes the pending load. Missing, malformed or naming an unknown slot: undefined (a
 * malformed hand-off is dropped, never retried).
 */
export function takePendingLoad(storage: PendingLoadStorage): PendingLoad | undefined {
  const text = storage.getItem(PENDING_LOAD_KEY);
  if (text === null) return undefined;
  storage.removeItem(PENDING_LOAD_KEY);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { slot, areaId, requestedAt, respawn } = value as Record<string, unknown>;
  if (typeof slot !== 'string' || !isSlotId(slot)) return undefined;
  return {
    slot,
    areaId: typeof areaId === 'string' ? areaId : undefined,
    requestedAt: typeof requestedAt === 'number' ? requestedAt : undefined,
    ...(isRespawn(respawn) && { respawn: { rule: respawn.rule } }),
  };
}

function isRespawn(value: unknown): value is { rule: string | null } {
  if (typeof value !== 'object' || value === null) return false;
  const { rule } = value as Record<string, unknown>;
  return rule === null || typeof rule === 'string';
}
