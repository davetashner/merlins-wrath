import { describe, expect, it } from 'vitest';
import type { DoorProfile } from '../mechanisms/components';
import { testKit } from '../scene/fixtures';
import { layoutScene, type SceneSpec } from '../scene/layout';
import { bakeNavMesh } from './bake';
import { NavMesh } from './mesh';
import { sceneNavBakeInput } from './scene';

const DOOR: DoorProfile = {
  id: 'plank',
  kind: 'hinged',
  size: { x: 1.2, y: 2.2, z: 0.06 },
  seconds: 1,
  crush: 0,
  manual: true,
  blocks: { light: true, gas: true, sound: true },
  loudness: 50,
};

const materials = new Map([
  ['stone', { climbable: 'rough' as const }],
  ['ivy', { climbable: 'ivy' as const }],
  ['glass', {}],
]);

const scene: SceneSpec = {
  id: 'nav-scene',
  grid: 1,
  placements: [
    { piece: { id: 'floor' }, at: [0, 0, 0], yaw: 0, scale: [4, 1, 4] },
    {
      piece: { id: 'doorway' },
      at: [0, 0, 2],
      yaw: 0,
      scale: [1, 1, 1],
      properties: { material: { id: 'ivy' } },
    },
    {
      piece: { id: 'ramp' },
      at: [2, 0, -2],
      yaw: 90,
      scale: [1, 1, 1],
      properties: { material: { id: 'glass' } },
    },
    { piece: { id: 'decal' }, at: [1, 0, 1], yaw: 0, scale: [1, 1, 1] },
  ],
  spawns: [
    { id: 'door', at: [0, 0, 2], yaw: 0, tags: [], door: { profile: { id: 'plank' } } },
    { id: 'start', at: [0, 0, 0], yaw: 0, tags: [] },
  ],
};

describe('scene bake input (mw-e11.4)', () => {
  const layout = layoutScene(scene, testKit);
  const doors = (id: string) => (id === 'plank' ? DOOR : undefined);

  it('bakes every solid part with its piece’s climb grade, and doors as leaves', () => {
    const input = sceneNavBakeInput(layout, { doors, materials });
    expect(input.id).toBe('nav-scene');
    // floor (stone, rough: grade 2), doorway's three parts (ivy: 1), ramp (glass: none); no decal.
    expect(input.solids.map((s) => s.climbGrade)).toEqual([2, 1, 1, 1, undefined]);
    expect(input.solids[4]?.shape.kind).toBe('ramp');
    expect(input.doors).toEqual([
      { id: 'door', bounds: { min: { x: -0.6, y: 0, z: 1.97 }, max: { x: 0.6, y: 2.2, z: 2.03 } } },
    ]);
    const mesh = new NavMesh(bakeNavMesh(input));
    expect(mesh.doors).toEqual(['door']);
  });

  it('uses the given level material and refuses unknown door profiles', () => {
    const glassy = sceneNavBakeInput(layout, { doors, materials, levelMaterial: 'glass' });
    expect(glassy.solids[0]?.climbGrade).toBeUndefined();
    expect(() => sceneNavBakeInput(layout, { doors: () => undefined, materials })).toThrow(
      new RangeError('unknown door profile "plank"'),
    );
  });
});
