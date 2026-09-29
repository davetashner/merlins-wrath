import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import {
  addProperties,
  propertyChanged,
  registerWorldProperties,
  type PropertyChange,
  type WorldPropertyInit,
} from './components';
import {
  actorNoiseMultiplier,
  breaksUnder,
  findPropertyViolations,
  floats,
  isFlammableNow,
  isRevealed,
  PROPERTY_INVARIANT_RULES,
  reveal,
  revealedOnly,
  SOAKED_WETNESS,
  supportOf,
} from './derived';

/** A world with one entity per `inits` entry, in order (ids 1, 2, …). */
function worldWith(...inits: WorldPropertyInit[]) {
  const w = registerWorldProperties(new World({ seed: 1 }));
  const ids = inits.map((init) => {
    const id = w.spawn();
    addProperties(w, id, init);
    return id;
  });
  return { w, ids };
}

describe('isFlammableNow', () => {
  it('AC-1: a flammable entity at wetness 0.8 cannot burn; at 0.2 it can', () => {
    const { w, ids } = worldWith(
      { flammable: true, wetness: 0.8 },
      { flammable: true, wetness: 0.2 },
    );
    expect(ids.map((id) => isFlammableNow(w, id))).toEqual([false, true]);
  });

  it('wetness exactly at the soaked threshold is soaked (mw-e03.5: ignites below 0.5 only)', () => {
    const { w, ids } = worldWith(
      { flammable: true, wetness: SOAKED_WETNESS },
      { flammable: true, wetness: 0.49 },
    );
    expect(ids.map((id) => isFlammableNow(w, id))).toEqual([false, true]);
  });

  it('frozen or non-flammable entities cannot burn; defaults are dry and unfrozen', () => {
    const { w, ids } = worldWith(
      { flammable: true, frozen: true, temperature: -5 },
      { flammable: false },
      {},
      { flammable: true },
    );
    expect(ids.map((id) => isFlammableNow(w, id))).toEqual([false, false, false, true]);
  });
});

describe('floats', () => {
  it('floats when less dense than water', () => {
    const { w, ids } = worldWith({ density: 600 }, { density: 7800 }, {});
    expect(ids.map((id) => floats(w, id))).toEqual([true, false, false]);
  });
});

describe('property invariants', () => {
  it('AC-5: frozen above its freeze point is reported as inconsistent', () => {
    const { w, ids } = worldWith({ frozen: true, temperature: 5, freezePoint: 0 });
    expect(findPropertyViolations(w)).toEqual([
      {
        entity: ids[0],
        rule: 'frozen-above-freeze-point',
        message: `entity ${String(ids[0])} frozen at 5 °C, above its freeze point 0 °C`,
      },
    ]);
  });

  it('AC-5: frozen at or below the freeze point, or not frozen, is consistent', () => {
    const { w } = worldWith(
      { frozen: true, temperature: 0, freezePoint: 0 },
      { frozen: true, temperature: -10 },
      { frozen: false, temperature: 40 },
      { burning: false, frozen: false },
    );
    expect(findPropertyViolations(w)).toEqual([]);
  });

  it('frozen with the default temperature (20 °C) is inconsistent', () => {
    const { w } = worldWith({ frozen: true });
    expect(findPropertyViolations(w).map((v) => v.rule)).toEqual(['frozen-above-freeze-point']);
  });

  it('reports every rule, sorted by entity then rule order', () => {
    const { w, ids } = worldWith(
      { transparent: true, opaque: true },
      { burning: true, frozen: true, temperature: -5, flammable: false },
      { burning: true, flammable: true },
      { transparent: true },
    );
    const found = findPropertyViolations(w).map(({ entity, rule }) => [entity, rule]);
    expect(found).toEqual([
      [ids[0], 'transparent-and-opaque'],
      [ids[1], 'burning-while-frozen'],
      [ids[1], 'burning-not-flammable'],
    ]);
    expect(PROPERTY_INVARIANT_RULES).toEqual([
      'frozen-above-freeze-point',
      'burning-while-frozen',
      'burning-not-flammable',
      'transparent-and-opaque',
      'suspended-without-support',
      'trapped-without-trap',
      'water-surface-not-liquid',
    ]);
  });

  it('AC-5 (mw-e03.31): suspended without a support, trapped without a trap and a water surface on a non-liquid are each reported with the entity id', () => {
    const { w, ids } = worldWith(
      { suspended: true },
      { trapped: true },
      { waterSurface: true, material: 'stone' },
      { suspended: true, support: 99 },
    );
    expect(findPropertyViolations(w)).toEqual([
      {
        entity: ids[0],
        rule: 'suspended-without-support',
        message: `entity ${String(ids[0])} suspended with no support`,
      },
      {
        entity: ids[1],
        rule: 'trapped-without-trap',
        message: `entity ${String(ids[1])} trapped with no trap definition`,
      },
      {
        entity: ids[2],
        rule: 'water-surface-not-liquid',
        message: `entity ${String(ids[2])} has a water surface but its material "stone" is not liquid`,
      },
      {
        entity: ids[3],
        rule: 'suspended-without-support',
        message: `entity ${String(ids[3])} suspended from entity 99, which does not exist`,
      },
    ]);
  });

  it('AC-5 (mw-e03.31): the valid combinations are consistent', () => {
    const { w, ids } = worldWith(
      {},
      { suspended: true, support: 1 },
      { trapped: true, trap: 'dart-trap' },
      { waterSurface: true, liquid: true, material: 'water' },
      { suspended: false, trapped: false, waterSurface: false },
    );
    expect(ids[0]).toBe(1); // the support of entity 2
    expect(findPropertyViolations(w)).toEqual([]);
  });
});

describe('breaksUnder (mw-e03.31)', () => {
  it('AC-2: toughness {blunt: 200 J, slash: 800 J} breaks under a 300 J blunt hit only', () => {
    const { w, ids } = worldWith({ breakable: true, toughness: { blunt: 200, slash: 800 } });
    const [crate = 0] = ids;
    expect([breaksUnder(w, crate, 'blunt', 300), breaksUnder(w, crate, 'slash', 300)]).toEqual([
      true,
      false,
    ]);
  });

  it('breaks at exactly the toughness; a kind with no toughness never breaks it', () => {
    const { w, ids } = worldWith({ breakable: true, toughness: { blunt: 200 } });
    const [wall = 0] = ids;
    expect(breaksUnder(w, wall, 'blunt', 200)).toBe(true);
    expect(breaksUnder(w, wall, 'blunt', 199)).toBe(false);
    expect(breaksUnder(w, wall, 'pierce', 1e8)).toBe(false);
  });

  it('a fragile threshold breaks it under any kind of hit, breakable or not; toughness alone needs breakable', () => {
    const { w, ids } = worldWith({ fragile: 5 }, { toughness: { force: 10 } }, {});
    const [glass = 0, notBreakable = 0, plain = 0] = ids;
    expect(breaksUnder(w, glass, 'pierce', 5)).toBe(true);
    expect(breaksUnder(w, notBreakable, 'force', 50)).toBe(false);
    expect(breaksUnder(w, plain, 'force', 1e6)).toBe(false);
  });
});

describe('hidden and revealed (mw-e03.31)', () => {
  it('AC-3: a hidden entity is excluded from perception and targeting until a reveal clears it, with one propertyChanged', () => {
    const { w, ids } = worldWith({ hidden: true }, {}, { hidden: false });
    const [stash = 0] = ids;
    const seen: PropertyChange[] = [];
    w.events.on(propertyChanged, (change) => seen.push(change));
    // Perception and interaction targeting both filter candidates through revealedOnly.
    expect(revealedOnly(w, ids)).toEqual([ids[1], ids[2]]);
    expect(isRevealed(w, stash)).toBe(false);

    expect(reveal(w, stash, { source: 2 })).toBe(true);
    expect(reveal(w, stash)).toBe(false); // already revealed: no second event
    expect(reveal(w, ids[1] ?? 0)).toBe(false); // never hidden
    w.events.flush();
    expect(seen).toEqual([{ entity: stash, key: 'hidden', old: true, new: false, source: 2 }]);
    expect(revealedOnly(w, ids)).toEqual(ids);
  });
});

describe('supportOf (mw-e03.31)', () => {
  it('names the live entity a suspended object hangs from', () => {
    const { w, ids } = worldWith(
      {},
      { suspended: true, support: 1 },
      { suspended: false, support: 1 },
      { suspended: true },
      { suspended: true, support: 99 },
    );
    expect(ids.map((id) => supportOf(w, id))).toEqual([
      undefined,
      1,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('actorNoiseMultiplier (mw-e03.31)', () => {
  it('AC-7: armour at 1.4 and 1.2 gives an actor multiplier of 1.68', () => {
    const { w, ids } = worldWith({ noiseMultiplier: 1.4 }, { noiseMultiplier: 1.2 }, {});
    expect(actorNoiseMultiplier(w, ids)).toBeCloseTo(1.68, 12);
  });

  it('AC-7: clamps to 0.2–3.0; nothing equipped is 1', () => {
    const loud = worldWith({ noiseMultiplier: 3 }, { noiseMultiplier: 1.6 });
    const quiet = worldWith({ noiseMultiplier: 0.2 }, { noiseMultiplier: 0.5 });
    expect(actorNoiseMultiplier(loud.w, loud.ids)).toBe(3);
    expect(actorNoiseMultiplier(quiet.w, quiet.ids)).toBe(0.2);
    expect(actorNoiseMultiplier(quiet.w, [])).toBe(1);
  });
});
