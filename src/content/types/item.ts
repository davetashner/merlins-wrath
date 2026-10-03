// The item content type (mw-e17.2): every thing that can sit in the player's pack, one file per item
// at `src/content/data/item/<id>.json`. Items are data, not code (contract §1); loot (mw-e18), shops
// (mw-e20), quests and progression (mw-e19) reference items by id.
//
// The schema is a union over `category`, so each category carries its own block and the inferred type
// narrows on it (`if (item.category === 'armor') item.armor.weightKg`). What ADR-0003 (encumbrance)
// fixes:
// - The pack is weightless and uncapped. Only armor pieces and shields have a weight, in kilograms
//   (`armor.weightKg`, `shield.weightKg`), which feeds the wearer's load class; nothing else does.
// - `weightClass` (light, medium, heavy) is only for what an item does outside the pack: impact noise
//   and physics when dropped or thrown. It is never summed.
// - `maxStack` is display chunking only; the sole cap is the technical guard of 9,999 units per
//   definition (`ITEM_STACK_GUARD`), so no stack size may exceed it. Unique items and equipment never
//   stack.
// - Quest items default to `noSell` and `noDrop` (AC-5); an item of category `quest` is a quest item.
// - Armor pieces never carry their own `noiseMultiplier`: the load class sets the wearer's noise.
// - Proficiency is soft (mw-e17.4): any class may equip anything. An item worn by a class lacking
//   one of its `equip.proficiencies` applies its `equip.nonProficient` penalty (slower draw, dearer
//   stamina, optionally louder; DEFAULT_NON_PROFICIENT_PENALTY when the file sets none).
//
// What ADR-0004 (progression) fixes: equipment grants capabilities (`grants`), each a capability id
// from the registry (src/content/data/capability/) that the player has while the item is equipped
// (an `equipment:<id>` source) or, for tools on the belt, while it is carried. Books list what they
// can teach. Every capability id an item names is checked against the registry at load
// (`checkItems`). `use` effects are a minimal union until the shared effect vocabulary
// (mw-e22 condition-effect DSL) lands and they migrate to it.
//
// Icons are UI asset ids (`icon-item-…`, style bible §15.1); whether each exists in the icon manifest
// (placeholder allowed) is checked by `itemIconProblems`, run against src/ui/icons/icon-manifest.json.
// The field reference in docs/content/item-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import type { ContentCheck, ContentIssue, Frozen } from '../loader.ts';
import { contentId, ref } from '../schema.ts';
import { worldPropertiesSchema } from '../world-properties.ts';
import { capabilityId, capabilityIds, localisationKey } from './capability.ts';
import type { LockDef } from './lock.ts';

/** Item categories (inventory tabs group them, mw-e17.10). */
export const ITEM_CATEGORIES = [
  'weapon',
  'armor',
  'shield',
  'ammo',
  'book',
  'key',
  'consumable',
  'tool',
  'quest',
  'artifact',
  'currency',
  'misc',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/** How heavy an item is when dropped or thrown (impact noise, physics); never carried weight. */
export const WEIGHT_CLASSES = ['light', 'medium', 'heavy'] as const;
export type WeightClass = (typeof WEIGHT_CLASSES)[number];

/** Equipment slots. Armor fills head, body, hands and feet; a shield the off hand. */
export const EQUIP_SLOTS = [
  'main-hand',
  'off-hand',
  'both-hands',
  'head',
  'body',
  'hands',
  'feet',
  'trinket',
  'tool-belt',
] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** The armor slots whose pieces count towards load (ADR-0003). */
export const ARMOR_SLOTS = ['head', 'body', 'hands', 'feet'] as const;

/** ADR-0003's technical guard: units of one definition a pack may hold; bounds save size. */
export const ITEM_STACK_GUARD = 9999;

/** Upper bound for one armor piece or shield, kg (plate body 12 kg + 25% tuning, with headroom). */
export const MAX_ARMOR_PIECE_KG = 20;

/** The resource pools a consumable can restore or a boon item can raise (ADR-0004). */
export const ITEM_POOLS = ['health', 'stamina', 'mana'] as const;

/** UI icon asset ids for items: `icon-item-<subject>-<variant>` (style bible §15.1). */
export const ITEM_ICON_PATTERN = /^icon-item-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const kilograms = (doc: string) =>
  z.number().positive().max(MAX_ARMOR_PIECE_KG).describe(`${doc} Kilograms (ADR-0003).`);

/** Upper bound of a non-proficiency penalty multiplier. */
export const MAX_PENALTY_MULTIPLIER = 3;

/**
 * The non-proficiency penalty an item applies when its wearer's class lacks one of its proficiency
 * tags and the item does not set its own (mw-e17.4): slower to draw or ready, dearer in stamina, no
 * louder. Armor proficiency proper is the class's armor capacity (ADR-0003).
 */
export const DEFAULT_NON_PROFICIENT_PENALTY = {
  drawTimeMultiplier: 1.5,
  staminaCostMultiplier: 1.25,
  noiseMultiplier: 1,
} as const;

const penaltyMultiplier = (doc: string, fallback: number) =>
  z
    .number()
    .min(1)
    .max(MAX_PENALTY_MULTIPLIER)
    .default(fallback)
    .describe(`${doc} 1 = no penalty; default ${String(fallback)}.`);

const nonProficientSchema = z
  .strictObject({
    drawTimeMultiplier: penaltyMultiplier(
      'Multiplier on the time to draw, ready or raise it (combat reads it, mw-e04/mw-e05).',
      DEFAULT_NON_PROFICIENT_PENALTY.drawTimeMultiplier,
    ),
    staminaCostMultiplier: penaltyMultiplier(
      'Multiplier on the stamina its moves cost (combat reads it, mw-e04).',
      DEFAULT_NON_PROFICIENT_PENALTY.staminaCostMultiplier,
    ),
    noiseMultiplier: penaltyMultiplier(
      'Multiplier on the wearer’s noise, on top of the load class (clamped with it, ADR-0003).',
      DEFAULT_NON_PROFICIENT_PENALTY.noiseMultiplier,
    ),
  })
  .default({ ...DEFAULT_NON_PROFICIENT_PENALTY })
  .describe(
    'The penalty while worn by a class lacking any of its proficiencies (soft proficiency, ' +
      'mw-e17.4): the equip succeeds and the wearer pays this instead.',
  );

const equipSchema = <const S extends readonly [EquipSlot, ...EquipSlot[]]>(slots: S) =>
  z
    .strictObject({
      slot: z.enum(slots).describe(`Slot it is worn or held in: ${slots.join(', ')}.`),
      proficiencies: z
        .array(contentId)
        .default([])
        .describe(
          'Class proficiency tags it calls for, e.g. "blades", "heavy-armor" (class data, mw-e19.4). ' +
            'Soft: any class may equip it (mw-e17.4).',
        ),
      nonProficient: nonProficientSchema,
    })
    .describe('How it is equipped.');

const grantSchema = z.strictObject({
  capability: capabilityId,
  while: z
    .enum(['equipped', 'carried'])
    .describe(
      'When the player has it: while the item is equipped (an equipment:<id> source), or while ' +
        'it is carried, e.g. a tool on the belt (ADR-0004).',
    ),
  crossClass: z
    .boolean()
    .optional()
    .describe(
      'Any class gains it through this item, e.g. a crowbar’s pry (ADR-0004 "simple" rule); ' +
        'default false.',
    ),
});

/** The minimal use-effect union (migrates to the mw-e22 effect vocabulary). */
const useEffectSchema = z.discriminatedUnion('op', [
  z
    .strictObject({
      op: z.literal('restore'),
      pool: z.enum(ITEM_POOLS),
      amount: z.int().positive().max(1000).describe('Points restored.'),
    })
    .describe('Restore points of a pool (a potion, a ration).'),
  z
    .strictObject({
      op: z.literal('stat-step'),
      pool: z.enum(ITEM_POOLS),
      amount: z.literal(10).describe('Always +10 (ADR-0004 P5).'),
    })
    .describe('A found boon item: raise a pool’s maximum one step, once (ADR-0004).'),
  z
    .strictObject({
      op: z.literal('learn'),
      capability: capabilityId,
    })
    .describe('Learn a capability permanently, e.g. a schematic or a scroll.'),
]);

const flagsSchema = z
  .strictObject({
    unique: z.boolean().optional().describe('At most one; never stacks. Default false.'),
    questItem: z
      .boolean()
      .optional()
      .describe('Needed by a quest. Default true for category quest, else false.'),
    noSell: z.boolean().optional().describe('Merchants refuse it. Default: questItem.'),
    noDrop: z.boolean().optional().describe('Cannot be dropped or thrown. Default: questItem.'),
  })
  .describe('Item rules; omitted flags take their defaults (quest items: noSell, noDrop).');

/** Fields every item has, whatever its category. */
const base = {
  id: contentId.describe('Unique item id, e.g. "oil-flask". Stable once shipped (saves).'),
  notes: z.string().min(1).describe('What the item is for, for designers and review.'),
  nameKey: localisationKey
    .optional()
    .describe('Localisation key of the display name; absent = "item.<id>.name".'),
  descKey: localisationKey
    .optional()
    .describe('Localisation key of the description; absent = "item.<id>.desc".'),
  icon: z
    .string()
    .regex(ITEM_ICON_PATTERN, 'must be an item icon asset id, e.g. "icon-item-lockpick-iron-01"')
    .describe('Inventory icon asset id (style bible §15.1); a placeholder until the art lands.'),
  value: z.int().nonnegative().describe('Base price in gold (merchants adjust it, mw-e20).'),
  stackable: z.boolean().default(false).describe('Several units share one inventory entry.'),
  maxStack: z
    .int()
    .min(1)
    .max(ITEM_STACK_GUARD)
    .optional()
    .describe(
      'Units shown per stack (display chunking only, ADR-0003); required when stackable, ' +
        'forbidden otherwise.',
    ),
  weightClass: z
    .enum(WEIGHT_CLASSES)
    .default('light')
    .describe('Impact noise and physics when dropped or thrown; never carried weight (ADR-0003).'),
  worldProperties: worldPropertiesSchema
    .optional()
    .describe('World properties when dropped or thrown (an oil flask is flammable).'),
  grants: z
    .array(grantSchema)
    .default([])
    .describe('Capabilities the item grants while equipped or carried (ADR-0004).'),
  use: z.array(useEffectSchema).optional().describe('Effects of using it; absent = no use.'),
  flags: flagsSchema.optional(),
};

const itemOptions = [
  z
    .strictObject({
      ...base,
      category: z.literal('weapon'),
      equip: equipSchema(['main-hand', 'off-hand', 'both-hands']),
      weapon: z
        .strictObject({
          moves: z
            .array(ref('move'))
            .default([])
            .describe('Moves it adds to the wielder’s moveset; its heft lives there (mw-e04).'),
        })
        .describe('Weapon data.'),
    })
    .describe('A weapon. Weightless for load (ADR-0003): its heft is in its moves.'),
  z
    .strictObject({
      ...base,
      category: z.literal('armor'),
      equip: equipSchema(ARMOR_SLOTS),
      armor: z
        .strictObject({ weightKg: kilograms('Weight counted towards the wearer’s load.') })
        .describe('Armor data.'),
    })
    .describe('An armor piece for the head, body, hands or feet.'),
  z
    .strictObject({
      ...base,
      category: z.literal('shield'),
      equip: equipSchema(['off-hand']),
      shield: z
        .strictObject({
          weightKg: kilograms('Weight counted towards the wearer’s load.'),
          profile: ref('shield').describe('What a block with it does (mw-e04.6).'),
        })
        .describe('Shield data.'),
    })
    .describe('A shield, held in the off hand.'),
  z
    .strictObject({
      ...base,
      category: z.literal('ammo'),
      ammo: z
        .strictObject({ arrow: ref('arrow').describe('The arrow it fires as (mw-e05).') })
        .describe('Ammunition data.'),
    })
    .describe('Ammunition. Must be stackable.'),
  z
    .strictObject({
      ...base,
      category: z.literal('book'),
      book: z
        .strictObject({
          textKey: localisationKey.describe('Localisation key of the readable text.'),
          teaches: z
            .array(capabilityId)
            .default([])
            .describe('Capabilities studying it can teach, as a learned book source (ADR-0004).'),
        })
        .describe('Book data.'),
    })
    .describe('A book, note or scroll the player reads.'),
  z
    .strictObject({
      ...base,
      category: z.literal('key'),
      key: z
        .strictObject({
          opens: z.array(contentId).default([]).describe('Lock ids it opens (mw-e17.5 keyring).'),
          opensTag: contentId.optional().describe('A master key: opens every lock with this tag.'),
          singleUse: z.boolean().default(false).describe('Consumed when it opens a lock.'),
        })
        .describe('Key data: opens and/or opensTag.'),
    })
    .describe('A key. Lives on the keyring (mw-e17.5).'),
  z
    .strictObject({
      ...base,
      category: z.literal('consumable'),
    })
    .describe('A consumable: using it spends one unit. Needs at least one use effect.'),
  z
    .strictObject({
      ...base,
      category: z.literal('tool'),
      equip: equipSchema(['tool-belt']).optional(),
    })
    .describe('A tool, e.g. lockpicks; usually grants its verb while carried (ADR-0004).'),
  z
    .strictObject({ ...base, category: z.literal('quest') })
    .describe('A quest item: noSell and noDrop by default.'),
  z
    .strictObject({
      ...base,
      category: z.literal('artifact'),
      equip: equipSchema(['trinket']).optional(),
    })
    .describe('An artifact or trinket.'),
  z
    .strictObject({ ...base, category: z.literal('currency') })
    .describe('Money. Must be stackable; gold clamps at its cap (mw-e17.3).'),
  z.strictObject({ ...base, category: z.literal('misc') }).describe('Anything else.'),
] as const;

type ParsedItem = z.output<(typeof itemOptions)[number]>;

/** Rules across fields: stacking, uses, quest flags, armor noise, keys, equip-only grants. */
function checkItem(item: ParsedItem, ctx: z.core.$RefinementCtx<ParsedItem>): void {
  const at = `item "${item.id}"`;
  const issue = (path: PropertyKey[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message: `${at}: ${message}` });
  };
  const equip = 'equip' in item ? item.equip : undefined;
  if (item.stackable) {
    if (item.maxStack === undefined) issue(['maxStack'], 'a stackable item needs maxStack');
    if (item.flags?.unique === true) issue(['stackable'], 'a unique item cannot stack');
    if (equip !== undefined) issue(['stackable'], 'equipment cannot stack (ADR-0003)');
  } else if (item.maxStack !== undefined) {
    issue(['maxStack'], 'maxStack is only for stackable items (stackable is false)');
  }
  if (!item.stackable && (item.category === 'ammo' || item.category === 'currency')) {
    issue(['stackable'], `${item.category} must be stackable`);
  }
  if (item.category === 'consumable' && (item.use ?? []).length === 0) {
    issue(['use'], 'a consumable needs at least one use effect');
  }
  if (item.category === 'quest' && item.flags?.questItem === false) {
    issue(['flags', 'questItem'], 'an item of category quest is a quest item');
  }
  if (item.category === 'armor' && item.worldProperties?.noiseMultiplier !== undefined) {
    issue(
      ['worldProperties', 'noiseMultiplier'],
      'armor sets noise through the load class, not per piece (ADR-0003)',
    );
  }
  if (item.category === 'key' && item.key.opens.length === 0 && item.key.opensTag === undefined) {
    issue(['key'], 'a key needs opens or opensTag');
  }
  item.grants.forEach((grant, i) => {
    if (grant.while === 'equipped' && equip === undefined) {
      issue(['grants', i, 'while'], 'only an equippable item can grant while equipped');
    }
  });
}

/** Fills the flag defaults (ADR-0003: quest items are noSell and noDrop unless they say otherwise). */
function withFlagDefaults<T extends ParsedItem>(item: T) {
  const questItem = item.flags?.questItem ?? item.category === 'quest';
  return {
    ...item,
    flags: {
      unique: item.flags?.unique ?? false,
      questItem,
      noSell: item.flags?.noSell ?? questItem,
      noDrop: item.flags?.noDrop ?? questItem,
    },
  };
}

/** Schema of one item file, `src/content/data/item/<id>.json`. */
export const itemSchema = z
  .discriminatedUnion('category', itemOptions)
  .superRefine(checkItem)
  .transform(withFlagDefaults);

/** An item as written in JSON. */
export type ItemDefInput = z.input<typeof itemSchema>;
/** A validated item: narrow on `category` for its block. */
export type ItemDef = z.output<typeof itemSchema>;
/** A validated item of one category, e.g. `ItemOf<'armor'>`. */
export type ItemOf<C extends ItemCategory> = Extract<ItemDef, { category: C }>;
/** A loaded (deeply frozen) item. */
export type ItemEntry = Frozen<ItemDef>;

/** The localisation keys of an item's name and description (explicit or by convention). */
export function itemKeys(item: Pick<ItemDef, 'id' | 'nameKey' | 'descKey'>): {
  nameKey: string;
  descKey: string;
} {
  return {
    nameKey: item.nameKey ?? `item.${item.id}.name`,
    descKey: item.descKey ?? `item.${item.id}.desc`,
  };
}

/** Every capability id an item names, with its JSON pointer. */
export function itemCapabilityUsages(item: ItemDef): { pointer: string; id: string }[] {
  return [
    ...item.grants.map(({ capability }, i) => ({
      pointer: `/grants/${String(i)}/capability`,
      id: capability,
    })),
    ...(item.category === 'book'
      ? item.book.teaches.map((id, i) => ({ pointer: `/book/teaches/${String(i)}`, id }))
      : []),
    ...(item.use ?? []).flatMap((effect, i) =>
      effect.op === 'learn'
        ? [{ pointer: `/use/${String(i)}/capability`, id: effect.capability }]
        : [],
    ),
  ];
}

/**
 * The load check for items: every capability an item names is in the registry (AC-4), and every lock
 * a key opens is declared lock content (mw-e03.18): each `key.opens` id is a lock, and a master key's
 * `opensTag` is carried by at least one lock.
 */
export const checkItems: ContentCheck = (entries) => {
  const capabilities = capabilityIds(entries);
  const locks = new Set<string>();
  const lockTags = new Set<string>();
  for (const { type, value } of entries) {
    if (type !== 'lock') continue;
    locks.add(value.id);
    for (const tag of (value as LockDef).tags) lockTags.add(tag);
  }
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'item') continue;
    const item = value as ItemDef;
    const report = (pointer: string, message: string) => {
      issues.push({ file, pointer, message: `item:${item.id} ${message}` });
    };
    for (const { pointer, id } of itemCapabilityUsages(item)) {
      if (!capabilities.has(id)) {
        report(
          pointer,
          `names unknown capability "${id}": declare it in src/content/data/capability/`,
        );
      }
    }
    if (item.category !== 'key') continue;
    item.key.opens.forEach((lock, i) => {
      if (!locks.has(lock)) {
        report(
          `/key/opens/${String(i)}`,
          `opens unknown lock "${lock}": declare it in src/content/data/lock/`,
        );
      }
    });
    const tag = item.key.opensTag;
    if (tag !== undefined && !lockTags.has(tag)) {
      report('/key/opensTag', `opens locks tagged "${tag}", but no lock carries that tag`);
    }
  }
  return issues;
};

/**
 * Items whose icon is missing from the icon manifest (`known`: every id the manifest lists, a
 * placeholder or final art). One message per missing icon; empty when all resolve.
 */
export function itemIconProblems(
  items: Iterable<Pick<ItemDef, 'id' | 'icon'>>,
  known: Iterable<string>,
): string[] {
  const ids = new Set(known);
  return [...items]
    .filter(({ icon }) => !ids.has(icon))
    .map(({ id, icon }) => `item:${id} uses icon "${icon}", which the icon manifest does not list`);
}
