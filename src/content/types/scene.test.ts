import { describe, expect, it } from 'vitest';
import { gameContentSources } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { ContentRef } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { sceneSchema, type SceneDefInput } from './scene.ts';

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
  it('ships the default testbed scene, the kit gallery and the combat sandbox', () => {
    expect(
      loadContent(contentTypes, gameContentSources(), contentChecks)
        .all('scene')
        .map((s) => s.id),
    ).toEqual(['combat-sandbox', 'kit-gallery', 'testbed']);
  });
});
