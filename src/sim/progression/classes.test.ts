import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { hashWorld } from '../snapshot';
import {
  addEquipment,
  emptySlots,
  equipmentOf,
  EquipmentRules,
  type EquipmentItemDef,
} from '../inventory/equipment';
import {
  addInventory,
  inventoryOf,
  InventoryRules,
  type InventoryItemDef,
} from '../inventory/inventory';
import {
  addCapabilities,
  capabilitiesOf,
  capabilitySources,
  CapabilityRegistry,
  UnknownCapabilityError,
} from './capabilities';
import {
  ClassAlreadySetError,
  classOf,
  ClassRules,
  PLAYER_CLASS_FACT,
  statsOf,
  type ClassApplyDef,
} from './classes';

type Def = EquipmentItemDef & InventoryItemDef;

const PENALTY = { drawTimeMultiplier: 1.5, staminaCostMultiplier: 1.25, noiseMultiplier: 1 };

const ITEMS: readonly Def[] = [
  {
    id: 'knife',
    category: 'weapon',
    stackable: false,
    flags: { unique: false, questItem: false },
    equip: { slot: 'main-hand', proficiencies: ['daggers'], nonProficient: PENALTY },
  },
  {
    id: 'lockpicks',
    category: 'tool',
    stackable: false,
    flags: { unique: false, questItem: false },
    equip: { slot: 'tool-belt', proficiencies: [], nonProficient: PENALTY },
  },
  {
    id: 'draught',
    category: 'consumable',
    stackable: true,
    maxStack: 5,
    flags: { unique: false, questItem: false },
  },
  {
    id: 'relic',
    category: 'artifact',
    stackable: false,
    flags: { unique: true, questItem: false },
  },
];

const kit = (id: string, count = 1, equip = false) => ({ item: { id }, count, equip });

const THIEF: ClassApplyDef & { proficiencies: string[]; armorCapacityKg: number } = {
  id: 'thief',
  startingCapabilities: ['verb.climb.ledge', 'trick.pickpocket'],
  startingKit: {
    gold: 40,
    items: [kit('knife', 1, true), kit('lockpicks', 1, true), kit('draught', 7)],
  },
  stats: { health: 90, stamina: 110, mana: 30 },
  proficiencies: ['daggers'],
  armorCapacityKg: 23,
};

const KNIGHT: ClassApplyDef & { proficiencies: string[]; armorCapacityKg: number } = {
  id: 'knight',
  startingCapabilities: ['verb.climb.ledge', 'technique.parry'],
  startingKit: { gold: 0, items: [kit('relic')] },
  stats: { health: 120, stamina: 100, mana: 20 },
  proficiencies: ['blades'],
  armorCapacityKg: 30,
};

const CAPABILITIES = ['verb.climb.ledge', 'trick.pickpocket', 'technique.parry'];

function setup(classes = [THIEF, KNIGHT]) {
  const world = new World({ seed: 3 });
  const actor = world.spawn();
  const capabilities = new CapabilityRegistry(CAPABILITIES);
  const rules = new ClassRules(classes, {
    capabilities,
    inventory: new InventoryRules(ITEMS),
    equipment: new EquipmentRules(ITEMS, classes),
  });
  return { world, actor, rules };
}

describe('apply class (mw-e19.5)', () => {
  it('grants the class capabilities, adds and equips the kit and sets the stats', () => {
    const { world, actor, rules } = setup();
    expect(rules.ids).toEqual(['thief', 'knight']);
    expect(classOf(world, actor)).toBeUndefined();
    expect(statsOf(world, actor)).toBeUndefined();

    const applied = rules.apply(world, actor, 'thief');

    expect(applied).toEqual({
      classId: 'thief',
      gained: ['verb.climb.ledge', 'trick.pickpocket'],
      items: [1, 2, 3, 4],
      equipped: [1, 2],
    });
    expect(classOf(world, actor)).toBe('thief');
    expect(capabilitiesOf(world, actor)).toEqual(['trick.pickpocket', 'verb.climb.ledge']);
    expect(capabilitySources(world, actor, 'trick.pickpocket')).toEqual(['class']);
    expect(inventoryOf(world, actor)).toEqual({
      gold: 40,
      nextInstanceId: 5,
      items: [
        { instanceId: 1, defId: 'knife', count: 1, flags: {} },
        { instanceId: 2, defId: 'lockpicks', count: 1, flags: {} },
        { instanceId: 3, defId: 'draught', count: 5, flags: {} },
        { instanceId: 4, defId: 'draught', count: 2, flags: {} },
      ],
    });
    expect(equipmentOf(world, actor)).toEqual({
      classId: 'thief',
      slots: {
        ...emptySlots(),
        'main-hand': { instanceId: 1, defId: 'knife' },
        'tool-belt-1': { instanceId: 2, defId: 'lockpicks' },
      },
    });
    expect(statsOf(world, actor)).toEqual({ health: 90, stamina: 110, mana: 30 });
  });

  it('AC-4: applying a class to a player who already has one throws class-already-set', () => {
    const { world, actor, rules } = setup();
    rules.apply(world, actor, 'thief');
    const before = hashWorld(world);

    expect(() => rules.apply(world, actor, 'knight')).toThrow('class-already-set');
    expect(() => rules.apply(world, actor, 'thief')).toThrow(ClassAlreadySetError);
    try {
      rules.apply(world, actor, 'knight');
    } catch (error) {
      expect(error).toMatchObject({ code: 'class-already-set', current: 'thief', actor });
      expect((error as ClassAlreadySetError).requested).toBe('knight');
    }
    // No stacking: nothing of the knight's was added.
    expect(hashWorld(world)).toBe(before);
    expect(classOf(world, actor)).toBe('thief');
  });

  it('writes the player.class fact when the world declares it', () => {
    const { world, actor, rules } = setup();
    world.facts.declare(PLAYER_CLASS_FACT, {
      type: 'enum',
      values: ['none', 'thief', 'knight'],
      default: 'none',
    });
    expect(world.facts.get(PLAYER_CLASS_FACT)).toBe('none');
    rules.apply(world, actor, 'thief');
    expect(world.facts.get(PLAYER_CLASS_FACT)).toBe('thief');
  });

  it('builds on components the actor already has, wearing its equipment as the class', () => {
    const { world, actor, rules } = setup();
    addCapabilities(world, actor);
    addInventory(world, actor, 5);
    addEquipment(world, actor, 'knight');
    const other = world.spawn();
    rules.apply(world, other, 'knight'); // registers every component first

    rules.apply(world, actor, 'thief');
    expect(inventoryOf(world, actor)?.gold).toBe(45);
    expect(equipmentOf(world, actor)?.classId).toBe('thief');
    // No gold in the knight's kit: none added.
    expect(inventoryOf(world, other)?.gold).toBe(0);
  });

  it('refuses an unknown class or kit item before changing anything', () => {
    const broken = {
      ...THIEF,
      id: 'bard',
      startingKit: { gold: 1, items: [kit('lute')] },
    };
    const { world, actor, rules } = setup([THIEF, broken]);
    const before = hashWorld(world);
    expect(() => rules.apply(world, actor, 'sorcerer')).toThrow('class "sorcerer" is not defined');
    expect(() => rules.apply(world, actor, 'bard')).toThrow('item "lute" is not defined');
    expect(hashWorld(world)).toBe(before);
    expect(classOf(world, actor)).toBeUndefined();
  });

  it('throws when the inventory refuses a kit item, naming class, item and reason', () => {
    const greedy = { ...KNIGHT, startingKit: { gold: 0, items: [kit('relic', 2)] } };
    const { world, actor, rules } = setup([greedy]);
    expect(() => rules.apply(world, actor, 'knight')).toThrow(
      'class "knight" kit item "relic" was refused by the inventory: unique-held',
    );
  });

  it('leaves undeclared starting capabilities to the registry policy', () => {
    const odd = { ...THIEF, startingCapabilities: ['verb.fly'] };
    const { world, actor, rules } = setup([odd]);
    expect(() => rules.apply(world, actor, 'thief')).toThrow(UnknownCapabilityError);
  });
});
