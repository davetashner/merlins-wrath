// SaveRecovery rules (mw-e30.8) over the in-memory store: failed migrations take the recovery chain
// and are logged (AC-4), newer-build saves are never treated as damage, offers that fail on accept
// move on to the next save, telemetry never breaks a load, and damaged copies are reported with their
// bytes. The IndexedDB end-to-end chain (AC-1–AC-3) is in recovery.integration.test.ts.
import { World } from '@sim/index';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SaveCorruptError, SaveRegistry, type SaveSection } from '../format/index';
import type { SlotId } from '../slots/ids';
import { MemorySaveStore, type SaveStore } from '../storage/index';
import {
  SaveRecovery,
  type RecoveryLoadResult,
  type RecoveryOffer,
  type SaveRecoveryEvent,
} from './recovery';

const build = { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' };
const NOW = 1_790_000_000_000;

interface Vitals {
  hp: number;
}

// A section whose apply fails for hp 13: such saves pass `check` but fail to load.
const vitals: SaveSection<Vitals> = {
  id: 'vitals',
  version: 1,
  schema: z.strictObject({ hp: z.number() }),
  serialize: (world) => ({ hp: world.tick }),
  deserialize: (_world, data) => {
    if (data.hp === 13) throw new Error('unlucky hp');
  },
};

const v1 = () => new SaveRegistry().register(vitals);
const throwingV2 = () =>
  new SaveRegistry().register({
    ...vitals,
    version: 2,
    migrations: {
      1: () => {
        throw new Error('bad step');
      },
    },
  });
const validV2 = () =>
  new SaveRegistry().register({ ...vitals, version: 2, migrations: { 1: (d) => d } });

function world(tick = 0): World {
  const w = new World({ seed: 1 });
  w.restore({ ...w.snapshot(), clock: { tick, hz: 60 } });
  return w;
}

/** Save bytes for a world at `tick` (hp = tick), saved at `savedAt`. */
const bytes = (tick: number, savedAt: number, registry = v1()) =>
  registry.write(world(tick), { build, wallClockSavedAt: savedAt });

/** Flips one body byte so the checksum no longer matches. */
function damage(save: Uint8Array): Uint8Array {
  const copy = save.slice();
  copy[copy.length - 1] = (copy[copy.length - 1] ?? 0) ^ 0xff;
  return copy;
}

/** Marks a save as written by a newer byte format. */
function newer(save: Uint8Array): Uint8Array {
  const copy = save.slice();
  copy[5] = 2;
  return copy;
}

function recovery(
  store: SaveStore,
  options: { registry?: SaveRegistry; now?: number; events?: SaveRecoveryEvent[] } = {},
) {
  const { events } = options;
  return new SaveRecovery({
    store,
    registry: options.registry ?? v1(),
    now: () => options.now ?? NOW,
    ...(events === undefined ? {} : { telemetry: (event) => void events.push(event) }),
  });
}

async function fill(store: MemorySaveStore, writes: [SlotId, Uint8Array][]) {
  for (const [slot, save] of writes) await store.write(slot, save);
}

function expectStatus<S extends RecoveryLoadResult['status']>(
  result: RecoveryLoadResult,
  status: S,
): Extract<RecoveryLoadResult, { status: S }> {
  expect(result.status).toBe(status);
  return result as Extract<RecoveryLoadResult, { status: S }>;
}

/** The result as an offer `accept` takes; fails the test when it offers nothing. */
function offerOf(result: RecoveryLoadResult): RecoveryOffer {
  if (result.status === 'offer') return result;
  if (result.status === 'newer-build' && result.candidate !== undefined) {
    return { ...result, candidate: result.candidate };
  }
  throw new Error(`expected an offer, got ${result.status}`);
}

describe('SaveRecovery', () => {
  it('loads an intact current save with nothing to report', async () => {
    const store = new MemorySaveStore();
    await store.write('manual-1', bytes(40, NOW - 1_000));
    const events: SaveRecoveryEvent[] = [];
    const target = world();
    const result = await recovery(store, { events }).load('manual-1', target);
    expect(result).toMatchObject({ status: 'loaded', slot: 'manual-1', warnings: [] });
    expect(target.tick).toBe(40);
    expect(events).toEqual([]);
  });

  it('reports an empty slot and refuses unknown slots', async () => {
    const r = recovery(new MemorySaveStore());
    expect(await r.load('quick', world())).toEqual({ status: 'empty', slot: 'quick' });
    await expect(r.load('manual-0', world())).rejects.toThrow('"manual-0" is not a save slot');
  });

  it('AC-4: a migration that throws is treated like corruption and logged to local telemetry', async () => {
    const store = new MemorySaveStore();
    // The backup was written by this build; the current copy by an old build whose data the
    // (buggy) 1 → 2 migration cannot upgrade.
    await fill(store, [
      ['manual-1', bytes(10, NOW - 60_000, throwingV2())],
      ['manual-1', bytes(20, NOW - 5_000)],
    ]);
    const events: SaveRecoveryEvent[] = [];
    const target = world();
    const result = expectStatus(
      await recovery(store, { registry: throwingV2(), events }).load('manual-1', target),
      'restored',
    );
    expect(target.tick).toBe(10);
    expect(result.damaged).toMatchObject([
      { slot: 'manual-1', copy: 'current', error: { kind: 'migration-failed', section: 'vitals' } },
    ]);
    expect(result.message).toEqual({
      key: 'save.recovery.restored-backup',
      params: { slot: 'manual-1', savedAt: NOW - 60_000, ageMs: 60_000 },
    });
    expect(events).toEqual([
      {
        type: 'save.load-failed',
        slot: 'manual-1',
        copy: 'current',
        errorKind: 'migration-failed',
        section: 'vitals',
        step: { from: 1, to: 2 },
      },
      { type: 'save.recovered', slot: 'manual-1', from: { slot: 'manual-1', copy: 'backup' } },
    ]);
  });

  it('AC-4: a missing migration step is also treated like corruption, in any slot, and logged', async () => {
    const store = new MemorySaveStore();
    const gap = new SaveRegistry().register({ ...vitals, version: 3, migrations: { 2: (d) => d } });
    await fill(store, [
      ['auto-1', bytes(5, NOW - 1)],
      ['manual-5', bytes(6, NOW - 2)],
    ]);
    const events: SaveRecoveryEvent[] = [];
    const result = expectStatus(
      await recovery(store, { registry: gap, events }).load('auto-1', world()),
      'unrecoverable',
    );
    expect(result.damaged.map((d) => `${d.slot}/${d.error.kind}`)).toEqual([
      'auto-1/missing-migration',
      'manual-5/missing-migration',
    ]);
    expect(events).toEqual([
      expect.objectContaining({ slot: 'auto-1', step: { from: 1, to: 2 } }),
      expect.objectContaining({ slot: 'manual-5', errorKind: 'missing-migration' }),
      { type: 'save.unrecoverable', slot: 'auto-1', damagedCount: 2 },
    ]);
  });

  it('never treats a save from a newer build as damage, offering the latest loadable save instead', async () => {
    const store = new MemorySaveStore();
    await fill(store, [
      ['manual-1', bytes(1, NOW - 9_000)],
      ['manual-1', newer(bytes(2, NOW - 1_000))],
      ['manual-2', bytes(3, NOW - 4_000)],
    ]);
    const events: SaveRecoveryEvent[] = [];
    const r = recovery(store, { events });
    const target = world(77);
    const result = expectStatus(await r.load('manual-1', target), 'newer-build');
    expect(target.tick).toBe(77);
    expect(result.damaged).toEqual([]);
    expect(result.error).toMatchObject({ kind: 'newer-build', part: 'format', found: 2 });
    expect(result.candidate).toMatchObject({ slot: 'manual-2', copy: 'current', ageMs: 4_000 });
    expect(result.message).toEqual({
      key: 'save.recovery.newer-build',
      params: { slot: 'manual-1', error: result.error, candidate: result.candidate },
    });
    expect(events).toEqual([
      expect.objectContaining({ type: 'save.load-failed', errorKind: 'newer-build' }),
    ]);

    // Accepting loads the other save; the newer-build copy is still stored, unchanged.
    const accepted = await r.accept(offerOf(result), target);
    expect(accepted).toMatchObject({
      status: 'restored',
      message: { key: 'save.recovery.restored-other', params: { from: { slot: 'manual-2' } } },
    });
    expect(target.tick).toBe(3);
    const kept = await store.read('manual-1');
    expect(kept.status === 'ok' && kept.generation).toBe(2);
  });

  it('reports a newer-build save with no alternative, and moves past an alternative that fails', async () => {
    const alone = new MemorySaveStore();
    await alone.write('quick', newer(bytes(2, NOW)));
    const none = expectStatus(await recovery(alone).load('quick', world()), 'newer-build');
    expect(none.candidate).toBeUndefined();

    const store = new MemorySaveStore();
    await fill(store, [
      ['quick', bytes(2, NOW - 500)],
      ['quick', newer(bytes(3, NOW))],
      ['manual-3', bytes(13, NOW - 10)], // passes the check, fails to apply
    ]);
    const r = recovery(store);
    const target = world(4);
    const offered = expectStatus(await r.load('quick', target), 'newer-build');
    expect(offered.candidate).toMatchObject({ slot: 'manual-3', copy: 'current' });
    const next = expectStatus(await r.accept(offerOf(offered), target), 'newer-build');
    expect(target.tick).toBe(4);
    expect(next.candidate).toMatchObject({ slot: 'quick', copy: 'backup', ageMs: 500 });
    expect(next.damaged).toMatchObject([{ slot: 'manual-3', error: { kind: 'apply-failed' } }]);
    expect(await r.accept(offerOf(next), target)).toMatchObject({
      status: 'restored',
      message: { key: 'save.recovery.restored-backup', params: { slot: 'quick', ageMs: 500 } },
    });
    expect(target.tick).toBe(2);
  });

  it('moves on to the next save when an accepted offer fails to load, then gives up', async () => {
    const store = new MemorySaveStore();
    await fill(store, [
      ['manual-1', damage(bytes(1, NOW - 100))],
      ['manual-1', damage(bytes(2, NOW - 50))],
      ['manual-2', bytes(13, NOW - 200)], // passes the check, fails to apply
      ['auto-1', bytes(9, NOW - 300)],
    ]);
    const events: SaveRecoveryEvent[] = [];
    const r = recovery(store, { events });
    const target = world(1);
    const first = expectStatus(await r.load('manual-1', target), 'offer');
    expect(first.candidate).toMatchObject({ slot: 'manual-2', savedAt: NOW - 200 });
    expect(first.damaged.map((d) => d.copy)).toEqual(['current', 'backup']);

    const second = expectStatus(await r.accept(first, target), 'offer');
    expect(target.tick).toBe(1);
    expect(second.candidate).toMatchObject({ slot: 'auto-1', copy: 'current' });
    expect(second.damaged.map((d) => `${d.slot}/${d.error.kind}`)).toEqual([
      'manual-1/corrupt',
      'manual-1/corrupt',
      'manual-2/apply-failed',
    ]);

    // The offered save disappears before the player accepts: nothing else is left.
    await store.delete('auto-1');
    const last = expectStatus(await r.accept(second, target), 'unrecoverable');
    expect(last.message).toEqual({
      key: 'save.recovery.unrecoverable',
      params: { slot: 'manual-1', damagedCount: 3 },
    });
    expect(events.map((e) => e.type)).toEqual([
      'save.load-failed',
      'save.load-failed',
      'save.recovery-offered',
      'save.load-failed',
      'save.recovery-offered',
      'save.unrecoverable',
    ]);
  });

  it('offers the most recent save across slots and both copies, current first on a tie', async () => {
    const store = new MemorySaveStore();
    await fill(store, [
      ['manual-1', damage(bytes(1, NOW))],
      ['manual-4', bytes(4, NOW - 30)],
      ['manual-4', bytes(5, NOW - 20)],
      ['auto-2', bytes(6, NOW - 10)],
      ['quick', bytes(7, NOW - 10)],
      ['auto-3', newer(bytes(8, NOW))],
    ]);
    const result = expectStatus(await recovery(store).load('manual-1', world()), 'offer');
    expect(result.candidate).toMatchObject({ slot: 'auto-2', copy: 'current', ageMs: 10 });
    // The newer-build autosave is skipped but never reported as damaged.
    expect(result.damaged.map((d) => d.slot)).toEqual(['manual-1']);
  });

  it('reports damaged store records without bytes and clamps a future save time to age 0', async () => {
    const memory = new MemorySaveStore();
    await memory.write('manual-2', bytes(3, NOW + 5_000));
    const corrupt = new SaveCorruptError('blob missing');
    const store: SaveStore = {
      kind: 'memory',
      durable: false,
      read: (slot, copy) =>
        slot === 'manual-1' || slot === 'auto-1'
          ? Promise.resolve({ status: 'corrupt', error: corrupt })
          : memory.read(slot, copy),
      list: () => memory.list(),
      write: (slot, b) => memory.write(slot, b),
      delete: (slot) => memory.delete(slot),
    };
    const result = expectStatus(await recovery(store).load('manual-1', world()), 'offer');
    expect(result.damaged).toEqual([
      { slot: 'manual-1', copy: 'current', error: corrupt, bytes: undefined },
      { slot: 'manual-1', copy: 'backup', error: corrupt, bytes: undefined },
      { slot: 'auto-1', copy: 'current', error: corrupt, bytes: undefined },
      { slot: 'auto-1', copy: 'backup', error: corrupt, bytes: undefined },
    ]);
    expect(result.candidate).toEqual({
      slot: 'manual-2',
      copy: 'current',
      savedAt: NOW + 5_000,
      ageMs: 0,
      gameVersion: '0.2.0',
      details: undefined,
    });
  });

  it('keeps loading when the telemetry sink throws', async () => {
    const store = new MemorySaveStore();
    await fill(store, [
      ['manual-1', bytes(1, NOW - 10)],
      ['manual-1', damage(bytes(2, NOW))],
    ]);
    const r = new SaveRecovery({
      store,
      registry: v1(),
      now: () => NOW,
      telemetry: () => {
        throw new Error('sink down');
      },
    });
    expect(await r.load('manual-1', world())).toMatchObject({ status: 'restored' });
  });

  it('lists every damaged copy across slots, but not intact or newer-build ones', async () => {
    const store = new MemorySaveStore();
    const damagedBytes = damage(bytes(2, NOW));
    await fill(store, [
      ['manual-1', bytes(1, NOW)],
      ['manual-1', damagedBytes],
      ['manual-2', bytes(3, NOW)],
      ['auto-1', newer(bytes(4, NOW))],
    ]);
    const damaged = await recovery(store, { registry: throwingV2() }).damagedSaves();
    expect(damaged.map((d) => `${d.slot}/${d.copy}/${d.error.kind}`)).toEqual([
      'manual-1/current/corrupt',
      'manual-1/backup/migration-failed',
      'manual-2/current/migration-failed',
    ]);
    expect(damaged[0]?.bytes).toEqual(damagedBytes);
    expect(await recovery(store, { registry: validV2() }).damagedSaves()).toHaveLength(1);
  });
});
