import { describe, expect, it } from 'vitest';
import type { SceneYaw } from '@content/index';
import { World } from '../core/world';
import { at as nth } from '../geom/vec';
import { addProperties, assignProperty, registerWorldProperties } from '../properties/components';
import type { ColliderHandle, StaticColliderSink } from '../physics/static-colliders';
import {
  layoutScene,
  type KitLookup,
  type KitPieceSpec,
  type LedgeOverrideSpec,
  type ScenePlacementSpec,
  type SceneSpec,
  type Triple,
} from '../scene/layout';
import { loadScene, registerSceneComponents } from '../scene/loader';
import { DEFAULT_LEDGE_CONFIG, extractLedges, LedgeIndex, sceneLedges, type Ledge } from './ledges';

const KIT: readonly KitPieceSpec[] = [
  {
    id: 'floor',
    purpose: 'walkable',
    parts: [{ shape: 'box', size: [2, 0.2, 2], offset: [0, -0.1, 0], collider: true }],
  },
  {
    id: 'block',
    purpose: 'climbable',
    parts: [{ shape: 'box', size: [1, 1.5, 1], offset: [0, 0.75, 0], collider: true }],
  },
  {
    id: 'wide-block',
    purpose: 'climbable',
    parts: [{ shape: 'box', size: [2, 1.5, 1], offset: [0, 0.75, 0], collider: true }],
  },
  {
    id: 'beam',
    purpose: 'climbable',
    parts: [{ shape: 'box', size: [5, 1.5, 1], offset: [0, 0.75, 0], collider: true }],
  },
  {
    id: 'step',
    purpose: 'walkable',
    parts: [{ shape: 'box', size: [1, 0.3, 1], offset: [0, 0.15, 0], collider: true }],
  },
  {
    id: 'ramp',
    purpose: 'walkable',
    parts: [{ shape: 'wedge', size: [1, 1.5, 1], offset: [0, 0.75, 0], collider: true }],
  },
  {
    id: 'ghost',
    purpose: 'hazard',
    parts: [{ shape: 'box', size: [1, 1.5, 1], offset: [0, 0.75, 0], collider: false }],
  },
  {
    id: 'two-part',
    purpose: 'blocking',
    parts: [
      { shape: 'box', size: [1, 1.5, 1], offset: [-2, 0.75, 0], collider: true },
      { shape: 'box', size: [1, 1.5, 1], offset: [2, 0.75, 0], collider: true },
    ],
  },
];
const kit: KitLookup = (id) => KIT.find((piece) => piece.id === id);

interface Place {
  readonly at?: Triple;
  readonly yaw?: SceneYaw;
  readonly ledges?: readonly LedgeOverrideSpec[];
}

const place = (piece: string, { at = [0, 0, 0], yaw = 0, ledges }: Place = {}) =>
  ({
    piece: { id: piece },
    at,
    yaw,
    scale: [1, 1, 1],
    ...(ledges !== undefined && { ledges }),
  }) satisfies ScenePlacementSpec;

const scene = (...placements: ScenePlacementSpec[]): SceneSpec => ({
  id: 'ledges',
  grid: 1,
  placements,
  spawns: [],
});

/** A 10 m floor under everything, so its own edges are far from the pieces under test. */
const FLOOR = { ...place('floor'), scale: [5, 1, 5] as Triple };

const ledgesOf = (s: SceneSpec) => extractLedges(layoutScene(s, kit));
const on = (ledges: readonly Ledge[], placement: number) =>
  ledges.filter((ledge) => ledge.placement === placement);
const sides = (ledges: readonly Ledge[]) => ledges.map((ledge) => ledge.side);
const length = ({ start, end }: Ledge) => end.x - start.x + (end.z - start.z);

describe('ledge extraction (mw-e03.22)', () => {
  it('AC-1: a 1.5 m box has ledges along its four top edges and none along vertical edges', () => {
    const ledges = on(ledgesOf(scene(FLOOR, place('block'))), 1);
    expect(sides(ledges)).toEqual(['-x', '+x', '-z', '+z']);
    for (const ledge of ledges) {
      // Horizontal, at the top of the box, 1 m long, facing out of it.
      expect(ledge.start.y).toBe(1.5);
      expect(ledge.end.y).toBe(1.5);
      expect(length(ledge)).toBe(1);
      expect(ledge.part).toBe(0);
    }
    expect(ledges[0]).toMatchObject({
      start: { x: -0.5, y: 1.5, z: -0.5 },
      end: { x: -0.5, y: 1.5, z: 0.5 },
      normal: { x: -1, y: 0, z: 0 },
    });
    expect(ledges[3]).toMatchObject({
      start: { x: -0.5, y: 1.5, z: 0.5 },
      end: { x: 0.5, y: 1.5, z: 0.5 },
      normal: { x: 0, y: 0, z: 1 },
    });
  });

  it('a step lower than the minimum drop is not a ledge; the floor under the box is not either', () => {
    const ledges = ledgesOf(scene(FLOOR, place('step', { at: [3, 0, 3] })));
    expect(on(ledges, 1)).toEqual([]);
    // The floor floats over nothing, so its outer edges are ledges (a pit edge).
    expect(sides(on(ledges, 0))).toEqual(['-x', '+x', '-z', '+z']);
  });

  it('a box stacked on another covers its top edges; neighbours of the same height hide the shared edge', () => {
    const stacked = ledgesOf(scene(FLOOR, place('block'), place('block', { at: [0, 1.5, 0] })));
    expect(on(stacked, 1)).toEqual([]);
    expect(sides(on(stacked, 2))).toEqual(['-x', '+x', '-z', '+z']);
    const side = ledgesOf(scene(FLOOR, place('block'), place('block', { at: [1, 0, 0] })));
    expect(sides(on(side, 1))).toEqual(['-x', '-z', '+z']);
    expect(sides(on(side, 2))).toEqual(['+x', '-z', '+z']);
  });

  it('a neighbour covering part of an edge splits it; slivers shorter than minLength are dropped', () => {
    // A 2 m block with a 1 m block against half of its +z side.
    const split = ledgesOf(scene(FLOOR, place('wide-block'), place('block', { at: [0.5, 0, 1] })));
    const plusZ = on(split, 1).filter((ledge) => ledge.side === '+z');
    expect(plusZ.map((l) => [l.start.x, l.end.x])).toEqual([[-1, 0]]);
    // Shifted so it leaves 0.25 m uncovered: shorter than 0.3 m, dropped.
    const sliver = ledgesOf(
      scene(FLOOR, place('block'), place('wide-block', { at: [-0.75, 0, 1] })),
    );
    const cut = on(sliver, 1).filter((ledge) => ledge.side === '+z');
    expect(cut).toEqual([]);
    const coarse = extractLedges(
      layoutScene(scene(FLOOR, place('block'), place('wide-block', { at: [-0.75, 0, 1] })), kit),
      { ...DEFAULT_LEDGE_CONFIG, minLength: 0.2 },
    );
    expect(
      on(coarse, 1)
        .filter((ledge) => ledge.side === '+z')
        .map((l) => [l.start.x, l.end.x]),
    ).toEqual([[0.25, 0.5]]);
  });

  it('several neighbours along one edge leave the gaps between them, in order along the edge', () => {
    const ledges = ledgesOf(
      scene(
        FLOOR,
        place('beam'),
        place('block', { at: [1, 0, 1] }),
        place('block', { at: [-1.5, 0, 1] }),
      ),
    );
    const plusZ = on(ledges, 1).filter((ledge) => ledge.side === '+z');
    expect(plusZ.map((l) => [l.start.x, l.end.x])).toEqual([
      [-2.5, -2],
      [-1, 0.5],
      [1.5, 2.5],
    ]);
  });

  it('ramps and non-solid parts have no ledges; ramps block, non-solid parts do not', () => {
    const ledges = ledgesOf(
      scene(
        FLOOR,
        place('ramp', { at: [1, 0, 0] }),
        place('block'),
        place('ghost', { at: [-1, 0, 0] }),
      ),
    );
    expect(on(ledges, 1)).toEqual([]);
    expect(on(ledges, 3)).toEqual([]);
    expect(sides(on(ledges, 2))).toEqual(['-x', '-z', '+z']);
  });

  it('AC-2: an edge override disable leaves no ledge there; overrides follow the piece’s yaw', () => {
    const off = (side: '+x' | '+z', yaw: SceneYaw) =>
      sides(
        on(ledgesOf(scene(FLOOR, place('block', { yaw, ledges: [{ side, ledge: false }] }))), 1),
      );
    expect(off('+z', 0)).toEqual(['-x', '+x', '-z']);
    // Yaw 90 turns local +z to world +x, and local +x to world -z; 180 and 270 turn +x to -x and +z.
    expect(off('+z', 90)).toEqual(['-x', '-z', '+z']);
    expect(off('+x', 90)).toEqual(['-x', '+x', '+z']);
    expect(off('+x', 180)).toEqual(['+x', '-z', '+z']);
    expect(off('+x', 270)).toEqual(['-x', '+x', '-z']);
    // Without a side, every edge goes.
    expect(on(ledgesOf(scene(FLOOR, place('block', { ledges: [{ ledge: false }] }))), 1)).toEqual(
      [],
    );
  });

  it('AC-2: an override can target one part; enable forces a whole edge; the later override wins', () => {
    const parts = ledgesOf(
      scene(FLOOR, place('two-part', { ledges: [{ part: 1, ledge: false }] })),
    );
    expect(on(parts, 1).map((ledge) => ledge.part)).toEqual([0, 0, 0, 0]);
    const forced = on(
      ledgesOf(scene(FLOOR, place('step', { ledges: [{ side: '-x', ledge: true }] }))),
      1,
    );
    expect(forced).toMatchObject([{ side: '-x', start: { x: -0.5, y: 0.3, z: -0.5 } }]);
    const lastWins = on(
      ledgesOf(
        scene(
          FLOOR,
          place('block', { ledges: [{ ledge: false }, { side: '+z', part: 0, ledge: true }] }),
        ),
      ),
      1,
    );
    expect(sides(lastWins)).toEqual(['+z']);
  });

  it('an override naming a part the piece does not have is an error', () => {
    expect(() =>
      ledgesOf(scene(FLOOR, place('block', { ledges: [{ part: 1, ledge: true }] }))),
    ).toThrow('placement 1 overrides the ledges of part 1, but kit piece "block" has 1 part(s)');
  });

  it('is deterministic: the same scene gives the same ledges, numbered in order', () => {
    const s = scene(FLOOR, place('block'), place('two-part', { at: [0, 0, 3] }));
    const a = ledgesOf(s);
    expect(ledgesOf(s)).toEqual(a);
    expect(a.map((ledge) => ledge.id)).toEqual(a.map((_, i) => i));
  });
});

describe('ledge queries (mw-e03.22)', () => {
  const NO_COLLIDERS: StaticColliderSink = {
    add: () => 0 as ColliderHandle,
    remove: () => undefined,
    has: () => false,
    count: () => 0,
  };

  function loaded() {
    const world = registerWorldProperties(registerSceneComponents(new World<never>({ seed: 2 })));
    const s = scene(FLOOR, place('block'), place('block', { at: [3, 0, 0] }));
    const scn = loadScene(world, s, kit, NO_COLLIDERS);
    return { world, scn, index: sceneLedges(scn) };
  }

  it('finds ledges near a point, nearest first, with the piece they belong to', () => {
    const { world, scn, index } = loaded();
    const hits = index.near(world, { x: 0, y: 1.5, z: -1 }, 0.6);
    expect(hits.map((hit) => [hit.ledge.side, hit.entity])).toEqual([['-z', scn.pieces[1]]]);
    expect(hits[0]).toMatchObject({
      point: { x: 0, y: 1.5, z: -0.5 },
      distance: 0.5,
      surface: 'none',
    });
    // Equal distances tie-break by id; a larger radius finds more.
    const corner = index.near(world, { x: -0.5, y: 1.5, z: -0.5 }, 0.01);
    expect(corner.map((hit) => hit.ledge.side)).toEqual(['-x', '-z']);
    expect(index.near(world, { x: 0, y: 1.5, z: -1 }, 0.4)).toEqual([]);
  });

  it('AC-3: ledges of a piece that is gone leave the query at once', () => {
    const { world, scn, index } = loaded();
    const at = { x: 0, y: 1.5, z: -1 };
    expect(index.near(world, at, 0.6)).toHaveLength(1);
    world.destroy(scn.pieces[1] ?? -1);
    expect(index.near(world, at, 0.6)).toEqual([]);
    // An index whose pieces do not cover a placement finds nothing there.
    expect(new LedgeIndex(index.ledges, []).near(world, at, 0.6)).toEqual([]);
  });

  it('AC-3, AC-4: a ledge reports its piece’s live surface: ivy, then slippery when frozen, then none', () => {
    const { world, scn, index } = loaded();
    const block = scn.pieces[1] ?? -1;
    addProperties(world, block, { climbable: 'ivy' });
    const at = { x: 0, y: 1.5, z: -1 };
    expect(index.near(world, at, 0.6)[0]?.surface).toBe('ivy');
    assignProperty(world, block, 'frozen', true);
    expect(index.near(world, at, 0.6)[0]?.surface).toBe('slippery');
    assignProperty(world, block, 'frozen', false);
    assignProperty(world, block, 'climbable', 'none');
    expect(index.near(world, at, 0.6)[0]?.surface).toBe('none');
    expect(index.entityOf(nth(index.ledges, 0))).toBe(scn.pieces[0]);
  });
});
