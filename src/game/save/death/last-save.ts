// "Load last save" (mw-e30.7): which save the death screen reloads. The last save is the most
// recently written one of any slot type (manual, autosave, quicksave), by the wall-clock time it was
// saved; on an exact tie a manual save beats a quicksave, which beats an autosave, because the player
// chose to make it. A slot whose current copy cannot be read still counts when its backup can: the
// damaged copy was written after the backup, so the slot is at least as recent as the backup says,
// and loading it goes through corruption recovery (mw-e30.8), which restores that backup. A slot with
// no readable copy cannot be dated and is left out; recovery would only offer another save anyway.

import { decodeSave } from '../format/index';
import { ALL_SLOTS, slotKind, type SlotId, type SlotKind } from '../slots/ids';
import { readSlotDetails, type SlotDetails } from '../slots/metadata';
import type { SaveStore } from '../storage/index';

/** A save the death screen can offer. */
export interface SaveChoice {
  readonly slot: SlotId;
  readonly kind: SlotKind;
  /** Wall-clock milliseconds since the Unix epoch (the backup's time when `damaged`). */
  readonly savedAt: number;
  /** Undefined when the save carries no slot metadata; it still loads. */
  readonly details: SlotDetails | undefined;
  /** The slot's current copy is unreadable; loading it restores the backup. */
  readonly damaged: boolean;
}

/** Tie-break order: lower wins. */
const KIND_RANK: Readonly<Record<SlotKind, number>> = { manual: 0, quicksave: 1, autosave: 2 };

/** Orders saves most recent first; ties go manual, then quicksave, then autosave, then slot order. */
export function rankSaves(saves: readonly SaveChoice[]): SaveChoice[] {
  // Array.prototype.sort is stable, so equal saves keep their slot-list order.
  return [...saves].sort((a, b) => b.savedAt - a.savedAt || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

/** The save "Load last save" loads, or undefined when there is none. */
export function resolveLastSave(saves: readonly SaveChoice[]): SaveChoice | undefined {
  return rankSaves(saves)[0];
}

/**
 * Every slot the death screen can load, most recent first (see `rankSaves`). Reads envelopes only,
 * never a world.
 * @throws SaveStorageError when storage itself fails.
 */
export async function findSaves(store: SaveStore): Promise<SaveChoice[]> {
  const used = new Set(await store.list());
  const found: (SaveChoice | undefined)[] = [];
  for (const slot of ALL_SLOTS) {
    if (!used.has(slot)) continue;
    found.push(
      (await readCopy(store, slot, 'current', false)) ??
        (await readCopy(store, slot, 'backup', true)),
    );
  }
  return rankSaves(found.filter((choice) => choice !== undefined));
}

async function readCopy(
  store: SaveStore,
  slot: SlotId,
  copy: 'current' | 'backup',
  damaged: boolean,
): Promise<SaveChoice | undefined> {
  const read = await store.read(slot, copy);
  if (read.status !== 'ok') return undefined;
  const decoded = decodeSave(read.bytes);
  if (!decoded.ok) return undefined;
  const { envelope } = decoded;
  return {
    slot,
    kind: slotKind(slot),
    savedAt: envelope.wallClockSavedAt,
    details: readSlotDetails(envelope.metadata),
    damaged,
  };
}
