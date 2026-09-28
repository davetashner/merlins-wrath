import { describe, expect, it } from 'vitest';
import {
  checkThumbnail,
  loadThumbnail,
  storeThumbnail,
  THUMBNAIL_MAX_BYTES,
  type SlotThumbnail,
} from './thumbnail';

const text = (s: string) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));
const webp = (size = 32): Uint8Array => {
  const bytes = new Uint8Array(size).map((_, i) => (i * 37) & 0xff);
  bytes.set(text('RIFF'), 0);
  bytes.set(text('WEBP'), 8);
  return bytes;
};
const thumb = (overrides: Partial<SlotThumbnail> = {}): SlotThumbnail => ({
  mimeType: 'image/webp',
  width: 256,
  height: 144,
  bytes: webp(),
  ...overrides,
});

describe('checkThumbnail', () => {
  it('accepts WebP, PNG and JPEG with matching signatures, up to 256×144 and the byte limit', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(checkThumbnail(thumb())).toBeUndefined();
    expect(checkThumbnail(thumb({ mimeType: 'image/png', bytes: png }))).toBeUndefined();
    expect(checkThumbnail(thumb({ mimeType: 'image/jpeg', bytes: jpeg }))).toBeUndefined();
    expect(checkThumbnail(thumb({ width: 1, height: 1 }))).toBeUndefined();
    expect(checkThumbnail(thumb({ bytes: webp(THUMBNAIL_MAX_BYTES) }))).toBeUndefined();
  });

  it('rejects unknown types, bad sizes, missing or oversized bytes and wrong signatures', () => {
    const cases: [Partial<SlotThumbnail>, RegExp][] = [
      [{ mimeType: 'image/gif' as 'image/png' }, /unsupported type image\/gif/],
      [{ width: 257 }, /257×144 is not within 256×144/],
      [{ height: 145 }, /not within/],
      [{ width: 0 }, /not within/],
      [{ width: 12.5 }, /not within/],
      [{ bytes: new Uint8Array() }, /no image bytes/],
      [{ bytes: [1, 2] as unknown as Uint8Array }, /no image bytes/],
      [{ bytes: webp(THUMBNAIL_MAX_BYTES + 1) }, /exceeds the 65536-byte limit/],
      [{ bytes: new Uint8Array(32) }, /not a image\/webp image/],
      [{ bytes: webp().fill(0, 8, 9) }, /not a image\/webp image/],
      [{ mimeType: 'image/png' }, /not a image\/png image/],
      [{ mimeType: 'image/jpeg' }, /not a image\/jpeg image/],
      [{ mimeType: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0x00]) }, /jpeg/],
      [{ mimeType: 'image/jpeg', bytes: new Uint8Array([0xff, 0x00]) }, /jpeg/],
    ];
    const problems = cases.map(([overrides]) => checkThumbnail(thumb(overrides)) ?? '');
    expect(problems.map((p, i) => (cases[i]?.[1].test(p) ? 'ok' : p))).toEqual(
      cases.map(() => 'ok'),
    );
  });
});

describe('stored thumbnails', () => {
  it('round-trip every byte value through the metadata form', () => {
    const bytes = webp(20_000);
    bytes.set(
      Array.from({ length: 256 }, (_, i) => i),
      12,
    );
    const stored = storeThumbnail(thumb({ bytes }));
    expect(stored.data).toHaveLength(20_000);
    expect(loadThumbnail(stored)).toEqual(thumb({ bytes }));
  });

  it('read back as undefined when the stored form is damaged', () => {
    const stored = storeThumbnail(thumb());
    expect(loadThumbnail({ ...stored, data: `${stored.data}Ā` })).toBeUndefined();
    expect(loadThumbnail({ ...stored, data: stored.data.slice(4) })).toBeUndefined();
  });
});
