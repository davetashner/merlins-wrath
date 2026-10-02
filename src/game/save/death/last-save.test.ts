// "Load last save" resolution (mw-e30.7 AC-1): the most recent save of any slot type, manual beating
// autosave on a tie; a slot with a damaged current copy is dated by its backup; one with no readable
// copy is left out.
import { defineComponent, World } from '@sim/index';
import { describe, expect, it } from 'vitest';
import { createGameSaveRegistry } from '../sections';
import { SaveSlots, type SaveSlotInput } from '../slots/index';
import { MemorySaveStore, type SaveStore } from '../storage/index';
import { findSaves, rankSaves, resolveLastSave, type SaveChoice } from './last-save';

const Position = defineComponent<{ x: number }>('Position');
const build = { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' };
const input: SaveSlotInput = { characterName: 'Knight', classId: 'knight', areaId: 'testbed' };

function world(tick = 0): World {
  const w = new World({ seed: 3 }).register(Position);
  w.add(w.spawn(), Position, { x: tick });
  w.restore({ ...w.snapshot(), clock: { tick, hz: 60 } });
  return w;
}

const choice = (
  slot: SaveChoice['slot'],
  kind: SaveChoice['kind'],
  savedAt: number,
): SaveChoice => ({
  slot,
  kind,
  savedAt,
  details: undefined,
  damaged: false,
});

/** Saves into slots at given wall-clock times. */
async function saveAt(store: SaveStore, saves: readonly [SaveChoice['slot'], number][]) {
  let clock = 0;
  const slots = new SaveSlots({
    store,
    registry: createGameSaveRegistry(),
    build,
    now: () => clock,
  });
  for (const [slot, time] of saves) {
    clock = time;
    await slots.overwrite(slot, world(time), input);
  }
}

/** Replaces a slot's current copy with bytes that do not decode (its old copy becomes the backup). */
async function damage(store: SaveStore, slot: string): Promise<void> {
  await store.write(slot, new Uint8Array([1, 2, 3]));
}

describe('last save', () => {
  it('AC-1: given an autosave at t=100 and a manual save at t=120, resolving "last save" chooses the manual save', async () => {
    expect(
      resolveLastSave([choice('auto-1', 'autosave', 100), choice('manual-1', 'manual', 120)])?.slot,
    ).toBe('manual-1');
    // The same through real saves in a store.
    const store = new MemorySaveStore();
    await saveAt(store, [
      ['auto-1', 100],
      ['manual-1', 120],
    ]);
    const saves = await findSaves(store);
    expect(resolveLastSave(saves)).toMatchObject({
      slot: 'manual-1',
      kind: 'manual',
      savedAt: 120,
      damaged: false,
      details: { areaId: 'testbed', playtimeTicks: 120 },
    });
    expect(saves.map((s) => s.slot)).toEqual(['manual-1', 'auto-1']);
  });

  it('chooses the most recent of any kind; an exact tie goes manual, quicksave, autosave, then slot order', () => {
    expect(
      resolveLastSave([choice('manual-1', 'manual', 100), choice('auto-2', 'autosave', 130)])?.slot,
    ).toBe('auto-2');
    expect(
      rankSaves([
        choice('auto-1', 'autosave', 50),
        choice('quick', 'quicksave', 50),
        choice('manual-2', 'manual', 50),
        choice('manual-1', 'manual', 50),
      ]).map((s) => s.slot),
    ).toEqual(['manual-2', 'manual-1', 'quick', 'auto-1']);
    expect(resolveLastSave([])).toBeUndefined();
  });

  it('dates a slot with a damaged current copy by its backup, and leaves out a slot with no readable copy', async () => {
    const store = new MemorySaveStore();
    await saveAt(store, [
      ['auto-1', 100],
      ['manual-1', 120],
      ['quick', 90],
    ]);
    await damage(store, 'manual-1');
    // quick: both copies unreadable.
    await damage(store, 'quick');
    await damage(store, 'quick');
    const saves = await findSaves(store);
    expect(saves.map((s) => [s.slot, s.savedAt, s.damaged])).toEqual([
      ['manual-1', 120, true],
      ['auto-1', 100, false],
    ]);
  });

  it('finds nothing in an empty store', async () => {
    expect(await findSaves(new MemorySaveStore())).toEqual([]);
  });

  it('ignores a damaged slot whose store record is itself unreadable', async () => {
    const store = new MemorySaveStore();
    await saveAt(store, [['auto-1', 100]]);
    const broken: SaveStore = {
      kind: 'memory',
      durable: false,
      write: (slot, bytes) => store.write(slot, bytes),
      list: () => Promise.resolve(['auto-1', 'manual-1']),
      delete: (slot) => store.delete(slot),
      read: (slot, copy) =>
        slot === 'manual-1' ? Promise.resolve({ status: 'empty' }) : store.read(slot, copy),
    };
    expect((await findSaves(broken)).map((s) => s.slot)).toEqual(['auto-1']);
  });
});
