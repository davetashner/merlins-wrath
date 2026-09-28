// The damaged-save bug report (mw-e30.8): one JSON file naming the build and each damaged copy, with
// the raw bytes in base64 (or null when the store record itself was lost).
import { describe, expect, it } from 'vitest';
import { SaveCorruptError, SaveMigrationError } from '../format/index';
import { buildDamagedSaveReport, DAMAGED_SAVE_REPORT_KIND } from './report';

const build = { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' };

function decodeBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

describe('buildDamagedSaveReport', () => {
  it('AC-3: exports every damaged copy with its error and exact bytes', () => {
    // Larger than one base64 chunk, so the chunked encoding is exercised.
    const big = Uint8Array.from({ length: 0x8000 + 5 }, (_, i) => i % 256);
    const file = buildDamagedSaveReport(
      [
        {
          slot: 'manual-1',
          copy: 'current',
          error: new SaveCorruptError('bad checksum'),
          bytes: big,
        },
        {
          slot: 'auto-2',
          copy: 'backup',
          error: new SaveMigrationError('vitals', 1, 2, new Error('boom')),
          bytes: undefined,
        },
      ],
      build,
      1_790_000_000_000,
    );
    expect(file.fileName).toBe('vesper-bell-damaged-saves-1790000000000.json');
    expect(file.mimeType).toBe('application/json');
    const report = JSON.parse(new TextDecoder().decode(file.bytes)) as {
      kind: string;
      version: number;
      exportedAt: number;
      build: unknown;
      copies: {
        slot: string;
        copy: string;
        errorKind: string;
        error: string;
        byteLength: number | null;
        bytesBase64: string | null;
      }[];
    };
    expect(report).toMatchObject({ kind: DAMAGED_SAVE_REPORT_KIND, version: 1, build });
    expect(report.exportedAt).toBe(1_790_000_000_000);
    const [first, second] = report.copies;
    expect(first).toMatchObject({
      slot: 'manual-1',
      copy: 'current',
      errorKind: 'corrupt',
      error: 'save is corrupt: bad checksum',
      byteLength: big.length,
    });
    expect(decodeBase64(first?.bytesBase64 ?? '')).toEqual(big);
    expect(second).toEqual({
      slot: 'auto-2',
      copy: 'backup',
      errorKind: 'migration-failed',
      error: 'section "vitals" migration v1 → v2 threw: Error: boom',
      byteLength: null,
      bytesBase64: null,
    });
  });
});
