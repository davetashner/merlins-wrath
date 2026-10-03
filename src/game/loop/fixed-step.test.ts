import { describe, expect, it, vi } from 'vitest';
import { FakeFrames } from './fake-frames';
import {
  createFrameLoop,
  DEFAULT_MAX_STEPS_PER_FRAME,
  MAX_TIME_SCALE,
  type FrameInfo,
  type FrameLoopOptions,
} from './fixed-step';

/** A sim stub recording the commands of every step. */
function stubSim() {
  const steps: (readonly string[])[] = [];
  return {
    steps,
    get tick() {
      return steps.length;
    },
    step(commands: readonly string[]) {
      steps.push(commands);
    },
  };
}

function setup(overrides: Partial<FrameLoopOptions<string>> = {}) {
  const frames = new FakeFrames(1000);
  const sim = stubSim();
  const rendered: FrameInfo[] = [];
  const warn = vi.fn();
  const loop = createFrameLoop<string>({
    sim,
    hz: 60,
    now: frames.now,
    scheduler: frames,
    visibility: frames,
    render: (frame) => rendered.push(frame),
    warn,
    ...overrides,
  });
  return { frames, sim, rendered, warn, loop };
}

describe('createFrameLoop', () => {
  it('AC-1: a 30 Hz display (33.3 ms frames) over a 60 Hz sim runs exactly 120 steps in 60 frames, alpha in [0, 1)', () => {
    const { frames, sim, rendered, warn, loop } = setup();
    loop.start();
    for (let i = 0; i < 60; i++) frames.frame(1000 / 30);
    expect(sim.steps).toHaveLength(120);
    expect(rendered).toHaveLength(60);
    for (const { alpha, steps } of rendered) {
      expect(steps).toBe(2);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('AC-1: alpha is the leftover fraction of a step, staying in [0, 1) at uneven frame times', () => {
    const { frames, sim, rendered, loop } = setup();
    loop.start();
    const deltas = [5, 10, 1.7, 16.6, 16.7, 40, 0, 3.3];
    for (const delta of deltas) frames.frame(delta);
    const total = deltas.reduce((a, b) => a + b, 0);
    expect(sim.steps).toHaveLength(Math.floor(total / (1000 / 60)));
    for (const { alpha } of rendered) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
    expect(rendered[0]?.alpha).toBeCloseTo(5 / (1000 / 60), 10);
    expect(loop.alpha).toBe(rendered.at(-1)?.alpha);
  });

  it('AC-2: a 2,000 ms frame runs at most 5 steps and drops the excess with a warning', () => {
    const { frames, sim, rendered, warn, loop } = setup();
    loop.start();
    frames.frame(2000);
    expect(DEFAULT_MAX_STEPS_PER_FRAME).toBe(5);
    expect(sim.steps).toHaveLength(5);
    expect(warn).toHaveBeenCalledOnce();
    const [message, dropped] = warn.mock.calls[0] as [
      string,
      { droppedMs: number; frameDeltaMs: number },
    ];
    expect(message).toMatch(/more than 5 sim steps; dropped \d+\.\d ms/);
    // 2,000 ms is 120 steps: 5 run, 115 whole steps dropped, no fraction left over.
    expect(dropped.frameDeltaMs).toBe(2000);
    expect(dropped.droppedMs).toBeCloseTo(115 * (1000 / 60), 6);
    expect(rendered[0]?.alpha).toBeCloseTo(0, 6);
    // The dropped time is gone: the next normal frame runs one step, not a backlog.
    frames.frame(1000 / 60);
    expect(sim.steps).toHaveLength(6);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('AC-2: the sub-step remainder survives the cap, so alpha stays meaningful', () => {
    const { frames, sim, rendered, warn, loop } = setup({ maxStepsPerFrame: 2 });
    loop.start();
    frames.frame(4.5 * (1000 / 60));
    expect(sim.steps).toHaveLength(2);
    const dropped = warn.mock.calls[0]?.[1] as { droppedMs: number };
    expect(dropped.droppedMs).toBeCloseTo(2 * (1000 / 60), 6);
    expect(rendered[0]?.alpha).toBeCloseTo(0.5, 6);
  });

  it('AC-2: warns through console.warn by default', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const frames = new FakeFrames();
    const sim = stubSim();
    const loop = createFrameLoop({
      sim,
      hz: 60,
      now: frames.now,
      scheduler: frames,
      visibility: frames,
    });
    loop.start();
    frames.frame(1000);
    expect(sim.steps).toHaveLength(5);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('AC-3: no steps run while hidden and becoming visible causes no catch-up burst', () => {
    const { frames, sim, rendered, loop } = setup();
    loop.start();
    frames.frame(1000 / 60);
    expect(sim.steps).toHaveLength(1);

    frames.setHidden(true);
    expect(loop.paused).toBe(true);
    expect(frames.pending).toBe(0); // the pending frame was cancelled
    for (let i = 0; i < 600; i++) frames.frame(1000 / 60); // 10 s of refreshes (none requested)
    expect(sim.steps).toHaveLength(1);

    frames.setHidden(false);
    expect(loop.paused).toBe(false);
    frames.frame(1000 / 60);
    expect(sim.steps).toHaveLength(2); // one frame's worth, not 600
    expect(rendered.at(-1)?.steps).toBe(1);
  });

  it('AC-3: a hidden page at start stays paused until visible; hidden time is never counted', () => {
    const { frames, sim, loop } = setup();
    frames.setHidden(true);
    loop.start();
    expect(loop.paused).toBe(true);
    expect(frames.pending).toBe(0);
    frames.advance(10_000);
    loop.frame(); // a stray callback while hidden does nothing
    expect(sim.steps).toHaveLength(0);
    frames.setHidden(false);
    frames.frame(1000 / 60);
    expect(sim.steps).toHaveLength(1);
  });

  it('AC-3: repeated visibility events are idempotent', () => {
    const { frames, sim, loop } = setup();
    loop.start();
    frames.setHidden(false); // visible → visible
    expect(frames.pending).toBe(1);
    frames.setHidden(true);
    frames.setHidden(true); // hidden → hidden
    expect(loop.paused).toBe(true);
    frames.setHidden(false);
    expect(frames.pending).toBe(1);
    frames.frame(1000 / 60);
    expect(sim.steps).toHaveLength(1);
  });

  it('timeScale scales sim time per frame (2× runs twice the steps, 0 freezes) and is range-checked', () => {
    const { frames, sim, loop } = setup();
    loop.start();
    expect(loop.timeScale).toBe(1);
    loop.timeScale = 2;
    for (let i = 0; i < 10; i++) frames.frame(1000 / 60);
    expect(sim.steps).toHaveLength(20);
    loop.timeScale = 0;
    for (let i = 0; i < 10; i++) frames.frame(1000 / 60);
    expect(sim.steps).toHaveLength(20);
    loop.timeScale = 0.5;
    for (let i = 0; i < 10; i++) frames.frame(1000 / 60);
    expect(sim.steps).toHaveLength(25);
    expect(() => (loop.timeScale = -1)).toThrow(RangeError);
    expect(() => (loop.timeScale = MAX_TIME_SCALE + 1)).toThrow(/0–8/);
    expect(() => (loop.timeScale = Number.NaN)).toThrow(RangeError);
    expect(loop.timeScale).toBe(0.5);
  });

  it('samples per-tick commands once per tick, with the tick about to be stepped', () => {
    const sampled: number[] = [];
    const { frames, sim, loop } = setup({
      sampleCommands: (tick) => {
        sampled.push(tick);
        return [`cmd-${String(tick)}`];
      },
    });
    loop.start();
    frames.frame(3 * (1000 / 60));
    expect(sampled).toEqual([0, 1, 2]);
    expect(sim.steps).toEqual([['cmd-0'], ['cmd-1'], ['cmd-2']]);
  });

  it('mw-e00.23: while simPaused, frames render but no step runs and paused time is discarded', () => {
    let paused = true;
    const sample = vi.fn(() => ['cmd']);
    const { frames, sim, rendered, loop } = setup({
      simPaused: () => paused,
      sampleCommands: sample,
    });
    loop.start();
    for (let i = 0; i < 60; i++) frames.frame(1000 / 60);
    expect(sim.steps).toHaveLength(0);
    expect(sample).not.toHaveBeenCalled();
    expect(rendered).toHaveLength(60);
    expect(rendered.every((frame) => frame.steps === 0 && frame.alpha === 0)).toBe(true);
    paused = false;
    frames.frame(1000 / 60); // no catch-up burst: exactly one step
    expect(sim.steps).toHaveLength(1);
  });

  it('mw-e17.10: while paused, stepWhilePaused runs exactly one step per frame it asks for', () => {
    let pending = 0;
    const log: string[] = [];
    const { frames, sim, rendered, loop } = setup({
      simPaused: () => true,
      stepWhilePaused: () => pending > 0,
      sampleCommands: (tick) => {
        pending = 0;
        return [`cmd-${String(tick)}`];
      },
      onStep: (tick) => log.push(`step ${String(tick)}`),
    });
    loop.start();
    frames.frame(1000); // a long paused frame: nothing to do, no catch-up later
    pending = 1;
    frames.frame(1000);
    frames.frame(1000);
    expect(sim.steps).toEqual([['cmd-0']]);
    expect(log).toEqual(['step 1']);
    expect(rendered.map((frame) => frame.steps)).toEqual([0, 1, 0]);
  });

  it('mw-e17.10: stopping from onStep during a paused step ends the frame without rendering', () => {
    const { frames, sim, rendered, loop } = setup({
      simPaused: () => true,
      stepWhilePaused: () => true,
      onStep: () => {
        loop.stop();
      },
    });
    loop.start();
    frames.frame(1000 / 60);
    expect(sim.steps).toHaveLength(1);
    expect(rendered).toHaveLength(0);
  });

  it('steps with no commands when there is no command sampler', () => {
    const { frames, sim, loop } = setup();
    loop.start();
    frames.frame(1000 / 60);
    expect(sim.steps).toEqual([[]]);
  });

  it('calls onStep after every step with the new tick, before render', () => {
    const log: string[] = [];
    const { frames, loop } = setup({
      onStep: (tick) => log.push(`step ${String(tick)}`),
      render: ({ steps }) => log.push(`render after ${String(steps)}`),
    });
    loop.start();
    frames.frame(2 * (1000 / 60));
    expect(log).toEqual(['step 1', 'step 2', 'render after 2']);
  });

  it('stopping from onStep ends the frame after that step, without rendering', () => {
    const { frames, sim, rendered, loop } = setup({
      onStep: (tick) => {
        if (tick === 2) loop.stop();
      },
    });
    loop.start();
    frames.frame(4 * (1000 / 60));
    expect(sim.steps).toHaveLength(2);
    expect(rendered).toHaveLength(0);
    expect(frames.pending).toBe(0);
  });

  it('runs without a render callback', () => {
    const frames = new FakeFrames();
    const sim = stubSim();
    const bare = createFrameLoop({
      sim,
      hz: 60,
      now: frames.now,
      scheduler: frames,
      visibility: frames,
    });
    bare.start();
    frames.frame(1000 / 60);
    expect(sim.steps).toHaveLength(1);
    expect(bare.alpha).toBeCloseTo(0, 6);
  });

  it('ignores a clock that goes backwards', () => {
    const { frames, sim, rendered, loop } = setup();
    loop.start();
    frames.frame(-50);
    expect(sim.steps).toHaveLength(0);
    expect(rendered[0]?.alpha).toBe(0);
  });

  it('start and stop are idempotent; stop cancels the frame and unsubscribes', () => {
    const { frames, sim, loop } = setup();
    expect(loop.running).toBe(false);
    loop.start();
    loop.start();
    expect(loop.running).toBe(true);
    expect(frames.pending).toBe(1);
    loop.stop();
    loop.stop();
    expect(loop.running).toBe(false);
    expect(frames.pending).toBe(0);
    frames.setHidden(true); // no longer listening
    frames.setHidden(false);
    expect(frames.pending).toBe(0);
    loop.frame(); // stray callback after stop
    expect(sim.steps).toHaveLength(0);
  });

  it('stopping while hidden clears the pause; restarting measures time from the restart', () => {
    const { frames, sim, loop } = setup();
    loop.start();
    frames.setHidden(true);
    loop.stop();
    expect(loop.paused).toBe(false);
    frames.setHidden(false);
    frames.advance(5000);
    loop.start();
    frames.frame(1000 / 60);
    expect(sim.steps).toHaveLength(1);
  });

  it.each([0, 1.5, 1001, Number.NaN])('rejects tick rate %s', (hz) => {
    expect(() => setup({ hz })).toThrow(RangeError);
  });

  it.each([0, -1, 2.5])('rejects maxStepsPerFrame %s', (maxStepsPerFrame) => {
    expect(() => setup({ maxStepsPerFrame })).toThrow(RangeError);
  });
});
