// mw-ju8.6: the Sleeping Ox, the data side (src/content/data/scene/sleeping-ox.json and the merchant
// and creature it places). Built from the e00 kit only; the headless run is sleeping-ox.test.ts and
// the browser run is e2e/sleeping-ox.spec.ts.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { layoutScene } from '@sim/index';

const content = loadGameContent();
const scene = content.get('scene', 'sleeping-ox');
const layout = layoutScene(scene, (id) => content.get('kit', id));
const spawn = (id: string) => scene.spawns.find((s) => s.id === id);
const placed = (piece: string) => scene.placements.filter((p) => p.piece.id === piece);

describe('the Sleeping Ox scene data (mw-ju8.6)', () => {
  it('a 10 x 8 m common room with a street door, an entrance inside it and a street exit outside', ({
    task,
  }) => {
    markExercised(task, 'scene', 'sleeping-ox');
    markExercised(task, 'door', 'wooden-door');
    const floor = scene.placements.find((p) => p.piece.id === 'floor' && p.at[2] === 0);
    expect(floor && [2 * floor.scale[0], 2 * floor.scale[2]]).toEqual([10, 8]);
    const door = spawn('front-door');
    expect(door?.door?.profile.id).toBe('wooden-door');
    const entrance = scene.spawns.find((s) => s.tags.includes('entrance'));
    const exit = scene.spawns.find((s) => s.tags.includes('area-exit'));
    expect(entrance?.tags).toContain('player-start');
    expect(entrance?.at[2]).toBeGreaterThan(door?.at[2] ?? 0);
    expect(exit?.at[2]).toBeLessThan(door?.at[2] ?? 0);
    // The street exit names where it leads, by the convention area transitions will read.
    expect(exit?.tags).toContain('scene:briar-glen-lane');
  });

  it('the bar is tagged for sleeping-ox with the Trade / Rooms prompt and Dot stands behind it', ({
    task,
  }) => {
    markExercised(task, 'creature', 'npc-dot');
    markExercised(task, 'faction', 'townsfolk');
    const bar = spawn('bar-counter');
    expect(bar?.tags).toEqual(
      expect.arrayContaining(['merchant:sleeping-ox', 'dev-crowns:400', 'counter']),
    );
    expect(bar?.interact?.affordances.map((a) => [a.verb, a.label])).toEqual([
      ['talk', 'Trade / Rooms'],
    ]);
    const dot = layout.spawns.find((s) => s.id === 'npc-dot');
    expect(dot?.creature).toBe('npc-dot');
    const counter = layout.parts.find(
      (part) => part.piece === 'platform' && part.max.x - part.min.x >= 5 && part.max.y === 1,
    );
    expect(counter).toBeDefined();
    expect(dot?.position.z).toBeGreaterThan(counter?.max.z ?? Infinity);
    expect(layout.spawns.find((s) => s.id === 'bar-counter')?.position.z).toBeLessThan(
      counter?.min.z ?? 0,
    );
    const keeper = content.get('creature', 'npc-dot');
    expect(keeper.attacks).toEqual([]);
    expect(keeper.disposition.towardPlayer).toBe('friendly');
  });

  it('the common room has a hearth, lanterns, tables with benches and a light block', () => {
    const fires = scene.spawns.filter((s) => s.properties?.burning === true);
    expect(fires.some((s) => s.tags.includes('hearth'))).toBe(true);
    expect(fires.filter((s) => s.tags.includes('lantern')).length).toBeGreaterThanOrEqual(2);
    const kinds = scene.spawns.flatMap((s) => s.tags);
    expect(kinds.filter((k) => k === 'table').length).toBeGreaterThanOrEqual(2);
    expect(kinds.filter((k) => k === 'bench').length).toBeGreaterThanOrEqual(4);
    expect(scene.light?.ambient).toBeLessThan(0.4);
    expect(scene.light?.directional.length).toBeGreaterThan(0);
  });

  it('a 4 x 4 m rented room opens off the common room through a doorway, with a bed in it', () => {
    const rented = placed('floor').find((p) => p.at[0] > 5);
    expect(rented && [2 * rented.scale[0], 2 * rented.scale[2]]).toEqual([4, 4]);
    const [roomX, , roomZ] = rented?.at ?? [0, 0, 0];
    // A doorway in the common room's east wall (x = 5) at the room's end.
    const doorway = placed('doorway').find((p) => p.at[0] === 5);
    expect(doorway?.yaw).toBe(90);
    expect(Math.abs((doorway?.at[2] ?? 99) - roomZ)).toBeLessThanOrEqual(2);
    const bed = spawn('bed');
    expect(bed?.tags).toEqual(expect.arrayContaining(['bed', 'rented-room']));
    expect(Math.abs((bed?.at[0] ?? 99) - roomX)).toBeLessThan(2);
    expect(Math.abs((bed?.at[2] ?? 99) - roomZ)).toBeLessThan(2);
  });
});

describe('the sleeping-ox merchant (mw-ju8.6)', () => {
  const merchant = content.get('merchant', 'sleeping-ox');

  it('sells a room for 8-15 crowns, a little existing food, and buys food only', ({ task }) => {
    markExercised(task, 'merchant', 'sleeping-ox');
    expect(merchant.npcId).toBe('npc-dot');
    expect(content.has('creature', merchant.npcId)).toBe(true);
    expect(merchant.services).toEqual([
      { id: 'room-for-the-night', name: 'Room for the night', price: 12, kind: 'rest' },
    ]);
    const stock = merchant.stock.map((line) => line.item?.id ?? '');
    expect(stock).toEqual(
      expect.arrayContaining(['bread-loaf', 'hard-cheese-wedge', 'smoked-sausage', 'apple']),
    );
    for (const id of stock) expect(content.get('item', id).category).toBe('consumable');
    expect(merchant.buysCategories).toEqual(['consumable']);
    expect(merchant.isFence).toBe(false);
  });
});
