// Save-slot thumbnail capture (mw-e30.4): scales whatever the game canvas shows down to 256×144 and
// encodes it, preferring WebP. It needs a real canvas and image encoder, so it lives in the
// coverage-excluded render layer; everything that can be checked without a GPU — size and type
// limits, signature checks, storage, and the "capture failed → placeholder" rule — lives in
// src/game/save/slots and is unit tested there. The result is structurally a `SlotThumbnail`
// (render may not import game), so the game passes `() => captureCanvasThumbnail(canvas)` as the
// slot manager's `captureThumbnail`. Failures (tainted canvas → SecurityError, lost context, no
// encoder) are thrown for the slot manager to turn into a placeholder.

/** Size thumbnails are captured at; matches THUMBNAIL_WIDTH × THUMBNAIL_HEIGHT in the save layer. */
export const CAPTURE_WIDTH = 256;
export const CAPTURE_HEIGHT = 144;

/** An encoded capture; the same shape as the save layer's SlotThumbnail. */
export interface CapturedThumbnail {
  readonly mimeType: 'image/webp' | 'image/png' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

/**
 * Captures `source` (the game canvas, after a frame has rendered — a WebGL canvas needs
 * `preserveDrawingBuffer` or capture straight after render) as a 256×144 thumbnail. The source is
 * cropped to 16:9 around its centre (no letterboxing).
 * @throws when the canvas is tainted, its context is lost, or the browser cannot encode an image.
 */
export async function captureCanvasThumbnail(
  source: HTMLCanvasElement | OffscreenCanvas,
): Promise<CapturedThumbnail> {
  const target = new OffscreenCanvas(CAPTURE_WIDTH, CAPTURE_HEIGHT);
  const context = target.getContext('2d');
  if (context === null) throw new Error('no 2D context available for the thumbnail');
  if (source.width === 0 || source.height === 0) throw new Error('the canvas has no pixels');
  const aspect = CAPTURE_WIDTH / CAPTURE_HEIGHT;
  const cropWidth = Math.min(source.width, source.height * aspect);
  const cropHeight = cropWidth / aspect;
  context.drawImage(
    source,
    (source.width - cropWidth) / 2,
    (source.height - cropHeight) / 2,
    cropWidth,
    cropHeight,
    0,
    0,
    CAPTURE_WIDTH,
    CAPTURE_HEIGHT,
  );
  // Browsers without a WebP encoder (Safari) silently return PNG; the blob's type says which.
  const blob = await target.convertToBlob({ type: 'image/webp', quality: 0.8 });
  const mimeType = blob.type;
  if (mimeType !== 'image/webp' && mimeType !== 'image/png' && mimeType !== 'image/jpeg') {
    throw new Error(`the browser encoded the thumbnail as ${mimeType}`);
  }
  return {
    mimeType,
    width: CAPTURE_WIDTH,
    height: CAPTURE_HEIGHT,
    bytes: new Uint8Array(await blob.arrayBuffer()),
  };
}
