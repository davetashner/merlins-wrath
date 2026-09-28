// In-memory save store (mw-e30.2): the fallback when IndexedDB is unavailable (private mode, blocked
// storage). Saves last only until the page closes, so it reports `durable: false` and the game shows
// a "saves will not persist" warning while it is in use. Also the reference implementation the
// shared contract test holds the IndexedDB store to.

import type { SaveStore, SlotCopy, SlotReadResult } from './store';

interface Entry {
  readonly generation: number;
  readonly bytes: Uint8Array;
}

interface Slot {
  readonly current: Entry;
  readonly backup: Entry | undefined;
}

/** A SaveStore held in a Map; nothing survives a reload. */
export class MemorySaveStore implements SaveStore {
  readonly kind = 'memory';
  readonly durable = false;
  private readonly slots = new Map<string, Slot>();

  write(slot: string, bytes: Uint8Array): Promise<void> {
    const previous = this.slots.get(slot);
    const generation = previous === undefined ? 1 : previous.current.generation + 1;
    this.slots.set(slot, {
      current: { generation, bytes: bytes.slice() },
      backup: previous?.current,
    });
    return Promise.resolve();
  }

  read(slot: string, copy: SlotCopy = 'current'): Promise<SlotReadResult> {
    const entry = this.slots.get(slot)?.[copy];
    return Promise.resolve(
      entry === undefined
        ? { status: 'empty' }
        : { status: 'ok', bytes: entry.bytes.slice(), generation: entry.generation },
    );
  }

  list(): Promise<readonly string[]> {
    return Promise.resolve([...this.slots.keys()].sort());
  }

  delete(slot: string): Promise<void> {
    this.slots.delete(slot);
    return Promise.resolve();
  }
}
