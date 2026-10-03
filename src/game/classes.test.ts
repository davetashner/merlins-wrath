import { describe, expect, it } from 'vitest';
import { controllerTuningFor, loadGameContent, PLAYER_CONTROLLER_ID } from '@content/index';
import { describeContent, markExercised } from '@content/testing';
import {
  capabilitiesOf,
  capabilitySources,
  classOf,
  equipmentOf,
  hasCapability,
  inventoryOf,
  PLAYER_CLASS_FACT,
  PlayerClassComponent,
  statsOf,
  World,
  type ClassRules,
} from '@sim/index';
import { createCapabilityRegistry } from './capabilities';
import {
  applyClass,
  classCards,
  createClassRules,
  isPlayerClass,
  itemLabel,
  kitLines,
  kitModel,
  newGameRequest,
} from './classes';
import { installFactRegistry } from './facts';

const content = loadGameContent();

function freshPlayer(): { world: World; actor: number; rules: ClassRules } {
  const world = new World({ seed: 5 });
  installFactRegistry(world.facts, content, true);
  const actor = world.spawn();
  return {
    world,
    actor,
    rules: createClassRules(content, createCapabilityRegistry(content, true)),
  };
}

describe('apply class in the game (mw-e19.5)', () => {
  it('AC-1: the thief applied to a fresh player matches the thief data file exactly', ({
    task,
  }) => {
    markExercised(task, 'class', 'thief');
    const thief = content.get('class', 'thief');
    const { world, actor, rules } = freshPlayer();
    applyClass(world, actor, 'thief', rules);

    // Registry: exactly the starting capabilities, each from the class source.
    expect(capabilitiesOf(world, actor)).toEqual([...thief.startingCapabilities].sort());
    for (const id of thief.startingCapabilities) {
      expect(capabilitySources(world, actor, id)).toEqual(['class']);
    }
    // Inventory: the kit's gold and items, in file order.
    const inventory = inventoryOf(world, actor);
    expect(inventory?.gold).toBe(thief.startingKit.gold);
    expect(inventory?.items.map(({ defId, count }) => [defId, count])).toEqual(
      thief.startingKit.items.map(({ item, count }) => [item.id, count]),
    );
    // Equipment: worn as the thief, holding exactly the items marked equip.
    const equipment = equipmentOf(world, actor);
    expect(equipment?.classId).toBe('thief');
    const worn = Object.values(equipment?.slots ?? {}).flatMap((ref) => (ref ? [ref.defId] : []));
    expect(worn.sort()).toEqual(
      thief.startingKit.items
        .filter(({ equip }) => equip)
        .map(({ item }) => item.id)
        .sort(),
    );
    expect(statsOf(world, actor)).toEqual(thief.stats);
    // Exposed to conditions.
    expect(classOf(world, actor)).toBe('thief');
    expect(world.facts.get(PLAYER_CLASS_FACT)).toBe('thief');
  });

  it('AC-4: a second class on the same player throws class-already-set', ({ task }) => {
    markExercised(task, 'class', 'knight');
    const { world, actor, rules } = freshPlayer();
    applyClass(world, actor, 'knight', rules);
    expect(() => applyClass(world, actor, 'sorcerer', rules)).toThrow('class-already-set');
    expect(hasCapability(world, actor, 'spell.ember')).toBe(false);
  });

  it('declares player.class with every class as a value', () => {
    const spec = content
      .all('fact')
      .flatMap((group) => group.facts)
      .find((f) => f.key === PLAYER_CLASS_FACT);
    expect(spec).toMatchObject({ type: 'enum', default: 'none' });
    expect(spec && 'values' in spec ? spec.values : []).toEqual([
      'none',
      'knight',
      'archer',
      'sorcerer',
      'thief',
    ]);
  });
});

describeContent('class', 'applies its capabilities, kit and stats from data', (def) => {
  const { world, actor, rules } = freshPlayer();
  if (!isPlayerClass(def.id)) throw new Error(def.id);
  const applied = applyClass(world, actor, def.id, rules);
  expect(applied.gained).toEqual(def.startingCapabilities);
  expect(applied.equipped).toHaveLength(def.startingKit.items.filter(({ equip }) => equip).length);
  expect(kitModel(world, actor, content)?.className).toBe(def.name);
  // Each class's controller override (if any) is valid tuning for the new player.
  expect(
    controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID), def.id),
  ).toBeDefined();
});

describe('class cards and the kit panel model', () => {
  it('lists the four classes in order with pitch, three verbs and the kit preview', ({ task }) => {
    const cards = classCards(content);
    expect(cards.map(({ id }) => id)).toEqual(['knight', 'archer', 'sorcerer', 'thief']);
    for (const card of cards) {
      markExercised(task, 'class', card.id);
      expect(card.verbs).toHaveLength(3);
      expect(card.pitch.length).toBeGreaterThan(0);
    }
    expect(cards.find(({ id }) => id === 'sorcerer')?.kit).toEqual([
      'Ash staff (equipped)',
      'Travelling robe (equipped)',
      'Mana draught ×2',
      '30 gold',
    ]);
    expect(kitLines(content.get('class', 'thief'))).toContain('Lockpicks (equipped)');
    expect(classCards({ all: () => [] } as never)).toEqual([]);
  });

  it('turns item ids into readable names', () => {
    expect(itemLabel('mana-draught')).toBe('Mana draught');
    expect(itemLabel('lockpicks')).toBe('Lockpicks');
    expect(itemLabel('')).toBe('');
  });

  it('derives the kit panel from the sim: null without a class, then the pack', () => {
    const { world, actor, rules } = freshPlayer();
    expect(kitModel(world, actor, content)).toBeNull();
    applyClass(world, actor, 'sorcerer', rules);
    expect(kitModel(world, actor, content)).toEqual({
      className: 'Sorcerer',
      gold: 30,
      items: [
        { label: 'Ash staff', count: 1, equipped: true },
        { label: 'Travelling robe', count: 1, equipped: true },
        { label: 'Mana draught', count: 2, equipped: false },
      ],
    });
  });

  it('reads a model even for a class without inventory or equipment components', () => {
    const { world, actor, rules } = freshPlayer();
    applyClass(world, actor, 'archer', rules);
    const other = world.spawn();
    // A class recorded on an actor with nothing else (e.g. a save of a stripped-down actor).
    world.add(other, PlayerClassComponent, { classId: 'knight' });
    expect(kitModel(world, other, content)).toEqual({ className: 'Knight', gold: 0, items: [] });
  });
});

describe('new game request', () => {
  it('reads ?newgame and ?class=<id>, ?class winning', () => {
    expect(newGameRequest('')).toEqual({ kind: 'none' });
    expect(newGameRequest('?scene=testbed&newgame')).toEqual({ kind: 'select' });
    expect(newGameRequest('?class=sorcerer&newgame')).toEqual({
      kind: 'class',
      classId: 'sorcerer',
    });
    expect(newGameRequest('?class=bard')).toEqual({ kind: 'unknown-class', classId: 'bard' });
    expect(isPlayerClass('thief')).toBe(true);
    expect(isPlayerClass('bard')).toBe(false);
  });
});
