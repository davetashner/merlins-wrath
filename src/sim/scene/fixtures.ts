// Test scenes for the sim scene tests (mw-e00.21). Plain objects: the sim may import content only as
// types, so these mirror the kit/scene content shapes without going through the content loader.
import type { KitLookup, KitPieceSpec, SceneSpec } from './layout';

export const TEST_KIT: readonly KitPieceSpec[] = [
  {
    id: 'floor',
    purpose: 'walkable',
    parts: [{ shape: 'box', size: [2, 0.2, 2], offset: [0, -0.1, 0], collider: true }],
  },
  {
    id: 'doorway',
    purpose: 'blocking',
    parts: [
      { shape: 'box', size: [0.4, 3, 0.2], offset: [-0.8, 1.5, 0], collider: true },
      { shape: 'box', size: [0.4, 3, 0.2], offset: [0.8, 1.5, 0], collider: true },
      { shape: 'box', size: [1.2, 0.8, 0.2], offset: [0, 2.6, 0], collider: true },
    ],
  },
  {
    id: 'ramp',
    purpose: 'walkable',
    parts: [{ shape: 'wedge', size: [2, 1, 3], offset: [0, 0.5, 0], collider: true }],
  },
  {
    id: 'decal',
    purpose: 'hazard',
    parts: [{ shape: 'box', size: [1, 0.01, 1], offset: [0, 0.005, 0], collider: false }],
  },
];

export const testKit: KitLookup = (id) => TEST_KIT.find((piece) => piece.id === id);

export const TEST_SCENE: SceneSpec = {
  id: 'test-room',
  grid: 1,
  placements: [
    { piece: { id: 'floor' }, at: [0, 0, 0], yaw: 0, scale: [5, 1, 5] },
    { piece: { id: 'doorway' }, at: [0, 0, 5], yaw: 90, scale: [1, 1, 1] },
    { piece: { id: 'ramp' }, at: [2, 0, 0], yaw: 180, scale: [1, 1, 1] },
    { piece: { id: 'decal' }, at: [1, 0, 1], yaw: 0, scale: [1, 1, 1], purpose: 'interactive' },
  ],
  spawns: [
    { id: 'player-start', at: [0, 0, -2], yaw: 0, tags: ['player-start'] },
    { id: 'crate', at: [1, 0, 2], yaw: 270, prop: { id: 'crate' }, tags: [] },
  ],
};
