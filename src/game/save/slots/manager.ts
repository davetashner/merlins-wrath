// The save slot manager (mw-e30.4): the one API the save/load screens (mw-e30.11), autosave
// (mw-e30.5) and quicksave (mw-e30.6) use. It joins the section registry (what a save contains) to
// the SaveStore (where the bytes live) and owns the slot rules: a new manual save goes to the first
// free manual slot and, once all ten are full, the player must pick one to overwrite; overwriting an
// occupied slot and deleting one both need explicit confirmation; a failed thumbnail capture never
// fails a save. Storage failures (quota, blocked database) are thrown as the store's typed errors so
// the UI can show them; the slot keeps its previous save in that case.

import type { World } from '@sim/index';
import {
  decodeSave,
  encodeSave,
  type BuildInfo,
  type DecodeSaveResult,
  type LoadSaveResult,
  type SaveLoadError,
  type SaveRegistry,
  type SectionRecord,
} from '../format/index';
import type { SaveStore, SlotReadResult } from '../storage/index';
import { ALL_SLOTS, isSlotId, MANUAL_SLOTS, slotKind, type SlotId, type SlotKind } from './ids';
import {
  normalizeSlotLabel,
  readSlotDetails,
  type SlotDescription,
  type SlotDetails,
  type StoredSlotMetadata,
} from './metadata';
import {
  checkThumbnail,
  storeThumbnail,
  type StoredThumbnail,
  type ThumbnailCapture,
} from './thumbnail';

/** What the manager needs from the rest of the game. */
export interface SaveSlotsOptions {
  readonly store: SaveStore;
  /** Usually `createGameSaveRegistry()`. */
  readonly registry: SaveRegistry;
  readonly build: BuildInfo;
  /** Wall-clock milliseconds since the Unix epoch, for "saved at"; injected for tests. */
  readonly now: () => number;
}

/** What to save besides the world. */
export interface SaveSlotInput extends SlotDescription {
  /** The player's name for the save; trimmed, empty means none. */
  readonly label?: string;
  /** Captures the thumbnail; omitted or failing means a placeholder thumbnail. */
  readonly captureThumbnail?: ThumbnailCapture;
  /** Unknown sections from the load this save continues (`LoadSaveResult.unknownSections`). */
  readonly preserve?: Readonly<Record<string, SectionRecord>>;
}

/** Why a slot's save cannot be read (before any world is involved). */
export type UnreadableSlotError = Extract<DecodeSaveResult, { ok: false }>['error'];

/** A slot as a slot list shows it. */
export type SlotSummary =
  | { readonly state: 'empty'; readonly slot: SlotId; readonly kind: SlotKind }
  | ReadySlotSummary
  | {
      readonly state: 'unreadable';
      readonly slot: SlotId;
      readonly kind: SlotKind;
      readonly error: UnreadableSlotError;
    };

/** A slot holding a readable save. */
export interface ReadySlotSummary {
  readonly state: 'ready';
  readonly slot: SlotId;
  readonly kind: SlotKind;
  /** Wall-clock milliseconds since the Unix epoch. */
  readonly savedAt: number;
  /** Release that wrote the save. */
  readonly gameVersion: string;
  /** Undefined when the save carries no (or malformed) slot metadata; it still loads. */
  readonly details: SlotDetails | undefined;
}

/** Whether the save got a real thumbnail. */
export type ThumbnailOutcome =
  { readonly status: 'captured' } | { readonly status: 'placeholder'; readonly reason: string };

/** Outcome of a save request. */
export type SaveSlotOutcome =
  | {
      readonly status: 'saved';
      readonly slot: SlotId;
      readonly summary: ReadySlotSummary;
      readonly thumbnail: ThumbnailOutcome;
    }
  /** The slot is occupied: ask the player, then call `save` again with `overwrite: true`. */
  | { readonly status: 'confirm-overwrite'; readonly slot: SlotId }
  /** Every manual slot is full: the player must pick one of `candidates` to overwrite. */
  | { readonly status: 'choose-overwrite'; readonly candidates: readonly SlotId[] };

/** Outcome of loading a slot into a world. */
export type LoadSlotResult =
  | ({ readonly status: 'loaded'; readonly slot: SlotId } & Extract<LoadSaveResult, { ok: true }>)
  | { readonly status: 'empty'; readonly slot: SlotId }
  | { readonly status: 'failed'; readonly slot: SlotId; readonly error: SaveLoadError };

/** Outcome of a delete request. */
export type DeleteSlotOutcome =
  { readonly status: 'deleted' } | { readonly status: 'confirm-delete' };

/** Outcome of a rename. */
export type RenameSlotOutcome =
  | { readonly status: 'renamed'; readonly summary: ReadySlotSummary }
  | { readonly status: 'empty' }
  | { readonly status: 'failed'; readonly error: UnreadableSlotError };

function assertSlot(slot: string): asserts slot is SlotId {
  if (!isSlotId(slot)) throw new RangeError(`"${slot}" is not a save slot`);
}

async function captureThumbnail(
  capture: ThumbnailCapture | undefined,
): Promise<{ stored: StoredThumbnail | null; outcome: ThumbnailOutcome }> {
  const placeholder = (reason: string) => ({
    stored: null,
    outcome: { status: 'placeholder', reason } as const,
  });
  if (capture === undefined) return placeholder('no thumbnail capture was supplied');
  try {
    const thumbnail = await capture();
    const problem = checkThumbnail(thumbnail);
    if (problem !== undefined) return placeholder(`thumbnail rejected: ${problem}`);
    return { stored: storeThumbnail(thumbnail), outcome: { status: 'captured' } };
  } catch (error) {
    return placeholder(`thumbnail capture failed: ${String(error)}`);
  }
}

/** Manual slots, autosave ring and quicksave over one SaveStore. */
export class SaveSlots {
  constructor(private readonly options: SaveSlotsOptions) {}

  /**
   * Every slot in display order (manual, autosave, quicksave) with what it holds. Reads only the
   * envelopes, never a world.
   * @throws SaveStorageError when storage itself fails.
   */
  async list(): Promise<SlotSummary[]> {
    const { store } = this.options;
    return Promise.all(ALL_SLOTS.map(async (slot) => summarize(slot, await store.read(slot))));
  }

  /**
   * A new manual save: into the first empty manual slot, or, when all are full, a request to choose
   * one to overwrite (then call `save(chosen, …, { overwrite: true })`).
   * @throws as `save`.
   */
  async saveNew(world: World, input: SaveSlotInput): Promise<SaveSlotOutcome> {
    const used = new Set(await this.options.store.list());
    const free = MANUAL_SLOTS.find((slot) => !used.has(slot));
    if (free === undefined) return { status: 'choose-overwrite', candidates: MANUAL_SLOTS };
    return this.save(free, world, input, { overwrite: true });
  }

  /**
   * Saves `world` into `slot`. An occupied slot is only replaced with `overwrite: true` (after the
   * player confirmed, or for autosave/quicksave); otherwise nothing is written and confirmation is
   * requested. The replaced save becomes the slot's backup.
   * @throws RangeError for an unknown slot or an over-long label; SaveQuotaError / SaveStorageError
   *   when storage fails (the slot keeps its previous save); SaveSectionInvalidError /
   *   CanonicalEncodingError when a section serializes bad data.
   */
  async save(
    slot: SlotId,
    world: World,
    input: SaveSlotInput,
    options: { readonly overwrite?: boolean } = {},
  ): Promise<SaveSlotOutcome> {
    assertSlot(slot);
    const label = normalizeSlotLabel(input.label ?? '');
    if (options.overwrite !== true && (await this.options.store.list()).includes(slot)) {
      return { status: 'confirm-overwrite', slot };
    }
    const thumbnail = await captureThumbnail(input.captureThumbnail);
    const metadata: StoredSlotMetadata = {
      characterName: input.characterName,
      classId: input.classId,
      areaId: input.areaId,
      ...(label === undefined ? {} : { label }),
      playtimeTicks: world.tick,
      tickRateHz: world.clock.hz,
      thumbnail: thumbnail.stored,
    };
    const { build } = this.options;
    const savedAt = this.options.now();
    const bytes = this.options.registry.write(world, {
      build,
      wallClockSavedAt: savedAt,
      metadata: { ...metadata },
      preserve: input.preserve ?? {},
    });
    await this.options.store.write(slot, bytes);
    return {
      status: 'saved',
      slot,
      summary: ready(slot, savedAt, build.gameVersion, { ...metadata }),
      thumbnail: thumbnail.outcome,
    };
  }

  /**
   * Loads a slot's current save into `world`. On failure the world is untouched. The player-facing
   * load path is `SaveRecovery.load` (mw-e30.8), which falls back to the backup and other saves.
   * @throws RangeError for an unknown slot; SaveStorageError when storage itself fails.
   */
  async load(slot: SlotId, world: World): Promise<LoadSlotResult> {
    assertSlot(slot);
    const read = await this.options.store.read(slot);
    if (read.status === 'empty') return { status: 'empty', slot };
    if (read.status === 'corrupt') return { status: 'failed', slot, error: read.error };
    const result = this.options.registry.read(world, read.bytes);
    if (!result.ok) return { status: 'failed', slot, error: result.error };
    return { status: 'loaded', slot, ...result };
  }

  /**
   * Deletes a slot's save and its backup, once the player confirmed (`confirmed: true`); otherwise
   * nothing happens and confirmation is requested. Deleting an empty slot does nothing.
   * @throws RangeError for an unknown slot; SaveStorageError when storage itself fails.
   */
  async delete(
    slot: SlotId,
    options: { readonly confirmed?: boolean } = {},
  ): Promise<DeleteSlotOutcome> {
    assertSlot(slot);
    if (options.confirmed !== true) return { status: 'confirm-delete' };
    await this.options.store.delete(slot);
    return { status: 'deleted' };
  }

  /**
   * Sets (or, with an empty label, clears) the player's name for a slot. The save is rewritten with
   * only its label changed — same world, tick and saved-at — so the pre-rename copy becomes the
   * backup.
   * @throws RangeError for an unknown slot or an over-long label; SaveQuotaError / SaveStorageError
   *   when storage fails.
   */
  async rename(slot: SlotId, label: string): Promise<RenameSlotOutcome> {
    assertSlot(slot);
    const normalized = normalizeSlotLabel(label);
    const read = await this.options.store.read(slot);
    if (read.status === 'empty') return { status: 'empty' };
    if (read.status === 'corrupt') return { status: 'failed', error: read.error };
    const decoded = decodeSave(read.bytes);
    if (!decoded.ok) return { status: 'failed', error: decoded.error };
    const { envelope } = decoded;
    const metadata = Object.fromEntries(
      Object.entries(envelope.metadata).filter(([key]) => key !== 'label'),
    );
    if (normalized !== undefined) metadata['label'] = normalized;
    const bytes = encodeSave({
      gameVersion: envelope.gameVersion,
      buildSha: envelope.buildSha,
      contentHash: envelope.contentHash,
      createdAtTick: envelope.createdAtTick,
      wallClockSavedAt: envelope.wallClockSavedAt,
      metadata,
      sections: envelope.sections,
    });
    await this.options.store.write(slot, bytes);
    return {
      status: 'renamed',
      summary: ready(slot, envelope.wallClockSavedAt, envelope.gameVersion, metadata),
    };
  }
}

function summarize(slot: SlotId, read: SlotReadResult): SlotSummary {
  const kind = slotKind(slot);
  if (read.status === 'empty') return { state: 'empty', slot, kind };
  if (read.status === 'corrupt') return { state: 'unreadable', slot, kind, error: read.error };
  const decoded = decodeSave(read.bytes);
  if (!decoded.ok) return { state: 'unreadable', slot, kind, error: decoded.error };
  const { envelope } = decoded;
  return ready(slot, envelope.wallClockSavedAt, envelope.gameVersion, envelope.metadata);
}

function ready(
  slot: SlotId,
  savedAt: number,
  gameVersion: string,
  metadata: Readonly<Record<string, unknown>>,
): ReadySlotSummary {
  return {
    state: 'ready',
    slot,
    kind: slotKind(slot),
    savedAt,
    gameVersion,
    details: readSlotDetails(metadata),
  };
}
