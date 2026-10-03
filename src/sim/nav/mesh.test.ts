import { describe, expect, it } from 'vitest';
import { bakeNavMesh } from './bake';
import { TWO_ROOMS, twoRooms } from './fixtures';
import { NAV_BAKE_VERSION, type NavMeshData } from './format';
import { NavMesh, NavMeshError } from './mesh';

const baked = (): NavMeshData => bakeNavMesh(TWO_ROOMS);

describe('NavMesh (mw-e11.4)', () => {
  it('unpacks polygons, portals and links in world metres', () => {
    const mesh = twoRooms();
    const data = mesh.data;
    expect(mesh.id).toBe('two-rooms');
    expect(mesh.polyCount).toBe(data.polys.length);
    expect(mesh.portalCount).toBe(data.portals.length);
    expect(mesh.linkCount).toBe(data.links.length);
    const p = mesh.locate({ x: 4, y: 0, z: 1 });
    const [x0, z0, x1, z1] = mesh.boundsOf(p);
    expect(x0).toBeLessThanOrEqual(4);
    expect(x1).toBeGreaterThanOrEqual(4);
    expect(z0).toBeLessThanOrEqual(1);
    expect(z1).toBeGreaterThanOrEqual(1);
    expect(mesh.centreOf(p).y).toBe(0);
    expect(mesh.areaOf(p)).toBe('ground');
    expect(mesh.contains(p, 4, 1)).toBe(true);
    expect(mesh.contains(p, 400, 1)).toBe(false);
    const portal = mesh.portal(0);
    expect(mesh.edgesOf(portal.a).some((e) => e.via === 'portal' && e.to === portal.b)).toBe(true);
    expect(mesh.edgesOf(portal.b).some((e) => e.via === 'portal' && e.to === portal.a)).toBe(true);
    const link = mesh.link(0);
    expect(mesh.edgesOf(link.from).some((e) => e.via === 'link' && e.to === link.to)).toBe(true);
    expect(['jump', 'drop', 'climb']).toContain(link.kind);
  });

  it('locates the surface under a point: the closest within reach above and below', () => {
    const mesh = twoRooms();
    // On the platform's top and on the floor beside it.
    const top = mesh.locate({ x: 1, y: 1.5, z: 3.5 });
    expect(mesh.heightAt(top, 1, 3.5)).toBe(1.5);
    expect(mesh.locate({ x: 1, y: 3, z: 3.5 }, 0.5, 1)).toBe(-1);
    expect(mesh.locate({ x: 1, y: 2.4, z: 3.5 }, 0.5, 1)).toBe(top);
    expect(mesh.locate({ x: 3, y: 0.4, z: 1 })).toBeGreaterThanOrEqual(0);
    expect(mesh.isOnMesh({ x: 3, y: 0.04, z: 1 })).toBe(true);
    expect(mesh.isOnMesh({ x: 3, y: 0.2, z: 1 })).toBe(false);
  });

  it('finds the nearest point within reach, optionally among accepted polygons', () => {
    const mesh = twoRooms();
    const near = mesh.nearest({ x: 0.1, y: 0, z: 1 }, 1, 0.5);
    expect(near?.x).toBeGreaterThan(0.3);
    expect(near?.z).toBe(1);
    expect(mesh.nearest({ x: -5, y: 0, z: 1 }, 1, 0.5)).toBeUndefined();
    expect(mesh.nearest({ x: 4, y: 0, z: 1 }, 1, 0.5, () => false)).toBeUndefined();
    expect(mesh.nearest({ x: 4, y: 10, z: 1 }, 1, 0.5)).toBeUndefined();
  });

  it('refuses data of another bake version or with indices out of range', () => {
    const data = baked();
    expect(() => new NavMesh({ ...data, version: NAV_BAKE_VERSION + 1 })).toThrow(
      new NavMeshError(
        `navmesh "two-rooms" is bake version ${String(NAV_BAKE_VERSION + 1)}; this build reads ${String(NAV_BAKE_VERSION)} (re-run pnpm nav:bake)`,
      ),
    );
    const poly = data.polys[0] ?? [0, 0, 1, 1, 0, 0, 0, 0, -1];
    const withPoly = (row: readonly number[]) =>
      new NavMesh({ ...data, polys: [row as unknown as typeof poly, ...data.polys.slice(1)] });
    expect(() => withPoly([...poly.slice(0, 7), 9, -1])).toThrow(/unknown area 9/);
    expect(() => withPoly([...poly.slice(0, 8), 5])).toThrow(/names door 5/);
    expect(() => withPoly([...poly.slice(0, 8), -2])).toThrow(/names door -2/);
    const portal = data.portals[0] ?? [0, 1, 0, 0, 0, 1];
    expect(() => new NavMesh({ ...data, portals: [[portal[0], 9999, 0, 0, 0, 1]] })).toThrow(
      /portal 0 names polygon 9999/,
    );
    expect(() => new NavMesh({ ...data, portals: [[0.5, 1, 0, 0, 0, 1]] })).toThrow(/polygon 0.5/);
    const link = data.links[0] ?? [0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
    expect(
      () => new NavMesh({ ...data, links: [[9, ...link.slice(1)] as unknown as typeof link] }),
    ).toThrow(/link 0 has unknown kind 9/);
    expect(
      () =>
        new NavMesh({ ...data, links: [[0, 0, -1, ...link.slice(3)] as unknown as typeof link] }),
    ).toThrow(/link 0 names polygon -1/);
  });
});
