// Corruption recovery (mw-e30.8): the load path the Continue / Load screens (mw-e30.11) use instead
// of `SaveSlots.load`. When a slot's save cannot be loaded it falls back, in order, to the slot's
// backup (loaded automatically, and the result says so and how old it is), then to the most recent
// loadable save in any other slot (offered, never loaded without the player accepting), and finally
// reports that nothing could be recovered so the UI can start a new game. It is strictly read-only:
// damaged copies stay where they are until the player overwrites or deletes the slot, and every
// result carries them (with their bytes) so the UI can offer a bug-report export. A save from a newer
// build is not damage — the next build can read it — so it is never auto-replaced or counted as
// damaged. Every failure is reported to an optional local telemetry sink with enumerated fields only.
// Results carry message keys and parameters, never display strings; the UI layer renders them.

import type { World } from '@sim/index';
import {
  decodeSave,
  type LoadSaveResult,
  type SaveEnvelope,
  type SaveFromNewerBuildError,
  type SaveLoadError,
  type SaveRegistry,
} from '../format/index';
import { ALL_SLOTS, isSlotId, type SlotId } from '../slots/ids';
import { readSlotDetails, type SlotDetails } from '../slots/metadata';
import type { SaveStore, SlotCopy } from '../storage/index';

/** What recovery needs; the same store, registry and clock the SaveSlots manager uses. */
export interface SaveRecoveryOptions {
  readonly store: SaveStore;
  /** Usually `createGameSaveRegistry()`. */
  readonly registry: SaveRegistry;
  /** Wall-clock milliseconds since the Unix epoch, for a restored save's age; injected for tests. */
  readonly now: () => number;
  /**
   * Local telemetry sink (mw-e34 adapts it to its event store). Called for every copy that fails to
   * load and for every recovery outcome. Exceptions it throws are swallowed: logging never breaks a
   * load.
   */
  readonly telemetry?: (event: SaveRecoveryEvent) => void;
}

/** One stored copy of one slot. */
export interface SaveCopyRef {
  readonly slot: SlotId;
  readonly copy: SlotCopy;
}

/** A copy this build cannot load for a reason other than coming from a newer build. */
export interface DamagedCopy extends SaveCopyRef {
  readonly error: SaveLoadError;
  /** The stored bytes, for a bug-report export; undefined when the store record itself is damaged. */
  readonly bytes: Uint8Array | undefined;
}

/** A loadable save recovery restored or offers. */
export interface RecoveryCandidate extends SaveCopyRef {
  /** Wall-clock milliseconds since the Unix epoch when it was saved. */
  readonly savedAt: number;
  /** How long before now it was saved, in milliseconds (0 if the clock says it is in the future). */
  readonly ageMs: number;
  /** Release that wrote it. */
  readonly gameVersion: string;
  /** Character, area, playtime and thumbnail for the offer dialog; undefined without slot metadata. */
  readonly details: SlotDetails | undefined;
}

/** What the UI should tell the player; `key` selects the string, `params` fill it. */
export type RecoveryMessage =
  /** "Your save was damaged; restored the backup from <savedAt> (<ageMs> ago)." */
  | {
      readonly key: 'save.recovery.restored-backup';
      readonly params: { readonly slot: SlotId; readonly savedAt: number; readonly ageMs: number };
    }
  /** "Your save was damaged; loaded <from> from <savedAt> (<ageMs> ago) instead." */
  | {
      readonly key: 'save.recovery.restored-other';
      readonly params: {
        readonly slot: SlotId;
        readonly from: SaveCopyRef;
        readonly savedAt: number;
        readonly ageMs: number;
      };
    }
  /** "This save and its backup are damaged. Load <candidate> from <savedAt> instead?" */
  | {
      readonly key: 'save.recovery.offer-other';
      readonly params: { readonly slot: SlotId; readonly candidate: RecoveryCandidate };
    }
  /** "No save could be recovered. Start a new game? You can export the damaged saves for a report." */
  | {
      readonly key: 'save.recovery.unrecoverable';
      readonly params: { readonly slot: SlotId; readonly damagedCount: number };
    }
  /** "This save needs a newer version of the game; update to continue it. It has not been changed." */
  | {
      readonly key: 'save.recovery.newer-build';
      readonly params: {
        readonly slot: SlotId;
        readonly error: SaveFromNewerBuildError;
        /** The most recent save this build can load instead, if any. */
        readonly candidate: RecoveryCandidate | undefined;
      };
    };

type Loaded = Extract<LoadSaveResult, { ok: true }>;

/** Outcome of loading a slot with recovery. On every outcome but loaded/restored the world is untouched. */
export type RecoveryLoadResult =
  /** The slot's current save loaded; nothing to tell the player. */
  | ({ readonly status: 'loaded'; readonly slot: SlotId } & Loaded)
  | { readonly status: 'empty'; readonly slot: SlotId }
  /** An older save was loaded in place of the damaged one; show `message`. */
  | ({
      readonly status: 'restored';
      readonly slot: SlotId;
      readonly from: RecoveryCandidate;
      readonly damaged: readonly DamagedCopy[];
      readonly message: Extract<
        RecoveryMessage,
        { key: 'save.recovery.restored-backup' | 'save.recovery.restored-other' }
      >;
    } & Loaded)
  /** The slot and its backup are damaged; ask the player, then `accept` or start over. */
  | {
      readonly status: 'offer';
      readonly slot: SlotId;
      readonly candidate: RecoveryCandidate;
      readonly damaged: readonly DamagedCopy[];
      readonly message: Extract<RecoveryMessage, { key: 'save.recovery.offer-other' }>;
    }
  /** Nothing loadable is left: offer a new game and the damaged-save export. */
  | {
      readonly status: 'unrecoverable';
      readonly slot: SlotId;
      readonly damaged: readonly DamagedCopy[];
      readonly message: Extract<RecoveryMessage, { key: 'save.recovery.unrecoverable' }>;
    }
  /** The slot's save is from a newer build: intact, never discarded; `candidate` may be offered. */
  | {
      readonly status: 'newer-build';
      readonly slot: SlotId;
      readonly error: SaveFromNewerBuildError;
      readonly candidate: RecoveryCandidate | undefined;
      readonly damaged: readonly DamagedCopy[];
      readonly message: Extract<RecoveryMessage, { key: 'save.recovery.newer-build' }>;
    };

/** A result offering another save, as `accept` takes it. */
export type RecoveryOffer =
  | Extract<RecoveryLoadResult, { status: 'offer' }>
  | (Extract<RecoveryLoadResult, { status: 'newer-build' }> & {
      readonly candidate: RecoveryCandidate;
    });

/** Local telemetry events; enumerated ids and numbers only, no free text. */
export type SaveRecoveryEvent =
  | {
      readonly type: 'save.load-failed';
      readonly slot: SlotId;
      readonly copy: SlotCopy;
      readonly errorKind: SaveLoadError['kind'];
      /** The section at fault, when the error names one. */
      readonly section: string | undefined;
      /** The failing migration step, for migration errors. */
      readonly step: { readonly from: number; readonly to: number } | undefined;
    }
  | { readonly type: 'save.recovered'; readonly slot: SlotId; readonly from: SaveCopyRef }
  | { readonly type: 'save.recovery-offered'; readonly slot: SlotId; readonly offered: SaveCopyRef }
  | { readonly type: 'save.unrecoverable'; readonly slot: SlotId; readonly damagedCount: number };

const COPIES: readonly SlotCopy[] = ['current', 'backup'];

const keyOf = (ref: SaveCopyRef): string => `${ref.slot}/${ref.copy}`;

type Attempt =
  | { readonly status: 'empty' }
  | { readonly status: 'failed'; readonly error: SaveLoadError }
  | { readonly status: 'loaded'; readonly result: Loaded };

interface Decoded {
  readonly ref: SaveCopyRef;
  readonly bytes: Uint8Array;
  readonly envelope: SaveEnvelope;
}

/** Loads slots with the backup → other-save → new-game fallback chain. */
export class SaveRecovery {
  constructor(private readonly options: SaveRecoveryOptions) {}

  /**
   * Loads `slot` into `world`, recovering from damage: the current copy, else the backup (loaded,
   * with a `restored` message), else the most recent loadable save elsewhere (offered), else
   * `unrecoverable`. A save from a newer build is reported as `newer-build` and not replaced.
   * @throws RangeError for an unknown slot; SaveStorageError when storage itself fails.
   */
  async load(slot: SlotId, world: World): Promise<RecoveryLoadResult> {
    const id: string = slot;
    if (!isSlotId(id)) throw new RangeError(`"${id}" is not a save slot`);
    const damaged: DamagedCopy[] = [];
    const current = await this.attempt({ slot, copy: 'current' }, world, damaged);
    if (current.status === 'empty') return { status: 'empty', slot };
    if (current.status === 'loaded') return { status: 'loaded', slot, ...current.result };
    const exclude = new Set([keyOf({ slot, copy: 'current' })]);
    if (current.error.kind === 'newer-build') {
      const candidate = await this.search(exclude, damaged);
      return this.newerBuild(slot, current.error, candidate, damaged);
    }
    const backupRef: SaveCopyRef = { slot, copy: 'backup' };
    const backup = await this.attempt(backupRef, world, damaged);
    if (backup.status === 'loaded') return this.restored(slot, backupRef, backup.result, damaged);
    exclude.add(keyOf(backupRef));
    return this.offerOrGiveUp(slot, await this.search(exclude, damaged), damaged);
  }

  /**
   * Loads the save an `offer` (or a `newer-build` result with a candidate) proposed, once the player
   * accepted. If that save fails too, the search continues and the next offer (or `unrecoverable`,
   * or `newer-build` without a candidate) is returned.
   * @throws SaveStorageError when storage itself fails.
   */
  async accept(offer: RecoveryOffer, world: World): Promise<RecoveryLoadResult> {
    const { slot, candidate } = offer;
    const damaged = [...offer.damaged];
    const attempt = await this.attempt(candidate, world, damaged);
    if (attempt.status === 'loaded') return this.restored(slot, candidate, attempt.result, damaged);
    const exclude = new Set([keyOf({ slot, copy: 'current' }), keyOf(candidate)]);
    for (const copy of damaged) exclude.add(keyOf(copy));
    const next = await this.search(exclude, damaged);
    if (offer.status === 'newer-build') return this.newerBuild(slot, offer.error, next, damaged);
    return this.offerOrGiveUp(slot, next, damaged);
  }

  /**
   * Every stored copy, in any slot, that this build cannot load because it is damaged (not merely
   * newer) — for the load screen's "export damaged saves". Does not load anything into a world.
   * @throws SaveStorageError when storage itself fails.
   */
  async damagedSaves(): Promise<DamagedCopy[]> {
    const damaged: DamagedCopy[] = [];
    for (const decoded of await this.scan(new Set(), damaged)) {
      const checked = this.options.registry.check(decoded.bytes);
      if (!checked.ok) this.fail(decoded.ref, checked.error, decoded.bytes, damaged);
    }
    return damaged;
  }

  /** Reads and loads one copy; a failure is logged and, unless newer-build, recorded as damaged. */
  private async attempt(ref: SaveCopyRef, world: World, damaged: DamagedCopy[]): Promise<Attempt> {
    const read = await this.options.store.read(ref.slot, ref.copy);
    if (read.status === 'empty') return { status: 'empty' };
    if (read.status === 'corrupt') return this.fail(ref, read.error, undefined, damaged);
    const result = this.options.registry.read(world, read.bytes);
    if (!result.ok) return this.fail(ref, result.error, read.bytes, damaged);
    return { status: 'loaded', result };
  }

  /** Every non-excluded stored copy that decodes, most recently saved first. */
  private async scan(exclude: ReadonlySet<string>, damaged: DamagedCopy[]): Promise<Decoded[]> {
    const decoded: Decoded[] = [];
    for (const slot of ALL_SLOTS) {
      for (const copy of COPIES) {
        const ref: SaveCopyRef = { slot, copy };
        if (exclude.has(keyOf(ref))) continue;
        const read = await this.options.store.read(slot, copy);
        if (read.status === 'empty') continue;
        if (read.status === 'corrupt') {
          this.fail(ref, read.error, undefined, damaged);
          continue;
        }
        const result = decodeSave(read.bytes);
        if (result.ok) decoded.push({ ref, bytes: read.bytes, envelope: result.envelope });
        else this.fail(ref, result.error, read.bytes, damaged);
      }
    }
    // Stable sort: equal times keep slot-list order, current before backup.
    return decoded.sort((a, b) => b.envelope.wallClockSavedAt - a.envelope.wallClockSavedAt);
  }

  /** The most recent non-excluded copy that passes a full check (decode, migrate, validate). */
  private async search(
    exclude: ReadonlySet<string>,
    damaged: DamagedCopy[],
  ): Promise<RecoveryCandidate | undefined> {
    for (const decoded of await this.scan(exclude, damaged)) {
      const checked = this.options.registry.check(decoded.bytes);
      if (checked.ok) return this.candidate(decoded.ref, checked.envelope);
      this.fail(decoded.ref, checked.error, decoded.bytes, damaged);
    }
    return undefined;
  }

  private fail(
    ref: SaveCopyRef,
    error: SaveLoadError,
    bytes: Uint8Array | undefined,
    damaged: DamagedCopy[],
  ): Attempt {
    const step =
      error.kind === 'migration-failed' || error.kind === 'missing-migration'
        ? { from: error.from, to: error.to }
        : undefined;
    this.emit({
      type: 'save.load-failed',
      slot: ref.slot,
      copy: ref.copy,
      errorKind: error.kind,
      section: 'section' in error ? error.section : undefined,
      step,
    });
    if (error.kind !== 'newer-build') damaged.push({ ...ref, error, bytes });
    return { status: 'failed', error };
  }

  private candidate(ref: SaveCopyRef, envelope: SaveEnvelope): RecoveryCandidate {
    return {
      ...ref,
      savedAt: envelope.wallClockSavedAt,
      ageMs: Math.max(0, this.options.now() - envelope.wallClockSavedAt),
      gameVersion: envelope.gameVersion,
      details: readSlotDetails(envelope.metadata),
    };
  }

  private restored(
    slot: SlotId,
    ref: SaveCopyRef,
    result: Loaded,
    damaged: readonly DamagedCopy[],
  ): RecoveryLoadResult {
    const from = this.candidate(ref, result.envelope);
    this.emit({ type: 'save.recovered', slot, from: { slot: ref.slot, copy: ref.copy } });
    const { savedAt, ageMs } = from;
    const message =
      ref.slot === slot && ref.copy === 'backup'
        ? ({ key: 'save.recovery.restored-backup', params: { slot, savedAt, ageMs } } as const)
        : ({
            key: 'save.recovery.restored-other',
            params: { slot, from: { slot: ref.slot, copy: ref.copy }, savedAt, ageMs },
          } as const);
    return { status: 'restored', slot, from, damaged, message, ...result };
  }

  private offerOrGiveUp(
    slot: SlotId,
    candidate: RecoveryCandidate | undefined,
    damaged: readonly DamagedCopy[],
  ): RecoveryLoadResult {
    if (candidate === undefined) {
      this.emit({ type: 'save.unrecoverable', slot, damagedCount: damaged.length });
      return {
        status: 'unrecoverable',
        slot,
        damaged,
        message: {
          key: 'save.recovery.unrecoverable',
          params: { slot, damagedCount: damaged.length },
        },
      };
    }
    this.emit({
      type: 'save.recovery-offered',
      slot,
      offered: { slot: candidate.slot, copy: candidate.copy },
    });
    return {
      status: 'offer',
      slot,
      candidate,
      damaged,
      message: { key: 'save.recovery.offer-other', params: { slot, candidate } },
    };
  }

  private newerBuild(
    slot: SlotId,
    error: SaveFromNewerBuildError,
    candidate: RecoveryCandidate | undefined,
    damaged: readonly DamagedCopy[],
  ): RecoveryLoadResult {
    return {
      status: 'newer-build',
      slot,
      error,
      candidate,
      damaged,
      message: { key: 'save.recovery.newer-build', params: { slot, error, candidate } },
    };
  }

  private emit(event: SaveRecoveryEvent): void {
    try {
      this.options.telemetry?.(event);
    } catch {
      // Telemetry is best-effort; a broken sink must never turn a recovery into a crash.
    }
  }
}
