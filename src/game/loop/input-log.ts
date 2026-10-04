// Recorded input logs (mw-e01.9): what a player (or the e2e's bot) did to the game, stamped with the
// sim tick each input was handed to, so it can be played back into the same ticks later. The frame
// loop never sees wall time, so a log replayed tick for tick reaches the same sim state hashes however
// slowly the page draws frames. A log is cut into segments, one per page load: a reload from a save
// restarts the sim at the save's tick, so each segment counts ticks from its page's first step.
//
// Only debug pages record or replay (src/main.ts gates both with the debug console's gate): release
// builds never carry a hook that feeds the game input. No DOM here; the page binds a target.

/** One thing done to the game, as logged. Commands are the game's own plain-data sim commands. */
export type InputOp =
  | { readonly op: 'down' | 'up'; readonly code: string }
  | { readonly op: 'look'; readonly x: number; readonly y: number }
  | { readonly op: 'releaseAll' }
  | { readonly op: 'command'; readonly command: unknown }
  | { readonly op: 'save'; readonly slot: string };

/** An input and the sim tick it was made at, counted from the segment's first step. */
export type InputEvent = InputOp & { readonly t: number };

/** One page load's inputs, in the order they were made. */
export interface InputLogSegment {
  readonly events: readonly InputEvent[];
  /** The sim tick the segment's first step simulated when it was recorded (for diagnosing drift). */
  readonly startTick?: number;
}

/** A whole recorded run. */
export interface InputLog {
  readonly version: 1;
  readonly segments: readonly InputLogSegment[];
}

/** What a replay drives: the page's action sampler, command queue and save. */
export interface InputTarget {
  down(code: string): void;
  up(code: string): void;
  look(x: number, y: number): void;
  releaseAll(): void;
  command(command: unknown): void;
  save(slot: string): void;
}

/** The sampler methods a recorder taps (ActionSampler has them). */
export interface RecordableInput {
  down(code: string): void;
  up(code: string): void;
  look(movementX: number, movementY: number): void;
  releaseAll(): void;
}

/** Collects one segment: what reaches the sampler (and the console's commands) with its tick. */
export class InputRecorder {
  readonly #events: InputEvent[] = [];
  readonly #tick: () => number;
  #start: number | undefined;

  /** `tick` reads the sim tick the next step will simulate. */
  constructor(tick: () => number) {
    this.#tick = tick;
  }

  /** The events so far, oldest first. */
  get events(): readonly InputEvent[] {
    return this.#events;
  }

  /** The segment recorded so far. */
  segment(): InputLogSegment {
    return {
      events: [...this.#events],
      ...(this.#start !== undefined && { startTick: this.#start }),
    };
  }

  /** The frame loop's first sample: the segment's tick 0. Inputs made before it stamp 0. */
  sampled(tick: number): void {
    this.#start ??= tick;
  }

  /** Logs `op` at the current tick. */
  record(op: InputOp): void {
    const t = this.#start === undefined ? 0 : Math.max(0, this.#tick() - this.#start);
    this.#events.push({ ...op, t });
  }

  /**
   * Makes `input` log every event it receives, still passing each on. `skip` names events not to log
   * (what a replay must not repeat, such as the keys that drive the debug console).
   */
  tap(input: RecordableInput, skip: (op: InputOp) => boolean = () => false): void {
    const pass = {
      down: input.down.bind(input),
      up: input.up.bind(input),
      look: input.look.bind(input),
      releaseAll: input.releaseAll.bind(input),
    };
    const log = (op: InputOp): void => {
      if (!skip(op)) this.record(op);
    };
    input.down = (code) => {
      log({ op: 'down', code });
      pass.down(code);
    };
    input.up = (code) => {
      log({ op: 'up', code });
      pass.up(code);
    };
    input.look = (x, y) => {
      log({ op: 'look', x, y });
      pass.look(x, y);
    };
    input.releaseAll = () => {
      log({ op: 'releaseAll' });
      pass.releaseAll();
    };
  }
}

/** Feeds a segment's events into a target as the sim reaches their ticks. */
export class InputPlayer {
  readonly #events: readonly InputEvent[];
  readonly #target: InputTarget;
  #next = 0;
  #start: number | undefined;

  constructor(segment: InputLogSegment, target: InputTarget) {
    this.#events = segment.events;
    this.#target = target;
  }

  /** The sim tick the replay counts from: the first step it saw (undefined before it). */
  get startTick(): number | undefined {
    return this.#start;
  }

  /** Events not yet played. */
  get remaining(): number {
    return this.#events.length - this.#next;
  }

  /** True once every event has been played. */
  get done(): boolean {
    return this.remaining === 0;
  }

  /** Plays every event due by sim tick `tick`, just before that tick is sampled. */
  advance(tick: number): void {
    this.#start ??= tick;
    const due = tick - this.#start;
    for (let event = this.#events[this.#next]; event !== undefined && event.t <= due;) {
      this.#play(event);
      this.#next += 1;
      event = this.#events[this.#next];
    }
  }

  #play(event: InputEvent): void {
    switch (event.op) {
      case 'down':
        this.#target.down(event.code);
        break;
      case 'up':
        this.#target.up(event.code);
        break;
      case 'look':
        this.#target.look(event.x, event.y);
        break;
      case 'releaseAll':
        this.#target.releaseAll();
        break;
      case 'command':
        this.#target.command(event.command);
        break;
      case 'save':
        this.#target.save(event.slot);
        break;
    }
  }
}
