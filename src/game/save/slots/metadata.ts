// What a slot shows before it is loaded (mw-e30.4): character, class, area, playtime and thumbnail.
// These live in the save envelope's free-form `metadata`, which `decodeSave` reads without a world,
// so a slot list never has to load a save to describe it. The envelope's savedAt and game version
// complete the picture. Metadata is display-only: a save whose metadata is missing or malformed
// still loads, it just lists without details.

import { z } from 'zod';
import {
  loadThumbnail,
  THUMBNAIL_MIME_TYPES,
  type SlotThumbnail,
  type StoredThumbnail,
} from './thumbnail';

/** Longest slot label a player can type, after trimming. */
export const SLOT_LABEL_MAX_LENGTH = 40;

/** What the game knows about the save being made; the slot manager adds playtime and thumbnail. */
export interface SlotDescription {
  /** The player character's name. */
  readonly characterName: string;
  /** Content id of the character's class, e.g. `knight`. The UI resolves the display name. */
  readonly classId: string;
  /** Content id of the area the save was made in, e.g. `testbed-arena`. */
  readonly areaId: string;
}

/** A slot's details as read back from its save. */
export interface SlotDetails extends SlotDescription {
  /** The player's name for the save, when they gave one (rename). */
  readonly label: string | undefined;
  /** Sim ticks played when the save was made. */
  readonly playtimeTicks: number;
  /** The tick rate those ticks ran at. */
  readonly tickRateHz: number;
  /** Whole seconds played: playtimeTicks / tickRateHz, rounded down. */
  readonly playtimeSeconds: number;
  /** The thumbnail, or null when the UI should draw its placeholder (capture failed or damaged). */
  readonly thumbnail: SlotThumbnail | null;
}

/** The metadata record as stored in the envelope. */
export interface StoredSlotMetadata extends SlotDescription {
  readonly label?: string;
  readonly playtimeTicks: number;
  readonly tickRateHz: number;
  readonly thumbnail: StoredThumbnail | null;
}

const storedThumbnailSchema = z.strictObject({
  mimeType: z.enum(THUMBNAIL_MIME_TYPES),
  width: z.int().positive(),
  height: z.int().positive(),
  data: z.string(),
});

// Not strict: a newer build may add fields, and this build should still list the slot.
const slotMetadataSchema = z.object({
  characterName: z.string(),
  classId: z.string(),
  areaId: z.string(),
  label: z.string().optional(),
  playtimeTicks: z.int().nonnegative(),
  tickRateHz: z.int().positive(),
  thumbnail: storedThumbnailSchema.nullable(),
});

/** Reads slot details from envelope metadata; undefined when they are missing or malformed. */
export function readSlotDetails(
  metadata: Readonly<Record<string, unknown>>,
): SlotDetails | undefined {
  const parsed = slotMetadataSchema.safeParse(metadata);
  if (!parsed.success) return undefined;
  const { characterName, classId, areaId, label, playtimeTicks, tickRateHz, thumbnail } =
    parsed.data;
  return {
    characterName,
    classId,
    areaId,
    label,
    playtimeTicks,
    tickRateHz,
    playtimeSeconds: Math.floor(playtimeTicks / tickRateHz),
    thumbnail: thumbnail === null ? null : (loadThumbnail(thumbnail) ?? null),
  };
}

/**
 * Trims a player-typed label; an empty label means "no label".
 * @throws RangeError when longer than SLOT_LABEL_MAX_LENGTH after trimming.
 */
export function normalizeSlotLabel(label: string): string | undefined {
  const trimmed = label.trim();
  if (trimmed.length > SLOT_LABEL_MAX_LENGTH) {
    throw new RangeError(
      `slot label is ${String(trimmed.length)} characters; the limit is ${String(SLOT_LABEL_MAX_LENGTH)}`,
    );
  }
  return trimmed === '' ? undefined : trimmed;
}
