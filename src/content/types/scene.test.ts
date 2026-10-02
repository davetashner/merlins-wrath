import { describe, expect, it } from 'vitest';
import { gameContentSources } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { ContentRef } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { sceneBreakableSchema, sceneSchema, type SceneDefInput } from './scene.ts';

const room = {
  id: 'room',
  name: 'Room',
  camera: { position: [0, 5, -5], target: [0, 0, 0] },
  placements: [{ piece: 'floor', at: [0, 0, 0] }],
} satisfies SceneDefInput;

const problems = (value: unknown) =>
  (sceneSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

const source = (path: string, json: unknown): ContentSource => ({
  path,
  text: JSON.stringify(json),
});

describe('scene schema (mw-e00.21)', () => {
  it('fills defaults: 1 m grid, no yaw, unit scale, no spawns', () => {
    expect(sceneSchema.parse(room)).toEqual({
      ...room,
      description: '',
      grid: 1,
      placements: [
        { piece: new ContentRef('kit', 'floor'), at: [0, 0, 0], yaw: 0, scale: [1, 1, 1] },
      ],
      spawns: [],
    });
  });

  it('AC-3: rejects positions off the snap grid, yaws that are not quarter turns and bad scales', () => {
    expect(problems({ ...room, placements: [{ piece: 'floor', at: [0.1, 0, 0] }] })).toEqual([
      'placements.0.at: must snap to the grid: every coordinate a multiple of 0.25 cells',
    ]);
    expect(problems({ ...room, placements: [{ piece: 'floor', at: [0, 0, 0], yaw: 45 }] })).toEqual(
      [expect.stringMatching(/^placements\.0\.yaw: /)],
    );
    expect(
      problems({ ...room, placements: [{ piece: 'floor', at: [0, 0, 0], scale: [1, 0, 1] }] }),
    ).toEqual([expect.stringMatching(/^placements\.0\.scale\.1: Too small/)]);
    expect(problems({ ...room, placements: [] })).toEqual([
      expect.stringMatching(/^placements: Too small/),
    ]);
  });

  it('AC-3: rejects two spawns with the same id', () => {
    const spawn = { id: 'player-start', at: [0, 0, 0] };
    expect(problems({ ...room, spawns: [spawn, spawn] })).toEqual([
      'spawns.1.id: spawn id "player-start" is used twice in this scene',
    ]);
  });

  it('mw-e12.4: a creature spawn takes a faction override and a patrol; a marker takes neither', () => {
    const den = {
      id: 'den',
      at: [1, 0, 1],
      creature: 'fixture-hound',
      faction: 'unaligned',
      patrol: [
        [1, 0, 1],
        [3, 0, 1],
      ],
    };
    expect(problems({ ...room, spawns: [den] })).toEqual([]);
    const marker = { id: 'marker', at: [0, 0, 0], faction: 'unaligned', patrol: [[0, 0, 0]] };
    expect(problems({ ...room, spawns: [marker] })).toEqual([
      'spawns.0.faction: spawn "marker" sets faction but spawns no creature',
      'spawns.0.patrol: spawn "marker" sets patrol but spawns no creature',
    ]);
    expect(problems({ ...room, spawns: [{ ...den, patrol: [] }] })).toEqual([
      expect.stringMatching(/^spawns\.0\.patrol: Too small/),
    ]);
  });

  it('mw-e03.22 AC-5: a level file with a climbable grade not in the enum fails validation', () => {
    const scene = (climbable: unknown) => ({
      ...room,
      placements: [{ piece: 'wall', at: [0, 0, 0], properties: { climbable } }],
    });
    expect(problems(scene('ivy'))).toEqual([]);
    expect(problems(scene('vertical'))).toEqual([
      expect.stringMatching(/^placements\.0\.properties\.climbable: /),
    ]);
    expect(problems(scene(2))).toEqual([
      expect.stringMatching(/^placements\.0\.properties\.climbable: /),
    ]);
    // Through the content loader too: the file and path are named.
    const load = () =>
      loadContent(
        contentTypes,
        [...gameContentSources(), source('fixtures/scene/room.json', scene('slippery'))],
        contentChecks,
      );
    expect(load).toThrow(ContentLoadError);
    expect(load).toThrow(/fixtures\/scene\/room\.json[\s\S]*placements\/0\/properties\/climbable/);
  });

  it('mw-e03.22: placements take world properties and ledge overrides', () => {
    const parsed = sceneSchema.parse({
      ...room,
      placements: [
        {
          piece: 'wall',
          at: [0, 0, 0],
          properties: { material: 'wood', climbable: 'ladder' },
          ledges: [{ ledge: false }, { side: '+z', part: 0, ledge: true }],
        },
      ],
    });
    expect(parsed.placements[0]).toMatchObject({
      properties: { material: new ContentRef('material', 'wood'), climbable: 'ladder' },
      ledges: [{ ledge: false }, { side: '+z', part: 0, ledge: true }],
    });
    expect(
      problems({
        ...room,
        placements: [{ piece: 'wall', at: [0, 0, 0], ledges: [{ side: 'north', ledge: false }] }],
      }),
    ).toEqual([expect.stringMatching(/^placements\.0\.ledges\.0\.side: /)]);
    expect(
      problems({
        ...room,
        placements: [{ piece: 'wall', at: [0, 0, 0], ledges: [{ part: -1, ledge: true }] }],
      }),
    ).toEqual([expect.stringMatching(/^placements\.0\.ledges\.0\.part: /)]);
  });

  it('mw-e03.37: spawns take world properties; scenes take light data, validated', () => {
    const parsed = sceneSchema.parse({
      ...room,
      spawns: [{ id: 'torch', at: [0, 1.5, 0], properties: { burning: true, fuel: 3600 } }],
      light: {
        ambient: 0.05,
        ambientZones: [{ id: 'alcove', min: [0, 0, 0], max: [1, 2, 1], level: 0 }],
        directional: [{ id: 'moon', direction: [0, -1, 1], level: 0.3, reach: 30 }],
      },
    });
    expect(parsed.spawns[0]?.properties).toEqual({ burning: true, fuel: 3600 });
    expect(parsed.light?.directional[0]?.id).toBe('moon');
    expect(sceneSchema.parse({ ...room, light: {} }).light).toEqual({
      ambientZones: [],
      directional: [],
    });
    const zone = { id: 'z', min: [0, 0, 0], max: [1, 1, 1], level: 0.5 };
    const moon = { id: 'moon', direction: [0, -1, 0], level: 0.5, reach: 10 };
    expect(problems({ ...room, light: { ambient: 1.5 } })).toEqual([
      expect.stringMatching(/^light\.ambient: /),
    ]);
    expect(problems({ ...room, light: { ambientZones: [{ ...zone, max: [1, 0, 1] }] } })).toEqual([
      'light.ambientZones.0.max: max must be above min on every axis',
    ]);
    expect(
      problems({ ...room, light: { directional: [{ ...moon, direction: [0, 0, 0] }] } }),
    ).toEqual(['light.directional.0.direction: direction must not be zero']);
    expect(problems({ ...room, light: { directional: [{ ...moon, reach: 0 }] } })).toEqual([
      expect.stringMatching(/^light\.directional\.0\.reach: /),
    ]);
  });

  it('AC-3: a scene using a kit piece or prop that does not exist fails to load, naming it', () => {
    const broken = {
      ...room,
      placements: [{ piece: 'trapdoor', at: [0, 0, 0] }],
      spawns: [{ id: 'thing', at: [0, 0, 0], prop: 'barrel' }],
    };
    const load = () =>
      loadContent(
        contentTypes,
        [...gameContentSources(), source('fixtures/scene/room.json', broken)],
        contentChecks,
      );
    expect(load).toThrow(ContentLoadError);
    expect(load).toThrow(/scene:room references missing kit:trapdoor/);
    expect(load).toThrow(/scene:room references missing testprop:barrel/);
  });
});

describeContent(
  'scene',
  'AC-3: passes the scene schema and every kit piece and prop it uses exists',
  (scene, content) => {
    expect(scene.placements.length).toBeGreaterThan(0);
    for (const placement of scene.placements) {
      expect(content.has('kit', placement.piece.id)).toBe(true);
    }
    for (const spawn of scene.spawns) {
      if (spawn.prop !== undefined) expect(content.has('testprop', spawn.prop.id)).toBe(true);
    }
  },
);

describe('scene content', () => {
  it('ships the default testbed scene, the kit gallery, the combat sandbox, the lighting room and the weak-wall room', () => {
    expect(
      loadContent(contentTypes, gameContentSources(), contentChecks)
        .all('scene')
        .map((s) => s.id),
    ).toEqual(['combat-sandbox', 'kit-gallery', 'lighting-room', 'testbed', 'weak-wall-room']);
  });

  it('mw-e03.11: the weak-wall room’s middle wall is a cracked old wall that reveals the passage', () => {
    const scene = loadContent(contentTypes, gameContentSources(), contentChecks).get(
      'scene',
      'weak-wall-room',
    );
    const breakables = scene.placements.filter((p) => p.breakable !== undefined);
    expect(breakables).toHaveLength(1);
    expect(breakables[0]?.breakable?.profile.id).toBe('old-wall');
    expect(breakables[0]?.breakable?.reveals).toBe('weak-wall-passage');
    expect(breakables[0]?.properties?.hp).toBe(100);
    const crate = scene.spawns.find((s) => s.id === 'loot-crate');
    expect(crate?.breakable?.contents?.map((prop) => prop.id)).toEqual(['plank']);
  });

  it('mw-e03.11: rejects a breakable naming no profile or an unknown key', () => {
    expect(sceneBreakableSchema.safeParse({}).success).toBe(false);
    expect(sceneBreakableSchema.safeParse({ profile: 'old-wall', hp: 3 }).success).toBe(false);
  });
});
