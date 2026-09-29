import { describe, expect, it } from 'vitest';
import { TEST_SCENE, testKit } from './fixtures';
import { layoutScene } from './layout';
import { sceneCollisionWorld } from './collision';

const DOWN = { x: 0, y: -1, z: 0 };

describe('sceneCollisionWorld (mw-e02.23)', () => {
  const layout = layoutScene(TEST_SCENE, testKit);
  const world = sceneCollisionWorld(layout);

  it('collides with every solid part of the scene', () => {
    // The floor tops out at y = 0.
    expect(world.raycast({ x: -3, y: 5, z: -3 }, DOWN, 10)?.distance).toBeCloseTo(5, 12);
    // The doorway's lintel (turned 90°, at x = 0, z = 5) is solid too.
    const lintel = world.raycast({ x: 0, y: 5, z: 5 }, DOWN, 10);
    expect(lintel?.point.y).toBeCloseTo(3, 12);
  });

  it('skips parts without a collider (the decal)', () => {
    // The decal lies 1 cm proud of the floor over x, z ∈ [0.5, 1.5]; a ray through it reaches the
    // floor (x < 1 keeps clear of the ramp).
    expect(world.raycast({ x: 0.75, y: 5, z: 1.25 }, DOWN, 10)?.point.y).toBeCloseTo(0, 12);
  });

  it('gives each solid part its own body, in part order', () => {
    const solid = layout.parts.filter((part) => part.collider !== undefined);
    const hit = world.raycast({ x: 0, y: 5, z: 5 }, DOWN, 10);
    expect(solid[(hit?.body ?? 0) - 1]?.piece).toBe('doorway');
  });
});
