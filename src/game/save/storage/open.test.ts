// Store selection at startup (mw-e30.2 AC-4): IndexedDB when usable, otherwise the in-memory store
// and a warning the game keeps on screen.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  MemorySaveStore,
  openSaveStore,
  PersistingSaveStore,
  SAVES_NOT_PERSISTED_WARNING,
  SaveStorageError,
} from './index';

describe('openSaveStore', () => {
  it('uses IndexedDB, with the persistence request, when it opens', async () => {
    const persist = () => Promise.resolve(true);
    const opened = await openSaveStore({
      indexedDB: new IDBFactory(),
      storage: { persist },
      databaseName: 'test-saves',
    });
    expect(opened.warning).toBeUndefined();
    expect(opened.store).toBeInstanceOf(PersistingSaveStore);
    expect([opened.store.kind, opened.store.durable]).toEqual(['indexeddb', true]);
    await opened.store.write('a', new Uint8Array([1]));
    expect(opened.warning === undefined && (await opened.store.persistence())).toBe('granted');
  });

  it('AC-4: falls back to memory with a warning when IndexedDB throws on open', async () => {
    const privateMode = {
      open: () => {
        throw new DOMException('private browsing', 'InvalidStateError');
      },
    } as unknown as IDBFactory;
    const opened = await openSaveStore({ indexedDB: privateMode, storage: undefined });
    expect(opened.store).toBeInstanceOf(MemorySaveStore);
    expect(opened.store.durable).toBe(false);
    expect(opened.warning).toBe(SAVES_NOT_PERSISTED_WARNING);
    expect(opened.warning).toMatch(/^Saves will not persist/);
    expect(opened.warning !== undefined && opened.reason).toMatchObject({
      kind: 'storage',
      cause: { name: 'InvalidStateError' },
    });
  });

  it('AC-4: falls back to memory with a warning when IndexedDB does not exist', async () => {
    const opened = await openSaveStore({ indexedDB: undefined, storage: undefined });
    expect(opened.store).toBeInstanceOf(MemorySaveStore);
    expect(opened.warning).toBe(SAVES_NOT_PERSISTED_WARNING);
    expect(opened.warning !== undefined && opened.reason).toBeInstanceOf(SaveStorageError);
  });
});
