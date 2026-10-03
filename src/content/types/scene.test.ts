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

describe('scene mechanisms (mw-e03.18)', () => {
  const spawn = (id: string, extra: object) => ({ id, at: [0, 0, 0], ...extra });

  it('fills door and switch defaults, and places signal graphs', () => {
    const scene = sceneSchema.parse({
      ...room,
      spawns: [
        spawn('gate', { door: { profile: 'portcullis' } }),
        spawn('lever', { switch: { kind: 'lever' } }),
      ],
      signals: [{ graph: 'gate' }],
    });
    expect(scene.spawns[0]?.door).toEqual({
      profile: new ContentRef('door', 'portcullis'),
      state: 'closed',
      hinge: 'left',
      swing: 'forward',
    });
    expect(scene.spawns[1]?.switch).toEqual({ kind: 'lever', initial: 0 });
    expect(scene.signals).toEqual([
      { graph: new ContentRef('signal-graph', 'gate'), bindings: {} },
    ]);
  });

  it('rejects a spawn that is a door and a switch, a door with its own prompt and a lockless locked door', () => {
    expect(
      problems({
        ...room,
        spawns: [
          spawn('both', {
            door: { profile: 'wooden-door', locked: true },
            switch: { kind: 'lever' },
            interact: { affordances: [{ verb: 'open' }] },
          }),
        ],
      }),
    ).toEqual([
      'spawns.0.switch: spawn "both" cannot be both a door and a switch',
      'spawns.0.interact: spawn "both" is a door: its affordances follow its state, so it declares none',
      'spawns.0.door: spawn "both" starts locked but has no lock',
    ]);
  });

  it('rejects positions on a lever or button, and a start outside the positions', () => {
    expect(
      problems({
        ...room,
        spawns: [
          spawn('lever', { switch: { kind: 'lever', positions: 3 } }),
          spawn('button', { switch: { kind: 'button', initial: 1 } }),
          spawn('crank', { switch: { kind: 'crank', positions: 4, initial: 3 } }),
          spawn('wheel', { switch: { kind: 'wheel', initial: 2 } }),
        ],
      }),
    ).toEqual([
      'spawns.0.switch: spawn "lever" is a lever: only a crank or wheel sets positions',
      'spawns.1.switch: spawn "button" starts in position 1 of 1',
      'spawns.3.switch: spawn "wheel" starts in position 2 of 2',
    ]);
  });

  it('rejects a signal binding to a spawn the scene does not have', () => {
    expect(
      problems({
        ...room,
        spawns: [spawn('gate', {})],
        signals: [{ graph: 'gate', bindings: { 'gate-lever': 'lever', gate: 'gate' } }],
      }),
    ).toEqual([
      'signals.0.bindings.gate-lever: binding "gate-lever" names spawn "lever", which this scene does not have',
    ]);
  });
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
      signals: [],
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

  it('mw-e17.7: an item spawn names an item and a count of 1 by default, within the unit guard', () => {
    const loot = { id: 'loot', at: [0, 0, 0], item: { id: 'healing-draught' } };
    expect(sceneSchema.parse({ ...room, spawns: [loot] }).spawns[0]?.item).toEqual({
      id: new ContentRef('item', 'healing-draught'),
      count: 1,
    });
    expect(problems({ ...room, spawns: [{ ...loot, item: { id: 'gold', count: 0 } }] })).toEqual([
      expect.stringMatching(/^spawns\.0\.item\.count: Too small/),
    ]);
    expect(
      problems({ ...room, spawns: [{ ...loot, item: { id: 'gold', count: 10_000 } }] }),
    ).toEqual([expect.stringMatching(/^spawns\.0\.item\.count: Too big/)]);
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
  it('ships the default testbed scene, the kit gallery, the combat sandbox, the lighting room, the weak-wall room and the mechanism room', () => {
    expect(
      loadContent(contentTypes, gameContentSources(), contentChecks)
        .all('scene')
        .map((s) => s.id),
    ).toEqual([
      'combat-sandbox',
      'kit-gallery',
      'lighting-room',
      'mechanism-room',
      'testbed',
      'weak-wall-room',
    ]);
  });

  it('mw-e03.18: the mechanism room places a prefab of every door kind and wires its switches', () => {
    const scene = loadContent(contentTypes, gameContentSources(), contentChecks).get(
      'scene',
      'mechanism-room',
    );
    const doors = scene.spawns.flatMap((s) => (s.door === undefined ? [] : [s.door.profile.id]));
    expect(doors).toEqual(['portcullis', 'wooden-door', 'iron-door', 'sliding-door', 'trapdoor']);
    const switches = scene.spawns.flatMap((s) => (s.switch === undefined ? [] : [s.switch.kind]));
    expect(switches).toEqual(['lever', 'button', 'crank']);
    expect(scene.signals.map((s) => s.graph.id)).toEqual(['mechanism-room']);
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
