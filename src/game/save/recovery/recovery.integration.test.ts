// AC-1–AC-3 [integration] (mw-e30.8): the recovery chain end to end over the real IndexedDB store,
// game save registry and SaveSlots manager. A damaged slot falls back to its backup and says how old
// it is; with both copies damaged the most recent save elsewhere is offered; with every save damaged
// the player can start a new game and export the damaged files, and nothing throws.
import 'fake-indexeddb/auto';
import { defineComponent, World } from '@sim/index';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createGameSaveRegistry } from '../sections';
import { SaveSlots, type SaveSlotInput } from '../slots/index';
import { openSaveStore, type SaveStore } from '../storage/index';
import { SaveRecovery } from './recovery';
import { buildDamagedSaveReport } from './report';

const Position = defineComponent<{ x: number }>('Position');
const build = { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' };
const input: SaveSlotInput = {
  characterName: 'Aldric',
  classId: 'knight',
  areaId: 'testbed-arena',
};
const HOUR = 3_600_000;
const T0 = 1_790_000_000_000;

function world(tick = 0, x = 0): World {
  const w = new World({ seed: 11 }).register(Position);
  w.add(w.spawn(), Position, { x });
  w.restore({ ...w.snapshot(), clock: { tick, hz: 60 } });
  return w;
}

async function setup() {
  const { store } = await openSaveStore({ indexedDB: new IDBFactory(), storage: undefined });
  let clock = T0;
  const options = { store, registry: createGameSaveRegistry(), now: () => clock };
  return {
    store,
    slots: new SaveSlots({ ...options, build }),
    recovery: new SaveRecovery(options),
    at: (time: number) => {
      clock = time;
    },
  };
}

/**
 * Rewrites a slot's current copy with one body byte flipped (a different byte each generation, so
 * damaging an already-damaged copy never repairs it), so its checksum fails.
 */
async function corruptCurrent(store: SaveStore, slot: string): Promise<void> {
  const read = await store.read(slot);
  if (read.status !== 'ok') throw new Error(`${slot} has nothing to corrupt`);
  const { bytes } = read;
  const at = bytes.length - read.generation;
  bytes[at] = (bytes[at] ?? 0) ^ 0xff;
  // Writing it moves the previous copy to the backup, as a torn or bit-rotted write would look.
  await store.write(slot, bytes);
}

describe('corruption recovery over IndexedDB', () => {
  it('AC-1: a slot whose current copy fails its checksum loads the backup and says when it is from', async () => {
    const { store, slots, recovery, at } = await setup();
    at(T0);
    await slots.save('manual-1', world(600, 6), input);
    await corruptCurrent(store, 'manual-1');

    at(T0 + 2 * HOUR);
    const target = world(0, 0);
    const result = await recovery.load('manual-1', target);
    expect(result).toMatchObject({
      status: 'restored',
      slot: 'manual-1',
      from: { slot: 'manual-1', copy: 'backup', savedAt: T0, ageMs: 2 * HOUR },
      message: {
        key: 'save.recovery.restored-backup',
        params: { slot: 'manual-1', savedAt: T0, ageMs: 2 * HOUR },
      },
      damaged: [{ slot: 'manual-1', copy: 'current', error: { kind: 'corrupt' } }],
    });
    expect(target.tick).toBe(600);
    // Recovery is read-only: the damaged copy is still there for the player to export.
    const kept = await store.read('manual-1');
    expect(kept.status === 'ok' && kept.generation).toBe(2);
  });

  it('AC-2: with the current copy and the backup both damaged, the next most recent save is offered', async () => {
    const { store, slots, recovery, at } = await setup();
    at(T0 - 3 * HOUR);
    await slots.save('auto-1', world(100, 1), input);
    at(T0 - 2 * HOUR);
    await slots.save('manual-2', world(200, 2), { ...input, areaId: 'bell-tower' });
    at(T0 - HOUR);
    await slots.save('manual-1', world(300, 3), input);
    await corruptCurrent(store, 'manual-1');
    await corruptCurrent(store, 'manual-1');

    at(T0);
    const target = world(5, 5);
    const offer = await recovery.load('manual-1', target);
    expect(offer).toMatchObject({
      status: 'offer',
      candidate: {
        slot: 'manual-2',
        copy: 'current',
        savedAt: T0 - 2 * HOUR,
        ageMs: 2 * HOUR,
        details: { areaId: 'bell-tower', playtimeTicks: 200 },
      },
      message: { key: 'save.recovery.offer-other' },
    });
    // Offered, not loaded: nothing older is loaded until the player accepts.
    expect(target.tick).toBe(5);
    if (offer.status !== 'offer') return;
    expect(offer.damaged.map((d) => d.copy)).toEqual(['current', 'backup']);

    const accepted = await recovery.accept(offer, target);
    expect(accepted).toMatchObject({
      status: 'restored',
      message: {
        key: 'save.recovery.restored-other',
        params: { slot: 'manual-1', from: { slot: 'manual-2', copy: 'current' }, ageMs: 2 * HOUR },
      },
    });
    expect(target.tick).toBe(200);
  });

  it('AC-3: with every save damaged, the player can start a new game and export the damaged files', async () => {
    const { store, slots, recovery, at } = await setup();
    at(T0);
    await slots.save('manual-1', world(10), input);
    await slots.save('quick', world(20), input);
    for (const slot of ['manual-1', 'manual-1', 'quick', 'quick'])
      await corruptCurrent(store, slot);

    const target = world(0, 9);
    const before = target.snapshot();
    const result = await recovery.load('manual-1', target);
    expect(result).toMatchObject({
      status: 'unrecoverable',
      message: { key: 'save.recovery.unrecoverable', params: { damagedCount: 4 } },
    });
    expect(target.snapshot()).toEqual(before);
    if (result.status !== 'unrecoverable') return;

    const file = buildDamagedSaveReport(result.damaged, build, T0);
    const report = JSON.parse(new TextDecoder().decode(file.bytes)) as {
      copies: { slot: string; copy: string; errorKind: string }[];
    };
    expect(report.copies.map((c) => `${c.slot}/${c.copy}/${c.errorKind}`)).toEqual([
      'manual-1/current/corrupt',
      'manual-1/backup/corrupt',
      'quick/current/corrupt',
      'quick/backup/corrupt',
    ]);
    expect(await recovery.damagedSaves()).toHaveLength(4);

    // A new game saves into a free slot; the damaged copies stay until the player removes them.
    const fresh = await slots.saveNew(world(1), input);
    expect(fresh).toMatchObject({ status: 'saved', slot: 'manual-2' });
    expect(await store.list()).toEqual(['manual-1', 'manual-2', 'quick']);
  });
});
