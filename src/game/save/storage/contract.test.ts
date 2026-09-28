// Shared SaveStore contract (mw-e30.2 AC-1): the IndexedDB store, the in-memory fallback and the
// persistence wrapper all behave identically, so slot code never needs to know which one it has.
import 'fake-indexeddb/auto';
import { defineComponent, World } from '@sim/index';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { decodeSave, SaveRegistry } from '../format/index';
import { IndexedDbSaveStore, MemorySaveStore, openSaveStore, type SaveStore } from './index';

const Position = defineComponent<{ x: number; y: number }>('Position');

/** Real save bytes, so the round trip is checked on what the game will actually store. */
function saveBytes(x: number): Uint8Array {
  const world = new World({ seed: 7 }).register(Position);
  world.add(world.spawn(), Position, { x, y: -1 });
  return new SaveRegistry().write(world, {
    build: { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' },
    wallClockSavedAt: 1_790_000_000_000,
    metadata: { area: 'testbed-arena' },
  });
}

async function openedIndexedDb(): Promise<SaveStore> {
  const opened = await openSaveStore({ indexedDB: new IDBFactory(), storage: undefined });
  return opened.store;
}

const implementations: [string, () => Promise<SaveStore>, SaveStore['kind'], boolean][] = [
  ['MemorySaveStore', () => Promise.resolve(new MemorySaveStore()), 'memory', false],
  ['IndexedDbSaveStore', () => IndexedDbSaveStore.open(new IDBFactory()), 'indexeddb', true],
  ['openSaveStore (IndexedDB + persistence)', openedIndexedDb, 'indexeddb', true],
];

describe.each(implementations)('%s', (_name, open, kind, durable) => {
  it('AC-1: a written save reads back byte-identical', async () => {
    const store = await open();
    const bytes = saveBytes(3.5);
    await store.write('manual-1', bytes);
    const read = await store.read('manual-1');
    expect(read).toEqual({ status: 'ok', bytes, generation: 1 });
    expect(read.status === 'ok' && decodeSave(read.bytes).ok).toBe(true);
  });

  it('reports its kind and durability', async () => {
    const store = await open();
    expect([store.kind, store.durable]).toEqual([kind, durable]);
  });

  it('reads an unknown slot, or a slot with no backup yet, as empty', async () => {
    const store = await open();
    expect(await store.read('nope')).toEqual({ status: 'empty' });
    await store.write('a', saveBytes(1));
    expect(await store.read('a', 'backup')).toEqual({ status: 'empty' });
  });

  it('keeps the previous write as the backup and drops older ones', async () => {
    const store = await open();
    const [first, second, third] = [saveBytes(1), saveBytes(2), saveBytes(3)];
    await store.write('a', first);
    await store.write('a', second);
    expect(await store.read('a')).toEqual({ status: 'ok', bytes: second, generation: 2 });
    expect(await store.read('a', 'backup')).toEqual({ status: 'ok', bytes: first, generation: 1 });
    await store.write('a', third);
    expect(await store.read('a')).toEqual({ status: 'ok', bytes: third, generation: 3 });
    expect(await store.read('a', 'backup')).toEqual({ status: 'ok', bytes: second, generation: 2 });
  });

  it('copies bytes in and out, so callers cannot alter a stored save', async () => {
    const store = await open();
    const bytes = saveBytes(1);
    const original = bytes.slice();
    await store.write('a', bytes);
    bytes.fill(0);
    const read = await store.read('a');
    if (read.status === 'ok') read.bytes.fill(0);
    expect(await store.read('a')).toEqual({ status: 'ok', bytes: original, generation: 1 });
  });

  it('lists slots in sorted order and keeps slots independent', async () => {
    const store = await open();
    expect(await store.list()).toEqual([]);
    await store.write('manual-2', saveBytes(2));
    await store.write('autosave-0', saveBytes(0));
    await store.write('manual-10', saveBytes(10));
    expect(await store.list()).toEqual(['autosave-0', 'manual-10', 'manual-2']);
    expect(await store.read('manual-2')).toEqual({
      status: 'ok',
      bytes: saveBytes(2),
      generation: 1,
    });
  });

  it('deletes a slot with its backup, leaving other slots alone', async () => {
    const store = await open();
    await store.write('a', saveBytes(1));
    await store.write('a', saveBytes(2));
    await store.write('b', saveBytes(3));
    await store.delete('a');
    await store.delete('never-written');
    expect(await store.list()).toEqual(['b']);
    expect(await store.read('a')).toEqual({ status: 'empty' });
    expect(await store.read('a', 'backup')).toEqual({ status: 'empty' });
    await store.write('a', saveBytes(4));
    expect(await store.read('a')).toEqual({ status: 'ok', bytes: saveBytes(4), generation: 1 });
  });
});
