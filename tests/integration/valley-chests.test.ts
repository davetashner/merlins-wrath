// mw-ju8.20: the valley's treasure chests. AC-1 checks the tiered loot tables against the crown bands
// in docs/design/economy.md; AC-2 rolls them seeded; AC-3 plays the iron-bound chest in valley-02 as the
// game wires it (refused without its key, opens with the key found in the wooden chest across the
// glade); AC-4 checks the placed chests: count, spacing along the path, never on the route.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import {
  contentChecks,
  contentTypes,
  gameContentSources,
  loadContent,
  loadGameContent,
  lootTableProblems,
  type LoadedEntry,
} from '@content/index';
import { markExercised } from '@content/testing';
import {
  actionButton,
  actionFrame,
  actionVector,
  containerActionCommand,
  containerOpened,
  inventoryOf,
  interactionPrompt,
  lockRefused,
  LockComponent,
  LootTables,
  PlayerLook,
  SceneSpawnComponent,
  teleportCommand,
  World,
  type ActionFrame,
  type ContainerOpened,
  type EntityId,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { describe, expect, it } from 'vitest';

const content = loadGameContent();
const tables = new LootTables(content.all('loot-table'), content.all('item'));

/** docs/design/economy.md, Income: crowns a chest of each tier yields. */
const BANDS = {
  common: { min: 8, max: 25, table: 'valley-chest-common' },
  fine: { min: 25, max: 70, table: 'valley-chest-fine' },
  superior: { min: 70, max: 180, table: 'valley-chest-superior' },
} as const;
const ROLLS = 3_000;

function crownsOver(tableId: string, seed: number) {
  const world = new World({ seed });
  const items = new Set<string>();
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < ROLLS; i++) {
    const { stacks, error } = tables.rollInWorld(world, tableId);
    expect(error).toBeUndefined();
    let crowns = 0;
    for (const { item, count } of stacks) {
      if (item === 'gold') crowns += count;
      else items.add(item);
    }
    min = Math.min(min, crowns);
    max = Math.max(max, crowns);
  }
  return { min, max, items };
}

describe('valley chest loot tables (mw-ju8.20)', () => {
  it('AC-1: the valley tables pass the loot validator with no warnings and name real items', ({
    task,
  }) => {
    let entries: readonly LoadedEntry[] = [];
    loadContent(contentTypes, gameContentSources(), [
      ...contentChecks,
      (loaded) => {
        entries = loaded;
        return [];
      },
    ]);
    const { errors, warnings } = lootTableProblems(entries);
    expect(errors).toEqual([]);
    expect(warnings.filter((w) => w.file.includes('valley-chest'))).toEqual([]);
    for (const id of [
      'valley-chest-common',
      'valley-chest-fine',
      'valley-chest-fine-gear',
      'valley-chest-superior',
      'valley-chest-superior-gear',
    ]) {
      markExercised(task, 'loot-table', id);
    }
  });

  it('AC-1: every tier pays its crown band exactly: the guaranteed floor plus one capped bonus', () => {
    for (const { min, max, table } of Object.values(BANDS)) {
      const t = content.get('loot-table', table);
      const floor = t.guaranteed.find((g) => g.item.id === 'gold')?.count ?? 0;
      const bonus = t.entries.filter((e) => e.item?.id === 'gold');
      expect(bonus).toHaveLength(1);
      expect(t.noDuplicates).toBe(true);
      expect(floor).toBe(min);
      // The bonus can win once only, so the purse tops out at floor + the bonus's largest count.
      expect(floor + (bonus[0]?.count.max ?? 0)).toBe(max);
    }
  });

  it('AC-2: seeded rolls are deterministic and every purse lies inside its tier band', () => {
    for (const { min, max, table } of Object.values(BANDS)) {
      const run = () => {
        const world = new World({ seed: 2026 });
        return Array.from({ length: 500 }, () => tables.rollInWorld(world, table).stacks);
      };
      expect(run()).toEqual(run());
      const seen = crownsOver(table, 7);
      expect(seen.min).toBeGreaterThanOrEqual(min);
      expect(seen.max).toBeLessThanOrEqual(max);
      // The bonus coin really is rolled: purses spread past the floor.
      expect(seen.max).toBeGreaterThan(min + (max - min) / 2);
    }
  });

  it('AC-2: the pools suit the tier: gear from fine up, a scroll in the superior chest only', () => {
    const common = crownsOver('valley-chest-common', 3).items;
    const fine = crownsOver('valley-chest-fine', 3).items;
    const superior = crownsOver('valley-chest-superior', 3).items;
    const categories = (ids: Set<string>) =>
      new Set([...ids].map((id) => content.get('item', id).category));
    expect(categories(common)).not.toContain('weapon');
    expect(categories(common)).not.toContain('armor');
    expect(categories(common)).not.toContain('book');
    expect(categories(fine).has('armor') && categories(fine).has('weapon')).toBe(true);
    expect(categories(fine)).not.toContain('book');
    expect(categories(superior)).toContain('book');
    expect([...superior].some((id) => content.get('item', id).category === 'armor')).toBe(true);
    for (const id of ['arming-sword', 'open-helm']) expect(fine).toContain(id);
    for (const id of ['tempered-hunting-knife', 'kettle-helm']) expect(superior).toContain(id);
  });
});

const UP = actionButton(false, false, false);
const DOWN = actionButton(true, true, false);
function frame(interact: boolean): ActionFrame {
  const zero = actionVector(0, 0);
  return actionFrame({
    move: zero,
    look: zero,
    buttons: (action) => (action === 'interact' && interact ? DOWN : UP),
  });
}
const IDLE = frame(false);
const INTERACT = frame(true);

describe('the valley-02 iron-bound chest (mw-ju8.20)', () => {
  it('AC-3: locked without its key (the prompt says locked); the key from the wooden chest opens it', ({
    task,
  }) => {
    markExercised(task, 'lock', 'valley-chest-iron');
    markExercised(task, 'item', 'valley-chest-key');
    markExercised(task, 'loot-table', 'valley-chest-common');
    const game = createGameWorld<unknown>(RAPIER, { seed: 5, hz: 60, scene: 'valley-02' });
    const { world, player } = game;
    const sim = world as unknown as World<never>;
    const spawn = (id: string): EntityId => {
      const found = world
        .query(SceneSpawnComponent)
        .ids()
        .find((entity) => world.get(entity, SceneSpawnComponent)?.id === id);
      if (found === undefined) throw new Error(`no spawn ${id}`);
      return found;
    };
    const iron = spawn('chest-valley-02-glade-west');
    const wooden = spawn('chest-valley-02-glade-east');
    expect(game.containers).toEqual(expect.arrayContaining([iron, wooden]));
    const refused: string[] = [];
    const searched: ContainerOpened[] = [];
    world.events.on(lockRefused, (e) => refused.push(e.reason));
    world.events.on(containerOpened, (e) => searched.push(e));
    const stand = (x: number, z: number, yaw: number) => {
      world.step([teleportCommand(player, { x, y: 0, z })]);
      world.set(player, PlayerLook, { yaw, pitch: 0 });
      for (let i = 0; i < 10; i++) world.step([IDLE]);
    };
    const pack = () => (inventoryOf(sim, player)?.items ?? []).map((i) => i.defId);

    // The padlocked chest, empty-handed: Unlock is greyed with the lock's hint; nothing opens.
    stand(-7.0, 31.0, Math.PI / 2);
    expect(world.get(iron, LockComponent)?.locked).toBe(true);
    expect(interactionPrompt(sim, player)).toMatchObject({
      target: iron,
      verb: 'unlock',
      available: false,
    });
    world.step([INTERACT]);
    expect(searched.filter((e) => e.entity === iron)).toEqual([]);
    expect(world.get(iron, LockComponent)?.locked).toBe(true);

    // The wooden chest on the far side holds the key (and rolls its common loot).
    stand(7.25, 14.0, -Math.PI / 2);
    expect(interactionPrompt(sim, player)).toMatchObject({
      target: wooden,
      verb: 'search',
      available: true,
    });
    world.step([INTERACT]);
    world.step([IDLE, containerActionCommand(player, wooden, { op: 'take-all' })]);
    expect(pack()).toContain('valley-chest-key');
    const first = searched.find((e) => e.entity === wooden);
    expect(first?.first).toBe(true);
    expect(first?.rolled.some((s) => s.item === 'gold')).toBe(true);

    // With the key on the ring, one press unlocks the iron-bound chest, the next searches it.
    stand(-7.0, 31.0, Math.PI / 2);
    expect(interactionPrompt(sim, player)).toMatchObject({
      target: iron,
      verb: 'unlock',
      available: true,
    });
    world.step([INTERACT]);
    expect(world.get(iron, LockComponent)?.locked).toBe(false);
    for (let i = 0; i < 30; i++) world.step([IDLE]);
    expect(interactionPrompt(sim, player)).toMatchObject({ target: iron, verb: 'search' });
    world.step([INTERACT]);
    const rolled = searched.find((e) => e.entity === iron)?.rolled ?? [];
    const crowns = rolled.filter((s) => s.item === 'gold').reduce((n, s) => n + s.count, 0);
    expect(crowns).toBeGreaterThanOrEqual(BANDS.fine.min);
    expect(crowns).toBeLessThanOrEqual(BANDS.fine.max);
    expect(refused).toEqual([]);
  });
});

type Pt = readonly [number, number];
const ORIGIN: Pt = [0, 0];
const distanceToPolyline = (p: Pt, line: readonly Pt[]): number => {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line.at(i) ?? ORIGIN;
    const b = line.at(i + 1) ?? ORIGIN;
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)),
    );
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz)));
  }
  return best;
};

/** Each scene's route centre line, from its authored path-start and path-end (valley-01 dog-legs). */
const ROUTE: Record<string, readonly Pt[]> = {
  'valley-01': [
    [0, 2],
    [0, 19.5],
    [6, 19.5],
    [6, 52],
  ],
  'valley-02': [
    [0, 2],
    [0, 46],
  ],
  'valley-03': [
    [0, 2],
    [0, 56],
  ],
};
const CHESTS = {
  'valley-01': ['chest-valley-01-nook'],
  'valley-02': ['chest-valley-02-glade-east', 'chest-valley-02-glade-west'],
  'valley-03': ['chest-valley-03-overlook-cache'],
} as const;

describe('chest placement in the valley scenes (mw-ju8.20)', () => {
  it('AC-4: the authored chests are in place, tagged, and cover the tiers', () => {
    let total = 0;
    for (const [sceneId, ids] of Object.entries(CHESTS)) {
      const def = content.get('scene', sceneId);
      const chests = def.spawns.filter((s) => s.container !== undefined);
      expect(chests.map((s) => s.id)).toEqual(ids);
      for (const c of chests) {
        expect(c.tags).toEqual(expect.arrayContaining(['chest', 'valley-chest']));
        expect(c.id).toMatch(/^chest-valley-0[123]-/);
      }
      total += chests.length;
    }
    expect(total).toBe(4);
    const loot = (scene: string, id: string) =>
      content.get('scene', scene).spawns.find((s) => s.id === id)?.container;
    expect(loot('valley-01', 'chest-valley-01-nook')?.loot?.id).toBe('valley-chest-common');
    expect(loot('valley-02', 'chest-valley-02-glade-west')).toMatchObject({
      loot: { id: 'valley-chest-fine' },
      lock: { id: 'valley-chest-iron' },
    });
    expect(loot('valley-02', 'chest-valley-02-glade-east')?.contents[0]?.item.id).toBe(
      'valley-chest-key',
    );
    expect(loot('valley-03', 'chest-valley-03-overlook-cache')?.loot?.id).toBe(
      'valley-chest-superior',
    );
  });

  it('AC-4: a chest every 40 to 60 m of path or so, none on the route centre line', () => {
    let routeLength = 0;
    let chests = 0;
    for (const [sceneId, line] of Object.entries(ROUTE)) {
      const def = content.get('scene', sceneId);
      const start = def.spawns.find((s) => s.tags.includes('path-start'));
      const end = def.spawns.find((s) => s.tags.includes('path-end'));
      expect(start?.at.slice(0, 3)).toEqual([
        (line.at(0) ?? ORIGIN)[0],
        0,
        (line.at(0) ?? ORIGIN)[1],
      ]);
      expect([end?.at[0], end?.at[2]]).toEqual(line.at(-1));
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line.at(i) ?? ORIGIN;
        const b = line.at(i + 1) ?? ORIGIN;
        routeLength += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      for (const s of def.spawns.filter((x) => x.container !== undefined)) {
        chests++;
        // Off the line by more than the route's half-width, so a chest never blocks the way.
        expect(distanceToPolyline([s.at[0], s.at[2]], line), s.id).toBeGreaterThanOrEqual(1.1);
      }
    }
    const perChest = routeLength / chests;
    expect(perChest).toBeGreaterThanOrEqual(35);
    expect(perChest).toBeLessThanOrEqual(65);
  });

  it('AC-4: the hidden overlook cache sits behind two breakable barricades', () => {
    const def = content.get('scene', 'valley-03');
    const barricades = def.placements.filter((p) => p.breakable?.profile.id === 'wood-barricade');
    expect(barricades).toHaveLength(2);
    expect(barricades.every((p) => p.breakable?.reveals === 'valley-03-cache')).toBe(true);
  });

  it('AC-4: each valley scene still loads headless with its chests as containers', () => {
    for (const [sceneId, ids] of Object.entries(CHESTS)) {
      const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene: sceneId });
      expect(game.containers).toHaveLength(ids.length);
      game.world.step([IDLE]);
    }
  });
});
