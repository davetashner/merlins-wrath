// mw-e11.4 on real content: the grey-box testbed's committed navmesh, the content build bake
// (pnpm nav:bake) against the content validation, and the sim's restated capability rules against
// content's locomotion model.
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  canEnterArea,
  canTraverseLink,
  contentChecks,
  contentTypes,
  deriveNavAgent,
  loadContent,
  loadGameContent,
  NAV_AREAS,
  NAV_BITS,
  NAV_LINK_KINDS,
  NAVMESH_VERSION,
  resolveLocomotion,
  type NavAgent,
  type NavLink,
} from '@content/index';
import { readContentSources } from '@content/fs-sources';
import {
  NAV_AGENT_BITS,
  NAV_AREA_NAMES,
  NAV_BAKE_VERSION,
  NAV_LINK_KIND_NAMES,
  navCanEnter,
  navCanTraverse,
  NavMesh,
  NavMeshQuery,
  type NavPathPoint,
  type NavPathResult,
} from '@sim/index';
import { CONTENT_DIR, navmeshPath } from '@tools/navmesh/bake';
import { main, type CliIo } from '@tools/navmesh/cli';

const REPO = join(import.meta.dirname, '../..');
const content = loadGameContent();
const mesh = new NavMesh(content.get('navmesh', 'testbed'));
const query = new NavMeshQuery(mesh);
const humanoid = deriveNavAgent(resolveLocomotion(content.get('locomotion', 'humanoid'), content));
const wolf = deriveNavAgent(resolveLocomotion(content.get('locomotion', 'briar-wolf'), content));
/** A walker that never climbs (the humanoid without its climb mode). */
const walker: NavAgent = { ...humanoid, mask: humanoid.mask & ~NAV_BITS.climb, maxClimbGrade: 0 };

const ROOM = { x: 0, y: 0, z: -1 };
const ARENA = { x: 0, y: 0, z: 24 };
const CLOSET = { x: 6, y: 0, z: 4 };
const LEDGE = { x: -3.5, y: 3, z: 4.5 };

const pointsOf = (r: NavPathResult): readonly NavPathPoint[] =>
  r.status === 'off-mesh' ? [] : r.points;

function onMesh(points: readonly NavPathPoint[]): boolean {
  for (let n = 1; n < points.length; n++) {
    const a = points[n - 1];
    const b = points[n];
    if (a === undefined || b === undefined || a.link !== undefined) continue;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      if (mesh.locate(p, 0.45, 0.45) < 0) return false;
    }
  }
  return true;
}

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('testbed navmesh (mw-e11.4)', () => {
  it('AC-6: the bake produces the testbed navmesh file in ≤ 10 s and content validation passes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vesper-nav-ac6-'));
    scratch.push(dir);
    cpSync(join(REPO, CONTENT_DIR), join(dir, CONTENT_DIR), { recursive: true });
    rmSync(join(dir, navmeshPath('testbed')));
    const lines: string[] = [];
    const io: CliIo = {
      cwd: dir,
      log: (l) => lines.push(l),
      error: (l) => lines.push(l),
      now: () => performance.now(),
    };
    const start = performance.now();
    expect(main(['bake', 'testbed'], io)).toBe(0);
    const seconds = (performance.now() - start) / 1000;
    expect(existsSync(join(dir, navmeshPath('testbed')))).toBe(true);
    expect(seconds).toBeLessThanOrEqual(10);
    const loaded = loadContent(
      contentTypes,
      readContentSources(join(dir, CONTENT_DIR), CONTENT_DIR),
      contentChecks,
    );
    expect(loaded.get('navmesh', 'testbed')).toEqual(content.get('navmesh', 'testbed'));
    console.info(`testbed bake: ${lines.join('; ')} (${seconds.toFixed(2)} s with content load)`);
  });

  it('AC-1: room → corridor → arena: a valid path, identical across runs', () => {
    const first = query.findPath({ start: ROOM, goal: ARENA, agent: humanoid });
    expect(first.status).toBe('found');
    expect(onMesh(pointsOf(first))).toBe(true);
    const again = new NavMeshQuery(new NavMesh(loadGameContent().get('navmesh', 'testbed')));
    expect(again.findPath({ start: ROOM, goal: ARENA, agent: humanoid })).toEqual(first);
  });

  it('AC-2: the locked closet door keeps a guard out; unlocked and opened, it walks in', () => {
    expect(mesh.doors).toEqual(['closet-door']);
    const locked = query.findPath({
      start: ROOM,
      goal: CLOSET,
      agent: humanoid,
      doors: () => 'locked',
    });
    expect(locked.status).toBe('unreachable');
    const open = query.findPath({
      start: ROOM,
      goal: CLOSET,
      agent: humanoid,
      doors: () => 'open',
    });
    expect(open.status).toBe('found');
    expect(onMesh(pointsOf(open))).toBe(true);
    // Closed but unlocked: the guard opens it; a Briar Wolf cannot.
    expect(
      query.findPath({ start: ROOM, goal: CLOSET, agent: humanoid, doors: () => 'closed' }).status,
    ).toBe('found');
    expect(
      query.findPath({ start: ROOM, goal: CLOSET, agent: wolf, doors: () => 'closed' }).status,
    ).toBe('unreachable');
  });

  it('AC-3: only the climber goes up the ivy to the ledge', () => {
    const climber = query.findPath({ start: ROOM, goal: LEDGE, agent: humanoid });
    expect(climber.status).toBe('found');
    expect(pointsOf(climber).filter((p) => p.link === 'climb').length).toBe(1);
    const walking = query.findPath({ start: ROOM, goal: LEDGE, agent: walker });
    expect(walking.status).toBe('unreachable');
    expect(pointsOf(walking).some((p) => p.link === 'climb')).toBe(false);
  });

  it('AC-4: an unreachable target answers Unreachable with the closest reachable point', () => {
    // The top of an arena pillar: 3 m up, too narrow to stand on.
    const result = query.findPath({ start: ROOM, goal: { x: 4, y: 3, z: 19 }, agent: humanoid });
    expect(result.status).toBe('unreachable');
    if (result.status === 'unreachable')
      expect(Math.hypot(result.closest.x - 4, result.closest.z - 19)).toBeLessThan(1);
  });
});

describe('nav capability rules (mw-e11.4)', () => {
  it('restates content’s bits, areas, link kinds and bake version', () => {
    expect(Object.values(NAV_AGENT_BITS)).toEqual(Object.values(NAV_BITS));
    expect([...NAV_AREA_NAMES]).toEqual([...NAV_AREAS]);
    expect([...NAV_LINK_KIND_NAMES]).toEqual([...NAV_LINK_KINDS]);
    expect(NAVMESH_VERSION).toBe(NAV_BAKE_VERSION);
  });

  it('agrees with content’s canTraverseLink and canEnterArea for every profile', () => {
    const agents = content
      .all('locomotion')
      .map((p) => deriveNavAgent(resolveLocomotion(p, content)));
    const links: NavLink[] = [0.3, 0.6, 1.2, 3, 30].flatMap((m) => [
      { kind: 'jump', rise: m },
      { kind: 'drop', fall: m },
    ]);
    for (const grade of [1, 2, 3]) links.push({ kind: 'climb', grade });
    links.push({ kind: 'door' }, { kind: 'fly' });
    for (const agent of agents) {
      for (const link of links) {
        const measure =
          link.kind === 'jump'
            ? link.rise
            : link.kind === 'drop'
              ? link.fall
              : link.kind === 'climb'
                ? link.grade
                : 0;
        expect(navCanTraverse(agent, link.kind, measure), `${link.kind} ${String(measure)}`).toBe(
          canTraverseLink(agent, link),
        );
      }
      for (const area of NAV_AREAS)
        expect(navCanEnter(agent, area)).toBe(canEnterArea(agent, area));
    }
  });
});
