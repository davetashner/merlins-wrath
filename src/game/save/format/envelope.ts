// The save envelope and its byte layout (mw-e30.1). A save file is a 12-byte header followed by a
// body in the sim's canonical encoding:
//
//   0  "VBSV" magic (Vesper Bell SaVe)
//   4  u16 formatVersion      — this byte layout plus the canonical encoding version
//   6  u16 saveSchemaVersion  — the envelope's field set (section data is versioned per section)
//   8  u32 checksum           — xxHash32 of the body bytes
//  12  body: canonical encoding of { buildSha, contentHash, createdAtTick, gameVersion, metadata,
//      sections, wallClockSavedAt }
//
// Both versions sit in the fixed header so a save from a newer build is refused before any of its
// body is parsed, and the checksum is verified over the raw body before decoding, so damaged bytes
// are never interpreted. All numbers are big-endian, like the canonical encoding.

import { encodeCanonical, xxHash32 } from '@sim/index';
import { z } from 'zod';
import { decodeCanonical } from './codec';
import { SaveCorruptError, SaveFromNewerBuildError, MissingMigrationError } from './errors';
import type { SectionRecord } from './section';

/** Version of the header + canonical body byte layout this build reads and writes. */
export const SAVE_FORMAT_VERSION = 1;

/** Version of the envelope field set this build reads and writes. */
export const SAVE_SCHEMA_VERSION = 1;

const MAGIC = [0x56, 0x42, 0x53, 0x56]; // "VBSV"
const HEADER_BYTES = 12;

/** Where and what built a save; recorded for diagnostics and compatibility checks. */
export interface BuildInfo {
  /** Release version, e.g. `0.3.0`. */
  readonly gameVersion: string;
  /** Git commit the build came from. */
  readonly buildSha: string;
  /** Fingerprint of the loaded content (see `@content` hash). */
  readonly contentHash: string;
}

/** Everything a save carries, as decoded. */
export interface SaveEnvelope extends BuildInfo {
  readonly formatVersion: number;
  readonly saveSchemaVersion: number;
  /** Sim tick the save was taken at. */
  readonly createdAtTick: number;
  /** Wall-clock milliseconds since the Unix epoch, injected by the caller (never read here). */
  readonly wallClockSavedAt: number;
  /** Free-form plain data for slot lists (character, area, playtime…). */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Section id → stored version and data. */
  readonly sections: Readonly<Record<string, SectionRecord>>;
  /** xxHash32 of the body bytes, 8 lowercase hex digits. */
  readonly checksum: string;
}

/** The envelope fields stored in the body (versions and checksum live in the header). */
export type SaveBody = Omit<SaveEnvelope, 'formatVersion' | 'saveSchemaVersion' | 'checksum'>;

const bodySchema = z.strictObject({
  gameVersion: z.string(),
  buildSha: z.string(),
  contentHash: z.string(),
  createdAtTick: z.int().nonnegative(),
  wallClockSavedAt: z.number(),
  metadata: z.record(z.string(), z.unknown()),
  sections: z.record(
    z.string(),
    z.strictObject({ version: z.int().positive(), data: z.unknown() }),
  ),
});

const hex = (n: number): string => n.toString(16).padStart(8, '0');

/**
 * Encodes a save: header plus canonical body.
 * @throws CanonicalEncodingError when metadata or section data holds a value with no canonical form.
 */
export function encodeSave(body: SaveBody): Uint8Array {
  const encoded = encodeCanonical({
    buildSha: body.buildSha,
    contentHash: body.contentHash,
    createdAtTick: body.createdAtTick,
    gameVersion: body.gameVersion,
    metadata: body.metadata,
    sections: body.sections,
    wallClockSavedAt: body.wallClockSavedAt,
  });
  const bytes = new Uint8Array(HEADER_BYTES + encoded.length);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC);
  view.setUint16(4, SAVE_FORMAT_VERSION);
  view.setUint16(6, SAVE_SCHEMA_VERSION);
  view.setUint32(8, xxHash32(encoded));
  bytes.set(encoded, HEADER_BYTES);
  return bytes;
}

/** Outcome of decoding a save's bytes. */
export type DecodeSaveResult =
  | { readonly ok: true; readonly envelope: SaveEnvelope }
  | {
      readonly ok: false;
      readonly error: SaveCorruptError | SaveFromNewerBuildError | MissingMigrationError;
    };

const corrupt = (reason: string): DecodeSaveResult => ({
  ok: false,
  error: new SaveCorruptError(reason),
});

/**
 * Checks and decodes a save without touching any world: magic, versions (refusing newer builds before
 * parsing), checksum, then the body. Section data is returned as stored, before migration. Slot lists
 * use this to read metadata cheaply.
 */
export function decodeSave(bytes: Uint8Array): DecodeSaveResult {
  if (bytes.length < HEADER_BYTES) return corrupt('shorter than the save header');
  if (MAGIC.some((byte, i) => bytes[i] !== byte)) return corrupt('not a Vesper Bell save');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const formatVersion = view.getUint16(4);
  const saveSchemaVersion = view.getUint16(6);
  if (formatVersion > SAVE_FORMAT_VERSION) {
    return {
      ok: false,
      error: new SaveFromNewerBuildError('format', formatVersion, SAVE_FORMAT_VERSION),
    };
  }
  if (formatVersion < SAVE_FORMAT_VERSION) {
    return corrupt(`unknown format version ${String(formatVersion)}`);
  }
  if (saveSchemaVersion > SAVE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: new SaveFromNewerBuildError('schema', saveSchemaVersion, SAVE_SCHEMA_VERSION),
    };
  }
  if (saveSchemaVersion < SAVE_SCHEMA_VERSION) {
    // Envelope migrations go here when SAVE_SCHEMA_VERSION first moves past 1.
    return {
      ok: false,
      error: new MissingMigrationError('envelope', saveSchemaVersion, saveSchemaVersion + 1),
    };
  }
  const body = bytes.subarray(HEADER_BYTES);
  const checksum = view.getUint32(8);
  const actual = xxHash32(body);
  if (actual !== checksum) {
    return corrupt(`checksum ${hex(actual)} does not match header ${hex(checksum)}`);
  }
  let decoded: unknown;
  try {
    decoded = decodeCanonical(body);
  } catch (error) {
    // Includes engine errors such as stack exhaustion from absurdly deep nesting.
    return corrupt(String(error));
  }
  const parsed = bodySchema.safeParse(decoded);
  if (!parsed.success) {
    const issue = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return corrupt(`malformed body: ${issue}`);
  }
  return {
    ok: true,
    envelope: {
      formatVersion,
      saveSchemaVersion,
      ...parsed.data,
      checksum: hex(checksum),
    },
  };
}
