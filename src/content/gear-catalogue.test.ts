// The gear catalogue (mw-ju8.3): the shop-stock items for weapons, armor, clothes and ammunition, each
// priced inside its docs/design/economy.md band. Tiers scale the common band: fine x2.5.
import { describe, expect, it } from 'vitest';
import type { ItemDef } from './types/item.ts';
import { loadGameContent } from './game-content.ts';

const inBand = (b: { min: number; max: number }, v: number) => v >= b.min && v <= b.max;

type Tier = 'common' | 'fine';
const TIER_MULTIPLIER: Record<Tier, number> = { common: 1, fine: 2.5 };

/** Common-tier base value bands per kind (economy.md "Sinks and price bands"). */
const BANDS = {
  sword: [60, 140],
  staff: [60, 140],
  bow: [60, 140],
  knife: [25, 60],
  clothes: [20, 80],
  'body-light': [90, 140],
  'body-medium': [180, 300],
  'helm-light': [35, 60],
  'helm-medium': [70, 120],
  'gloves-light': [25, 45],
  'gloves-medium': [50, 90],
  'boots-light': [25, 45],
  'boots-medium': [50, 90],
  // The economy doc has no shield band: shields are priced as a helmet of the matching class.
  'shield-light': [35, 60],
  'shield-medium': [70, 120],
  arrow: [3, 8],
} as const satisfies Record<string, readonly [number, number]>;
type Kind = keyof typeof BANDS;

/** Every catalogue item: id, kind (a band and an owner category) and tier. */
const CATALOGUE: readonly (readonly [id: string, kind: Kind, tier: Tier])[] = [
  ['short-sword', 'sword', 'common'],
  ['longsword', 'sword', 'fine'],
  ['utility-knife', 'knife', 'common'],
  ['tempered-hunting-knife', 'knife', 'fine'],
  ['walking-staff', 'staff', 'common'],
  ['yew-staff', 'staff', 'fine'],
  ['hunting-bow', 'bow', 'common'],
  ['yew-longbow', 'bow', 'fine'],
  ['broadhead-arrow', 'arrow', 'common'],
  ['blunt-arrow', 'arrow', 'common'],
  ['fire-arrow', 'arrow', 'common'],
  ['peasant-tunic', 'clothes', 'common'],
  ['wool-cloak', 'clothes', 'common'],
  ['hooded-travelling-cloak', 'clothes', 'common'],
  ['merchants-coat', 'clothes', 'fine'],
  ['padded-gambeson', 'body-light', 'common'],
  ['reinforced-gambeson', 'body-light', 'fine'],
  ['brigandine', 'body-medium', 'common'],
  ['tempered-mail-hauberk', 'body-medium', 'fine'],
  ['open-helm', 'helm-light', 'common'],
  ['burnished-open-helm', 'helm-light', 'fine'],
  ['nasal-helm', 'helm-medium', 'common'],
  ['kettle-helm', 'helm-medium', 'fine'],
  ['leather-gloves', 'gloves-light', 'common'],
  ['lined-leather-gloves', 'gloves-light', 'fine'],
  ['mail-gauntlets', 'gloves-medium', 'common'],
  ['leather-boots', 'boots-light', 'common'],
  ['oiled-riding-boots', 'boots-light', 'fine'],
  ['riveted-boots', 'boots-medium', 'common'],
  ['small-buckler', 'shield-light', 'common'],
  ['reinforced-buckler', 'shield-light', 'fine'],
  ['kite-shield', 'shield-medium', 'common'],
];

/** The owner's list (2026-10-04) and the kinds, or slots, that satisfy each entry. */
const OWNER_CATEGORIES: Record<string, (item: ItemDef) => boolean> = {
  swords: (i) => i.id.includes('sword') && i.category === 'weapon',
  knives: (i) => i.category === 'weapon' && i.id.includes('knife'),
  staves: (i) => i.category === 'weapon' && i.id.includes('staff'),
  bows: (i) => i.category === 'weapon' && i.id.includes('bow'),
  arrows: (i) => i.category === 'ammo',
  helmets: (i) => i.category === 'armor' && i.equip.slot === 'head',
  gloves: (i) => i.category === 'armor' && i.equip.slot === 'hands',
  boots: (i) => i.category === 'armor' && i.equip.slot === 'feet',
  armor: (i) =>
    i.category === 'armor' && i.equip.slot === 'body' && i.armor.weightKg >= 2.5 && !isClothes(i),
  shields: (i) => i.category === 'shield',
  clothes: (i) => isClothes(i),
};
const isClothes = (i: ItemDef) => CATALOGUE.some(([id, kind]) => id === i.id && kind === 'clothes');

const content = loadGameContent();
const byId = new Map(content.all('item').map((item) => [item.id, item as unknown as ItemDef]));

/** Tier of an item in its owner category: its tier, or for arrows the standard/special split. */
function tiersIn(category: string): Set<string> {
  const tiers = new Set<string>();
  for (const [id, kind, tier] of CATALOGUE) {
    const item = byId.get(id);
    if (item !== undefined && OWNER_CATEGORIES[category]?.(item) === true) {
      tiers.add(kind === 'arrow' ? 'special' : tier);
    }
  }
  if (category === 'arrows') tiers.add('standard');
  return tiers;
}

describe('gear catalogue (mw-ju8.3)', () => {
  it('AC-1: every catalogue item is loaded, passes the item schema and sits inside its economy band', () => {
    for (const [id, kind, tier] of CATALOGUE) {
      const item = byId.get(id);
      expect(item, `item ${id} is declared in src/content/data/item`).toBeDefined();
      const [min, max] = BANDS[kind];
      const band = { min: min * TIER_MULTIPLIER[tier], max: max * TIER_MULTIPLIER[tier] };
      expect(
        inBand(band, item?.value ?? Number.NaN),
        `${id} value ${String(item?.value)} is outside ${kind}/${tier} band ${String(band.min)}-${String(band.max)}`,
      ).toBe(true);
    }
  });

  it('AC-1: standard arrows and rope arrows also stay in the arrow bands', () => {
    expect(byId.get('standard-arrow')?.value).toBeGreaterThanOrEqual(1);
    expect(byId.get('standard-arrow')?.value).toBeLessThanOrEqual(3);
    expect(inBand({ min: 3, max: 8 }, byId.get('rope-arrow')?.value ?? 0)).toBe(true);
  });

  it('AC-1: armor and shield weights stay inside ADR-0003 reference weights ±25%', () => {
    const ref = { head: [1, 2], body: [2, 8], hands: [1, 2], feet: [1, 2] } as const;
    for (const [id] of CATALOGUE) {
      const item = byId.get(id);
      if (item?.category === 'armor') {
        const slot = item.equip.slot;
        const kg = item.armor.weightKg;
        const [light, mail] = ref[slot];
        expect(kg, id).toBeGreaterThanOrEqual(Math.min(light, 0.5) * 0.75);
        expect(kg, id).toBeLessThanOrEqual(mail * 1.25);
      }
    }
  });

  it('AC-2: the catalogue covers every owner category with at least two tiers', () => {
    const missing: string[] = [];
    for (const category of Object.keys(OWNER_CATEGORIES)) {
      if (tiersIn(category).size < 2) missing.push(category);
    }
    expect(missing).toEqual([]);
  });

  it('AC-2: gloves, boots and helmets exist in light and medium classes', () => {
    for (const slot of ['head', 'hands', 'feet'] as const) {
      const profs = new Set<string>();
      for (const [id] of CATALOGUE) {
        const item = byId.get(id);
        if (item?.category === 'armor' && item.equip.slot === slot) {
          item.equip.proficiencies.forEach((p) => profs.add(p));
        }
      }
      expect([...profs].sort(), slot).toEqual(['light-armor', 'medium-armor']);
    }
  });
});
