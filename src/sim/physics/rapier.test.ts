// The Rapier physics port (mw-e03.35). Vitest loads the real deterministic WASM build (vite.config.ts:
// vite-plugin-wasm plus an alias to the package's ES entry), so these run the engine the game ships.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box, rampAt, type GreyboxShape } from '../character/greybox';
import { World } from '../core/world';
import { TEST_SCENE, testKit } from '../scene/fixtures';
import { loadScene, registerSceneComponents, unloadScene } from '../scene/loader';
import { diffSnapshots, hashWorld } from '../snapshot';
import type { Vec3 } from '../stimulus/shapes';
import { decodeBase64, encodeBase64 } from './base64';
import { PhysicsStateError, type PhysicsState } from './port';
import { DEFAULT_GRAVITY, RapierPhysics } from './rapier';
import type { ColliderHandle } from './static-colliders';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const PLATFORM: GreyboxShape = { ...box(v(0, 0, 0), v(2, 0.2, 2)), velocity: v(0.5, 0, -0.25) };

/** A world owning Rapier physics with TEST_SCENE loaded and a moving platform, never stepped. */
function sceneWorld() {
  const physics = new RapierPhysics(RAPIER);
  const world = registerSceneComponents(new World({ seed: 9, physics }));
  const loaded = loadScene(world, TEST_SCENE, testKit, physics);
  physics.add(PLATFORM);
  return { world, physics, loaded };
}

/** A world like sceneWorld's, for restoring snapshots into (scene components registered, no scene). */
function emptyWorld() {
  const physics = new RapierPhysics(RAPIER);
  return { world: registerSceneComponents(new World({ seed: 9, physics })), physics };
}

/** Where Rapier has a collider `physics` added (read from a snapshot, so the port stays untouched). */
function colliderAt(physics: RapierPhysics, handle: ColliderHandle): Vec3 {
  const data = physics.snapshot().data as { world: string; colliders: number[][] };
  const row = data.colliders.find(([h]) => h === handle) ?? [];
  const restored = RAPIER.World.restoreSnapshot(decodeBase64(data.world));
  const at = restored.getCollider(row[1] ?? -1).translation();
  restored.free();
  return { x: at.x, y: at.y, z: at.z };
}

describe('Rapier physics port (mw-e03.35)', () => {
  it('AC-1: a greybox scene loaded into the Rapier sink leaves zero colliders once unloaded', () => {
    const physics = new RapierPhysics(RAPIER);
    const world = registerSceneComponents(new World({ seed: 1, physics }));
    const loaded = loadScene(world, TEST_SCENE, testKit, physics);
    // Floor, three doorway parts and a ramp are solid; the decal is not.
    expect(loaded.colliders).toHaveLength(5);
    expect(physics.count()).toBe(5);
    world.step();
    unloadScene(world, loaded, physics);
    expect(physics.count()).toBe(0);
    world.step();
    expect(physics.count()).toBe(0);
  });

  it('AC-2: the same scene run for 600 ticks twice gives identical state hashes, physics included', () => {
    const run = () => {
      const { world } = sceneWorld();
      const hashes: string[] = [];
      for (let tick = 0; tick < 600; tick++) {
        world.step();
        if (tick % 100 === 99) hashes.push(hashWorld(world));
      }
      return { hashes, snapshot: world.snapshot() };
    };
    const first = run();
    const second = run();
    expect(second.hashes).toEqual(first.hashes);
    expect(new Set(first.hashes).size).toBe(first.hashes.length); // the platform moves: physics is hashed
    expect(diffSnapshots(first.snapshot, second.snapshot)).toBeUndefined();
    expect(first.snapshot.physics?.engine).toBe(`rapier3d-deterministic@${RAPIER.version()}`);
  });

  it('AC-3: a snapshot taken at tick 300 and restored into a new World reaches the same hash at 600', () => {
    const { world: uninterrupted } = sceneWorld();
    for (let tick = 0; tick < 600; tick++) uninterrupted.step();

    const { world: first } = sceneWorld();
    for (let tick = 0; tick < 300; tick++) first.step();
    // Through JSON, as a save or a replay checkpoint would store it.
    const saved = JSON.parse(JSON.stringify(first.snapshot())) as ReturnType<World['snapshot']>;

    const { world: resumed } = emptyWorld();
    resumed.restore(saved);
    expect(hashWorld(resumed)).toBe(hashWorld(first));
    for (let tick = 300; tick < 600; tick++) resumed.step();
    expect(resumed.tick).toBe(600);
    expect(hashWorld(resumed)).toBe(hashWorld(uninterrupted));
  });

  it('keeps handles valid across a restore, so a restored scene unloads cleanly', () => {
    const { world, loaded } = sceneWorld();
    world.step();
    const { world: copy, physics } = emptyWorld();
    copy.restore(world.snapshot());
    expect(physics.count()).toBe(6);
    unloadScene(copy, loaded, physics);
    expect(physics.count()).toBe(1); // the platform
    // New handles carry on from the restored counter.
    expect(physics.add(box(v(0, 0, 0), v(1, 1, 1)))).toBe(7);
  });

  it('moves a kinematic collider at its velocity on every step and not before', () => {
    const physics = new RapierPhysics(RAPIER);
    const handle = physics.add(PLATFORM);
    expect(colliderAt(physics, handle)).toEqual(v(1, 0.10000000149011612, 1));
    const world = new World({ seed: 1, physics });
    for (let tick = 0; tick < 60; tick++) world.step();
    const at = colliderAt(physics, handle);
    // Rapier works in 32-bit floats.
    expect(at.x).toBeCloseTo(1.5, 4);
    expect(at.z).toBeCloseTo(0.75, 4);
    physics.remove(handle);
    expect(physics.count()).toBe(0);
  });

  it('builds a ramp from its wedge corners', () => {
    const physics = new RapierPhysics(RAPIER, { gravity: v(0, -1, 0) });
    for (const rises of ['+x', '-x', '+z', '-z'] as const) {
      physics.add({ kind: 'ramp', min: v(-1, 0, -1), max: v(1, 2, 1), rises });
    }
    physics.add(rampAt(v(5, 0, 0), 30, 1, 2));
    expect(physics.count()).toBe(5);
  });

  it('refuses shapes with no volume, and removing an unknown or removed handle', () => {
    const physics = new RapierPhysics(RAPIER);
    expect(() => physics.add(box(v(0, 0, 0), v(1, 0, 1)))).toThrow(
      'greybox box: max.y must be above min.y',
    );
    expect(() =>
      physics.add({ kind: 'ramp', min: v(0, 0, 0), max: v(0, 1, 1), rises: '+z' }),
    ).toThrow('greybox ramp: max.x must be above min.x');
    const handle = physics.add(box(v(0, 0, 0), v(1, 1, 1)));
    physics.remove(handle);
    expect(() => {
      physics.remove(handle);
    }).toThrow(`collider ${String(handle)} is not in this sink`);
    expect(physics.count()).toBe(0);
  });

  it('defaults to standard gravity', () => {
    expect(DEFAULT_GRAVITY).toEqual(v(0, -9.81, 0));
  });

  describe('restore', () => {
    const good = (): { physics: RapierPhysics; state: PhysicsState } => {
      const physics = new RapierPhysics(RAPIER);
      physics.add(box(v(0, 0, 0), v(1, 1, 1)));
      physics.add(PLATFORM);
      return { physics, state: physics.snapshot() };
    };
    const withData = (state: PhysicsState, data: Record<string, unknown>): PhysicsState => ({
      ...state,
      data: { ...(state.data as object), ...data },
    });

    it('refuses state from another engine', () => {
      const { physics, state } = good();
      expect(() => {
        physics.restore({ ...state, engine: 'reference@1' });
      }).toThrow(
        new PhysicsStateError(
          `physics state from reference@1 cannot be restored into ${physics.engine}`,
        ),
      );
    });

    it.each<[string, unknown]>([
      ['not an object', null],
      ['a missing world', { next: 1, colliders: [] }],
      ['a fractional next handle', { world: '', next: 1.5, colliders: [] }],
      ['no collider table', { world: '', next: 1 }],
      ['a malformed collider row', { world: '', next: 1, colliders: [[1]] }],
      ['a non-numeric collider row', { world: '', next: 1, colliders: [[1, 'a']] }],
      ['a world that is not base64', { world: 'A!==', next: 1, colliders: [] }],
    ])('refuses malformed data: %s', (_, data) => {
      const { physics, state } = good();
      expect(() => {
        physics.restore({ ...state, data });
      }).toThrow('malformed Rapier physics state');
      expect(physics.count()).toBe(2); // unchanged
    });

    it('refuses bytes Rapier cannot read, keeping the current state', () => {
      const { physics, state } = good();
      const garbage = withData(state, { world: encodeBase64(new Uint8Array([1, 2, 3])) });
      expect(() => {
        physics.restore(garbage);
      }).toThrow('Rapier could not read the physics state');
      expect(physics.count()).toBe(2);
    });

    it('refuses a handle table naming colliders or bodies the Rapier state lacks', () => {
      const { physics, state } = good();
      const { colliders } = state.data as { colliders: number[][] };
      // Rapier handles are 64-bit floats whose low 32 bits are the arena index.
      const index50 = new Float64Array(new Uint32Array([50, 0]).buffer)[0] ?? 0;
      expect(() => {
        physics.restore(withData(state, { colliders: [...colliders, [3, index50]] }));
      }).toThrow('physics state has no collider for handle 3');
      const [first = [], second = []] = colliders;
      expect(() => {
        physics.restore(withData(state, { colliders: [first, [second[0], second[1], index50]] }));
      }).toThrow(`physics state has no collider for handle ${String(second[0])}`);
      expect(physics.count()).toBe(2);
      physics.restore(state);
      expect(physics.count()).toBe(2);
    });

    it('frees the Rapier world on dispose', () => {
      const { physics } = good();
      physics.dispose();
      expect(() => physics.count()).toThrow();
    });
  });
});
