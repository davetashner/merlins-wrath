import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUY_RATE_BAND,
  DISPOSITION_BANDS,
  DISPOSITION_MULTIPLIERS,
  HAGGLE_BAND,
  inBand,
  MARKUP_BAND,
  MIN_PRICE,
  SPECIALTY_BONUS_BAND,
  STOLEN_FACTOR_BAND,
  WORLD_PRICE_BAND,
  type DispositionBand,
} from './bands';
import { price, type PriceInput, type PriceResult, type PricedItem } from './price';

const sword: PricedItem = { id: 'sword', category: 'weapon', value: 100 };
const merchant = { markup: 1.2, buyRate: 0.4 };

const quote = (input: Partial<PriceInput> & Pick<PriceInput, 'direction'>): PriceResult =>
  price({ item: sword, merchant, ...input });

function priced(result: PriceResult) {
  if (!result.ok) throw new Error(`refused: ${result.refused}`);
  return result;
}

describe('price model', () => {
  it('AC-1: value 100, markup 1.2, neutral disposition: buys for 120, breakdown lists base and markup', () => {
    const result = priced(quote({ direction: 'buy' }));
    expect(result.price).toBe(120);
    expect(result.direction).toBe('buy');
    expect(result.breakdown.map((s) => s.kind)).toEqual(['base', 'markup']);
    expect(result.breakdown[0]).toEqual({ kind: 'base', amount: 100 });
    expect(result.breakdown[1]).toMatchObject({ kind: 'markup', factor: 1.2 });
    expect(priced(quote({ direction: 'buy', disposition: 'neutral' })).price).toBe(120);
  });

  it('AC-2: a friendly merchant sells for less than a cold one, by the economy doc multipliers', () => {
    const cold = priced(quote({ direction: 'buy', disposition: 'cold' }));
    const friendly = priced(quote({ direction: 'buy', disposition: 'friendly' }));
    expect(friendly.price).toBeLessThan(cold.price);
    expect(cold.price).toBe(Math.round(100 * 1.2 * DISPOSITION_MULTIPLIERS.cold.buy));
    expect(friendly.price).toBe(Math.round(100 * 1.2 * DISPOSITION_MULTIPLIERS.friendly.buy));
    expect(cold.breakdown.map((s) => s.kind)).toEqual(['base', 'markup', 'disposition']);
    const sellCold = priced(quote({ direction: 'sell', disposition: 'cold' }));
    const sellFriendly = priced(quote({ direction: 'sell', disposition: 'friendly' }));
    expect(sellFriendly.price).toBeGreaterThan(sellCold.price);
  });

  it('prices a sell at value x buyRate, with devoted paying more than neutral', () => {
    expect(priced(quote({ direction: 'sell' })).price).toBe(40);
    expect(priced(quote({ direction: 'sell', disposition: 'devoted' })).price).toBe(46);
  });

  it('a hostile merchant refuses both directions', () => {
    expect(quote({ direction: 'buy', disposition: 'hostile' })).toEqual({
      ok: false,
      refused: 'hostile',
    });
    expect(quote({ direction: 'sell', disposition: 'hostile' })).toEqual({
      ok: false,
      refused: 'hostile',
    });
  });

  it('AC-4: a stolen item sold to a non-fence is refused: stolen', () => {
    const stolen = { flags: { stolen: true } };
    expect(quote({ direction: 'sell', instance: stolen })).toEqual({
      ok: false,
      refused: 'stolen',
    });
    // A fence that does not buy stolen goods refuses too.
    expect(
      quote({ direction: 'sell', instance: stolen, merchant: { ...merchant, isFence: true } }),
    ).toEqual({ ok: false, refused: 'stolen' });
  });

  it('a fence that buys stolen goods pays the stolen factor (default 0.6) of the sell price', () => {
    const fence = { ...merchant, isFence: true, buysStolen: true };
    const stolen = { flags: { stolen: true } };
    const result = priced(quote({ direction: 'sell', instance: stolen, merchant: fence }));
    expect(result.price).toBe(24);
    expect(result.breakdown.map((s) => s.kind)).toEqual(['base', 'buy-rate', 'stolen']);
    expect(
      priced(
        quote({ direction: 'sell', instance: stolen, merchant: { ...fence, stolenFactor: 0.5 } }),
      ).price,
    ).toBe(20);
    // Clean goods at a fence are not discounted.
    expect(priced(quote({ direction: 'sell', merchant: fence })).price).toBe(40);
  });

  it('AC-5: a quest item sold is refused: quest-item; noSell and bound goods are refused too', () => {
    const quest = { ...sword, category: 'quest', flags: { questItem: true, noSell: true } };
    expect(quote({ direction: 'sell', item: quest })).toEqual({ ok: false, refused: 'quest-item' });
    const noSell = { ...sword, flags: { noSell: true } };
    expect(quote({ direction: 'sell', item: noSell })).toEqual({ ok: false, refused: 'no-sell' });
    expect(quote({ direction: 'sell', instance: { flags: { bound: true } } })).toEqual({
      ok: false,
      refused: 'bound',
    });
    // Buying one is not a sell: the shelf may hold it.
    expect(priced(quote({ direction: 'buy', item: quest })).price).toBe(120);
  });

  it('refuses a sell outside the merchant’s buysCategories, accepts inside', () => {
    const smith = { ...merchant, buysCategories: ['armor'] };
    expect(quote({ direction: 'sell', merchant: smith })).toEqual({
      ok: false,
      refused: 'not-bought',
    });
    expect(
      priced(quote({ direction: 'sell', merchant: { ...smith, buysCategories: ['weapon'] } }))
        .price,
    ).toBe(40);
  });

  it('pays the specialty bonus (default 1.2, or the merchant’s own) on specialty categories only', () => {
    const smith = { ...merchant, specialties: ['weapon'] };
    const bonus = priced(quote({ direction: 'sell', merchant: smith }));
    expect(bonus.price).toBe(48);
    expect(bonus.breakdown.map((s) => s.kind)).toEqual(['base', 'buy-rate', 'specialty']);
    expect(
      priced(quote({ direction: 'sell', merchant: { ...smith, specialtyBonus: 1.1 } })).price,
    ).toBe(44);
    expect(
      priced(quote({ direction: 'sell', merchant: { ...merchant, specialties: ['armor'] } })).price,
    ).toBe(40);
  });

  it('applies the world multiplier (clamped to its band) to both directions', () => {
    const famine = { priceMultiplier: 1.25 };
    expect(priced(quote({ direction: 'buy', worldFacts: famine })).price).toBe(150);
    expect(priced(quote({ direction: 'buy', worldFacts: { priceMultiplier: 9 } })).price).toBe(150);
    expect(priced(quote({ direction: 'buy', worldFacts: { priceMultiplier: 0 } })).price).toBe(96);
    expect(priced(quote({ direction: 'buy', worldFacts: {} })).price).toBe(120);
    expect(priced(quote({ direction: 'sell', worldFacts: famine })).price).toBe(50);
  });

  it('haggling moves the buy price down and the sell price up, clamped to the haggle band', () => {
    expect(priced(quote({ direction: 'buy', haggleModifier: 0.1 })).price).toBe(108);
    expect(priced(quote({ direction: 'buy', haggleModifier: 5 })).price).toBe(108);
    expect(priced(quote({ direction: 'buy', haggleModifier: -0.05 })).price).toBe(126);
    expect(priced(quote({ direction: 'buy', haggleModifier: -3 })).price).toBe(126);
    expect(priced(quote({ direction: 'sell', haggleModifier: 0.1 })).price).toBe(44);
    expect(priced(quote({ direction: 'sell', haggleModifier: -0.05 })).price).toBe(38);
  });

  it('floors every price at 1 gold, listing the floor step', () => {
    const free = { ...sword, value: 0 };
    const buy = priced(quote({ direction: 'buy', item: free }));
    expect(buy.price).toBe(MIN_PRICE);
    expect(buy.breakdown.at(-1)).toEqual({ kind: 'floor', amount: MIN_PRICE });
    const sell = priced(quote({ direction: 'sell', item: free }));
    expect(sell.price).toBe(MIN_PRICE);
    const cheap = priced(quote({ direction: 'sell', item: { ...sword, value: 1 } }));
    expect(cheap.price).toBe(1);
  });

  it('caps a sell at the merchant’s own buy price, listing the cap step', () => {
    // A cheap-to-buy, generous-to-sell merchant: buyRate 0.6 x specialty 1.3 x devoted 1.15 > markup 1.1 x 0.85.
    const odd = { markup: 1.1, buyRate: 0.6, specialties: ['weapon'], specialtyBonus: 1.3 };
    const result = priced(
      quote({ direction: 'sell', merchant: odd, disposition: 'devoted', haggleModifier: 0.1 }),
    );
    const buy = priced(quote({ direction: 'buy', merchant: odd, disposition: 'devoted' }));
    expect(result.price).toBeLessThanOrEqual(buy.price);
    expect(result.breakdown.at(-1)?.kind).toBe('cap');
    // A cap below one gold still pays the floor.
    const tiny = priced(quote({ direction: 'sell', merchant: odd, item: { ...sword, value: 0 } }));
    expect(tiny.price).toBe(1);
  });

  it('uses the economy-doc defaults for a merchant that sets nothing', () => {
    expect(priced(price({ item: sword, merchant: {}, direction: 'buy' })).price).toBe(
      Math.round(100 * MARKUP_BAND.default),
    );
    expect(priced(price({ item: sword, merchant: {}, direction: 'sell' })).price).toBe(
      Math.round(100 * BUY_RATE_BAND.default),
    );
  });

  it('rounds half up', () => {
    // 5 x 1.3 = 6.5 -> 7; 5 x 0.5 = 2.5 -> 3.
    expect(
      priced(price({ item: { ...sword, value: 5 }, merchant: { markup: 1.3 }, direction: 'buy' }))
        .price,
    ).toBe(7);
    expect(
      priced(price({ item: { ...sword, value: 5 }, merchant: { buyRate: 0.5 }, direction: 'sell' }))
        .price,
    ).toBe(3);
  });
});

describe('economy bands', () => {
  it('match the design doc', () => {
    expect([MARKUP_BAND.min, MARKUP_BAND.max]).toEqual([1.1, 1.5]);
    expect([BUY_RATE_BAND.min, BUY_RATE_BAND.max]).toEqual([0.3, 0.6]);
    expect(DISPOSITION_MULTIPLIERS.neutral).toEqual({ buy: 1, sell: 1 });
    expect(DISPOSITION_BANDS).toEqual(['hostile', 'cold', 'neutral', 'friendly', 'devoted']);
    for (const band of [MARKUP_BAND, BUY_RATE_BAND, SPECIALTY_BONUS_BAND, STOLEN_FACTOR_BAND]) {
      expect(inBand(band, band.default)).toBe(true);
    }
    expect(inBand(MARKUP_BAND, 1.5)).toBe(true);
    expect(inBand(MARKUP_BAND, 1.51)).toBe(false);
    expect(inBand(MARKUP_BAND, 1.09)).toBe(false);
  });
});

describe('price model properties', () => {
  const dispositions = DISPOSITION_BANDS.filter((b) => b !== 'hostile') as DispositionBand[];

  it('AC-3: over 10,000 random cases, sell price <= buy price and every price >= 1 gold', () => {
    const arbitrary = fc.record({
      value: fc.integer({ min: 0, max: 100_000 }),
      category: fc.constantFrom('weapon', 'armor', 'consumable', 'tool'),
      markup: fc.double({ min: MARKUP_BAND.min, max: MARKUP_BAND.max, noNaN: true }),
      buyRate: fc.double({ min: BUY_RATE_BAND.min, max: BUY_RATE_BAND.max, noNaN: true }),
      specialty: fc.boolean(),
      specialtyBonus: fc.double({
        min: SPECIALTY_BONUS_BAND.min,
        max: SPECIALTY_BONUS_BAND.max,
        noNaN: true,
      }),
      fence: fc.boolean(),
      stolen: fc.boolean(),
      stolenFactor: fc.double({
        min: STOLEN_FACTOR_BAND.min,
        max: STOLEN_FACTOR_BAND.max,
        noNaN: true,
      }),
      disposition: fc.constantFrom(...dispositions),
      haggle: fc.double({ min: HAGGLE_BAND.min - 0.1, max: HAGGLE_BAND.max + 0.1, noNaN: true }),
      world: fc.double({
        min: WORLD_PRICE_BAND.min - 0.2,
        max: WORLD_PRICE_BAND.max + 0.2,
        noNaN: true,
      }),
    });
    fc.assert(
      fc.property(arbitrary, (c) => {
        const common = {
          item: { id: 'x', category: c.category, value: c.value },
          merchant: {
            markup: c.markup,
            buyRate: c.buyRate,
            specialties: c.specialty ? [c.category] : [],
            specialtyBonus: c.specialtyBonus,
            isFence: c.fence,
            buysStolen: c.fence,
            stolenFactor: c.stolenFactor,
          },
          disposition: c.disposition,
          haggleModifier: c.haggle,
          worldFacts: { priceMultiplier: c.world },
        };
        const buy = priced(price({ ...common, direction: 'buy' }));
        const sell = price({
          ...common,
          instance: { flags: { stolen: c.stolen } },
          direction: 'sell',
        });
        expect(buy.price).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(buy.price)).toBe(true);
        if (!sell.ok) {
          expect(sell.refused).toBe('stolen');
          expect(c.stolen && !c.fence).toBe(true);
          return;
        }
        expect(sell.price).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(sell.price)).toBe(true);
        expect(sell.price).toBeLessThanOrEqual(buy.price);
      }),
      { numRuns: 10_000 },
    );
  });
});
