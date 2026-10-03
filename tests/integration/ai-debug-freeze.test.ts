// @vitest-environment happy-dom
// mw-e11.17 AC-3: the AI debug overlay's freeze and step on the game's own frame loop. Three frozen
// fixture guards stand in a world driven by createGameLoop on fake 60 Hz frames, with the overlay
// on and drawn every frame (the overlay's held flag ORed into simPaused, as src/main.ts wires it).
// After `ai.freeze`, 60 rendered frames leave the sim tick where it was; `ai.step` advances it by
// exactly one tick, then it holds again.
import { compileCreatures } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import { markExercised } from '@content/testing';
import { createGameLoop, FakeFrames } from '@game/loop/index';
import {
  buildFactionTable,
  compileBehaviours,
  factionSpecFromDef,
  installAi,
  installFactions,
  registerCreatureComponents,
  registerSceneComponents,
  spawnCreature,
  World,
} from '@sim/index';
import type { ConsoleHost } from '@tools/console/builtins';
import { createGameHost } from '@tools/console/host';
import { CommandRegistry } from '@tools/console/registry';
import { startAiDebug, type AiDebugSession } from '@tools/ai-debug/start';
import { PerspectiveCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';

describe('AI debug freeze and step (mw-e11.17)', () => {
  it('AC-3: after ai.freeze, 60 rendered frames do not advance the sim tick; ai.step advances exactly 1', ({
    task,
  }) => {
    markExercised(task, 'creature', 'fixture-guard');
    const content = loadFixtureContent();
    const creatures = compileCreatures(content.all('creature'), content);
    const factions = buildFactionTable(content.all('faction').map(factionSpecFromDef));
    const world = installFactions(
      registerCreatureComponents(registerSceneComponents(new World<never>({ seed: 9 }))),
    );
    installAi(world, { behaviours: compileBehaviours(content.all('behaviour')) });
    for (const x of [-3, 0, 3]) {
      const spawned = spawnCreature(
        world,
        { creatures, factions },
        { creature: 'fixture-guard', at: { x, y: 0, z: -8 } },
      );
      expect(spawned.ok).toBe(true);
    }
    const registry = new CommandRegistry<ConsoleHost>(
      createGameHost({
        world,
        submit: () => undefined,
        player: () => undefined,
        spawnables: [],
        bookmarks: () => new Map(),
        scenes: [],
        loadScene: () => undefined,
        loop: { timeScale: 1 },
      }),
    );
    const frames = new FakeFrames(1000);
    const ref: { session?: AiDebugSession } = {};
    let drawn = 0;
    const { loop } = createGameLoop({
      world,
      sources: { now: frames.now, scheduler: frames, visibility: frames },
      simPaused: () => ref.session?.held() === true,
      draw: () => {
        ref.session?.frame();
        drawn++;
      },
      warn: () => undefined,
    });
    const root = document.createElement('div');
    document.body.append(root);
    const session = startAiDebug({
      world,
      loop,
      registry,
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      root,
      pointerLocked: () => false,
    });
    ref.session = session;
    expect(registry.execute('ai.debug on').ok).toBe(true);
    loop.start();
    for (let i = 0; i < 30; i++) frames.frame(1000 / 60);
    expect(world.tick).toBe(30);
    expect(session.debug.frame()?.snapshot.agents).toHaveLength(3);

    expect(registry.execute('ai.freeze').ok).toBe(true);
    const frozenAt = world.tick;
    const before = drawn;
    for (let i = 0; i < 60; i++) frames.frame(1000 / 60);
    expect(drawn - before).toBe(60);
    expect(world.tick).toBe(frozenAt);

    expect(registry.execute('ai.step').ok).toBe(true);
    for (let i = 0; i < 60; i++) frames.frame(1000 / 60);
    expect(world.tick).toBe(frozenAt + 1);
    expect(session.debug.frame()?.snapshot.tick).toBe(frozenAt + 1);

    // Unfrozen, it runs on.
    expect(registry.execute('ai.freeze off').ok).toBe(true);
    for (let i = 0; i < 10; i++) frames.frame(1000 / 60);
    expect(world.tick).toBe(frozenAt + 11);
  });
});
