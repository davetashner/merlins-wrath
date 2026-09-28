// The autosave ring (mw-e30.5): which of the autosave slots the next autosave replaces. An empty
// slot is filled first; then a slot whose save cannot be read (it is no use as a save to load); then
// the oldest save by the wall-clock time it was written. The newest autosaves are therefore never
// the ones replaced, and because every store write is atomic, a write that fails leaves the chosen
// slot — and so every good autosave — exactly as it was.

import type { ReadySlotSummary, SlotId, SlotSummary } from '../slots/index';

/**
 * The slot the next autosave goes into, given the ring's summaries in ring order
 * (`SaveSlots.list(AUTOSAVE_SLOTS)`). Ties go to the earlier slot in ring order.
 * @throws TypeError when `ring` is empty.
 */
export function pickAutosaveSlot(ring: readonly SlotSummary[]): SlotId {
  const free = ring.find((s) => s.state === 'empty') ?? ring.find((s) => s.state === 'unreadable');
  if (free !== undefined) return free.slot;
  const ready = ring.filter((s): s is ReadySlotSummary => s.state === 'ready');
  return ready.reduce((oldest, s) => (s.savedAt < oldest.savedAt ? s : oldest)).slot;
}
