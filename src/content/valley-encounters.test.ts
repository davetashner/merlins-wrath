// mw-ju8.21 (content side): the skeletons placed along the valley path (valley-01 to valley-03).
// Each encounter is a creature spawn with a leash; this checks the placement rules the bead's design
// sets: nobody spawns a fight on the player (6 m from every transition and arrival spawn, 8 m from the
// path start), nobody sits on a chest (2 m) or the valley-03 cache box, no group is bigger than the
// scene's cap, every leash is a sane size on the level, every creature exists and every spawn stands on
// baked navmesh. The expected income is tests/integration/valley-yield.test.ts.

import { describe, expect, it } from 'vitest';
import { loadGameContent } from './game-content.ts';
import { markExercised } from './testing.ts';

const content = loadGameContent();
const SCENES = ['valley-01', 'valley-02', 'valley-03'] as const;
/** Most enemies that wake together in one scene (the owner: two early, three at the gatekeeper). */
const CAP = { 'valley-01': 2, 'valley-02': 2, 'valley-03': 3 } as const;
/** Skeletons within this many metres of each other see the same fight and wake together. */
const WAKE_LINK = 9;
const VARIANTS = new Set([
  'forgotten-miner',
  'forgotten-archer',
  'forgotten-shield-bearer',
  'forgotten-brute',
]);

const encounters = (scene: string) =>
  content.get('scene', scene).spawns.filter((s) => s.creature !== undefined);
type P = readonly [number, number, number];
const flat = (a: P, b: P) => Math.hypot(a[0] - b[0], a[2] - b[2]);

describe('the valley encounters (mw-ju8.21)', () => {
  for (const sceneId of SCENES) {
    const def = content.get('scene', sceneId);
    const mobs = encounters(sceneId);

    it(`AC-2: ${sceneId} loads with its encounters: real valley skeletons, resting, leashed 15 to 25 m`, ({
      task,
    }) => {
      markExercised(task, 'scene', sceneId);
      expect(mobs.length).toBeGreaterThanOrEqual(3);
      for (const m of mobs) {
        expect(VARIANTS.has(m.creature?.id ?? ''), m.id).toBe(true);
        expect(content.get('creature', m.creature?.id ?? '').loot, m.id).toBeDefined();
        expect(m.tags).toContain('encounter');
        expect(
          m.tags.some((t) => t.startsWith('habit-')),
          m.id,
        ).toBe(true);
        expect(m.leash?.radius, m.id).toBeGreaterThanOrEqual(15);
        expect(m.leash?.radius, m.id).toBeLessThanOrEqual(25);
        expect(m.carries ?? [], `${m.id} carries nothing extra (the key is in the chest)`).toEqual(
          [],
        );
        expect(m.patrol, m.id).toBeUndefined(); // rest posture: they stand where their habit is
      }
    });

    it(`AC-2: ${sceneId} encounters keep clear of transitions, arrivals, the path start and chests`, () => {
      const markers = def.spawns.filter((s) => s.tags.includes('arrival'));
      const start = def.spawns.find((s) => s.tags.includes('path-start'));
      const chests = def.spawns.filter((s) => s.container !== undefined);
      for (const m of mobs) {
        for (const t of def.transitions) {
          const dx = Math.max(t.min[0] - m.at[0], 0, m.at[0] - t.max[0]);
          const dz = Math.max(t.min[2] - m.at[2], 0, m.at[2] - t.max[2]);
          expect(Math.hypot(dx, dz), `${m.id} vs ${t.id}`).toBeGreaterThanOrEqual(6);
        }
        for (const a of markers)
          expect(flat(m.at, a.at), `${m.id} vs ${a.id}`).toBeGreaterThanOrEqual(6);
        expect(flat(m.at, start?.at ?? [0, 0, 0]), m.id).toBeGreaterThanOrEqual(8);
        for (const c of chests)
          expect(flat(m.at, c.at), `${m.id} vs ${c.id}`).toBeGreaterThanOrEqual(2);
        if (sceneId === 'valley-03') {
          // The hidden cache's box: x 6.25-8.25, z 10-14, 2 m of margin.
          const inBox = m.at[0] > 4.25 && m.at[0] < 10.25 && m.at[2] > 8 && m.at[2] < 16;
          expect(inBox, `${m.id} in the cache box`).toBe(false);
        }
      }
    });

    it(`AC-2: ${sceneId} never wakes more than ${String(CAP[sceneId])} skeletons at once`, () => {
      // Union the skeletons that stand within WAKE_LINK of each other; the biggest cluster is the cap.
      const cluster = mobs.map((_, i) => i);
      const find = (i: number): number => (cluster[i] === i ? i : find(cluster[i] ?? i));
      mobs.forEach((a, i) => {
        mobs.forEach((b, j) => {
          if (i < j && flat(a.at, b.at) <= WAKE_LINK) cluster[find(j)] = find(i);
        });
      });
      const sizes = new Map<number, number>();
      mobs.forEach((_, i) => sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1));
      expect(Math.max(...sizes.values())).toBeLessThanOrEqual(CAP[sceneId]);
    });

    it(`AC-2: ${sceneId} posts and spawns lie inside the walkable level and on baked navmesh`, () => {
      const nav = content.get('navmesh', sceneId);
      const [ox, oz] = nav.origin;
      const cell = nav.settings.cellSize;
      const onMesh = (x: number, z: number) =>
        nav.polys.some(
          (p) =>
            x >= ox + p[0] * cell &&
            x < ox + p[2] * cell &&
            z >= oz + p[1] * cell &&
            z < oz + p[3] * cell,
        );
      for (const m of mobs) {
        expect(onMesh(m.at[0], m.at[2]), `${m.id} is off the navmesh`).toBe(true);
        const post = m.leash?.post ?? m.at;
        expect(onMesh(post[0], post[2]), `${m.id} post is off the navmesh`).toBe(true);
      }
    });
  }

  it('AC-2: the lone opener is a miner, valley-02 has a shield-bearer by the west chest, valley-03 ends on one brute', () => {
    const v1 = encounters('valley-01');
    expect(v1.filter((m) => m.tags.includes('group-bend')).map((m) => m.creature?.id)).toEqual([
      'forgotten-miner',
    ]);
    const v1pair = v1.filter((m) => m.tags.includes('group-flank')).map((m) => m.creature?.id);
    expect(v1pair.sort()).toEqual(['forgotten-archer', 'forgotten-miner']);
    const v2 = content.get('scene', 'valley-02');
    const chest = v2.spawns.find((s) => s.id === 'chest-valley-02-glade-west');
    const bearer = encounters('valley-02').find(
      (m) => m.creature?.id === 'forgotten-shield-bearer',
    );
    expect(flat(bearer?.at ?? [0, 0, 0], chest?.at ?? [99, 0, 99])).toBeLessThanOrEqual(5);
    const v3 = encounters('valley-03');
    expect(v3.filter((m) => m.creature?.id === 'forgotten-brute')).toHaveLength(1);
    const brute = v3.find((m) => m.creature?.id === 'forgotten-brute');
    // Furthest along the path: the gatekeeper is the last fight, on the near side of the bridge (z < 28).
    expect(Math.max(...v3.map((m) => m.at[2]))).toBe(brute?.at[2]);
    const post = brute?.leash?.post ?? brute?.at ?? [0, 0, 0];
    expect(post[2] + (brute?.leash?.radius ?? 0)).toBeLessThan(46); // never reaches the far bank
  });

  it('AC-2: every skeleton spawn id is unique and prefixed with its scene', () => {
    for (const sceneId of SCENES) {
      const ids = encounters(sceneId).map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id.startsWith(`skel-${sceneId}-`), id).toBe(true);
    }
  });
});
