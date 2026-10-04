// mw-ju8.9: Marsh's General Store, the data side (src/content/data/scene/marsh-store.json and the
// merchant, creature, faction and behaviour it places). Built from the e00 kit only; the headless
// run through the game's wiring is marsh-store.test.ts and the browser run is
// e2e/marsh-store.spec.ts.

import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { layoutScene } from '@sim/index';

const content = loadGameContent();
const scene = content.get('scene', 'marsh-store');
const layout = layoutScene(scene, (id) => content.get('kit', id));
const spawn = (id: string) => scene.spawns.find((s) => s.id === id);
const withTag = (tag: string) => scene.spawns.filter((s) => s.tags.includes(tag));
const placed = (piece: string) => scene.placements.filter((p) => p.piece.id === piece);

describe('Marsh’s General Store scene (mw-ju8.9)', () => {
  it('AC-1: a 10 x 8 m shop with a front door, an entrance inside it and a street exit outside', ({
    task,
  }) => {
    markExercised(task, 'scene', 'marsh-store');
    markExercised(task, 'door', 'wooden-door');
    const floor = scene.placements.find((p) => p.piece.id === 'floor' && p.at[2] === 0);
    expect(floor && [2 * floor.scale[0], 2 * floor.scale[2]]).toEqual([10, 8]);
    const door = spawn('front-door');
    expect(door?.door?.profile.id).toBe('wooden-door');
    expect(door?.door?.locked).toBeUndefined();
    // A doorway in the street-side (south) wall, where the door stands.
    expect(placed('doorway').map((p) => [p.at[0], p.at[2]])).toEqual([[0, door?.at[2]]]);
    const inside = withTag('entrance')[0];
    const exit = withTag('area-exit')[0];
    expect(inside?.at[2]).toBeGreaterThan(door?.at[2] ?? 0);
    expect(exit?.at[2]).toBeLessThan(door?.at[2] ?? 0);
    expect(inside?.tags).toContain('player-start');
  });

  it('AC-1: the counter is long, the shopkeeper stands in clear space behind it, friendly and unarmed', ({
    task,
  }) => {
    markExercised(task, 'creature', 'npc-ottilie');
    markExercised(task, 'faction', 'townsfolk');
    const counter = layout.parts.find(
      (part) => part.piece === 'platform' && part.max.x - part.min.x >= 5 && part.max.y === 1,
    );
    expect(counter).toBeDefined();
    const keeper = layout.spawns.find((s) => s.id === 'npc-ottilie');
    expect(keeper?.creature).toBe('npc-ottilie');
    const at = keeper?.position ?? { x: 0, y: 0, z: 0 };
    // Behind the counter: on its far (north) side, with the customer's spot and the trade
    // marker on the near one.
    expect(at.z).toBeGreaterThan(counter?.max.z ?? Infinity);
    expect(layout.spawns.find((s) => s.id === 'shop-counter')?.position.z).toBeLessThan(
      counter?.min.z ?? 0,
    );
    // Clear space: nothing solid within a body width of her, from the floor to head height.
    const body = 0.5;
    const blockers = layout.parts.filter(
      (part) =>
        part.min.y < 1.8 &&
        part.max.y > 0.1 &&
        part.min.x < at.x + body &&
        part.max.x > at.x - body &&
        part.min.z < at.z + body &&
        part.max.z > at.z - body,
    );
    expect(blockers).toEqual([]);
    const ottilie = content.get('creature', 'npc-ottilie');
    expect(ottilie.attacks).toEqual([]);
    expect(ottilie.faction?.id).toBe('townsfolk');
    expect(content.get('faction', 'townsfolk').towardPlayer).toBe('friendly');
    expect(ottilie.disposition.towardPlayer).toBe('friendly');
  });

  it('AC-1: the shop has shelves along the walls, light sources and crate-kit stock props', () => {
    // Tall platform stand-ins (shelves) against the back and west walls.
    const shelves = layout.parts.filter(
      (part) =>
        part.piece === 'platform' && part.max.y >= 1.5 && part.max.y <= 2 && part.min.y === 0,
    );
    expect(shelves.length).toBeGreaterThanOrEqual(2);
    expect(placed('crate').length).toBeGreaterThanOrEqual(6);
    // Every burning light is a warm lantern or hearth (tagged), on the ground floor and upstairs.
    const fires = scene.spawns.filter((s) => s.properties?.burning === true);
    expect(fires.some((s) => s.at[1] < 3 && s.tags.includes('hearth'))).toBe(true);
    expect(fires.some((s) => s.at[1] < 3 && s.tags.includes('lantern'))).toBe(true);
    expect(fires.some((s) => s.at[1] >= 3 && s.tags.includes('hearth'))).toBe(true);
    expect(scene.light?.ambient).toBeLessThan(0.4);
  });

  it('AC-3: a wooden stair of 12 steps rises 3 m to a second floor of 8 x 6 m, reached through the stair opening', () => {
    const stairs = placed('stairs');
    expect(stairs).toHaveLength(3);
    // Each flight starts where the last ended: 1 m higher, 2 m further north, in the same lane.
    stairs.forEach((flight, i) => {
      expect(flight.at).toEqual([4, i, -2 + 2 * i]);
    });
    const top = (stairs.at(-1)?.at[1] ?? 0) + 1;
    // Every step is a riser the controller walks (no jump, no mantle).
    const heights = content
      .get('kit', 'stairs')
      .parts.map((part) => part.size[1])
      .sort((x, y) => x - y);
    heights.forEach((height, i) => {
      expect(height - (heights[i - 1] ?? 0)).toBeLessThanOrEqual(
        content.get('controller', 'player').stepHeight,
      );
    });
    // The upper slab (8 x 6) and the landing sit at the stair's top height.
    const slabs = placed('floor').filter((p) => p.at[1] === top);
    expect(slabs.map((p) => [2 * p.scale[0], 2 * p.scale[2]])).toContainEqual([8, 6]);
    // No drop off the flight: a wall holds its west side from the second flight up (the first
    // flight's open side is a 1 m drop at most), and the room's stair side is walled upstairs.
    expect(placed('wall').some((w) => w.yaw === 90 && w.at[0] === 3 && w.at[1] === 0)).toBe(true);
    expect(placed('wall').some((w) => w.yaw === 90 && w.at[0] === 3 && w.at[1] === top)).toBe(true);
    // Upstairs walls close the room's other three sides and the stairwell's east side.
    const upper = placed('wall').filter((w) => w.at[1] === top);
    expect(upper.length).toBeGreaterThanOrEqual(5);
  });

  it('AC-3: the upstairs room has a bed, a table with chairs, a desk, a wardrobe, a hearth and a dormer light', () => {
    const upstairs = scene.spawns.filter((s) => s.at[1] >= 3 && s.tags.includes('home'));
    const kinds = new Set(upstairs.flatMap((s) => s.tags));
    for (const kind of ['bed', 'table', 'chair', 'desk', 'wardrobe']) expect(kinds).toContain(kind);
    expect(upstairs.filter((s) => s.tags.includes('chair')).length).toBeGreaterThanOrEqual(3);
    const dormer = withTag('dormer')[0];
    expect(dormer?.properties?.lightEmitter).toBeDefined();
    expect(dormer?.at[1]).toBeGreaterThanOrEqual(3);
    // Named so art can dress each stand-in later.
    expect(upstairs.map((s) => s.id)).toEqual(
      expect.arrayContaining(['bed', 'table', 'desk', 'wardrobe']),
    );
  });

  it('AC-2: the counter is a shop counter for marsh-general-store with a Trade prompt', () => {
    const counter = spawn('shop-counter');
    expect(counter?.merchant?.id).toBe('marsh-general-store');
    expect(counter?.interact?.affordances.map((a) => [a.verb, a.label])).toEqual([
      ['use', 'Trade'],
    ]);
  });
});

describe('the marsh-general-store merchant (mw-ju8.9)', () => {
  const merchant = content.get('merchant', 'marsh-general-store');

  it('AC-2: speaks through Ottilie, stocks only items that exist today and never sells currency', ({
    task,
  }) => {
    markExercised(task, 'merchant', 'marsh-general-store');
    expect(merchant.npcId).toBe('npc-ottilie');
    expect(content.has('creature', merchant.npcId)).toBe(true);
    const items = merchant.stock.map((line) => line.item?.id ?? '');
    expect(items).toEqual(
      expect.arrayContaining([
        'arming-sword',
        'hunting-knife',
        'leather-jerkin',
        'mail-hauberk',
        'shortbow',
        'standard-arrow',
        'healing-draught',
        'mana-draught',
        'oil-flask',
        'lockpicks',
        'wooden-shield',
        'travelling-robe',
      ]),
    );
    expect(items).not.toContain('gold');
    for (const line of merchant.stock) expect(line.count).toBeGreaterThan(0);
  });

  it('AC-2: sits inside the economy bands, buys everyday goods and never keys or quest items', () => {
    expect(merchant.markup).toBeGreaterThanOrEqual(1.1);
    expect(merchant.markup).toBeLessThanOrEqual(1.5);
    expect(merchant.buyRate).toBeGreaterThanOrEqual(0.3);
    expect(merchant.buyRate).toBeLessThanOrEqual(0.6);
    expect(merchant.buysCategories).toEqual(
      expect.arrayContaining(['weapon', 'armor', 'shield', 'ammo', 'consumable', 'tool']),
    );
    expect(merchant.buysCategories).not.toContain('key');
    expect(merchant.buysCategories).not.toContain('quest');
    expect(merchant.goldReserve).toBeGreaterThan(0);
    expect(merchant.isFence).toBe(false);
  });
});
