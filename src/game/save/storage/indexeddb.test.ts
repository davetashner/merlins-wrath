// IndexedDB store specifics (mw-e30.2 AC-2, AC-3): atomic writes that roll back on abort or quota
// errors, durability across connections, and damaged records reported as SaveCorruptError.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveCorruptError } from '../format/index';
import { IndexedDbSaveStore, SAVE_DB_NAME, SaveQuotaError, SaveStorageError } from './index';

const bytes = (...values: number[]) => new Uint8Array(values);

/** Opens a second, raw connection to poke at records the way a bug or a damaged disk might. */
function raw(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve) => {
    const request = factory.open(SAVE_DB_NAME);
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

async function rawPut(factory: IDBFactory, store: string, key: IDBValidKey, value: unknown) {
  const db = await raw(factory);
  await new Promise<void>((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => {
      resolve();
    };
  });
  db.close();
}

async function rawKeys(factory: IDBFactory, store: string): Promise<IDBValidKey[]> {
  const db = await raw(factory);
  const keys = await new Promise<IDBValidKey[]>((resolve) => {
    const request = db.transaction(store).objectStore(store).getAllKeys();
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
  db.close();
  return keys;
}

/** Runs `after` once a put into the blobs store has succeeded, before the transaction commits. */
function afterBlobPut(after: (tx: IDBTransaction) => void) {
  const put = Reflect.get(IDBObjectStore.prototype, 'put');
  return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const request = Reflect.apply(put, this, [value, key]);
    const tx = this.transaction;
    if (this.name === 'blobs') {
      request.addEventListener('success', () => {
        after(tx);
      });
    }
    return request;
  });
}

async function storeWithTwoSaves() {
  const factory = new IDBFactory();
  const store = await IndexedDbSaveStore.open(factory);
  await store.write('slot', bytes(1));
  await store.write('slot', bytes(2));
  return { factory, store };
}

async function expectUntouched(store: IndexedDbSaveStore) {
  expect(await store.read('slot')).toEqual({ status: 'ok', bytes: bytes(2), generation: 2 });
  expect(await store.read('slot', 'backup')).toEqual({
    status: 'ok',
    bytes: bytes(1),
    generation: 1,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IndexedDbSaveStore', () => {
  it('keeps saves across connections (durable)', async () => {
    const { factory, store } = await storeWithTwoSaves();
    store.close();
    const reopened = await IndexedDbSaveStore.open(factory);
    expect(await reopened.read('slot')).toEqual({ status: 'ok', bytes: bytes(2), generation: 2 });
    expect(await rawKeys(factory, 'blobs')).toEqual([
      ['slot', 1],
      ['slot', 2],
    ]);
  });

  it('AC-2: a write aborted mid-transaction leaves the previous save and backup intact', async () => {
    const { store } = await storeWithTwoSaves();
    afterBlobPut((tx) => {
      tx.abort();
    });
    const write = store.write('slot', bytes(3));
    await expect(write).rejects.toBeInstanceOf(SaveStorageError);
    await expect(write).rejects.toMatchObject({ cause: { name: 'AbortError' } });
    vi.restoreAllMocks();
    await expectUntouched(store);
  });

  it('AC-3: a quota abort surfaces as SaveQuotaError and keeps the previous save', async () => {
    const { store } = await storeWithTwoSaves();
    // What browsers do when the disk quota runs out: the transaction aborts with QuotaExceededError.
    afterBlobPut((tx) => {
      (tx as unknown as { _abort(name: string): void })._abort('QuotaExceededError');
    });
    const write = store.write('slot', bytes(3));
    await expect(write).rejects.toBeInstanceOf(SaveQuotaError);
    await expect(write).rejects.toMatchObject({ kind: 'quota', suggestion: 'free up space' });
    vi.restoreAllMocks();
    await expectUntouched(store);
  });

  it('AC-3: a quota error thrown synchronously by put is also a SaveQuotaError', async () => {
    const { store } = await storeWithTwoSaves();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('disk full', 'QuotaExceededError');
    });
    await expect(store.write('slot', bytes(3))).rejects.toBeInstanceOf(SaveQuotaError);
    vi.restoreAllMocks();
    await expectUntouched(store);
  });

  it('reports a malformed slot record as corrupt, then recovers on the next write', async () => {
    const { factory, store } = await storeWithTwoSaves();
    await rawPut(factory, 'slots', 'slot', { current: 'two' });
    const read = await store.read('slot');
    expect(read.status === 'corrupt' && read.error).toBeInstanceOf(SaveCorruptError);
    expect(read.status === 'corrupt' && read.error.reason).toBe(
      'slot "slot" has a malformed record',
    );

    await store.write('slot', bytes(9));
    expect(await store.read('slot')).toEqual({ status: 'ok', bytes: bytes(9), generation: 1 });
    expect(await store.read('slot', 'backup')).toEqual({ status: 'empty' });
    expect(await rawKeys(factory, 'blobs')).toEqual([['slot', 1]]);
  });

  it('reports a missing or non-byte blob as corrupt', async () => {
    const { factory, store } = await storeWithTwoSaves();
    await rawPut(factory, 'slots', 'slot', { current: 5, backup: 2 });
    await rawPut(factory, 'blobs', ['slot', 2], 'not bytes');
    const current = await store.read('slot');
    const backup = await store.read('slot', 'backup');
    expect(current.status === 'corrupt' && current.error.reason).toBe(
      'slot "slot" current copy (generation 5) is missing',
    );
    expect(backup.status === 'corrupt' && backup.error.reason).toBe(
      'slot "slot" backup copy (generation 2) is not save bytes',
    );
  });

  it('sweeps orphaned blobs on the next write', async () => {
    const { factory, store } = await storeWithTwoSaves();
    await rawPut(factory, 'blobs', ['slot', 7], bytes(7));
    await rawPut(factory, 'blobs', ['other', 1], bytes(0));
    await store.write('slot', bytes(3));
    expect(await rawKeys(factory, 'blobs')).toEqual([
      ['other', 1],
      ['slot', 2],
      ['slot', 3],
    ]);
  });

  it('lists only string slot keys', async () => {
    const { factory, store } = await storeWithTwoSaves();
    await rawPut(factory, 'slots', 42, { current: 1, backup: null });
    expect(await store.list()).toEqual(['slot']);
  });

  it('fails with SaveStorageError when IndexedDB refuses to open', async () => {
    const throwing = {
      open: () => {
        throw new DOMException('private mode', 'InvalidStateError');
      },
    } as unknown as IDBFactory;
    await expect(IndexedDbSaveStore.open(throwing)).rejects.toMatchObject({
      kind: 'storage',
      operation: 'open the save database "mw-saves"',
      cause: { name: 'InvalidStateError' },
    });

    // An asynchronous open error: the database is already at a newer version than this build.
    const factory = new IDBFactory();
    await new Promise<void>((resolve) => {
      const request = factory.open('newer', 99);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    await expect(IndexedDbSaveStore.open(factory, 'newer')).rejects.toMatchObject({
      kind: 'storage',
      cause: { name: 'VersionError' },
    });
  });

  it('steps aside for a newer schema in another tab, then fails loudly', async () => {
    const { factory, store } = await storeWithTwoSaves();
    await new Promise<void>((resolve) => {
      const request = factory.open(SAVE_DB_NAME, 2);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    await expect(store.write('slot', bytes(3))).rejects.toMatchObject({
      kind: 'storage',
      operation: 'write slot "slot"',
      cause: { name: 'InvalidStateError' },
    });
  });

  it('fails every operation with SaveStorageError after close', async () => {
    const { store } = await storeWithTwoSaves();
    store.close();
    await expect(store.read('slot')).rejects.toBeInstanceOf(SaveStorageError);
    await expect(store.list()).rejects.toBeInstanceOf(SaveStorageError);
    await expect(store.delete('slot')).rejects.toBeInstanceOf(SaveStorageError);
  });
});
