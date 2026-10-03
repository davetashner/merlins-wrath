import { compileCreatures } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import {
  aiSnapshotter,
  buildFactionTable,
  compileBehaviours,
  emitNoise,
  factionSpecFromDef,
  installAi,
  installFactions,
  noiseHeard,
  registerCreatureComponents,
  spawnCreature,
  World,
  type EntityId,
  type NoiseEvent,
} from '@sim/index';
import { describe, expect, it, vi } from 'vitest';
import { AiDebug, MAX_NOISES, NOISE_RING_S } from './controller';

const content = loadFixtureContent();
const creatures = compileCreatures(content.all('creature'), content);
const factions = buildFactionTable(content.all('faction').map(factionSpecFromDef));

/** A world with `n` fixture guards standing in a row, 4 m apart, facing −z. */
function guardWorld(n: number): { world: World<never>; guards: EntityId[] } {
  const world = installFactions(registerCreatureComponents(new World<never>({ seed: 5 })));
  installAi(world, { behaviours: compileBehaviours(content.all('behaviour')) });
  const guards: EntityId[] = [];
  for (let i = 0; i < n; i++) {
    const result = spawnCreature(
      world,
      { creatures, factions },
      { creature: 'fixture-guard', at: { x: i * 4, y: 0, z: -6 }, facing: { x: 0, y: 0, z: -1 } },
    );
    if (!result.ok) throw new Error(result.error.kind);
    guards.push(result.entity);
  }
  world.step();
  return { world, guards };
}

function setup(n = 3) {
  const { world, guards } = guardWorld(n);
  const loop = { stepOnce: vi.fn() };
  const snapshotter = aiSnapshotter(world);
  let cursor: { x: number; y: number; z: number } | undefined = { x: 1.04, y: 0, z: 2 };
  const light = { levelAt: vi.fn(() => 0.456) };
  const debug = new AiDebug({ world, loop, snapshotter, light, cursorPoint: () => cursor });
  return {
    world,
    guards,
    loop,
    snapshotter,
    debug,
    light,
    setCursor: (p: typeof cursor) => (cursor = p),
  };
}

describe('AI debug controller (mw-e11.17)', () => {
  it('AC-5: with the overlay off, the sim runs and frames draw but no snapshot is built and nothing is heard', () => {
    const { world, debug, snapshotter, light } = setup();
    for (let i = 0; i < 120; i++) {
      world.step();
      emitNoise(world, { position: { x: 0, y: 0, z: 0 }, loudness: 60, kind: 'pot' });
      expect(debug.frame()).toBeUndefined();
    }
    expect(snapshotter.builds).toBe(0);
    expect(debug.builds).toBe(0);
    expect(light.levelAt).not.toHaveBeenCalled();
    debug.enabled = true;
    expect(debug.frame()?.model.noises).toEqual([]); // nothing was remembered while off
    expect(debug.builds).toBe(1);
  });

  it('builds one snapshot per sim tick, not per frame; selection and freeze changes rebuild', () => {
    const { world, guards, debug } = setup();
    debug.enabled = true;
    debug.enabled = true; // no-op
    const first = debug.frame();
    expect(first?.snapshot.agents).toHaveLength(3);
    expect(debug.frame()).toBe(first);
    expect(debug.builds).toBe(1);
    world.step();
    expect(debug.frame()?.snapshot.tick).toBe(world.tick);
    expect(debug.builds).toBe(2);
    debug.selected = guards[1];
    debug.selected = guards[1]; // no-op
    expect(debug.frame()?.snapshot.agents[1]?.detail?.entity).toBe(guards[1]);
    debug.frozen = true;
    expect(debug.frame()?.model.status[0]).toMatch(/FROZEN/);
    expect(debug.builds).toBe(4);
  });

  it('reads the light probe every frame and remodels only when it changes', () => {
    const { debug, light, setCursor } = setup(1);
    debug.enabled = true;
    const a = debug.frame();
    expect(a?.model.probe).toEqual({ point: { x: 1, y: 0, z: 2 } });
    expect(a?.model.status.at(-1)).toBe('light 0.46 at (1.0, 0.0, 2.0)');
    expect(debug.frame()).toBe(a);
    setCursor({ x: 3, y: 0, z: 2 });
    const b = debug.frame();
    expect(b).not.toBe(a);
    expect(b?.snapshot).toBe(a?.snapshot);
    light.levelAt.mockReturnValue(0.9);
    expect(debug.frame()?.model.status.at(-1)).toBe('light 0.90 at (3.0, 0.0, 2.0)');
    setCursor(undefined);
    expect(debug.frame()?.model.probe).toBeNull();
    setCursor({ x: 3, y: 0, z: 2 });
    expect(debug.frame()?.model.probe).toEqual({ point: { x: 3, y: 0, z: 2 } });
    expect(debug.builds).toBe(1);
  });

  it('without a light field there is no probe', () => {
    const { world } = guardWorld(1);
    const debug = new AiDebug({
      world,
      loop: { stepOnce: vi.fn() },
      cursorPoint: () => ({ x: 0, y: 0, z: 0 }),
    });
    debug.enabled = true;
    expect(debug.frame()?.model.probe).toBeNull();
  });

  it('remembers noises while on — rings with routes to the listeners that heard them — and forgets them when off', () => {
    const { world, guards, debug } = setup(2);
    debug.enabled = true;
    emitNoise(world, { position: { x: 1, y: 0, z: 1 }, loudness: 62, kind: 'pot' });
    world.step();
    let frame = debug.frame();
    expect(frame?.model.noises).toHaveLength(1);
    const noise: NoiseEvent = {
      tick: world.tick - 1,
      position: { x: 1, y: 0, z: 1 },
      loudness: 62,
      kind: 'pot',
      entity: null,
      source: null,
      tags: [],
    };
    const heard = (listener: EntityId, via: string | null) => ({
      tick: world.tick,
      listener,
      noise,
      level: 40,
      perceived: { x: 2, y: 0, z: 2 },
      via,
      occlusion: 0,
    });
    world.events.emit(noiseHeard, heard(guards[0] ?? 0, null));
    world.events.emit(noiseHeard, heard(guards[1] ?? 0, 'door-1'));
    world.events.emit(noiseHeard, heard(999, null)); // a listener without a placement
    world.events.emit(noiseHeard, { ...heard(guards[0] ?? 0, null), noise: { ...noise, tick: 0 } });
    world.step();
    frame = debug.frame();
    expect(frame?.model.noises[0]?.routes).toEqual([
      [
        { x: 1, y: 0, z: 1 },
        { x: 0, y: 0, z: -6 },
      ],
      [
        { x: 1, y: 0, z: 1 },
        { x: 2, y: 0, z: 2 },
        { x: 4, y: 0, z: -6 },
      ],
    ]);
    expect(frame?.model.status).toContain('noise pot 62 dB → heard 40/40 dB');
    // Rings fade after NOISE_RING_S seconds.
    for (let i = 0; i < NOISE_RING_S * world.clock.hz; i++) world.step();
    expect(debug.frame()?.model.noises).toEqual([]);
    // At most MAX_NOISES at once, the oldest dropped first.
    for (let i = 0; i < MAX_NOISES + 3; i++) {
      emitNoise(world, { position: { x: i, y: 0, z: 0 }, loudness: 50, kind: `n${String(i)}` });
    }
    world.step();
    const status = debug.frame()?.model.status ?? [];
    expect(status.filter((line) => line.startsWith('noise'))).toHaveLength(MAX_NOISES);
    expect(status).not.toContain('noise n0 50 dB');
    debug.dispose();
    expect(debug.enabled).toBe(false);
    emitNoise(world, { position: { x: 0, y: 0, z: 0 }, loudness: 50, kind: 'late' });
    world.step();
    debug.enabled = true;
    expect(debug.frame()?.model.noises).toEqual([]);
  });

  it('step freezes the sim and asks the loop for exactly one step', () => {
    const { debug, loop } = setup(1);
    expect(debug.held).toBe(false);
    debug.step();
    expect(debug.held).toBe(true);
    expect(debug.frozen).toBe(true);
    expect(loop.stepOnce).toHaveBeenCalledTimes(1);
    debug.frozen = false;
    expect(debug.held).toBe(false);
  });

  it('picks the agent a ray points at, from the last frame or a fresh snapshot', () => {
    const { guards, debug } = setup(3);
    const toward = (x: number) => ({
      origin: { x, y: 1.2, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
    });
    expect(debug.pick(toward(4))).toBe(guards[1]);
    expect(debug.selected).toBe(guards[1]);
    debug.enabled = true;
    debug.frame();
    expect(debug.pick(toward(8))).toBe(guards[2]);
    expect(debug.pick(toward(40))).toBeUndefined();
    expect(debug.selected).toBe(guards[2]);
  });
});
