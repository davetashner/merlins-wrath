import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { InMemoryColliderSink } from '../physics/static-colliders';
import { TEST_SCENE, testKit } from '../scene/fixtures';
import { loadScene, registerSceneComponents } from '../scene/loader';
import { OUTSIDE_ROOM } from './graph';
import { propagateNoise } from './propagation';
import { soundGraphFromScene, type SceneAcousticsSpec } from './scene';

function loaded() {
  const world = registerSceneComponents(new World<never>({ seed: 1 }));
  return loadScene(world, TEST_SCENE, testKit, new InMemoryColliderSink());
}

const acoustics: SceneAcousticsSpec = {
  rooms: [
    { id: 'room', min: [-5, 0, -5], max: [5, 3, 5] },
    { id: 'porch', min: [-1, 0, 5], max: [1, 3, 7] },
  ],
  portals: [
    { id: 'doorway', rooms: ['room', 'porch'], at: [0, 1, 5], door: 'crate' },
    { id: 'gate', rooms: ['porch', OUTSIDE_ROOM], at: [0, 1, 7] },
  ],
  partitions: [{ rooms: ['room', 'porch'], material: 'wood' }],
};

describe('a scene’s sound graph (mw-e09.3)', () => {
  it('scales grid cells to metres and finds each portal door’s spawn entity', () => {
    const scene = loaded();
    const crate = scene.spawns.find((s) => s.spawn.id === 'crate')?.entity;
    const graph = soundGraphFromScene({ grid: 2, acoustics }, scene);
    expect(graph.rooms[0]).toMatchObject({
      min: { x: -10, y: 0, z: -10 },
      max: { x: 10, y: 6, z: 10 },
    });
    expect(graph.portals).toMatchObject([
      { id: 'doorway', position: { x: 0, y: 2, z: 10 }, door: crate },
      { id: 'gate', rooms: [1, 2], door: null },
    ]);
    expect(graph.rooms[0]?.partitions).toEqual([{ to: 1, kind: 'wall', material: 'wood' }]);
  });

  it('a scene without acoustics is all outside: distance alone', () => {
    const graph = soundGraphFromScene({ grid: 1 }, loaded());
    expect(graph.rooms.map((r) => r.id)).toEqual([OUTSIDE_ROOM]);
    expect(
      propagateNoise(graph, { x: 0, y: 0, z: 0 }, 60).hear({ x: 10, y: 0, z: 0 })?.level,
    ).toBeCloseTo(40, 10);
  });

  it('rejects a portal door no spawn is', () => {
    const portals = [
      { id: 'doorway', rooms: ['room', 'porch'] as const, at: [0, 1, 5] as const, door: 'ghost' },
    ];
    expect(() =>
      soundGraphFromScene({ grid: 1, acoustics: { ...acoustics, portals } }, loaded()),
    ).toThrow('portal "doorway" names door "ghost", no spawn');
  });
});
