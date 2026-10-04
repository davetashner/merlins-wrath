// The pure price model (mw-e20.3, docs/design/economy.md). `price` turns an item, a merchant, a
// direction and the context (disposition band, haggle, world) into whole gold plus a breakdown the
// shop UI can show, or a refusal. Deterministic: no randomness, wall clock or content imports (the
// game passes plain data in). Rules:
//
// - buy (the player buys): value x markup x disposition.buy x world x (1 - haggle).
// - sell (the player sells): value x buyRate x specialty (if the item's category is a specialty) x
//   disposition.sell x stolen factor (a stolen item at a fence) x world x (1 + haggle).
// - the result is rounded half up and never below MIN_PRICE (1 gold); identity steps are not listed.
// - a sell price never exceeds the same merchant's buy price for the item (capped, step `cap`).
// - refusals on a sell: `hostile` (any direction), `quest-item`, `no-sell`, `bound`, `stolen` (only a
//   fence with buysStolen takes stolen goods) and `not-bought` (outside the merchant's categories).

import {
  BUY_RATE_BAND,
  DISPOSITION_MULTIPLIERS,
  HAGGLE_BAND,
  MARKUP_BAND,
  MIN_PRICE,
  NEUTRAL_DISPOSITION,
  SPECIALTY_BONUS_BAND,
  STOLEN_FACTOR_BAND,
  WORLD_PRICE_BAND,
  type DispositionBand,
} from './bands';

/** What the price model reads of an item definition. */
export interface PricedItem {
  readonly id: string;
  readonly category: string;
  /** Base value in gold. */
  readonly value: number;
  readonly flags?: {
    readonly questItem?: boolean | undefined;
    readonly noSell?: boolean | undefined;
  };
}

/** What it reads of an inventory instance (`ItemInstanceFlags`). */
export interface PricedInstance {
  readonly flags?: { readonly stolen?: boolean; readonly bound?: boolean };
}

/** What it reads of a merchant definition; absent fields take the economy-doc defaults. */
export interface PricedMerchant {
  readonly markup?: number | undefined;
  readonly buyRate?: number | undefined;
  readonly specialties?: readonly string[] | undefined;
  readonly specialtyBonus?: number | undefined;
  readonly buysCategories?: readonly string[] | undefined;
  readonly isFence?: boolean | undefined;
  readonly buysStolen?: boolean | undefined;
  readonly stolenFactor?: number | undefined;
}

/** World context. `priceMultiplier` is a regional event's effect on every price (clamped). */
export interface PriceWorldFacts {
  readonly priceMultiplier?: number;
}

export type PriceDirection = 'buy' | 'sell';

export interface PriceInput {
  readonly item: PricedItem;
  readonly instance?: PricedInstance;
  readonly merchant: PricedMerchant;
  readonly direction: PriceDirection;
  /** Disposition band; neutral (multipliers 1.0) until mw-e22.4. */
  readonly disposition?: DispositionBand;
  /** Haggle result in HAGGLE_BAND (clamped); positive favours the player. */
  readonly haggleModifier?: number;
  readonly worldFacts?: PriceWorldFacts;
}

export type PriceStepKind =
  | 'base'
  | 'markup'
  | 'buy-rate'
  | 'specialty'
  | 'disposition'
  | 'stolen'
  | 'world'
  | 'haggle'
  | 'cap'
  | 'floor';

/** One line of the breakdown: the factor applied (absent for base, cap, floor) and the running price. */
export interface PriceStep {
  readonly kind: PriceStepKind;
  readonly factor?: number;
  /** The unrounded running price after this step. */
  readonly amount: number;
}

export type PriceRefusal = 'hostile' | 'quest-item' | 'no-sell' | 'bound' | 'stolen' | 'not-bought';

export type PriceResult =
  | {
      readonly ok: true;
      readonly direction: PriceDirection;
      /** Whole gold, at least MIN_PRICE. */
      readonly price: number;
      readonly breakdown: readonly PriceStep[];
    }
  | { readonly ok: false; readonly refused: PriceRefusal };

type NonHostile = Exclude<DispositionBand, 'hostile'>;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Round half up; the 1e-9 keeps products like 100 x 1.2 from landing a hair under the integer. */
const roundGold = (amount: number): number => Math.floor(amount + 0.5 + 1e-9);

/** Applies the steps in order, skipping identity factors. */
function run(base: number, factors: readonly (readonly [PriceStepKind, number])[]) {
  const breakdown: PriceStep[] = [{ kind: 'base', amount: base }];
  let amount = base;
  for (const [kind, factor] of factors) {
    if (factor === 1) continue;
    amount *= factor;
    breakdown.push({ kind, factor, amount });
  }
  return { breakdown, amount };
}

/** The disposition multipliers of a non-hostile input (hostile is refused before this). */
function multipliersFor(input: PriceInput) {
  return DISPOSITION_MULTIPLIERS[(input.disposition ?? NEUTRAL_DISPOSITION) as NonHostile];
}

const worldFactor = (input: PriceInput): number =>
  clamp(input.worldFacts?.priceMultiplier ?? 1, WORLD_PRICE_BAND.min, WORLD_PRICE_BAND.max);

/** The buy steps for a given haggle (used for the sell cap too). */
function buyFactors(input: PriceInput, haggle: number) {
  const { merchant } = input;
  const factors: (readonly [PriceStepKind, number])[] = [
    ['markup', merchant.markup ?? MARKUP_BAND.default],
    ['disposition', multipliersFor(input).buy],
    ['world', worldFactor(input)],
    ['haggle', 1 - haggle],
  ];
  return factors;
}

const clampHaggle = (h: number | undefined): number =>
  clamp(h ?? 0, HAGGLE_BAND.min, HAGGLE_BAND.max);

/** Why a sell is refused, or undefined when the merchant would take it. */
function sellRefusal(input: PriceInput): PriceRefusal | undefined {
  const { item, instance, merchant } = input;
  if (item.flags?.questItem === true) return 'quest-item';
  if (item.flags?.noSell === true) return 'no-sell';
  if (instance?.flags?.bound === true) return 'bound';
  if (
    instance?.flags?.stolen === true &&
    !(merchant.isFence === true && merchant.buysStolen === true)
  ) {
    return 'stolen';
  }
  if (merchant.buysCategories !== undefined && !merchant.buysCategories.includes(item.category)) {
    return 'not-bought';
  }
  return undefined;
}

/** Prices one item for one merchant: whole gold with the applied modifiers, or a refusal. */
export function price(input: PriceInput): PriceResult {
  if (input.disposition === 'hostile') return { ok: false, refused: 'hostile' };
  const { item, merchant, direction } = input;
  const haggle = clampHaggle(input.haggleModifier);
  const buy = run(item.value, buyFactors(input, haggle));

  if (direction === 'buy') {
    return finish('buy', buy.breakdown, buy.amount);
  }

  const refused = sellRefusal(input);
  if (refused !== undefined) return { ok: false, refused };
  const stolen = input.instance?.flags?.stolen === true;
  const sell = run(item.value, [
    ['buy-rate', merchant.buyRate ?? BUY_RATE_BAND.default],
    [
      'specialty',
      merchant.specialties?.includes(item.category) === true
        ? (merchant.specialtyBonus ?? SPECIALTY_BONUS_BAND.default)
        : 1,
    ],
    ['disposition', multipliersFor(input).sell],
    ['stolen', stolen ? (merchant.stolenFactor ?? STOLEN_FACTOR_BAND.default) : 1],
    ['world', worldFactor(input)],
    ['haggle', 1 + haggle],
  ]);
  // Never above what the merchant sells it for: the buy price with and without this haggle.
  const ceiling = Math.max(
    MIN_PRICE,
    Math.min(roundGold(run(item.value, buyFactors(input, 0)).amount), roundGold(buy.amount)),
  );
  const capped = roundGold(sell.amount) > ceiling;
  const steps = capped
    ? [...sell.breakdown, { kind: 'cap' as const, amount: ceiling }]
    : sell.breakdown;
  return finish('sell', steps, capped ? ceiling : sell.amount);
}

function finish(
  direction: PriceDirection,
  breakdown: readonly PriceStep[],
  amount: number,
): PriceResult {
  const rounded = roundGold(amount);
  if (rounded >= MIN_PRICE) return { ok: true, direction, price: rounded, breakdown };
  return {
    ok: true,
    direction,
    price: MIN_PRICE,
    breakdown: [...breakdown, { kind: 'floor', amount: MIN_PRICE }],
  };
}
