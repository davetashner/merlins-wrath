// Renderer bootstrap (mw-e00.19, ADR-0001: Three.js). Creates the canvas, WebGL2 renderer, scene and
// camera; keeps the drawing buffer at CSS size × min(devicePixelRatio, cap) × render scale; and tears
// everything down in dispose() so the WebGL context is released rather than leaked.
import { PerspectiveCamera, Scene, WebGLRenderer, type Material, type Object3D } from 'three';
import { populateBootScene } from './boot-scene.ts';
import { DEFAULT_MAX_PIXEL_RATIO, clampRenderScale, effectivePixelRatio } from './sizing.ts';

export * from './sizing.ts';

export interface RenderBootstrapOptions {
  /** Element the canvas is appended to; the canvas fills it. */
  readonly container: HTMLElement;
  /** Cap on devicePixelRatio (default DEFAULT_MAX_PIXEL_RATIO). */
  readonly maxPixelRatio?: number;
  /** Initial render scale (settings hook; default 1). */
  readonly renderScale?: number;
  /** Called once, right after the first frame has been submitted. */
  readonly onFirstFrame?: () => void;
  /**
   * When false, the bootstrap runs no animation loop of its own: the caller draws each frame with
   * `renderFrame` (the game's frame loop does, after stepping the sim; mw-e00.20). Default true.
   */
  readonly animationLoop?: boolean;
}

export interface RenderBootstrap {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Current render scale after clamping. */
  readonly renderScale: number;
  /** Draws one frame at render-side time `timeMs` (resizing first if needed). */
  renderFrame(timeMs: number): void;
  /** Settings hook: changes the render scale; applied before the next frame. */
  setRenderScale(scale: number): void;
  /** Stops the loop, frees GPU resources, releases the WebGL context and removes the canvas. Idempotent. */
  dispose(): void;
}

export function createRenderBootstrap(options: RenderBootstrapOptions): RenderBootstrap {
  const { container } = options;
  const view = container.ownerDocument.defaultView;
  const maxPixelRatio = options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO;
  let renderScale = clampRenderScale(options.renderScale ?? 1);

  const canvas = container.ownerDocument.createElement('canvas');
  canvas.dataset['testid'] = 'game-canvas';
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.append(canvas);

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    canvas.remove();
    throw error;
  }

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.1, 200);
  const boot = populateBootScene(scene, camera);

  // Resize is checked every frame (CSS size, DPR and render scale), which also catches a window
  // moving to a monitor with a different devicePixelRatio, where no resize event fires.
  let applied = { width: -1, height: -1, ratio: -1 };
  const resizeIfNeeded = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = effectivePixelRatio(view?.devicePixelRatio ?? 1, maxPixelRatio, renderScale);
    if (width === applied.width && height === applied.height && ratio === applied.ratio) return;
    applied = { width, height, ratio };
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = height > 0 ? width / height : 1;
    camera.updateProjectionMatrix();
  };

  let firstFrame = true;
  let disposed = false;
  const renderFrame = (timeMs: number): void => {
    if (disposed) return;
    resizeIfNeeded();
    boot.update(timeMs);
    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      options.onFirstFrame?.();
    }
  };
  if (options.animationLoop ?? true) renderer.setAnimationLoop(renderFrame);

  return {
    canvas,
    renderer,
    scene,
    camera,
    renderFrame,
    get renderScale() {
      return renderScale;
    },
    setRenderScale(scale) {
      renderScale = clampRenderScale(scale);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      disposeObjectTree(scene);
      renderer.dispose();
      // dispose() frees Three's GPU resources but leaves the context alive until GC; browsers cap
      // live contexts (16 in Chromium), so release it explicitly.
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

function disposeObjectTree(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Partial<{
      geometry: { dispose(): void };
      material: Material | Material[];
    }>;
    mesh.geometry?.dispose();
    const materials = mesh.material === undefined ? [] : [mesh.material].flat();
    for (const material of materials) material.dispose();
  });
}
