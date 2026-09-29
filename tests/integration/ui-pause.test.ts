// @vitest-environment happy-dom
// mw-e00.23 AC-2: a pausing screen stops the sim and gameplay input, end to end: real World, real
// frame loop (fake frames), real ActionSampler, real UiRoot and the UI ↔ game bridge.
import { describe, expect, it } from 'vitest';
import { ActionSampler } from '@game/input/index';
import { createGameLoop, FakeFrames } from '@game/loop/index';
import { createUiGameBridge } from '@game/ui/index';
import { World, type ActionFrame } from '@sim/index';
import { UiRoot } from '@ui/index';

describe('UI pause (integration)', () => {
  it('AC-2: with a pausesSim screen open, 60 ticks of gameplay keys record no action frames and the tick does not advance', () => {
    const world = new World<ActionFrame>({ seed: 1 });
    const frames = new FakeFrames(0);
    const sampler = new ActionSampler();
    const ui = new UiRoot(document.body);
    const recorded: ActionFrame[] = [];
    const bridge = createUiGameBridge({
      ui,
      sampleCommands: sampler.sampleCommands,
      drain: () => sampler.sample(),
    });
    const { loop } = createGameLoop({
      world,
      sources: { now: frames.now, scheduler: frames, visibility: frames },
      sampleCommands: (tick) => {
        const commands = bridge.sampleCommands(tick);
        recorded.push(...commands);
        return commands;
      },
      simPaused: bridge.simPaused,
      draw: () => {
        bridge.frame();
      },
    });
    loop.start();
    frames.frame(1000 / 60);
    const before = world.tick;
    expect(before).toBe(1);
    recorded.length = 0;

    const content = document.createElement('div');
    content.append(document.createElement('button'));
    ui.push({ id: 'pause', label: 'Paused', content, pausesSim: true });
    for (let tick = 0; tick < 60; tick++) {
      sampler.down(tick % 2 === 0 ? 'KeyW' : 'Space');
      frames.frame(1000 / 60);
      sampler.up(tick % 2 === 0 ? 'KeyW' : 'Space');
    }
    expect(recorded).toEqual([]);
    expect(world.tick).toBe(before);

    // Closing the menu resumes on the next frame, with no burst of catch-up ticks and no replay of
    // the keys pressed while paused.
    ui.pop();
    frames.frame(1000 / 60);
    expect(world.tick).toBe(before + 1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.jump.pressed).toBe(false);
    expect(recorded[0]?.move.y).toBe(0);
  });
});
