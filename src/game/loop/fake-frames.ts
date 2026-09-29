// A deterministic stand-in for the browser's frame sources (mw-e00.20): a manual clock, a one-slot
// animation-frame queue and a visibility flag. Tests (and later tools such as frame-step debugging)
// drive the frame loop with it instead of requestAnimationFrame and performance.now.
import type { FrameScheduler, TimeSource, VisibilitySource } from './fixed-step';

export class FakeFrames implements FrameScheduler, VisibilitySource {
  /** Current fake time in milliseconds. */
  time: number;
  private isHidden = false;
  private nextHandle = 1;
  private readonly callbacks = new Map<number, () => void>();
  private readonly listeners = new Set<() => void>();

  constructor(startMs = 0) {
    this.time = startMs;
  }

  readonly now: TimeSource = () => this.time;

  get hidden(): boolean {
    return this.isHidden;
  }

  /** Animation frames requested and not yet run or cancelled. */
  get pending(): number {
    return this.callbacks.size;
  }

  request(callback: () => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Changes visibility and fires `visibilitychange` listeners. */
  setHidden(hidden: boolean): void {
    this.isHidden = hidden;
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Advances the clock by `deltaMs`, then runs the animation frames that were pending (as a display
   * refresh would). Frames requested while running wait for the next call. Returns how many ran.
   */
  frame(deltaMs: number): number {
    this.time += deltaMs;
    const due = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of due) callback();
    return due.length;
  }

  /** Advances the clock without a frame (time passing while no frame is shown). */
  advance(ms: number): void {
    this.time += ms;
  }
}
