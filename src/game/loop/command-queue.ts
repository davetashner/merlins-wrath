// Commands from outside the input sampler (mw-e33.1): the debug console, and later tools, queue sim
// commands here and the frame loop hands them to the next sim step along with that tick's
// ActionFrame. Going through `World.step` inputs is what keeps them deterministic and recorded in
// replays; nothing outside the sim ever changes sim state directly.

import type { CommandSampler } from './fixed-step';

export class CommandQueue<TCommand> {
  private pending: TCommand[] = [];

  /** Commands waiting for the next step. */
  get size(): number {
    return this.pending.length;
  }

  /** Queues `command` for the next sim step. */
  push(command: TCommand): void {
    this.pending.push(command);
  }

  /** Takes every queued command, in push order, leaving the queue empty. */
  drain(): TCommand[] {
    const taken = this.pending;
    this.pending = [];
    return taken;
  }

  /** A sampler giving each step `sample`'s commands followed by the queued ones. */
  sampler<TSampled extends TCommand>(sample: CommandSampler<TSampled>): CommandSampler<TCommand> {
    return (tick) => {
      const sampled = sample(tick);
      return this.pending.length === 0 ? sampled : [...sampled, ...this.drain()];
    };
  }
}
