import { describe, expect, it } from 'vitest';
import type { GreyboxShape, RampRise } from '../character/greybox';
import type { Vec3 } from '../stimulus/shapes';
import {
  bakeNavMesh,
  DEFAULT_NAV_BAKE_SETTINGS,
  NavBakeError,
  navBakeSource,
  type NavBakeInput,
  type NavBakeSolid,
} from './bake';
import { TWO_ROOMS } from './fixtures';
import { NAV_BAKE_VERSION, NAV_LINK_KIND_NAMES, type NavMeshData } from './format';
import { NavMesh } from './mesh';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const box = (min: Vec3, max: Vec3, climbGrade?: number): NavBakeSolid => {
  const shape: GreyboxShape = { kind: 'box', min, max };
  return climbGrade === undefined ? { shape } : { shape, climbGrade };
};
const floor = (size = 6) => box(v(0, -0.2, 0), v(size, 0, size));
const level = (solids: NavBakeSolid[], doors: NavBakeInput['doors'] = []): NavBakeInput => ({
  id: 'test',
  solids,
  doors,
});
const linksOf = (data: NavMeshData, kind: (typeof NAV_LINK_KIND_NAMES)[number]) =>
  data.links.filter((l) => NAV_LINK_KIND_NAMES[l[0]] === kind);

describe('navmesh bake (mw-e11.4)', () => {
  it('AC-1: bakes the same bytes every time, fingerprinted by its input', () => {
    const a = bakeNavMesh(TWO_ROOMS);
    const b = bakeNavMesh(TWO_ROOMS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.version).toBe(NAV_BAKE_VERSION);
    expect(a.source).toMatch(/^[0-9a-f]{8}$/);
    expect(a.doors).toEqual(['gate']);
    expect(a.settings).toEqual(DEFAULT_NAV_BAKE_SETTINGS);
    const moved = { ...TWO_ROOMS, solids: TWO_ROOMS.solids.slice(1) };
    expect(navBakeSource(moved, DEFAULT_NAV_BAKE_SETTINGS)).not.toBe(a.source);
    expect(navBakeSource(TWO_ROOMS, { ...DEFAULT_NAV_BAKE_SETTINGS, agentRadius: 0.3 })).not.toBe(
      a.source,
    );
  });

  it('shrinks the walkable floor by the agent radius from walls and drops', () => {
    const data = bakeNavMesh(level([floor()]));
    const mesh = new NavMesh(data);
    expect(mesh.isOnMesh(v(3, 0, 3))).toBe(true);
    expect(mesh.isOnMesh(v(0.2, 0, 3))).toBe(false);
    expect(mesh.isOnMesh(v(0.45, 0, 3))).toBe(true);
    // One flat floor merges into one rectangle.
    expect(data.polys.length).toBe(1);
    expect(data.portals).toEqual([]);
  });

  it('merges overlapping and nested solids into one surface', () => {
    const data = bakeNavMesh(
      level([floor(), box(v(2, -0.2, 2), v(4, 0, 4)), box(v(2.5, -0.1, 2.5), v(3, -0.05, 3))]),
    );
    expect(data.polys.length).toBe(1);
  });

  it('bakes nothing for nothing', () => {
    const data = bakeNavMesh(level([]));
    expect(data.polys).toEqual([]);
    expect(data.origin).toEqual([0, 0]);
    expect(new NavMesh(data).locate(v(0, 0, 0))).toBe(-1);
  });

  it('rejects settings it cannot bake with, naming the setting', () => {
    const bad = (patch: object) => () =>
      bakeNavMesh(level([floor()]), { ...DEFAULT_NAV_BAKE_SETTINGS, ...patch });
    expect(bad({ cellSize: 0 })).toThrow(new NavBakeError('cellSize must be above 0 (got 0)'));
    expect(bad({ agentRadius: -1 })).toThrow(/agentRadius/);
    expect(bad({ agentHeight: Number.NaN })).toThrow(/agentHeight/);
    expect(bad({ stepHeight: -0.1 })).toThrow(
      new NavBakeError('stepHeight must be at least 0 (got -0.1)'),
    );
    expect(bad({ maxJump: -1 })).toThrow(/maxJump/);
    expect(bad({ maxDrop: -1 })).toThrow(/maxDrop/);
    expect(bad({ maxSlope: 90 })).toThrow(
      new NavBakeError('maxSlope must be in [0, 90) degrees (got 90)'),
    );
    expect(bad({ maxSlope: -1 })).toThrow(/maxSlope/);
  });

  it.each(['+x', '-x', '+z', '-z'] as RampRise[])(
    'walks a ramp rising towards %s on its plane',
    (rises) => {
      const along = rises.endsWith('x') ? 'x' : 'z';
      const min = v(2, 0, 2);
      const max = along === 'x' ? v(6, 1, 4) : v(4, 1, 6);
      const data = bakeNavMesh(level([floor(8), { shape: { kind: 'ramp', min, max, rises } }]));
      const mesh = new NavMesh(data);
      const centre = v((min.x + max.x) / 2, 0.5, (min.z + max.z) / 2);
      const p = mesh.locate(centre, 0.05, 0.05);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(mesh.heightAt(p, centre.x, centre.z)).toBeCloseTo(0.5, 9);
      const [, , , , , gx, gz] = data.polys[p] ?? [];
      const slope = (rises.startsWith('+') ? 1 : -1) * 0.25;
      expect(along === 'x' ? [gx, gz] : [gz, gx]).toEqual([slope, 0]);
    },
  );

  it('does not walk a slope steeper than maxSlope, or under a ceiling lower than the agent', () => {
    const steep = bakeNavMesh(
      level([floor(8), { shape: { kind: 'ramp', min: v(2, 0, 2), max: v(3, 2, 6), rises: '+x' } }]),
    );
    expect(new NavMesh(steep).locate(v(2.5, 1, 4), 0.1, 0.1)).toBe(-1);
    const low = bakeNavMesh(level([floor(8), box(v(2, 1.2, 2), v(6, 1.4, 6))]));
    const mesh = new NavMesh(low);
    expect(mesh.isOnMesh(v(4, 0, 4))).toBe(false);
    expect(mesh.isOnMesh(v(1, 0, 7))).toBe(true);
    // Its top is walkable, but only by jumping, which this bake allows up to 2 m.
    expect(mesh.isOnMesh(v(4, 1.4, 4))).toBe(true);
  });

  it('steps up stairs but not up a wall', () => {
    const stairs = [0.25, 0.5, 0.75, 1].map((y, n) =>
      box(v(2 + n * 0.5, 0, 0), v(2.5 + n * 0.5, y, 4)),
    );
    const data = bakeNavMesh(level([floor(8), ...stairs, box(v(4, 0, 0), v(8, 1, 4))]));
    expect(data.portals.length).toBeGreaterThanOrEqual(4);
    const mesh = new NavMesh(data);
    const a = mesh.locate(v(1, 0, 2));
    const b = mesh.locate(v(6, 1, 2));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
  });

  it('marks the doorway under a door, widening a thin leaf to a cell either side', () => {
    const mesh = new NavMesh(bakeNavMesh(TWO_ROOMS));
    const doorway = mesh.locate(v(7, 0, 3));
    expect(mesh.doorOf(doorway)).toBe('gate');
    expect(mesh.doorOf(mesh.locate(v(6.5, 0, 3)))).toBeUndefined();
    // A thick door (a portcullis 0.5 m deep) is used as it is; a door far above the floor marks nothing.
    const thick = level(
      [floor(8)],
      [{ id: 'thick', bounds: { min: v(3, 0, 2), max: v(5, 2, 2.5) } }],
    );
    const thickMesh = new NavMesh(bakeNavMesh(thick));
    expect(thickMesh.doorOf(thickMesh.locate(v(4, 0, 2.25)))).toBe('thick');
    expect(thickMesh.doorOf(thickMesh.locate(v(4, 0, 2.7)))).toBeUndefined();
    const high = level(
      [floor(8)],
      [{ id: 'high', bounds: { min: v(3, 5, 2), max: v(5, 7, 2.5) } }],
    );
    expect(bakeNavMesh(high).polys.every((p) => p[8] === -1)).toBe(true);
  });

  it('links climbable faces wide enough for the agent, both ways, with their grade', () => {
    const data = bakeNavMesh(TWO_ROOMS);
    const climbs = linksOf(data, 'climb');
    // The platform's east and south faces (its west and north faces stand against walls).
    expect(climbs.length).toBe(4);
    expect(climbs.every((l) => l[9] === 1)).toBe(true);
    const thin = bakeNavMesh(level([floor(8), box(v(4, 0, 2), v(4.5, 2, 2.5), 1)]));
    expect(linksOf(thin, 'climb')).toEqual([]);
    // A climbable block too low to be a climb (within a step) is just walked onto.
    const low = bakeNavMesh(level([floor(8), box(v(2, 0, 2), v(6, 0.3, 6), 1)]));
    expect(linksOf(low, 'climb')).toEqual([]);
    // A climbable block on no floor has nowhere to start.
    const floating = bakeNavMesh(level([box(v(2, 0, 2), v(6, 3, 6), 1)]));
    expect(linksOf(floating, 'climb')).toEqual([]);
  });

  it('links jumps and drops across short gaps, but never through a wall', () => {
    const data = bakeNavMesh(TWO_ROOMS);
    expect(linksOf(data, 'jump').length).toBeGreaterThan(0);
    expect(linksOf(data, 'drop').length).toBeGreaterThan(0);
    for (const l of linksOf(data, 'jump')) expect(l[5] - l[4]).not.toBe(0);
    // A higher floor behind a wall: no jump through it.
    const walled = bakeNavMesh(
      level([floor(8), box(v(4, 0, 0), v(4.2, 3, 8)), box(v(4.2, 0, 0), v(8, 1, 8))]),
    );
    expect(linksOf(walled, 'jump')).toEqual([]);
    // Too high to jump, but a drop down from it.
    const tall = bakeNavMesh(level([floor(8), box(v(4, 0, 0), v(8, 3, 8))]));
    expect(linksOf(tall, 'jump')).toEqual([]);
    expect(linksOf(tall, 'drop').length).toBeGreaterThan(0);
    // Long edges get one link per 2 m.
    expect(linksOf(tall, 'drop').length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the closest surface when several overlap a gap probe', () => {
    // A shelf over a lower ledge: from the floor the probe finds both; the lower one is the jump.
    const data = bakeNavMesh(
      level([floor(8), box(v(4, 0, 0), v(8, 0.8, 8)), box(v(6, 3, 0), v(8, 3.2, 8))]),
    );
    const jumps = linksOf(data, 'jump');
    expect(jumps.length).toBeGreaterThan(0);
    expect(jumps.every((l) => l[9] <= 0.8 + 1e-9)).toBe(true);
  });
});
