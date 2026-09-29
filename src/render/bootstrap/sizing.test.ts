import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_PIXEL_RATIO,
  MAX_RENDER_SCALE,
  MIN_RENDER_SCALE,
  clampRenderScale,
  drawingBufferSize,
  effectivePixelRatio,
} from '@render/bootstrap/sizing';

describe('renderer drawing-buffer sizing (mw-e00.19)', () => {
  it('AC-2: caps devicePixelRatio at the configured maximum', () => {
    expect(effectivePixelRatio(1, DEFAULT_MAX_PIXEL_RATIO, 1)).toBe(1);
    expect(effectivePixelRatio(1.5, 2, 1)).toBe(1.5);
    expect(effectivePixelRatio(3, 2, 1)).toBe(2);
  });

  it('AC-2: drawing buffer is viewport × min(dpr, cap), floored like WebGLRenderer.setSize', () => {
    expect(drawingBufferSize(1280, 720, effectivePixelRatio(1, 2, 1))).toEqual({
      width: 1280,
      height: 720,
    });
    expect(drawingBufferSize(1920, 1080, effectivePixelRatio(3, 2, 1))).toEqual({
      width: 3840,
      height: 2160,
    });
    expect(drawingBufferSize(333, 101, 1.5)).toEqual({ width: 499, height: 151 });
    expect(drawingBufferSize(0, 0, 2)).toEqual({ width: 1, height: 1 });
  });

  it('applies the render-scale hook on top of the capped ratio', () => {
    expect(effectivePixelRatio(2, 2, 0.5)).toBe(1);
    expect(effectivePixelRatio(1, 2, 1.5)).toBe(1.5);
  });

  it('treats a missing or bogus devicePixelRatio as 1', () => {
    expect(effectivePixelRatio(Number.NaN, 2, 1)).toBe(1);
    expect(effectivePixelRatio(0, 2, 1)).toBe(1);
  });

  it('clamps the render scale into its bounds and ignores non-finite values', () => {
    expect(clampRenderScale(0.01)).toBe(MIN_RENDER_SCALE);
    expect(clampRenderScale(10)).toBe(MAX_RENDER_SCALE);
    expect(clampRenderScale(0.75)).toBe(0.75);
    expect(clampRenderScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
