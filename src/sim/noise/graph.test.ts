import { describe, expect, it } from 'vitest';
import {
  buildSoundGraph,
  OUTSIDE_ROOM,
  PARTITION_GAP,
  roomAt,
  type SoundGraphSpec,
  type SoundRoomSpec,
} from './graph';

const v = (x: number, y: number, z: number) => ({ x, y, z });
const room = (id: string, min: [number, number, number], max: [number, number, number]) => ({
  id,
  min: v(...min),
  max: v(...max),
});

const hall = room('hall', [0, 0, 0], [10, 3, 10]);
const east = room('east', [10, 0, 0], [20, 3, 10]);
const above = room('above', [0, 3, 0], [10, 6, 10]);

describe('sound graph (mw-e09.3)', () => {
  it('finds walls between side-by-side rooms and floors between stacked ones', () => {
    const graph = buildSoundGraph({
      rooms: [hall, east, above],
      portals: [],
      partitions: [{ rooms: ['above', 'hall'], material: 'wood' }],
    });
    expect(graph.outside).toBe(3);
    expect(graph.rooms.map((r) => r.id)).toEqual(['hall', 'east', 'above', OUTSIDE_ROOM]);
    expect(graph.rooms[0]?.partitions).toEqual([
      { to: 1, kind: 'wall', material: null },
      { to: 2, kind: 'floor', material: 'wood' },
    ]);
    expect(graph.rooms[2]?.partitions).toEqual([{ to: 0, kind: 'floor', material: 'wood' }]);
    // east and above only share an edge: no partition.
    expect(graph.rooms[1]?.partitions).toEqual([{ to: 0, kind: 'wall', material: null }]);
    expect(graph.rooms[3]?.partitions).toEqual([]);
  });

  it('treats faces within the gap as touching (rooms drawn to a wall’s faces), but not beyond', () => {
    const near = room('near', [10 + PARTITION_GAP, 0, 0], [20, 3, 10]);
    const far = room('far', [10 + PARTITION_GAP + 0.01, 0, 0], [20, 3, 10]);
    expect(buildSoundGraph({ rooms: [hall, near], portals: [] }).rooms[0]?.partitions).toHaveLength(
      1,
    );
    expect(buildSoundGraph({ rooms: [hall, far], portals: [] }).rooms[0]?.partitions).toEqual([]);
  });

  it('lists each room’s portals, one side may be the outside, and a portal without a door is open', () => {
    const graph = buildSoundGraph({
      rooms: [hall, east],
      portals: [
        { id: 'arch', rooms: ['hall', 'east'], position: v(10, 1, 5), door: 7 },
        { id: 'gate', rooms: [OUTSIDE_ROOM, 'hall'], position: v(0, 1, 5) },
      ],
    });
    expect(graph.portals).toEqual([
      { id: 'arch', rooms: [0, 1], position: v(10, 1, 5), door: 7 },
      { id: 'gate', rooms: [2, 0], position: v(0, 1, 5), door: null },
    ]);
    expect(graph.rooms.map((r) => r.portals)).toEqual([[0, 1], [0], [1]]);
    expect(Object.isFrozen(graph.portals[0])).toBe(true);
  });

  it('places a position in its room (first on a shared face) or outside', () => {
    const graph = buildSoundGraph({ rooms: [hall, east, above], portals: [] });
    expect(roomAt(graph, v(5, 1, 5))).toBe(0);
    expect(roomAt(graph, v(10, 1, 5))).toBe(0);
    expect(roomAt(graph, v(15, 1, 5))).toBe(1);
    expect(roomAt(graph, v(5, 4, 5))).toBe(2);
    expect(roomAt(graph, v(-1, 1, 5))).toBe(3);
    expect(roomAt(graph, v(5, -1, 5))).toBe(3);
    expect(roomAt(graph, v(5, 7, 5))).toBe(3);
    expect(roomAt(graph, v(5, 1, -1))).toBe(3);
    expect(roomAt(graph, v(5, 1, 11))).toBe(3);
    expect(roomAt(graph, v(21, 1, 5))).toBe(3);
    expect(roomAt(graph, v(Number.NaN, 1, 5))).toBe(3);
  });

  it('rejects bad rooms', () => {
    const build = (rooms: SoundRoomSpec[]) => () => buildSoundGraph({ rooms, portals: [] });
    expect(build([room(OUTSIDE_ROOM, [0, 0, 0], [1, 1, 1])])).toThrow(/reserved/);
    expect(build([hall, hall])).toThrow('room id "hall" is used twice');
    expect(build([room('nan', [0, 0, 0], [Number.NaN, 1, 1])])).toThrow(/finite corners/);
    expect(build([room('inf', [-Infinity, 0, 0], [1, 1, 1])])).toThrow(/finite corners/);
    expect(build([room('flat', [0, 0, 0], [1, 0, 1])])).toThrow(/above min/);
    expect(build([hall, room('inner', [2, 0, 2], [4, 2, 4])])).toThrow(
      'rooms "hall" and "inner" overlap',
    );
  });

  it('rejects bad portals and partitions', () => {
    const build = (spec: Partial<SoundGraphSpec>) => () =>
      buildSoundGraph({ rooms: [hall, east], portals: [], ...spec });
    const portal = { id: 'p', rooms: ['hall', 'east'] as const, position: v(10, 1, 5) };
    expect(build({ portals: [portal, portal] })).toThrow('portal id "p" is used twice');
    expect(build({ portals: [{ ...portal, rooms: ['hall', 'cellar'] }] })).toThrow(
      'portal "p" names unknown room "cellar"',
    );
    expect(build({ portals: [{ ...portal, rooms: ['hall', 'hall'] }] })).toThrow(/to itself/);
    expect(build({ portals: [{ ...portal, rooms: [OUTSIDE_ROOM, OUTSIDE_ROOM] }] })).toThrow(
      /to itself/,
    );
    expect(build({ portals: [{ ...portal, position: v(0, Number.NaN, 0) }] })).toThrow(
      /finite position/,
    );
    expect(build({ portals: [{ ...portal, position: v(Infinity, 0, 0) }] })).toThrow(
      /finite position/,
    );
    expect(build({ portals: [{ ...portal, position: v(0, 0, -Infinity) }] })).toThrow(
      /finite position/,
    );
    const part = (rooms: [string, string]) => ({ partitions: [{ rooms, material: 'stone' }] });
    expect(build(part(['hall', OUTSIDE_ROOM]))).toThrow('names unknown room "outside"');
    expect(build(part(['hall', 'hall']))).toThrow(/to itself/);
    const apart = buildSoundGraph.bind(null, {
      rooms: [hall, room('far', [30, 0, 0], [40, 3, 10])],
      portals: [],
      partitions: [{ rooms: ['hall', 'far'], material: 'stone' }],
    });
    expect(apart).toThrow('partition hall–far names rooms that do not touch');
    const overlapping = buildSoundGraph.bind(null, {
      rooms: [hall, room('inner', [2, 0, 2], [4, 2, 4])],
      portals: [],
      partitions: [{ rooms: ['hall', 'inner'], material: 'stone' }],
    });
    expect(overlapping).toThrow(/do not touch/);
  });
});
