// The byte layout: header checks happen before parsing, the checksum before decoding.
import { encodeCanonical, xxHash32 } from '@sim/index';
import { describe, expect, it } from 'vitest';
import {
  decodeSave,
  encodeSave,
  SAVE_FORMAT_VERSION,
  SAVE_SCHEMA_VERSION,
  type SaveBody,
} from './envelope';
import { MissingMigrationError, SaveCorruptError, SaveFromNewerBuildError } from './errors';

const body: SaveBody = {
  gameVersion: '0.1.0',
  buildSha: 'abc1234',
  contentHash: '0123456789abcdef',
  createdAtTick: 3600,
  wallClockSavedAt: 1_790_000_000_000,
  metadata: { area: 'testbed-arena', playtimeTicks: 3600 },
  sections: { world: { version: 1, data: { x: -0 } } },
};

/** A save with a hand-written header over `bodyBytes`, checksum computed unless given. */
function withHeader(
  bodyBytes: Uint8Array,
  {
    format = SAVE_FORMAT_VERSION,
    schema = SAVE_SCHEMA_VERSION,
    checksum = xxHash32(bodyBytes),
  } = {},
): Uint8Array {
  const bytes = new Uint8Array(12 + bodyBytes.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x56, 0x42, 0x53, 0x56]);
  view.setUint16(4, format);
  view.setUint16(6, schema);
  view.setUint32(8, checksum);
  bytes.set(bodyBytes, 12);
  return bytes;
}

function errorOf(bytes: Uint8Array): unknown {
  const result = decodeSave(bytes);
  return result.ok ? undefined : result.error;
}

describe('encodeSave / decodeSave', () => {
  it('round-trips every envelope field, with versions and checksum from the header', () => {
    const bytes = encodeSave(body);
    expect(Array.from(bytes.subarray(0, 4), (b) => String.fromCharCode(b)).join('')).toBe('VBSV');
    const result = decodeSave(bytes);
    expect(result).toEqual({
      ok: true,
      envelope: {
        ...body,
        formatVersion: SAVE_FORMAT_VERSION,
        saveSchemaVersion: SAVE_SCHEMA_VERSION,
        checksum: xxHash32(bytes.subarray(12)).toString(16).padStart(8, '0'),
      },
    });
    const data = result.ok ? result.envelope.sections['world']?.data : undefined;
    expect(Object.is((data as { x: number }).x, -0)).toBe(true);
  });

  it('writes identical bytes for identical content regardless of key order', () => {
    const reordered: SaveBody = {
      ...body,
      metadata: { playtimeTicks: 3600, area: 'testbed-arena' },
    };
    expect(encodeSave(reordered)).toEqual(encodeSave(body));
  });

  it('decodes a save held in a larger buffer', () => {
    const bytes = encodeSave(body);
    const padded = new Uint8Array(bytes.length + 5);
    padded.set(bytes, 5);
    expect(decodeSave(padded.subarray(5)).ok).toBe(true);
  });

  it.each([
    ['a truncated header', new Uint8Array(11), /shorter than the save header/],
    ['foreign bytes', new Uint8Array(20), /not a Vesper Bell save/],
    [
      'format version 0',
      withHeader(encodeCanonical(null), { format: 0 }),
      /unknown format version 0/,
    ],
  ])('reports %s as corrupt', (_, bytes, reason) => {
    const error = errorOf(bytes);
    expect(error).toBeInstanceOf(SaveCorruptError);
    expect((error as Error).message).toMatch(reason);
  });

  it('AC-6: refuses a newer saveSchemaVersion before parsing the body', () => {
    // The body is garbage: were it parsed, this would be reported as corrupt instead.
    const error = errorOf(withHeader(Uint8Array.from([0xff]), { schema: SAVE_SCHEMA_VERSION + 1 }));
    expect(error).toBeInstanceOf(SaveFromNewerBuildError);
    expect(error).toMatchObject({ part: 'schema', found: SAVE_SCHEMA_VERSION + 1 });
  });

  it('AC-6: refuses a newer format version before parsing the body', () => {
    const error = errorOf(withHeader(Uint8Array.from([0xff]), { format: SAVE_FORMAT_VERSION + 1 }));
    expect(error).toMatchObject({ kind: 'newer-build', part: 'format' });
  });

  it('needs an envelope migration for an older saveSchemaVersion', () => {
    const error = errorOf(withHeader(encodeCanonical(null), { schema: 0 }));
    expect(error).toBeInstanceOf(MissingMigrationError);
    expect(error).toMatchObject({ section: 'envelope', from: 0, to: 1 });
  });

  it('AC-3: reports a body that does not match its checksum as corrupt', () => {
    const bytes = encodeSave(body);
    bytes.set([(bytes.at(-2) ?? 0) ^ 0x01], bytes.length - 2);
    const error = errorOf(bytes);
    expect(error).toBeInstanceOf(SaveCorruptError);
    expect((error as Error).message).toMatch(/checksum [0-9a-f]{8} does not match header/);
  });

  it('reports a checksummed body that is not canonical bytes as corrupt', () => {
    const error = errorOf(withHeader(Uint8Array.from([0x00, 0x00])));
    expect((error as Error).message).toMatch(/trailing bytes/);
  });

  it('reports a checksummed body with the wrong shape as corrupt', () => {
    const error = errorOf(withHeader(encodeCanonical({ ...body, createdAtTick: -1, extra: 1 })));
    expect(error).toBeInstanceOf(SaveCorruptError);
    expect((error as Error).message).toMatch(/malformed body: .*createdAtTick/);
  });
});
