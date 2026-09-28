import { describe, expect, it } from 'vitest';
import { normalizeSlotLabel, readSlotDetails, SLOT_LABEL_MAX_LENGTH } from './metadata';
import { storeThumbnail } from './thumbnail';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
const thumbnail = { mimeType: 'image/png', width: 256, height: 144, bytes: png } as const;
const stored = {
  characterName: 'Aldric',
  classId: 'knight',
  areaId: 'testbed-arena',
  playtimeTicks: 3_601,
  tickRateHz: 60,
  thumbnail: storeThumbnail(thumbnail),
};

describe('readSlotDetails', () => {
  it('reads stored metadata, deriving whole seconds of playtime and decoding the thumbnail', () => {
    expect(readSlotDetails(stored)).toEqual({
      ...stored,
      label: undefined,
      playtimeSeconds: 60,
      thumbnail,
    });
    expect(readSlotDetails({ ...stored, label: 'Before the minotaur' })?.label).toBe(
      'Before the minotaur',
    );
  });

  it('keeps a null thumbnail and turns a damaged one into the placeholder (null)', () => {
    expect(readSlotDetails({ ...stored, thumbnail: null })?.thumbnail).toBeNull();
    const damaged = { ...stored.thumbnail, data: 'not a png' };
    expect(readSlotDetails({ ...stored, thumbnail: damaged })?.thumbnail).toBeNull();
  });

  it('tolerates extra fields from newer builds but returns undefined for malformed metadata', () => {
    expect(readSlotDetails({ ...stored, mood: 'grim' })?.classId).toBe('knight');
    expect(readSlotDetails({})).toBeUndefined();
    expect(readSlotDetails({ ...stored, tickRateHz: 0 })).toBeUndefined();
    expect(readSlotDetails({ ...stored, thumbnail: { ...stored.thumbnail, mimeType: 'x' } })).toBe(
      undefined,
    );
  });
});

describe('normalizeSlotLabel', () => {
  it('trims, treats blank as no label and refuses over-long labels', () => {
    expect(normalizeSlotLabel('  Run 2 ')).toBe('Run 2');
    expect(normalizeSlotLabel('   ')).toBeUndefined();
    expect(normalizeSlotLabel('x'.repeat(SLOT_LABEL_MAX_LENGTH))).toHaveLength(40);
    expect(() => normalizeSlotLabel('x'.repeat(41))).toThrow(
      'slot label is 41 characters; the limit is 40',
    );
  });
});
