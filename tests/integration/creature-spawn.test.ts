// mw-e12.4: data-defined creatures in the grey-box scenes through the game's own wiring (the sim's
// Rapier physics, scene loader, debug commands with the creature spawners, the player, combat and
// creatures: createGameWorld, as src/main.ts wires it), headless, on the debug-build content (the
// game's plus the frozen fixture creatures and the creature pen). The debug console runs against it
// exactly as in the page: typed lines become sim commands fed to the next step, and render proxies
// are bound after each step as src/main.ts binds them.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadDevContent } from '@content/dev-content';
import { markExercised } from '@content/testing';
import { bindCreatures, creatureReadout } from '@game/creatures/index';
import { ActionSampler } from '@game/input/index';
import { CommandQueue } from '@game/loop/index';
import {
  CreatureComponent,
  creatureEntities,
  DamageApplied,
  FactionMemberComponent,
  hashWorld,
  HealthComponent,
  LockOnComponent,
  TargetableComponent,
  teleportCommand,
  type DamageResult,
  type EntityId,
} from '@sim/index';
import { registerBuiltins, type ConsoleHost } from '@tools/console/builtins';
import { createGameHost } from '@tools/console/host';
import { CommandRegistry } from '@tools/console/registry';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadDevContent();

function game(scene: string, seed = 1) {
  const g = createGameWorld<unknown>(RAPIER, { seed, hz: 60, scene, content });
  const { world, sync, creatures } = g;
  const queue = new CommandQueue<unknown>();
  const host = createGameHost({
    world,
    submit: (command) => {
      queue.push(command);
    },
    player: () => g.player,
    spawnables: [...creatures.spawners.keys()].sort(),
    bookmarks: () => new Map(),
    scenes: [scene],
    loadScene: () => undefined,
    loop: { timeScale: 1 },
  });
  const console = new CommandRegistry<ConsoleHost>(host);
  registerBuiltins(console);
  const nothing = (): undefined => undefined;
  const bind = () =>
    bindCreatures(world, sync, (_entity, look) => ({
      object: look,
      read: () => undefined,
      apply: nothing,
      dispose: nothing,
    }));
  bind();
  /** One frame: a sim step with the queued commands, then render binding (as src/main.ts does). */
  const frame = (inputs: readonly unknown[] = []) => {
    world.step([...queue.drain(), ...inputs]);
    bind();
  };
  const readout = () => creatureReadout(world, (id) => sync.has(id));
  const kind = (id: EntityId) => world.get(id, CreatureComponent)?.origin.creature;
  return { ...g, console, queue, frame, readout, kind };
}

describe('creatures in the grey-box scenes (mw-e12.4)', () => {
  it('AC-3: `spawn fixture-hound 3` in the testbed makes 3 hounds with render proxies within 1 frame', ({
    task,
  }) => {
    markExercised(task, 'scene', 'testbed');
    const g = game('testbed');
    expect(g.readout()).toEqual({ count: 0, drawn: 0, inView: 0, kinds: {} });
    expect(g.console.execute('spawn fixture-hound 3')).toEqual({
      ok: true,
      lines: ['spawning 3 × fixture-hound'],
    });
    g.frame();
    expect(g.readout()).toMatchObject({ count: 3, drawn: 3, kinds: { 'fixture-hound': 3 } });
    const hounds = creatureEntities(g.world);
    expect(hounds.every((id) => g.sync.has(id))).toBe(true);
    // Lockable (the testbed player has lock-on) and hittable, in the unaligned faction.
    for (const id of hounds) {
      expect(g.world.has(id, TargetableComponent)).toBe(true);
      expect(g.world.get(id, HealthComponent)?.max).toBe(60);
      expect(g.world.get(id, FactionMemberComponent)?.faction).toBe('unaligned');
    }
    // An unknown creature is refused up front and never reaches the sim.
    expect(g.console.execute('spawn fixture-wyvern').ok).toBe(false);
    expect(g.queue.size).toBe(0);
    // `despawn all` removes them, and render sync drops their proxies.
    g.console.execute('despawn all');
    g.frame();
    expect(g.readout().count).toBe(0);
    expect(hounds.some((id) => g.world.isAlive(id))).toBe(false);
  });

  it('AC-5 (headless): the creature pen loads its 4 creature spawns, each drawn, with no spawn errors', () => {
    const g = game('creature-pen');
    expect(g.sceneCreatures.errors).toEqual([]);
    expect(g.sceneCreatures.entities.map(g.kind)).toEqual([
      'fixture-hound',
      'fixture-hound',
      'fixture-guard',
      'fixture-sentinel',
    ]);
    expect(g.readout()).toMatchObject({
      count: 4,
      drawn: 4,
      kinds: { 'fixture-guard': 1, 'fixture-hound': 2, 'fixture-sentinel': 1 },
    });
    // In view: a stand-in projection that puts everything beyond z = 3.5 m past the far plane (the
    // sentinel's corner) and everything else on screen.
    const project = (p: { x: number; y: number; z: number }) => ({
      x: 0,
      y: 0,
      z: p.z > 3.5 ? 2 : 0,
    });
    expect(creatureReadout(g.world, (id) => g.sync.has(id), project).inView).toBe(3);
    expect(g.readout().inView).toBe(0); // no projection: nothing counted in view
    const [, , guard] = g.sceneCreatures.entities;
    expect(g.world.get(guard ?? 0, CreatureComponent)?.origin).toMatchObject({
      point: 'guard-post',
      facing: { x: 0, y: 0, z: -1 },
      patrol: [
        { x: -4, y: 0, z: 3 },
        { x: 4, y: 0, z: 3 },
      ],
    });
  });

  it('AC-1 (game wiring): two pens with the same seed step to the same state hash', () => {
    const a = game('creature-pen', 9);
    const b = game('creature-pen', 9);
    for (let i = 0; i < 120; i++) {
      a.frame();
      b.frame();
    }
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
  });

  it('the knight’s sword hurts a creature, and he locks on to creatures', () => {
    const g = game('creature-pen');
    const [, , guard] = g.sceneCreatures.entities; // the guard at (0, 0, 3)
    const hits: DamageResult[] = [];
    g.world.events.on(DamageApplied, (e) => hits.push(e));
    g.frame();
    // A step in front of the guard, looking at it (the player start looks along +z).
    g.frame([teleportCommand(g.player, { x: 0, y: 0, z: 1.8 })]);
    for (let i = 0; i < 10; i++) g.frame();
    const sampler = new ActionSampler();
    const press = (code: string) => {
      sampler.down(code);
      g.frame(sampler.sampleCommands(g.world.tick));
      sampler.up(code);
      g.frame();
    };
    press('Mouse0');
    for (let i = 0; i < 40; i++) g.frame();
    expect(hits.map((h) => h.target)).toContain(guard);
    expect(g.world.get(guard ?? 0, HealthComponent)?.current).toBeLessThan(100);
    press('KeyQ');
    const locked = g.world.get(g.player, LockOnComponent)?.target ?? 0;
    expect(g.sceneCreatures.entities).toContain(locked);
  });
});
