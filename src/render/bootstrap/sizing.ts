// Drawing-buffer sizing for the renderer bootstrap (mw-e00.19). Pure so it is unit tested without a GPU.

/** Default cap on devicePixelRatio: a 3× phone or 5K panel would otherwise quadruple fill cost. */
export const DEFAULT_MAX_PIXEL_RATIO = 2;

/** Render scale bounds for the settings hook (dynamic resolution in mw-e32.6 moves within these). */
export const MIN_RENDER_SCALE = 0.25;
export const MAX_RENDER_SCALE = 2;

/** Clamps a requested render scale into [MIN_RENDER_SCALE, MAX_RENDER_SCALE]; non-finite means 1. */
export function clampRenderScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_RENDER_SCALE, Math.max(MIN_RENDER_SCALE, scale));
}

/** The pixel ratio the renderer draws at: min(devicePixelRatio, cap) × render scale. */
export function effectivePixelRatio(
  devicePixelRatio: number,
  maxPixelRatio: number,
  renderScale: number,
): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, maxPixelRatio) * clampRenderScale(renderScale);
}

export interface BufferSize {
  readonly width: number;
  readonly height: number;
}

/** Drawing-buffer size for a CSS size at a pixel ratio, floored like WebGLRenderer.setSize (min 1×1). */
export function drawingBufferSize(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): BufferSize {
  return {
    width: Math.max(1, Math.floor(cssWidth * pixelRatio)),
    height: Math.max(1, Math.floor(cssHeight * pixelRatio)),
  };
}
