// The save slot model (mw-e30.4): ten manual slots the player names and manages, a ring of autosave
// slots (rotated by the autosave scheduler, mw-e30.5) and one quicksave slot (mw-e30.6). Slot ids are
// the SaveStore keys, so the stored layout is readable in devtools and stable across builds.

/** How many manual slots the player can fill before a new save must overwrite one. */
export const MANUAL_SLOT_COUNT = 10;

/** How many autosave slots the autosave ring rotates through. */
export const AUTOSAVE_RING_SIZE = 3;

/** A slot's store key: `manual-1`…`manual-10`, `auto-1`…`auto-3` or `quick`. */
export type SlotId = `manual-${number}` | `auto-${number}` | 'quick';

/** What a slot is for; decides how the UI presents it. */
export type SlotKind = 'manual' | 'autosave' | 'quicksave';

const numbered = <P extends 'manual' | 'auto'>(prefix: P, count: number): `${P}-${number}`[] =>
  Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1)}` as `${P}-${number}`);

/** Manual slots in display order. */
export const MANUAL_SLOTS: readonly SlotId[] = numbered('manual', MANUAL_SLOT_COUNT);

/** Autosave ring slots in ring order. */
export const AUTOSAVE_SLOTS: readonly SlotId[] = numbered('auto', AUTOSAVE_RING_SIZE);

/** The single quicksave slot. */
export const QUICKSAVE_SLOT: SlotId = 'quick';

/** Every slot, in the order slot lists show them: manual, autosave, quicksave. */
export const ALL_SLOTS: readonly SlotId[] = [...MANUAL_SLOTS, ...AUTOSAVE_SLOTS, QUICKSAVE_SLOT];

const known = new Set<string>(ALL_SLOTS);

/** True when `value` names one of the slots in ALL_SLOTS. */
export function isSlotId(value: string): value is SlotId {
  return known.has(value);
}

/** The kind of a slot. */
export function slotKind(slot: SlotId): SlotKind {
  if (slot === QUICKSAVE_SLOT) return 'quicksave';
  return slot.startsWith('auto-') ? 'autosave' : 'manual';
}
