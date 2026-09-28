// Persistent-storage request and quota estimate (mw-e30.2 AC-5): best-effort extras that must never
// get in the way of saving.
import { describe, expect, it, vi } from 'vitest';
import { MemorySaveStore } from './memory';
import { estimateSaveQuota, PersistingSaveStore, type StorageManagerLike } from './persistence';

const bytes = new Uint8Array([1, 2, 3]);

describe('PersistingSaveStore', () => {
  it('AC-5: saves without error when navigator.storage.persist is unavailable', async () => {
    for (const storage of [undefined, {}]) {
      const store = new PersistingSaveStore(new MemorySaveStore(), storage);
      await store.write('a', bytes);
      expect(await store.read('a')).toEqual({ status: 'ok', bytes, generation: 1 });
      expect(await store.persistence()).toBe('unavailable');
    }
  });

  it('AC-5: saves without error when persist() throws or rejects', async () => {
    const throwing: StorageManagerLike = {
      persist: () => {
        throw new Error('not allowed');
      },
    };
    const rejecting: StorageManagerLike = { persist: () => Promise.reject(new Error('denied')) };
    for (const storage of [throwing, rejecting]) {
      const store = new PersistingSaveStore(new MemorySaveStore(), storage);
      await store.write('a', bytes);
      expect(await store.persistence()).toBe('unavailable');
    }
  });

  it('requests persistence once, on the first save', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    const store = new PersistingSaveStore(new MemorySaveStore(), { persist });
    expect(await store.persistence()).toBe('not-requested');
    await store.list();
    expect(persist).not.toHaveBeenCalled();
    await store.write('a', bytes);
    await store.write('a', bytes);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await store.persistence()).toBe('granted');
  });

  it('records a denied request', async () => {
    const store = new PersistingSaveStore(new MemorySaveStore(), {
      persist: () => Promise.resolve(false),
    });
    await store.write('a', bytes);
    expect(await store.persistence()).toBe('denied');
  });

  it('does not wait on the request (it may be a permission prompt)', async () => {
    const store = new PersistingSaveStore(new MemorySaveStore(), {
      persist: () => new Promise<boolean>(() => undefined),
    });
    await store.write('a', bytes);
    expect(await store.list()).toEqual(['a']);
  });

  it('passes through kind, durability, backups and deletes', async () => {
    const store = new PersistingSaveStore(new MemorySaveStore(), undefined);
    expect([store.kind, store.durable]).toEqual(['memory', false]);
    await store.write('a', bytes);
    await store.write('a', new Uint8Array([4]));
    expect(await store.read('a', 'backup')).toEqual({ status: 'ok', bytes, generation: 1 });
    await store.delete('a');
    expect(await store.list()).toEqual([]);
  });
});

describe('estimateSaveQuota', () => {
  it('returns usage and quota when the browser reports both', async () => {
    const storage = { estimate: () => Promise.resolve({ usage: 10, quota: 100 }) };
    expect(await estimateSaveQuota(storage)).toEqual({ usage: 10, quota: 100 });
  });

  it('returns undefined when the browser cannot say', async () => {
    const cases: (StorageManagerLike | undefined)[] = [
      undefined,
      {},
      { estimate: () => Promise.resolve({ quota: 100 }) },
      { estimate: () => Promise.resolve({ usage: 10 }) },
      { estimate: () => Promise.reject(new Error('nope')) },
    ];
    const results = await Promise.all(cases.map((storage) => estimateSaveQuota(storage)));
    expect(results).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
