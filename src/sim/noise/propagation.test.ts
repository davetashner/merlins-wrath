import { describe, expect, it } from 'vitest';
import { at } from '../geom/vec';
import { buildSoundGraph, OUTSIDE_ROOM, type SoundPortal } from './graph';
import {
  DEFAULT_NOISE_TUNING,
  distanceGainDb,
  doorGainDb,
  OPEN_PORTALS,
  partitionGainDb,
  propagateNoise,
  type PortalGain,
} from './propagation';

const v = (x: number, y: number, z: number) => ({ x, y, z });
const room = (id: string, min: [number, number, number], max: [number, number, number]) => ({
  id,
  min: v(...min),
  max: v(...max),
});

/** Gains by portal id; unlisted portals are open. */
const gains =
  (byId: Record<string, number>): PortalGain =>
  (portal: SoundPortal) =>
    byId[portal.id] ?? 0;

/** Two rooms 1 m apart (a thick wall: no partition) joined only by a doorway at x = 10.5. */
const twoRooms = buildSoundGraph({
  rooms: [room('a', [0, 0, 0], [10, 3, 10]), room('b', [11, 0, 0], [21, 3, 10])],
  portals: [{ id: 'door', rooms: ['a', 'b'], position: v(10.5, 1, 5) }],
});

describe('noise propagation (mw-e09.3)', () => {
  it('AC-1: a 60 dB noise 10 m away in the same room is heard at 40 dB ± 0.5', () => {
    const graph = buildSoundGraph({ rooms: [room('hall', [0, 0, 0], [30, 3, 30])], portals: [] });
    const heard = propagateNoise(graph, v(5, 1, 5), 60).hear(v(15, 1, 5));
    expect(heard?.level).toBeCloseTo(40, 10);
    expect(Math.abs((heard?.level ?? 0) - 40)).toBeLessThanOrEqual(0.5);
    expect(heard).toMatchObject({ via: null, occlusion: 0, distance: 10, perceived: v(5, 1, 5) });
  });

  it('AC-2: a closed door on the only path takes exactly 20 dB off', () => {
    const at = v(16, 1, 5);
    const open = propagateNoise(twoRooms, v(5, 1, 5), 60).hear(at);
    const closed = propagateNoise(twoRooms, v(5, 1, 5), 60, {
      portalGain: gains({ door: DEFAULT_NOISE_TUNING.doors.closed }),
    }).hear(at);
    expect(open?.level).toBeCloseTo(60 + distanceGainDb(11), 10);
    expect((open?.level ?? 0) - (closed?.level ?? 0)).toBeCloseTo(20, 10);
    expect(closed?.occlusion).toBe(20);
  });

  it('AC-3: a noise heard in the next room through a doorway seems to come from the doorway', () => {
    const field = propagateNoise(twoRooms, v(5, 1, 5), 60);
    expect(field.hear(v(16, 1, 5))).toMatchObject({ perceived: v(10.5, 1, 5), via: 'door' });
    // In the source's own room it comes straight from the source.
    expect(field.hear(v(5, 1, 8))).toMatchObject({ perceived: v(5, 1, 5), via: null });
  });

  describe('AC-4: the louder of two routes is used', () => {
    // Source room a and listener room b sit 1 m apart (no wall transmission). A door between them
    // makes an 8 m route; a corridor round the top makes a 25 m route through two open archways.
    const graph = buildSoundGraph({
      rooms: [
        room('a', [0, 0, 0], [4.5, 3, 10]),
        room('b', [5.5, 0, 0], [10, 3, 10]),
        room('corridor', [0, 0, 11], [10, 3, 20]),
      ],
      portals: [
        { id: 'door', rooms: ['a', 'b'], position: v(5, 1, 2) },
        { id: 'arch-a', rooms: ['a', 'corridor'], position: v(1, 1, 10.5) },
        { id: 'arch-b', rooms: ['corridor', 'b'], position: v(9, 1, 10.5) },
      ],
    });
    const source = v(1, 1, 2);
    const listener = v(9, 1, 2);

    it('the open 25 m corridor beats the closed 8 m door', () => {
      const heard = propagateNoise(graph, source, 60, { portalGain: gains({ door: -20 }) }).hear(
        listener,
      );
      expect(heard?.distance).toBeCloseTo(25, 10);
      expect(heard?.level).toBeCloseTo(60 + distanceGainDb(25), 10);
      expect(heard?.level).toBeGreaterThan(60 + distanceGainDb(8) - 20);
      expect(heard).toMatchObject({ via: 'arch-b', perceived: v(9, 1, 10.5), occlusion: 0 });
    });

    it('with the door open the short route wins', () => {
      const heard = propagateNoise(graph, source, 60).hear(listener);
      expect(heard?.distance).toBeCloseTo(8, 10);
      expect(heard).toMatchObject({ via: 'door', perceived: v(5, 1, 2) });
    });
  });

  it('AC-5: a noise on the floor above is heard below through the wooden floor’s −15 dB', () => {
    const rooms = [room('upper', [0, 3, 0], [10, 6, 10]), room('lower', [0, 0, 0], [10, 3, 10])];
    const wooden = buildSoundGraph({
      rooms,
      portals: [],
      partitions: [{ rooms: ['upper', 'lower'], material: 'wood' }],
    });
    const heard = propagateNoise(wooden, v(5, 4, 5), 60).hear(v(5, 1, 5));
    expect(heard?.level).toBeCloseTo(60 + distanceGainDb(3) - 15, 10);
    // Through a floor the sound is muffled but comes from the right direction.
    expect(heard).toMatchObject({ occlusion: 15, via: null, perceived: v(5, 4, 5) });
    // An unnamed floor uses the default floor gain.
    const plain = buildSoundGraph({ rooms, portals: [] });
    expect(propagateNoise(plain, v(5, 4, 5), 60).hear(v(5, 1, 5))?.occlusion).toBe(25);
  });

  it('AC-7: a noise outside every room falls off with distance alone', () => {
    const open = buildSoundGraph({ rooms: [], portals: [] });
    const heard = propagateNoise(open, v(0, 0, 0), 60).hear(v(0, 0, 20));
    expect(heard?.level).toBeCloseTo(60 + distanceGainDb(20), 10);
    expect(heard).toMatchObject({ via: null, occlusion: 0, distance: 20 });
    // With rooms elsewhere in the level, open terrain still falls off with distance alone.
    const field = propagateNoise(twoRooms, v(-10, 0, 0), 60);
    expect(field.hear(v(-10, 0, 10))?.level).toBeCloseTo(40, 10);
    // A room with no opening onto the outside hears nothing of it (outside has no walls).
    expect(field.hear(v(5, 1, 5))).toBeNull();
  });

  it('reaches into a room from the outside through a portal onto it', () => {
    const graph = buildSoundGraph({
      rooms: [room('hut', [0, 0, 0], [4, 3, 4])],
      portals: [{ id: 'hut-door', rooms: [OUTSIDE_ROOM, 'hut'], position: v(0, 1, 2) }],
    });
    const field = propagateNoise(graph, v(-6, 1, 2), 60);
    expect(field.hear(v(2, 1, 2))).toMatchObject({ via: 'hut-door', distance: 8 });
  });

  it('passes walls into touching rooms and carries on through their portals', () => {
    // a | b (wall) | c (doorway from b): a noise in a reaches c through the wall, then the doorway.
    const graph = buildSoundGraph({
      rooms: [
        room('a', [0, 0, 0], [10, 3, 10]),
        room('b', [10, 0, 0], [20, 3, 10]),
        room('c', [21, 0, 0], [31, 3, 10]),
      ],
      portals: [{ id: 'bc', rooms: ['b', 'c'], position: v(20.5, 1, 5) }],
      partitions: [{ rooms: ['a', 'b'], material: 'wood' }],
    });
    const field = propagateNoise(graph, v(9, 1, 5), 80);
    const inB = field.hear(v(11, 1, 5));
    expect(inB?.level).toBeCloseTo(80 + distanceGainDb(2) - 18, 10);
    expect(inB).toMatchObject({ via: null, occlusion: 18, perceived: v(9, 1, 5) });
    expect(field.hear(v(25.5, 1, 5))).toMatchObject({ via: 'bc', occlusion: 18 });
  });

  it('keeps a muffled short route beside a louder long one into the same doorway', () => {
    // c | a (wall), then a doorway on to b. Into b through doorway ab: through the wall (short, −30)
    // or round through the open archway ca (long, open). Neither route dominates the other.
    const graph = buildSoundGraph({
      rooms: [
        room('c', [0, 0, 0], [10, 3, 10]),
        room('a', [10, 0, 0], [20, 3, 10]),
        room('b', [21, 0, 0], [31, 3, 10]),
      ],
      portals: [
        { id: 'ca', rooms: ['c', 'a'], position: v(10, 1, 9.5) },
        { id: 'ab', rooms: ['a', 'b'], position: v(20.5, 1, 1) },
      ],
    });
    const field = propagateNoise(graph, v(9, 1, 1), 100);
    // source; a via wall; a via ca; b via ab (round); b via ab (wall); c again via ca (wall-crossed).
    expect(field.routes).toBeGreaterThanOrEqual(5);
    expect(field.hear(v(25, 1, 1))).toMatchObject({ via: 'ab', occlusion: 0 });
  });

  it('is bounded by the audibility floor', () => {
    const field = propagateNoise(twoRooms, v(5, 1, 5), 25, {
      portalGain: gains({ door: -20 }),
    });
    expect(field.floor).toBe(10);
    expect(field.hear(v(16, 1, 5))).toBeNull();
    expect(field.hear(v(6, 1, 5))?.level).toBe(25);
    // Too quiet even at the source: nothing is searched.
    const silent = propagateNoise(twoRooms, v(5, 1, 5), 5);
    expect(silent.routes).toBe(0);
    expect(silent.hear(v(5, 1, 5))).toBeNull();
    // Heard at the source room, but too quiet at the far corner.
    const quiet = propagateNoise(twoRooms, v(0, 1, 0), 20);
    expect(quiet.hear(v(5, 1, 5))).toBeNull();
    const custom = { ...DEFAULT_NOISE_TUNING, audibleFloor: 0 };
    expect(propagateNoise(twoRooms, v(0, 1, 0), 20, { tuning: custom }).hear(v(5, 1, 5))).not.toBe(
      null,
    );
  });

  it('rejects a loudness or source that is not finite', () => {
    expect(() => propagateNoise(twoRooms, v(0, 0, 0), Number.NaN)).toThrow(/loudness/);
    expect(() => propagateNoise(twoRooms, v(Number.NaN, 0, 0), 60)).toThrow(/source/);
    expect(() => propagateNoise(twoRooms, v(0, Infinity, 0), 60)).toThrow(/source/);
    expect(() => propagateNoise(twoRooms, v(0, 0, -Infinity), 60)).toThrow(/source/);
  });

  it('reads each portal’s gain at most once per noise, and only the portals it reaches', () => {
    const asked: string[] = [];
    const counting: PortalGain = (portal) => {
      asked.push(portal.id);
      return 0;
    };
    propagateNoise(twoRooms, v(5, 1, 5), 60, { portalGain: counting });
    expect(asked).toEqual(['door']);
    asked.length = 0;
    propagateNoise(twoRooms, v(5, 1, 5), 5, { portalGain: counting });
    expect(asked).toEqual([]);
    expect(OPEN_PORTALS(at(twoRooms.portals, 0))).toBe(0);
  });

  it('a hall with many doorways: each closet hears through its own, nearest first', () => {
    // Closets of different depths round a 40 m hall, some at equal distances (ties settle in order).
    const hall = room('hall', [0, 0, 0], [40, 3, 40]);
    const xs = [2, 6, 10, 14, 18, 22, 26, 30, 34, 38];
    const closets = xs.map((x, i) => room(`c${String(i)}`, [x - 1, 0, 41], [x + 1, 3, 43]));
    const portals = xs.map((x, i) => ({
      id: `d${String(i)}`,
      rooms: ['hall', `c${String(i)}`] as const,
      position: v(x, 1, 40.5),
    }));
    const graph = buildSoundGraph({ rooms: [hall, ...closets], portals });
    const field = propagateNoise(graph, v(20, 1, 20), 90, {
      portalGain: gains({ d3: -20, d6: -6 }),
    });
    xs.forEach((x, i) => {
      expect(field.hear(v(x, 1, 42))?.via).toBe(`d${String(i)}`);
    });
    expect(field.hear(v(14, 1, 42))?.occlusion).toBe(20);
  });

  it('keeps every route a listener could hear loudest, and is deterministic', () => {
    // A ring of rooms with doors of mixed states: the same noise gives the same answers every time.
    const n = 12;
    const rooms = Array.from({ length: n }, (_, i) =>
      room(`r${String(i)}`, [i * 6, 0, 0], [i * 6 + 5, 3, 5]),
    );
    const portals = Array.from({ length: n - 1 }, (_, i) => ({
      id: `p${String(i)}`,
      rooms: [`r${String(i)}`, `r${String(i + 1)}`] as const,
      position: v(i * 6 + 5.5, 1, 2.5),
    }));
    portals.push({
      id: 'loop',
      rooms: ['r0', `r${String(n - 1)}`] as const,
      position: v(30, 1, 6),
    });
    const graph = buildSoundGraph({ rooms, portals });
    const portalGain = gains({ p2: -20, p5: -6, loop: -6 });
    const run = () => {
      const field = propagateNoise(graph, v(2, 1, 2), 100, { portalGain });
      return rooms.map((r) => field.hear(v(r.min.x + 2.5, 1, 2.5)));
    };
    expect(run()).toEqual(run());
    const heard = run();
    for (let i = 1; i < heard.length; i++) expect(heard[i]).not.toBeNull();
  });
});

describe('noise gains (mw-e09.3)', () => {
  it('distance: none within 1 m, then −20·log10(d) (−6 dB per doubling)', () => {
    expect(distanceGainDb(0)).toBe(0);
    expect(distanceGainDb(1)).toBe(0);
    expect(distanceGainDb(10)).toBeCloseTo(-20, 12);
    expect(distanceGainDb(4) - distanceGainDb(2)).toBeCloseTo(-6.0206, 4);
  });

  it('doors: the state’s default, or the leaf material’s override', () => {
    expect(doorGainDb('open', null)).toBe(0);
    expect(doorGainDb('ajar', null)).toBe(-6);
    expect(doorGainDb('closed', null)).toBe(-20);
    expect(doorGainDb('closed', 'iron')).toBe(-25);
    expect(doorGainDb('open', 'iron')).toBe(0);
    expect(doorGainDb('closed', 'wood')).toBe(-20);
  });

  it('partitions: the kind’s default, or the material’s override', () => {
    expect(partitionGainDb('wall', null)).toBe(-30);
    expect(partitionGainDb('floor', null)).toBe(-25);
    expect(partitionGainDb('floor', 'wood')).toBe(-15);
    expect(partitionGainDb('wall', 'stone')).toBe(-35);
    expect(partitionGainDb('wall', 'glass')).toBe(-30);
    const tuning = {
      ...DEFAULT_NOISE_TUNING,
      partitions: { wall: -10, floor: -12, materials: [{ material: 'wood', wall: -4 }] },
    };
    expect(partitionGainDb('floor', 'wood', tuning)).toBe(-12);
    expect(partitionGainDb('wall', 'wood', tuning)).toBe(-4);
  });
});
