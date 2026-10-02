// A world that owns physics survives a real save and load (mw-e30.7): the world section (v3) carries
// the physics port's state, so the game's own worlds — a scene loaded into Rapier, props falling —
// can be saved, and a load into a freshly built world gives the saved state hash and steps on
// identically. A v2 save had no physics field, so it migrates unchanged.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { loadGameContent } from '@content/index';
import { RenderSync } from '@game/loop/render-sync';
import { installGamePhysics } from '@game/physics-objects';
import { SceneLoader } from '@game/scene/index';
import { hashWorld, RapierPhysics, registerSceneComponents, World } from '@sim/index';
import { describe, expect, it } from 'vitest';
import { decodeSave, encodeSave, SaveRegistry, WORLD_SECTION_ID } from './index';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const options = { build, wallClockSavedAt: 1_790_000_000_000 };
const content = loadGameContent();

/** The testbed as the game builds it: scene geometry and props in Rapier. */
function testbed(): World {
  const physics = new RapierPhysics(RAPIER);
  const world = registerSceneComponents(new World({ seed: 5, physics }));
  installGamePhysics(world, {});
  new SceneLoader({
    world,
    sync: new RenderSync(world),
    colliders: physics,
    content,
    objects: { staticGeometry: () => ({}), spawn: () => ({}) },
    binding: (object, read) => ({ object, read, apply: () => undefined, dispose: () => undefined }),
    physics: {},
  }).load('testbed');
  return world;
}

const steps = (world: World, n: number): void => {
  for (let i = 0; i < n; i++) world.step();
};

describe('physics in saves', () => {
  it('a physics world loads into a freshly built one at the saved hash and steps on identically', () => {
    const registry = new SaveRegistry();
    const saved = testbed();
    steps(saved, 30);
    const bytes = registry.write(saved, options);

    const loaded = testbed();
    expect(registry.read(loaded, bytes)).toMatchObject({ ok: true });
    expect(loaded.tick).toBe(30);
    expect(hashWorld(loaded)).toBe(hashWorld(saved));
    steps(saved, 30);
    steps(loaded, 30);
    expect(hashWorld(loaded)).toBe(hashWorld(saved));
  });

  it('a v2 save (no physics field) migrates to v3 unchanged', () => {
    const registry = new SaveRegistry();
    const bytes = registry.write(new World({ seed: 4 }), options);
    const decoded = decodeSave(bytes);
    if (!decoded.ok) throw decoded.error;
    const { envelope } = decoded;
    const section = envelope.sections[WORLD_SECTION_ID];
    expect(section?.data).not.toHaveProperty('physics');
    const v2 = encodeSave({
      ...envelope,
      sections: { ...envelope.sections, [WORLD_SECTION_ID]: { version: 2, data: section?.data } },
    });
    const target = new World({ seed: 8 });
    expect(registry.read(target, v2)).toMatchObject({ ok: true });
    expect(target.seed).toBe(4);
  });
});
