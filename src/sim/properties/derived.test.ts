import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { addProperties, registerWorldProperties, type WorldPropertyInit } from './components';
import {
  findPropertyViolations,
  floats,
  isFlammableNow,
  PROPERTY_INVARIANT_RULES,
  SOAKED_WETNESS,
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
    ]);
  });
});
