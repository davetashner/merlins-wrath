import { describe, expect, it } from 'vitest';
import { World } from '../../core/world';
import { hashWorld } from '../../snapshot';
import {
  combatantFromCreature,
  DAMAGE_COMPONENTS,
  DEFAULT_POISE_REGEN,
  giveCombatant,
  HealthComponent,
  healthOf,
  isDead,
  PlayerCombatantComponent,
  UndyingComponent,
  PoiseComponent,
  poiseAfterHit,
  poiseOf,
  poiseSystem,
  ResistancesComponent,
  type Poise,
} from './components';

const world = () => {
  const w = new World<never>({ seed: 3 }).register(...DAMAGE_COMPONENTS);
  w.addSystem(poiseSystem());
  return w;
};

describe('combatant components', () => {
  it('gives full health, poise with default regen, resistances, armor and the player marker', () => {
    const w = world();
    const e = w.spawn();
    giveCombatant(w, e, {
      health: 80,
      poise: 40,
      resistances: { blunt: 1.5, poison: 0 },
      armor: { slash: 2 },
      player: true,
    });
    expect(healthOf(w, e)).toEqual({ max: 80, current: 80 });
    expect(poiseOf(w, e)).toEqual({
      max: 40,
      current: 40,
      regenDelayTicks: DEFAULT_POISE_REGEN.delayTicks,
      regenPercentPerSecond: DEFAULT_POISE_REGEN.percentPerSecond,
      regenResumesAt: 0,
    });
    expect(w.get(e, ResistancesComponent)).toEqual({
      multipliers: { blunt: 1.5, poison: 0 },
      armor: { slash: 2 },
    });
    expect(w.has(e, PlayerCombatantComponent)).toBe(true);
    expect(isDead(w, e)).toBe(false);
    expect(isDead(w, w.spawn())).toBe(false);
  });

  it('omits poise and the marker when not asked for, and adds them at the end of a step', () => {
    const w = world();
    const e = w.spawn();
    giveCombatant(w, e, { health: 10 });
    expect(poiseOf(w, e)).toBeUndefined();
    expect(w.has(e, PlayerCombatantComponent)).toBe(false);
    const later = w.spawn();
    w.addSystem({
      name: 'spawner',
      run: () => {
        giveCombatant(w, later, { health: 1, poise: 1 });
      },
    });
    w.step();
    expect(healthOf(w, later)?.current).toBe(1);
  });

  it('builds a combatant spec from creature data', () => {
    expect(
      combatantFromCreature({
        stats: { health: 60, poise: 30, mass: 70, size: 'medium' },
        resistances: { blunt: 1.5, pierce: 0.5, poison: 0 },
        poiseRegen: { delayTicks: 90, percentPerSecond: 40 },
      }),
    ).toEqual({
      health: 60,
      poise: 30,
      poiseRegen: { delayTicks: 90, percentPerSecond: 40 },
      resistances: { blunt: 1.5, pierce: 0.5, poison: 0 },
    });
  });

  it('rejects invalid specs', () => {
    const w = world();
    const e = w.spawn();
    const bad = [
      [{ health: 0 }, /health.max must be > 0/],
      [{ health: -1 }, /health.max/],
      [{ health: 5, poise: -1 }, /poise.max/],
      [
        { health: 5, poise: 5, poiseRegen: { delayTicks: 1.5, percentPerSecond: 25 } },
        /regenDelayTicks/,
      ],
      [
        { health: 5, poise: 5, poiseRegen: { delayTicks: 1, percentPerSecond: 101 } },
        /regenPercent/,
      ],
      [{ health: 5, resistances: { slash: 3.5 } }, /multipliers.slash must be ≤ 3/],
      [{ health: 5, resistances: { holy: 1 } }, /unknown damage type "holy"/],
      [{ health: 5, armor: { fire: -2 } }, /armor.fire/],
    ] as const;
    for (const [spec, message] of bad) {
      expect(() => {
        giveCombatant(w, e, spec as never);
      }).toThrow(message);
    }
  });

  it('round-trips through a snapshot and rejects corrupt snapshot data', () => {
    const w = world();
    const e = w.spawn();
    giveCombatant(w, e, { health: 12.5, poise: 20, resistances: { fire: 2 }, player: true });
    const copy = world();
    copy.restore(w.snapshot());
    expect(hashWorld(copy)).toBe(hashWorld(w));
    expect(healthOf(copy, e)).toEqual({ max: 12.5, current: 12.5 });

    const corrupt: [
      (
        | typeof HealthComponent
        | typeof PoiseComponent
        | typeof ResistancesComponent
        | typeof PlayerCombatantComponent
      ),
      unknown,
      RegExp,
    ][] = [
      [HealthComponent, null, /health must be an object/],
      [HealthComponent, { max: 10, current: 11 }, /health.current/],
      [HealthComponent, { max: 10, current: '1' }, /health.current/],
      [PoiseComponent, { max: 10, current: -1 }, /poise.current/],
      [PoiseComponent, { max: 10, current: 1, regenPercentPerSecond: '5' }, /regenPercent/],
      [
        PoiseComponent,
        { max: 10, current: 1, regenPercentPerSecond: 5, regenDelayTicks: 1, regenResumesAt: -1 },
        /regenResumesAt/,
      ],
      [ResistancesComponent, { multipliers: {}, armor: 3 }, /resistances.armor must be an object/],
      [PlayerCombatantComponent, false, /marker/],
    ];
    for (const [type, data, message] of corrupt) {
      expect(() => type.deserialize(data)).toThrow(message);
    }
    expect(UndyingComponent.deserialize(true)).toBe(true);
    expect(() => UndyingComponent.deserialize(1)).toThrow(/undying marker/);
  });
});

describe('poise', () => {
  const poise: Poise = {
    max: 50,
    current: 50,
    regenDelayTicks: 120,
    regenPercentPerSecond: 25,
    regenResumesAt: 0,
  };

  it('restarts the regen pause on a hit and breaks (refilling) when it empties', () => {
    expect(poiseAfterHit(poise, 20, 10)).toEqual({
      broken: false,
      poise: { ...poise, current: 30, regenResumesAt: 130 },
    });
    expect(poiseAfterHit({ ...poise, current: 20 }, 20, 0).broken).toBe(true);
    expect(poiseAfterHit({ ...poise, max: 0, current: 0 }, 0.01, 0)).toEqual({
      broken: true,
      poise: { ...poise, max: 0, current: 0, regenResumesAt: 120 },
    });
  });

  it('regenerates 25% of max per second after the pause, capped at max', () => {
    const w = world();
    const e = w.spawn();
    giveCombatant(w, e, { health: 1, poise: 50 });
    w.set(e, PoiseComponent, { ...poise, current: 10, regenResumesAt: 60 });
    const trace: (number | undefined)[] = [];
    for (let i = 0; i < 3; i++) {
      w.step();
      trace.push(poiseOf(w, e)?.current);
      for (let t = 0; t < 59; t++) w.step();
    }
    // Paused through tick 59; regen runs on ticks 60…: +0.2083… per tick, 12.5 per second.
    expect(trace).toEqual([10, 10 + 12.5 / 60, 10 + 12.5 * (61 / 60)]);
    for (let t = 0; t < 180; t++) w.step();
    expect(poiseOf(w, e)?.current).toBe(50);
  });
});
