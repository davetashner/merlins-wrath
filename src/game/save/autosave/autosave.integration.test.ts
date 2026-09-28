// Autosave through the real stack (mw-e30.5): the save registry, SaveSlots and the IndexedDB store
// (fake-indexeddb). AC-4: a failing write is retried once at the next safe moment and a second
// failure surfaces as a non-blocking HUD warning, leaving the good autosaves intact. AC-5 (at the
// sim level until the greybox testbed exists): an entity tagged player walking into a checkpoint
// trigger volume produces an autosave that the slot list shows with its area.
import 'fake-indexeddb/auto';
import {
  addSignalGraph,
  installSignals,
  installStimuli,
  placeEntity,
  registerWorldProperties,
  signalSystem,
  tagEntity,
  World,
  type SignalGraphDef,
} from '@sim/index';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createGameSaveRegistry } from '../sections';
import { AUTOSAVE_SLOTS, SaveSlots } from '../slots/index';
import { IndexedDbSaveStore, SaveQuotaError, type SaveStore } from '../storage/index';
import { autosaveAtCheckpoints } from './checkpoints';
import { AutosaveScheduler, type AutosaveEvent } from './scheduler';

const build = { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' };

function setup(store: SaveStore, areaId = 'testbed-arena') {
  const slots = new SaveSlots({
    store,
    registry: createGameSaveRegistry(),
    build,
    now: () => 1_790_000_000_000,
  });
  const scheduler = new AutosaveScheduler({
    slots,
    describe: () => ({ characterName: 'Aldric', classId: 'knight', areaId }),
    minGapSeconds: 0,
  });
  const hud: AutosaveEvent[] = [];
  scheduler.subscribe((event) => hud.push(event));
  return { slots, scheduler, hud };
}

/** An event as the HUD reacts to it: a failure either retries quietly or shows the warning. */
const show = (e: AutosaveEvent) =>
  e.type === 'failed' ? `failed:${e.retrying ? 'retrying' : 'warn'}` : e.type;

/** The IndexedDB store, with writes that fail with a quota error while `full` is set. */
async function quotaStore() {
  const inner = await IndexedDbSaveStore.open(new IDBFactory());
  const disk = { full: false };
  const store: SaveStore = {
    kind: inner.kind,
    durable: inner.durable,
    write: (slot, bytes) =>
      disk.full
        ? Promise.reject(new SaveQuotaError(new DOMException('full', 'QuotaExceededError')))
        : inner.write(slot, bytes),
    read: (slot, copy) => inner.read(slot, copy),
    list: () => inner.list(),
    delete: (slot) => inner.delete(slot),
  };
  return { store, disk };
}

describe('autosave integration', () => {
  it('AC-4: retries a failed autosave once at the next safe moment and warns on the second failure', async () => {
    const { store, disk } = await quotaStore();
    const { slots, scheduler, hud } = setup(store);
    const w = new World({ seed: 5 });
    for (let i = 0; i < 3; i += 1) {
      scheduler.request({ kind: 'checkpoint' });
      await scheduler.update(w);
      w.step();
    }
    const good = await slots.list(AUTOSAVE_SLOTS);
    expect(good.map((s) => s.state)).toEqual(['ready', 'ready', 'ready']);
    hud.length = 0;

    disk.full = true;
    scheduler.request({ kind: 'area-transition', source: 'crypt' });
    await scheduler.update(w);
    expect(hud.map(show)).toEqual(['saving', 'failed:retrying']);
    w.step();
    await scheduler.update(w); // the next safe moment: the one retry
    expect(hud.map(show)).toEqual(['saving', 'failed:retrying', 'saving', 'failed:warn']);
    const warning = hud.at(-1);
    expect(warning?.type === 'failed' && warning.error).toBeInstanceOf(SaveQuotaError);
    // Non-blocking: nothing waits, the game plays on, and every good autosave is untouched.
    expect(scheduler.pending).toBeNull();
    expect(scheduler.saving).toBe(false);
    expect(await slots.list(AUTOSAVE_SLOTS)).toEqual(good);

    disk.full = false;
    scheduler.request({ kind: 'checkpoint' });
    w.step();
    expect((await scheduler.update(w))?.type).toBe('saved');
  });

  it('AC-5: entering a checkpoint volume autosaves, and the slot list shows the area', async () => {
    const store = await IndexedDbSaveStore.open(new IDBFactory());
    const { slots, scheduler, hud } = setup(store, 'testbed-crypt');
    const w = installSignals(
      installStimuli(registerWorldProperties(new World<never>({ seed: 9 }))),
    );
    w.addSystem(signalSystem());
    const checkpoint: SignalGraphDef = {
      id: 'crypt-checkpoints',
      nodes: [
        {
          id: 'gate',
          kind: 'volume',
          shape: { kind: 'box', center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } },
          filter: [{ test: 'tag', tag: 'player' }],
        },
        {
          id: 'crate-zone',
          kind: 'volume',
          shape: { kind: 'box', center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } },
        },
      ],
      wires: [],
    };
    addSignalGraph(w, checkpoint);
    const stop = autosaveAtCheckpoints(w.events, scheduler, (c) => c.node === 'gate');
    const player = w.spawn();
    tagEntity(w, player, 'player');
    placeEntity(w, player, { x: 20, y: 0, z: 0 });
    w.step();
    expect(await scheduler.update(w)).toBeNull();

    placeEntity(w, player, { x: 0, y: 0, z: 0 });
    w.step();
    expect(scheduler.pending).toEqual({ kind: 'checkpoint', source: 'crypt-checkpoints/gate' });
    await scheduler.update(w);
    const [first] = await slots.list(AUTOSAVE_SLOTS);
    expect(first?.state === 'ready' && first.details?.areaId).toBe('testbed-crypt');
    expect(hud.map((e) => e.type)).toEqual(['saving', 'saved']);

    // After unsubscribing, crossings no longer request autosaves.
    stop();
    placeEntity(w, player, { x: 20, y: 0, z: 0 });
    w.step();
    placeEntity(w, player, { x: 0, y: 0, z: 0 });
    w.step();
    expect(scheduler.pending).toBeNull();
  });
});
