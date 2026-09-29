// In-page instrumentation shared by every prototype. The Playwright harness (spikes/bench/run.ts)
// reads `window.__bench`; nothing here depends on an engine.
//
// Per frame we record:
//  - interval: time between successive frame starts (requestAnimationFrame cadence). With vsync on this
//    is capped at the display refresh; with --disable-gpu-vsync --disable-frame-rate-limit it tracks
//    the real CPU+GPU throughput of the pipeline.
//  - cpu: main-thread time inside the frame callback (animation, physics step, scene submission).
//    GPU work is asynchronous and is NOT in this number.
//  - gpu: GPU time of the frame's commands via EXT_disjoint_timer_query_webgl2, when the browser exposes it
//    (Chrome on macOS does in headed mode). Results arrive a few frames late and are matched by order.

export interface BenchSample {
  intervals: number[];
  cpu: number[];
  /** GPU time per frame from EXT_disjoint_timer_query_webgl2 (empty when the extension is unavailable). */
  gpu: number[];
}

export interface BenchInfo {
  prototype: string;
  renderer: string;
  physics: string;
  versions: Record<string, string>;
  drawingBuffer: { width: number; height: number };
  gpu: string;
  counts: Record<string, number>;
}

export interface BenchApi {
  ready: boolean;
  ttffMs: number | null;
  frameCount: number;
  info: BenchInfo | null;
  errors: string[];
  startSampling(): void;
  stopSampling(): BenchSample;
  heap(): { usedJSHeapSize: number; totalJSHeapSize: number } | null;
}

declare global {
  interface Window {
    __bench: BenchApi;
  }
}

export interface FrameHook {
  frameStart(): void;
  frameEnd(): void;
  setInfo(info: BenchInfo): void;
  /**
   * Engines that compile shaders asynchronously (Babylon) can draw frames before every material is
   * ready. They call deferReady() up front and contentReady() once the scene is complete, so TTFF means
   * "first complete frame" in every prototype.
   */
  deferReady(): void;
  contentReady(): void;
  /** Wraps every frame in a GPU TIME_ELAPSED query when the browser exposes the timer extension. */
  attachGpuTimer(gl: WebGL2RenderingContext): void;
}

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export function installBenchHook(): FrameHook {
  let sampling = false;
  let lastStart = -1;
  let start = 0;
  let intervals: number[] = [];
  let contentReady = true;
  let firstCompleteFrame = false;
  let cpu: number[] = [];
  let gpu: number[] = [];
  let gl: WebGL2RenderingContext | null = null;
  let timer: TimerExt | null = null;
  let active: WebGLQuery | null = null;
  const pending: { q: WebGLQuery; sampled: boolean }[] = [];
  const pollGpu = (): void => {
    if (!gl || !timer) return;
    while (pending.length) {
      const head = pending[0]!;
      if (!gl.getQueryParameter(head.q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(head.q, gl.QUERY_RESULT) as number;
      const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT) as boolean;
      if (head.sampled && !disjoint) gpu.push(ns / 1e6);
      gl.deleteQuery(head.q);
      pending.shift();
    }
  };
  const api: BenchApi = {
    ready: false,
    ttffMs: null,
    frameCount: 0,
    info: null,
    errors: [],
    startSampling() {
      intervals = [];
      cpu = [];
      gpu = [];
      sampling = true;
    },
    stopSampling() {
      sampling = false;
      return { intervals, cpu, gpu };
    },
    heap() {
      const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } })
        .memory;
      return m ? { usedJSHeapSize: m.usedJSHeapSize, totalJSHeapSize: m.totalJSHeapSize } : null;
    },
  };
  window.__bench = api;
  window.addEventListener('error', (e) => api.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => api.errors.push(String(e.reason)));

  return {
    frameStart() {
      start = performance.now();
      if (sampling && lastStart >= 0) intervals.push(start - lastStart);
      lastStart = start;
      pollGpu();
      if (gl && timer && pending.length < 16) {
        active = gl.createQuery();
        if (active) gl.beginQuery(timer.TIME_ELAPSED_EXT, active);
      }
    },
    frameEnd() {
      if (gl && timer && active) {
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        pending.push({ q: active, sampled: sampling });
        active = null;
      }
      const end = performance.now();
      if (sampling) cpu.push(end - start);
      api.frameCount++;
      if (contentReady && !firstCompleteFrame) {
        firstCompleteFrame = true;
        // First frame submitted; the next animation frame is our best in-page proxy for "presented".
        requestAnimationFrame(() => {
          api.ttffMs = performance.now();
          api.ready = true;
        });
      }
    },
    setInfo(info) {
      api.info = info;
    },
    deferReady() {
      contentReady = false;
    },
    contentReady() {
      contentReady = true;
    },
    attachGpuTimer(context) {
      const ext = context.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
      if (ext) {
        gl = context;
        timer = ext;
      }
    },
  };
}

/** Unmasked GPU string from a WebGL context, e.g. "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, …)". */
export function gpuString(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
}
