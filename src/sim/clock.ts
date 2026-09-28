// The sim clock (mw-e00.14): time is an input, never the wall clock. The fixed-step loop is the only
// thing that advances it; systems get a ReadonlyClock. Ticks are the source of truth — 60 Hz steps are
// not a whole number of milliseconds, so milliseconds are derived (floored) from ticks, never stored.

export const DEFAULT_TICK_RATE_HZ = 60;

export interface ClockState {
  readonly tick: number;
  readonly hz: number;
}

/** What systems see: they can read time, never move it. */
export interface ReadonlyClock {
  readonly tick: number;
  readonly hz: number;
  /** Whole milliseconds of sim time elapsed: floor(tick × 1000 / hz). */
  elapsedMs(): number;
  /** Ticks for a design duration in whole milliseconds, rounded half up (500 ms at 60 Hz → 30). */
  ticksFor(ms: number): number;
}

export class SimClock implements ReadonlyClock {
  readonly hz: number;
  private current: number;

  constructor(hz: number = DEFAULT_TICK_RATE_HZ, tick = 0) {
    if (!Number.isInteger(hz) || hz < 1 || hz > 1000) {
      throw new RangeError(`tick rate must be an integer 1–1000 Hz, got ${String(hz)}`);
    }
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new RangeError(`tick must be a non-negative safe integer, got ${String(tick)}`);
    }
    this.hz = hz;
    this.current = tick;
  }

  static restore(state: ClockState): SimClock {
    return new SimClock(state.hz, state.tick);
  }

  get tick(): number {
    return this.current;
  }

  /** Advances one fixed step. Only the sim loop calls this. */
  advance(): number {
    this.current += 1;
    return this.current;
  }

  elapsedMs(): number {
    return Math.floor((this.current * 1000) / this.hz);
  }

  ticksFor(ms: number): number {
    if (!Number.isSafeInteger(ms) || ms < 0) {
      throw new RangeError(
        `ticksFor(${String(ms)}): need a non-negative whole number of milliseconds`,
      );
    }
    return Math.floor((ms * this.hz + 500) / 1000);
  }

  serialize(): ClockState {
    return { tick: this.current, hz: this.hz };
  }
}
