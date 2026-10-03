import { describe, expect, it } from 'vitest';
import type { LoadedEntry } from '../loader.ts';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { checkNavmeshes, NAVMESH_VERSION, navmeshSchema, type NavmeshDefInput } from './navmesh.ts';

const problems = (value: unknown) =>
  (navmeshSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

const base: NavmeshDefInput = {
  id: 'room',
  version: NAVMESH_VERSION,
  source: '0123abcd',
  settings: {
    cellSize: 0.125,
    agentRadius: 0.35,
    agentHeight: 1.8,
    stepHeight: 0.4,
    maxSlope: 45,
    maxJump: 2,
    maxDrop: 4,
  },
  origin: [-1, -1],
  polys: [
    [0, 0, 4, 4, 0, 0, 0, 0, -1],
    [4, 0, 8, 4, 0, 0, 0, 0, 0],
  ],
  portals: [[0, 1, 4, 0, 4, 4]],
  links: [[1, 1, 0, 1, 1, 1, 0, 0, 0, 1]],
  doors: ['gate'],
};

describe('navmesh schema (mw-e11.4)', () => {
  it('accepts a baked navmesh', () => {
    expect(problems(base)).toEqual([]);
  });

  it('refuses empty rectangles and indices out of range', () => {
    expect(
      problems({
        ...base,
        polys: [
          [0, 0, 0, 4, 0, 0, 0, 0, -1],
          [4, 0, 8, 4, 0, 0, 0, 0, 3],
        ],
        portals: [
          [1, 0, 0, 0, 0, 1],
          [0, 2, 0, 0, 0, 1],
        ],
        links: [[0, 0, 5, 0, 0, 0, 0, 0, 0, 1]],
      }),
    ).toEqual([
      'polys.0: is an empty rectangle',
      'polys.1.8: names door 3 of 1',
      'portals.0: joins polygons 1 and 0 of 2',
      'portals.1: joins polygons 0 and 2 of 2',
      'links.0: joins polygons 0 and 5 of 2',
    ]);
    expect(problems({ ...base, version: 2, source: 'nope' })).toEqual([
      'version: Invalid input: expected 1',
      'source: Invalid string: must match pattern /^[0-9a-f]{8}$/',
    ]);
  });
});

describe('navmesh content check (mw-e11.4)', () => {
  const scene = (doors: string[]): LoadedEntry => ({
    type: 'scene',
    file: 'scene/room.json',
    value: {
      id: 'room',
      spawns: [...doors.map((id) => ({ id, door: {} })), { id: 'start' }],
    } as never,
  });
  const mesh = (value: object): LoadedEntry => ({
    type: 'navmesh',
    file: 'navmesh/room.json',
    value: navmeshSchema.parse({ ...base, ...value }),
  });

  it('ties each navmesh to its scene and the scene’s door spawns', () => {
    expect(checkNavmeshes([scene(['gate']), mesh({})])).toEqual([]);
    expect(checkNavmeshes([scene([]), mesh({ doors: ['gate', 'start'] })])).toEqual([
      {
        file: 'navmesh/room.json',
        pointer: '/doors/0',
        message:
          'navmesh:room names door "gate", which scene:room has no door spawn for (re-run pnpm nav:bake)',
      },
      {
        file: 'navmesh/room.json',
        pointer: '/doors/1',
        message:
          'navmesh:room names door "start", which scene:room has no door spawn for (re-run pnpm nav:bake)',
      },
    ]);
    expect(checkNavmeshes([mesh({ id: 'elsewhere' })])).toEqual([
      {
        file: 'navmesh/room.json',
        pointer: '/id',
        message: 'navmesh:elsewhere has no scene "elsewhere" to belong to',
      },
    ]);
  });
});

describeContent(
  'navmesh',
  'AC-6: is valid, round-trips and belongs to its scene',
  (entry, content) => {
    expect(navmeshSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
    expect(content.has('scene', entry.id)).toBe(true);
    expect(entry.polys.length).toBeGreaterThan(0);
  },
);
