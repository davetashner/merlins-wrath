// IndexedDB save store (mw-e30.2). Database `mw-saves` has two object stores:
//
//   slots  slot name → { current, backup } generation numbers (the slot pointer)
//   blobs  [slot, generation] → save bytes
//
// A write puts the new blob and repoints the slot in ONE readwrite transaction, keeping the previous
// current blob as the backup and dropping everything older. IndexedDB transactions are atomic, so a
// crash, quota error or abort mid-write rolls the whole thing back and the slot still reads its
// previous save. Damaged records are reported as SaveCorruptError rather than thrown or ignored, so
// corruption recovery (mw-e30.8) can fall back to the backup.

import { z } from 'zod';
import { SaveCorruptError } from '../format/index';
import { SaveStorageError, toSaveStoreError } from './errors';
import type { SaveStore, SlotCopy, SlotReadResult } from './store';

/** Name of the IndexedDB database saves live in. */
export const SAVE_DB_NAME = 'mw-saves';
/** Schema version of that database (object stores and record shapes). */
export const SAVE_DB_VERSION = 1;

const SLOTS = 'slots';
const BLOBS = 'blobs';

const slotRecordSchema = z.strictObject({
  current: z.int().positive(),
  backup: z.int().positive().nullable(),
});

/** Every blob key of `slot`, optionally excluding one end of the range. */
const blobRange = (slot: string, from: number, to: number, openFrom = false, openTo = false) =>
  IDBKeyRange.bound([slot, from], [slot, to], openFrom, openTo);

/** One transaction over both stores; a throw inside any step aborts it with that error. */
class Tx {
  failure: { readonly error: unknown } | undefined;

  constructor(readonly raw: IDBTransaction) {}

  get slots(): IDBObjectStore {
    return this.raw.objectStore(SLOTS);
  }

  get blobs(): IDBObjectStore {
    return this.raw.objectStore(BLOBS);
  }

  /** Runs `step` with the request's result once it succeeds. */
  then<R>(request: IDBRequest<R>, step: (result: R) => void): void {
    request.onsuccess = () => {
      this.guard(() => {
        step(request.result);
      });
    };
  }

  guard(step: () => void): void {
    try {
      step();
    } catch (error) {
      this.failure = { error };
      this.raw.abort();
    }
  }
}

const corrupt = (reason: string): SlotReadResult => ({
  status: 'corrupt',
  error: new SaveCorruptError(reason),
});

/** A SaveStore backed by IndexedDB; open it with `IndexedDbSaveStore.open`. */
export class IndexedDbSaveStore implements SaveStore {
  readonly kind = 'indexeddb';
  readonly durable = true;

  private constructor(private readonly db: IDBDatabase) {
    // A newer build (another tab) is upgrading the schema: step aside rather than block it.
    // Later operations here fail with SaveStorageError.
    db.onversionchange = () => {
      db.close();
    };
  }

  /**
   * Opens (creating or upgrading) the save database.
   * @throws SaveStorageError when IndexedDB refuses: private mode, blocked storage, disk errors.
   */
  static open(factory: IDBFactory, name = SAVE_DB_NAME): Promise<IndexedDbSaveStore> {
    return new Promise((resolve, reject) => {
      const fail = (cause: unknown) => {
        reject(new SaveStorageError(`open the save database "${name}"`, cause));
      };
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(name, SAVE_DB_VERSION);
      } catch (error) {
        fail(error);
        return;
      }
      request.onupgradeneeded = () => {
        // Version 1 is the only schema so far; later upgrades branch on the event's oldVersion.
        request.result.createObjectStore(SLOTS);
        request.result.createObjectStore(BLOBS);
      };
      request.onsuccess = () => {
        resolve(new IndexedDbSaveStore(request.result));
      };
      request.onerror = () => {
        fail(request.error);
      };
    });
  }

  /** Closes the connection; later operations fail with SaveStorageError. */
  close(): void {
    this.db.close();
  }

  async write(slot: string, bytes: Uint8Array): Promise<void> {
    const copy = bytes.slice();
    await this.transact(`write slot "${slot}"`, 'readwrite', (tx) => {
      tx.then(tx.slots.get(slot), (value) => {
        const record = slotRecordSchema.safeParse(value);
        const previous = record.success ? record.data.current : null;
        // Keep only the blob that becomes the backup; this also sweeps up any orphans.
        if (previous === null) {
          tx.blobs.delete(blobRange(slot, 0, Infinity));
        } else {
          tx.blobs.delete(blobRange(slot, 0, previous, false, true));
          tx.blobs.delete(blobRange(slot, previous, Infinity, true));
        }
        const generation = (previous ?? 0) + 1;
        tx.blobs.put(copy, [slot, generation]);
        tx.slots.put({ current: generation, backup: previous }, slot);
      });
    });
  }

  async read(slot: string, copy: SlotCopy = 'current'): Promise<SlotReadResult> {
    let result: SlotReadResult = { status: 'empty' };
    await this.transact(`read slot "${slot}"`, 'readonly', (tx) => {
      tx.then(tx.slots.get(slot), (value) => {
        if (value === undefined) return;
        const record = slotRecordSchema.safeParse(value);
        if (!record.success) {
          result = corrupt(`slot "${slot}" has a malformed record`);
          return;
        }
        const generation = record.data[copy];
        if (generation === null) return;
        tx.then(tx.blobs.get([slot, generation]), (blob) => {
          const what = `slot "${slot}" ${copy} copy (generation ${String(generation)})`;
          if (blob instanceof Uint8Array) result = { status: 'ok', bytes: blob, generation };
          else if (blob === undefined) result = corrupt(`${what} is missing`);
          else result = corrupt(`${what} is not save bytes`);
        });
      });
    });
    return result;
  }

  async list(): Promise<readonly string[]> {
    let slots: string[] = [];
    await this.transact('list slots', 'readonly', (tx) => {
      // IndexedDB returns keys in key order, which for strings is code-unit order like Array#sort.
      tx.then(tx.slots.getAllKeys(), (keys) => {
        slots = keys.filter((key) => typeof key === 'string');
      });
    });
    return slots;
  }

  async delete(slot: string): Promise<void> {
    await this.transact(`delete slot "${slot}"`, 'readwrite', (tx) => {
      tx.slots.delete(slot);
      tx.blobs.delete(blobRange(slot, 0, Infinity));
    });
  }

  /** Runs `body` in one transaction over both stores and waits for it to commit. */
  private transact(
    operation: string,
    mode: IDBTransactionMode,
    body: (tx: Tx) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const fail = (cause: unknown) => {
        reject(toSaveStoreError(operation, cause));
      };
      let raw: IDBTransaction;
      try {
        raw = this.db.transaction([SLOTS, BLOBS], mode);
      } catch (error) {
        fail(error);
        return;
      }
      const tx = new Tx(raw);
      raw.oncomplete = () => {
        resolve();
      };
      raw.onabort = () => {
        fail(
          tx.failure === undefined
            ? (raw.error ?? new DOMException('the transaction was aborted', 'AbortError'))
            : tx.failure.error,
        );
      };
      tx.guard(() => {
        body(tx);
      });
    });
  }
}
