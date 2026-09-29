// The frame loop (mw-e00.20): binds the fixed-step sim to display frames. Each animation frame adds
// the elapsed wall time to an accumulator and runs as many fixed sim steps as fit, then renders with
// the leftover fraction of a step (alpha) so visuals interpolate between the last two sim states.
// The sim itself never sees wall time: it only ever receives `step(inputs)` calls, one per tick, so a
// 144 Hz and a 60 Hz display produce the same sim state for the same per-tick inputs.
//
// Guards: at most `maxStepsPerFrame` steps run per frame (a debugger pause or a long hitch must not
// trigger a spiral of death); the excess is dropped and reported. While the tab is hidden the loop
// stops requesting frames and ignores elapsed time, so becoming visible again causes no catch-up burst.
//
// Every browser dependency (clock, requestAnimationFrame, visibility) is injected, so unit tests
// drive the loop with fake frames and a fake clock.

/** The part of the sim the loop drives. `World` satisfies it. */
export interface SteppableSim<TCommand> {
  /** Ticks simulated so far (the tick the next `step` will simulate). */
  readonly tick: number;
  /** Simulates one fixed tick with that tick's commands. */
  step(commands: readonly TCommand[]): void;
}

/**
 * Per-tick command source: the hook the input layer (e02 input actions) fills in. Called exactly once
 * per sim tick, just before that tick is stepped, with the tick number; the payload is opaque here.
 */
export type CommandSampler<TCommand> = (tick: number) => readonly TCommand[];

/** Monotonic milliseconds (the browser passes `() => performance.now()`). */
export type TimeSource = () => number;

/** Requests and cancels animation frames (the browser passes requestAnimationFrame). */
export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

/** Page visibility (the browser passes `document.hidden` and `visibilitychange`). */
export interface VisibilitySource {
  readonly hidden: boolean;
  /** Calls `listener` whenever visibility changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** What the render callback receives each frame. */
export interface FrameInfo {
  /** Fraction of a sim step left in the accumulator, in [0, 1): how far to interpolate. */
  readonly alpha: number;
  /** Sim steps run this frame. */
  readonly steps: number;
  /** Timestamp of this frame from the time source. */
  readonly timeMs: number;
}

/** Reported when a frame needed more than `maxStepsPerFrame` steps and the rest was dropped. */
export interface DroppedTime {
  /** Milliseconds of sim time discarded (whole steps beyond the cap). */
  readonly droppedMs: number;
  /** Frame delta that caused it. */
  readonly frameDeltaMs: number;
}

export const DEFAULT_MAX_STEPS_PER_FRAME = 5;

export interface FrameLoopOptions<TCommand> {
  readonly sim: SteppableSim<TCommand>;
  /** Fixed sim rate; must match the sim's clock (use `world.clock.hz`). */
  readonly hz: number;
  readonly now: TimeSource;
  readonly scheduler: FrameScheduler;
  readonly visibility: VisibilitySource;
  /** Per-tick commands; defaults to none (no input layer yet). */
  readonly sampleCommands?: CommandSampler<TCommand>;
  /** Called after each sim step (render sync captures the new state here). */
  readonly onStep?: (tick: number) => void;
  /** Called once per frame after stepping. */
  readonly render?: (frame: FrameInfo) => void;
  /**
   * While this returns true (a menu that pauses the game is open, mw-e00.23) frames keep rendering
   * but no sim step runs and no commands are sampled; the paused time is discarded, not caught up.
   */
  readonly simPaused?: () => boolean;
  /** Spiral-of-death guard (default 5). */
  readonly maxStepsPerFrame?: number;
  /** Where dropped-time warnings go (default console.warn). */
  readonly warn?: (message: string, dropped: DroppedTime) => void;
}

export interface FrameLoop {
  /** Starts requesting frames (no-op when running). Elapsed time is measured from here. */
  start(): void;
  /**
   * Stops requesting frames and unsubscribes from visibility (no-op when stopped). Called from
   * `onStep`, it also ends the current frame after that step.
   */
  stop(): void;
  /** Runs one frame at the time source's current time; the scheduler calls this. */
  frame(): void;
  readonly running: boolean;
  /** True while started but the page is hidden. */
  readonly paused: boolean;
  /** Interpolation alpha after the latest frame, in [0, 1). */
  readonly alpha: number;
}

const NO_COMMANDS: readonly never[] = Object.freeze([]);

/**
 * Tolerance for accumulated floating-point error, so a display whose frame is exactly a whole number
 * of steps (30 Hz display, 60 Hz sim: 2 × 16.666…) runs exactly that many steps every frame.
 */
const EPSILON_MS = 1e-6;

export function createFrameLoop<TCommand>(options: FrameLoopOptions<TCommand>): FrameLoop {
  const { sim, hz, now, scheduler, visibility } = options;
  if (!Number.isInteger(hz) || hz < 1 || hz > 1000) {
    throw new RangeError(`tick rate must be an integer 1–1000 Hz, got ${String(hz)}`);
  }
  const maxSteps = options.maxStepsPerFrame ?? DEFAULT_MAX_STEPS_PER_FRAME;
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new RangeError(`maxStepsPerFrame must be a positive integer, got ${String(maxSteps)}`);
  }
  const sample = options.sampleCommands ?? (() => NO_COMMANDS);
  const warn =
    options.warn ??
    ((message: string) => {
      console.warn(message);
    });
  const stepMs = 1000 / hz;

  let running = false;
  let paused = false;
  let handle: number | undefined;
  const subscriptions: (() => void)[] = [];
  let last = 0;
  let accumulator = 0;
  let alpha = 0;

  // A call, not the variable: onStep may stop the loop mid-frame, which narrowing can't see.
  const isRunning = (): boolean => running;

  const schedule = (): void => {
    handle = scheduler.request(frame);
  };

  const unschedule = (): void => {
    if (handle !== undefined) scheduler.cancel(handle);
    handle = undefined;
  };

  function frame(): void {
    handle = undefined;
    if (!running || paused) return;
    const timeMs = now();
    const delta = Math.max(0, timeMs - last);
    last = timeMs;
    accumulator = options.simPaused?.() === true ? 0 : accumulator + delta;

    let steps = 0;
    while (accumulator + EPSILON_MS >= stepMs && steps < maxSteps) {
      sim.step(sample(sim.tick));
      accumulator -= stepMs;
      steps++;
      options.onStep?.(sim.tick);
      if (!isRunning()) return; // stopped by onStep: no more steps, no render
    }
    if (accumulator + EPSILON_MS >= stepMs) {
      // Keep only the fraction of a step; whole steps past the cap are dropped, not deferred.
      const whole = Math.floor((accumulator + EPSILON_MS) / stepMs);
      const droppedMs = whole * stepMs;
      accumulator -= droppedMs;
      warn(
        `frame loop: ${delta.toFixed(1)} ms frame needed more than ${String(maxSteps)} sim steps; ` +
          `dropped ${droppedMs.toFixed(1)} ms of sim time`,
        { droppedMs, frameDeltaMs: delta },
      );
    }
    if (accumulator < 0) accumulator = 0; // within EPSILON_MS of a whole step
    alpha = Math.min(accumulator / stepMs, 1 - Number.EPSILON);

    options.render?.({ alpha, steps, timeMs });
    schedule();
  }

  // Subscribed only while running.
  const onVisibility = (): void => {
    if (visibility.hidden) {
      if (paused) return;
      paused = true;
      unschedule();
      return;
    }
    if (!paused) return;
    paused = false;
    // Hidden time never reaches the accumulator: measure from now, as if the page never left.
    last = now();
    schedule();
  };

  return {
    start() {
      if (running) return;
      running = true;
      subscriptions.push(visibility.subscribe(onVisibility));
      last = now();
      paused = visibility.hidden;
      if (!paused) schedule();
    },
    stop() {
      if (!running) return;
      running = false;
      paused = false;
      unschedule();
      for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    },
    frame,
    get running() {
      return running;
    },
    get paused() {
      return paused;
    },
    get alpha() {
      return alpha;
    },
  };
}
