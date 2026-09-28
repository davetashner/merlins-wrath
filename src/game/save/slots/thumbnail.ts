// Slot thumbnails (mw-e30.4): a small encoded image of the scene when the save was made. Capturing it
// is render-side (src/render/thumbnail.ts reads the canvas); the slot layer only accepts the encoded
// bytes, checks them against hard limits so a buggy or hostile capture cannot bloat every save, and
// stores them inside the save's envelope metadata. Keeping the thumbnail in the same save bytes means
// a slot's current copy and its backup each carry their own matching picture, written atomically.

/** Width the renderer captures thumbnails at, and the largest width accepted. */
export const THUMBNAIL_WIDTH = 256;

/** Height the renderer captures thumbnails at, and the largest height accepted. */
export const THUMBNAIL_HEIGHT = 144;

/** Largest encoded thumbnail accepted, in bytes (a 256×144 WebP is typically 5–20 KiB). */
export const THUMBNAIL_MAX_BYTES = 64 * 1024;

/** Encodings accepted. WebP is preferred; browsers that cannot encode it fall back to PNG or JPEG. */
export const THUMBNAIL_MIME_TYPES = ['image/webp', 'image/png', 'image/jpeg'] as const;

export type ThumbnailMimeType = (typeof THUMBNAIL_MIME_TYPES)[number];

/** An encoded thumbnail image. */
export interface SlotThumbnail {
  readonly mimeType: ThumbnailMimeType;
  /** Pixel size of the encoded image. */
  readonly width: number;
  readonly height: number;
  /** The encoded file (WebP/PNG/JPEG bytes). */
  readonly bytes: Uint8Array;
}

/**
 * Produces the thumbnail at save time (e.g. `captureCanvasThumbnail` from src/render). May throw or
 * reject — a tainted canvas or a lost context — in which case the save goes ahead with a placeholder.
 */
export type ThumbnailCapture = () => SlotThumbnail | Promise<SlotThumbnail>;

/** How a thumbnail sits in envelope metadata: canonical encoding has strings, not byte arrays. */
export interface StoredThumbnail {
  readonly mimeType: ThumbnailMimeType;
  readonly width: number;
  readonly height: number;
  /** One UTF-16 code unit (0–255) per byte: 2 bytes per byte stored, versus 2.7 for base64. */
  readonly data: string;
}

const SIGNATURES: Readonly<Record<ThumbnailMimeType, (bytes: Uint8Array) => boolean>> = {
  'image/webp': (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP'),
  'image/png': (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};

function ascii(bytes: Uint8Array, at: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

const dimension = (value: unknown, max: number): boolean =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max;

/**
 * Checks a thumbnail against the limits: a known type whose bytes start with that type's signature,
 * dimensions within 256×144, and at most THUMBNAIL_MAX_BYTES. Returns why it is unacceptable, or
 * undefined when it is fine. Tolerates malformed input, since captures are outside the save layer.
 */
export function checkThumbnail(thumbnail: SlotThumbnail): string | undefined {
  const { mimeType, width, height, bytes } = thumbnail;
  const type: unknown = mimeType;
  if (!(THUMBNAIL_MIME_TYPES as readonly unknown[]).includes(type)) {
    return `unsupported type ${String(type)}`;
  }
  if (!dimension(width, THUMBNAIL_WIDTH) || !dimension(height, THUMBNAIL_HEIGHT)) {
    return `size ${String(width)}×${String(height)} is not within ${String(THUMBNAIL_WIDTH)}×${String(THUMBNAIL_HEIGHT)}`;
  }
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return 'no image bytes';
  if (bytes.length > THUMBNAIL_MAX_BYTES) {
    return `${String(bytes.length)} bytes exceeds the ${String(THUMBNAIL_MAX_BYTES)}-byte limit`;
  }
  if (!SIGNATURES[mimeType](bytes)) return `bytes are not a ${mimeType} image`;
  return undefined;
}

/** Converts a checked thumbnail to its metadata form. */
export function storeThumbnail(thumbnail: SlotThumbnail): StoredThumbnail {
  let data = '';
  // Chunked so the argument list never exceeds the engine's limit.
  for (let i = 0; i < thumbnail.bytes.length; i += 8192) {
    data += String.fromCharCode(...thumbnail.bytes.subarray(i, i + 8192));
  }
  const { mimeType, width, height } = thumbnail;
  return { mimeType, width, height, data };
}

/**
 * Converts a thumbnail back from its metadata form, re-checking it. Returns undefined when the stored
 * form is damaged (a code unit above 255, or bytes that fail checkThumbnail).
 */
export function loadThumbnail(stored: StoredThumbnail): SlotThumbnail | undefined {
  const bytes = new Uint8Array(stored.data.length);
  for (let i = 0; i < bytes.length; i++) {
    const unit = stored.data.charCodeAt(i);
    if (unit > 0xff) return undefined;
    bytes[i] = unit;
  }
  const { mimeType, width, height } = stored;
  const thumbnail = { mimeType, width, height, bytes };
  return checkThumbnail(thumbnail) === undefined ? thumbnail : undefined;
}
