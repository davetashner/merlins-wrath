// Damaged-save bug report (mw-e30.8): when a save cannot be recovered, the player can export the
// damaged copies and attach them to a bug report. This builds the file's bytes; offering the download
// is the UI's job. It is a diagnostic bundle, not a save the game can import (general export/import is
// mw-e30.10): one JSON document naming the build, each copy's slot and error, and the raw stored
// bytes in base64 so the exact damage can be inspected.

import type { BuildInfo } from '../format/index';
import type { DamagedCopy } from './recovery';

/** Identifies the report format; bump `DAMAGED_SAVE_REPORT_VERSION` when its shape changes. */
export const DAMAGED_SAVE_REPORT_KIND = 'vesper-bell-damaged-saves';

/** Version of the report's JSON shape. */
export const DAMAGED_SAVE_REPORT_VERSION = 1;

/** A file ready for the UI to offer as a download. */
export interface DamagedSaveReportFile {
  /** Suggested file name, e.g. `vesper-bell-damaged-saves-1790000000000.json`. */
  readonly fileName: string;
  readonly mimeType: 'application/json';
  readonly bytes: Uint8Array;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a large save never exceeds the engine's argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Builds the bug-report file for `damaged` copies (from a recovery result or
 * `SaveRecovery.damagedSaves()`), written by `build` at `exportedAt` (wall-clock ms since the epoch).
 */
export function buildDamagedSaveReport(
  damaged: readonly DamagedCopy[],
  build: BuildInfo,
  exportedAt: number,
): DamagedSaveReportFile {
  const report = {
    kind: DAMAGED_SAVE_REPORT_KIND,
    version: DAMAGED_SAVE_REPORT_VERSION,
    exportedAt,
    build: {
      gameVersion: build.gameVersion,
      buildSha: build.buildSha,
      contentHash: build.contentHash,
    },
    copies: damaged.map(({ slot, copy, error, bytes }) => ({
      slot,
      copy,
      errorKind: error.kind,
      error: error.message,
      byteLength: bytes === undefined ? null : bytes.length,
      bytesBase64: bytes === undefined ? null : toBase64(bytes),
    })),
  };
  return {
    fileName: `${DAMAGED_SAVE_REPORT_KIND}-${String(exportedAt)}.json`,
    mimeType: 'application/json',
    bytes: new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`),
  };
}
