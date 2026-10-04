// mw-ju8.1: the valley spike's three grey-box outdoor scenes (src/content/data/scene/valley-*.json),
// built from the e00 kit only. Their look (fog, backdrop layer) and shape (a tight path of 40 to 60 m,
// a stone bridge over a tagged river) are data, checked here; the frame cost is in
// docs/design/valley-spike.md.

import { describe, expect, it } from 'vitest';
import { loadGameContent } from './game-content.ts';
import { markExercised } from './testing.ts';

const content = loadGameContent();
const scene = (id: string) => content.get('scene', id);
const spawn = (id: string, tag: string) => scene(id).spawns.find((s) => s.tags.includes(tag));

describe('the valley spike scenes (mw-ju8.1)', () => {
  it('AC-1: valley-01 is a 40 to 60 m path between walls at most 4 m apart, with a far-mountains backdrop', ({
    task,
  }) => {
    markExercised(task, 'scene', 'valley-01');
    const def = scene('valley-01');
    const start = spawn('valley-01', 'path-start');
    const end = spawn('valley-01', 'path-end');
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    const [sx, , sz] = start?.at ?? [0, 0, 0];
    const [ex, , ez] = end?.at ?? [0, 0, 0];
    const length = Math.hypot(ex - sx, ez - sz);
    expect(length).toBeGreaterThanOrEqual(40);
    expect(length).toBeLessThanOrEqual(60);
    // Rock walls (yaw 90, running along z) close in both sides of the first stretch.
    const flank = def.placements.filter(
      (p) => p.piece.id === 'wall' && p.yaw === 90 && p.at[2] <= 12 && Math.abs(p.at[0]) <= 2,
    );
    expect(flank.map((p) => Math.sign(p.at[0])).sort()).toEqual([-1, 1]);
    expect(def.environment?.backdrop?.image).toBe('backdrop-valley-01/far-mountains-castle.png');
    expect(def.environment?.fog).toBeDefined();
  });

  it('AC-1: valley-02 is a forest path with a river glimpse and the mid-forest backdrop', ({
    task,
  }) => {
    markExercised(task, 'scene', 'valley-02');
    const def = scene('valley-02');
    expect(def.placements.filter((p) => p.piece.id === 'pillar').length).toBeGreaterThanOrEqual(12);
    expect(def.regions.map((r) => r.id)).toEqual(['river']);
    expect(def.environment?.backdrop?.image).toBe('backdrop-valley-01/mid-forest-river.png');
    expect(def.environment?.backdrop?.follow).toBeLessThan(1);
  });

  it('AC-1: valley-03 has a fenced overlook and a stone bridge across a tagged water region', ({
    task,
  }) => {
    markExercised(task, 'scene', 'valley-03');
    const def = scene('valley-03');
    const river = def.regions.find((r) => r.tags.includes('water'));
    expect(river).toBeDefined();
    const [, , z0] = river?.min ?? [0, 0, 0];
    const [, , z1] = river?.max ?? [0, 0, 0];
    // A walkable deck at ground level spans the whole river.
    const spans = def.placements
      .filter((p) => p.piece.id === 'floor' && p.at[1] === 0)
      .some((p) => p.at[2] - p.scale[2] <= z0 && p.at[2] + p.scale[2] >= z1);
    expect(spans).toBe(true);
    // Parapets run along both sides of the bridge and fences along the overlook edge.
    expect(
      def.placements.filter((p) => p.piece.id === 'wall' && p.scale[1] < 1).length,
    ).toBeGreaterThanOrEqual(4);
    expect(spawn('valley-03', 'area-exit')).toBeDefined();
  });

  it('AC-1: only approved-for-dev backdrops are used: never the overlook concept', () => {
    for (const id of ['valley-01', 'valley-02', 'valley-03']) {
      const image = scene(id).environment?.backdrop?.image ?? '';
      expect(image).toMatch(/^backdrop-valley-01\/(far-mountains-castle|mid-forest-river)\.png$/);
    }
  });
});
