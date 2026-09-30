import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import type { DifficultyOverrides } from '../../difficulty';
import { Rng } from '../../rng';
import { drainStamina, giveStamina, StaminaComponent, staminaOf } from '../stamina';
import {
  DAMAGE_COMPONENTS,
  giveCombatant,
  healthOf,
  HealthComponent,
  isDead,
  poiseOf,
  poiseSystem,
  UNDYING_FLOOR,
  UndyingComponent,
  type CombatantSpec,
} from './components';
import {
  DamageApplied,
  Died,
  PoiseBroken,
  type DamageResult,
  type Death,
  type PoiseBreak,
} from './events';
import {
  DAMAGE_STAGES,
  DamageModel,
  reduceDamage,
  scaleDamage,
  type DamageModifier,
  type DamageStage,
} from './model';
import { DAMAGE_TAGS, type DamagePacketInput } from './packet';

function setup(spec: CombatantSpec, difficulty: DifficultyOverrides = {}) {
  const world = new World<never>({ seed: 7, difficulty }).register(
    ...DAMAGE_COMPONENTS,
    StaminaComponent,
  );
  world.addSystem(poiseSystem());
  const target = world.spawn();
  giveCombatant(world, target, spec);
  const applied: DamageResult[] = [];
  const broken: PoiseBreak[] = [];
  const died: Death[] = [];
  world.events.on(DamageApplied, (e) => applied.push(e));
  world.events.on(PoiseBroken, (e) => broken.push(e));
  world.events.on(Died, (e) => died.push(e));
  const model = new DamageModel();
  /** Applies a packet to `to` (default: the target) and delivers the events. */
  const hit = (packet: DamagePacketInput, to: EntityId = target) => {
    const result = model.apply(world, to, packet);
    world.events.flush();
    return result;
  };
  const health = (entity: EntityId = target) => healthOf(world, entity)?.current;
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) world.step();
  };
  return { world, target, model, hit, health, steps, applied, broken, died };
}

describe('damage model', () => {
  it('AC-1: a 40-slash packet against slash resistance 0.5 and no armor takes exactly 20 health', () => {
    const s = setup({ health: 100, resistances: { slash: 0.5 } });
    const result = s.hit({ amounts: { slash: 40 } });
    expect(s.health()).toBe(80);
    expect(result).toMatchObject({ total: 20, healthBefore: 100, healthAfter: 80, immune: false });
  });

  it('AC-2: 30 blunt + 20 fire against blunt 1.5 / fire 1.0 deals 65 with a per-type breakdown', () => {
    const s = setup({ health: 200, resistances: { blunt: 1.5, fire: 1 } });
    s.hit({ amounts: { blunt: 30, fire: 20 }, instigator: 9, source: 10 });
    expect(s.health()).toBe(135);
    expect(s.applied).toHaveLength(1);
    expect(s.applied[0]).toMatchObject({
      tick: 0,
      target: s.target,
      total: 65,
      amounts: { blunt: 45, fire: 20 },
      packet: { instigator: 9, source: 10 },
    });
    expect(Object.keys(s.applied[0]?.amounts ?? {})).toEqual(['blunt', 'fire']);
  });

  const backstab: DamageModifier = {
    name: 'backstab',
    stage: 'attacker',
    apply: (hit) =>
      hit.tags.includes(DAMAGE_TAGS.backstab)
        ? { ...hit, amounts: scaleDamage(hit.amounts, 2) }
        : undefined,
  };
  const ward: DamageModifier = {
    name: 'ward',
    stage: 'defender',
    apply: (hit) => ({ ...hit, amounts: reduceDamage(hit.amounts, 10) }),
  };

  it('AC-3: attacker ×2 (backstab) then defender −10 turns a tagged 20-pierce packet into 30', () => {
    const s = setup({ health: 100 });
    // Registered defender-first: stage order, not registration order, decides.
    s.model.register(ward);
    s.model.register(backstab);
    expect(s.hit({ amounts: { pierce: 20 }, tags: ['backstab'] })?.total).toBe(30);
    expect(s.hit({ amounts: { pierce: 20 } })?.total).toBe(10);
  });

  it('AC-3: stage order is stable by (stage, registration id) across 1000 seeded runs', () => {
    const rng = Rng.create(0xd3a7);
    const outcomes = new Set<string>();
    let ordered = 0;
    for (let run = 0; run < 1000; run++) {
      const s = setup({ health: 1000 });
      const trace: [number, number][] = [];
      const noise = rng.int(0, 6);
      const plan = rng.shuffle([
        backstab,
        ward,
        ...Array.from({ length: noise }, () => ({ name: 'noop', stage: rng.pick(DAMAGE_STAGES) })),
      ]);
      for (const entry of plan) {
        const id: number = s.model.register({
          name: entry.name,
          stage: entry.stage,
          apply: (hit, ctx) => {
            trace.push([DAMAGE_STAGES.indexOf(ctx.stage), id]);
            return 'apply' in entry ? entry.apply(hit, ctx) : undefined;
          },
        });
      }
      outcomes.add(String(s.hit({ amounts: { pierce: 20 }, tags: ['backstab'] })?.total));
      const sorted = [...trace].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const expected = s.model
        .modifiers()
        .map(({ id, stage }) => [DAMAGE_STAGES.indexOf(stage), id]);
      if (
        JSON.stringify(trace) === JSON.stringify(sorted) &&
        JSON.stringify(trace) === JSON.stringify(expected)
      ) {
        ordered++;
      }
    }
    expect(ordered).toBe(1000);
    expect([...outcomes]).toEqual(['30']);
  });

  it('AC-4: three 20-poise hits within 120 ticks break poise max 50 once, on the third, and reset it', () => {
    const s = setup({ health: 100, poise: 50 });
    const breaks: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      breaks.push(s.hit({ amounts: {}, poiseDamage: 20 })?.poiseBroken ?? false);
      s.steps(50);
    }
    expect(breaks).toEqual([false, false, true]);
    expect(s.broken).toEqual([{ tick: 100, target: s.target, instigator: null, source: null }]);
    expect(poiseOf(s.world, s.target)?.current).toBe(50);
  });

  it('AC-4: the same hits 150 ticks apart never break poise because it regenerated', () => {
    const s = setup({ health: 100, poise: 50 });
    const after: (number | undefined)[] = [];
    for (let i = 0; i < 3; i++) {
      s.hit({ amounts: {}, poiseDamage: 20 });
      after.push(poiseOf(s.world, s.target)?.current);
      s.steps(150);
    }
    // 30 → +6.25 (30 ticks of 12.5/s) → 16.25 → 22.5 → 2.5.
    expect(after).toEqual([30, 16.25, 2.5]);
    expect(s.broken).toEqual([]);
  });

  it('AC-5: 1000 damage on 5 health clamps to 0, emits Died once and ignores later packets', () => {
    const s = setup({ health: 5, poise: 10 });
    const first = s.hit({
      amounts: { blunt: 1000 },
      poiseDamage: 50,
      instigator: 3,
      tags: ['critical'],
    });
    expect(first).toMatchObject({ total: 1000, healthAfter: 0, died: true, poiseBroken: false });
    expect(s.hit({ amounts: { blunt: 1000 } })).toBeUndefined();
    expect(s.health()).toBe(0);
    expect(isDead(s.world, s.target)).toBe(true);
    expect(s.died).toEqual([
      { tick: 0, target: s.target, killer: 3, source: null, tags: ['critical'] },
    ]);
    expect(s.applied).toHaveLength(1);
    expect(s.broken).toEqual([]); // a killing blow does not also stagger
  });

  it('an undying combatant keeps UNDYING_FLOOR health and never dies, though hits report their damage (mw-e04.9)', () => {
    const s = setup({ health: 50, poise: 10 });
    s.world.register(UndyingComponent);
    s.world.add(s.target, UndyingComponent, true);
    s.world.step();
    const result = s.hit({ amounts: { slash: 10_000 }, poiseDamage: 5 });
    expect(result).toMatchObject({ total: 10_000, healthBefore: 50, healthAfter: 1, died: false });
    expect(UNDYING_FLOOR).toBe(1);
    expect(s.hit({ amounts: { slash: 10_000 } })).toMatchObject({ healthAfter: 1, died: false });
    s.world.set(s.target, HealthComponent, { max: 50, current: 0.5 });
    expect(s.hit({ amounts: { slash: 3 } })).toMatchObject({ healthAfter: 0.5, died: false });
    expect(s.died).toEqual([]);
    // Without the marker (or in a world that never registered it) the hit kills as ever.
    const other = s.world.spawn();
    giveCombatant(s.world, other, { health: 5 });
    s.world.step();
    expect(s.hit({ amounts: { slash: 10 } }, other)).toMatchObject({ died: true });
  });

  it('AC-6: a type the defender is immune to deals 0 and is flagged immune', () => {
    const s = setup({ health: 50, resistances: { poison: 0 } });
    expect(s.hit({ amounts: { poison: 25 } })).toMatchObject({
      total: 0,
      amounts: { poison: 0 },
      immune: true,
      healthAfter: 50,
    });
    expect(s.applied[0]?.immune).toBe(true);
    // Mixed with a type it is not immune to, or dealing nothing at all, it is not "no effect".
    expect(s.hit({ amounts: { poison: 25, slash: 5 } })?.immune).toBe(false);
    expect(s.hit({ amounts: {}, poiseDamage: 5 })?.immune).toBe(false);
  });

  it('keeps health exact to the hundredth over many fractional hits', () => {
    const s = setup({ health: 100 });
    for (let i = 0; i < 1000; i++) s.model.apply(s.world, s.target, { amounts: { slash: 0.07 } });
    expect(s.health()).toBe(30);
  });

  it('applies the hurtbox region multiplier and flat armor per type', () => {
    const s = setup({ health: 100, armor: { slash: 3 } });
    expect(
      s.hit({ amounts: { slash: 20, fire: 2 }, region: 'head', regionMultiplier: 1.5 }),
    ).toMatchObject({
      amounts: { slash: 27, fire: 3 },
      packet: { region: 'head' },
    });
    expect(s.hit({ amounts: { slash: 2 } })?.total).toBe(0); // armor never heals
  });

  it('treats an entity with health but no resistances component as neutral', () => {
    const s = setup({ health: 10 });
    const bare = s.world.spawn();
    s.world.add(bare, HealthComponent, { max: 10, current: 10 });
    expect(s.hit({ amounts: { poison: 4 } }, bare)).toMatchObject({ total: 4, immune: false });
  });

  it('ignores hits on entities without health', () => {
    const s = setup({ health: 10 });
    expect(s.hit({ amounts: { slash: 4 } }, s.world.spawn())).toBeUndefined();
    expect(s.applied).toEqual([]);
  });

  it('a guard modifier can absorb damage and drain stamina like the e04.6 block', () => {
    const s = setup({ health: 100 });
    giveStamina(s.world, s.target);
    s.model.register({
      name: 'wood-shield',
      stage: 'guard',
      apply: (hit, { world, target }) => {
        drainStamina(world, target, hit.staminaDamage * (1 - 60 / 100));
        return { ...hit, amounts: scaleDamage(hit.amounts, 0.15, ['slash']) };
      },
    });
    const result = s.hit({ amounts: { slash: 30 }, staminaDamage: 20 });
    expect(result?.staminaDamage).toBe(20);
    expect(s.health()).toBe(95.5);
    expect(staminaOf(s.world, s.target)?.current).toBe(92);
  });

  it('modifiers can change poise damage and add tags; outputs are clamped and rounded', () => {
    const s = setup({ health: 100, poise: 40 });
    s.model.register({
      name: 'hyperarmor',
      stage: 'defender',
      apply: (hit) => ({
        ...hit,
        poiseDamage: -5,
        staminaDamage: 1.234,
        tags: [...hit.tags, 'counter', 'counter'],
      }),
    });
    s.model.register({
      name: 'overshoot',
      stage: 'armor',
      apply: (hit) => ({ ...hit, amounts: { ...hit.amounts, slash: -40, fire: 1.006 } }),
    });
    expect(s.hit({ amounts: { slash: 10 }, poiseDamage: 30, tags: ['riposte'] })).toMatchObject({
      amounts: { slash: 0, fire: 1.01 },
      poiseDamage: 0,
      staminaDamage: 1.23,
      tags: ['counter', 'riposte'],
    });
    expect(poiseOf(s.world, s.target)?.current).toBe(40);
  });

  it('rejects modifiers that return invalid hits, naming them', () => {
    const s = setup({ health: 100 });
    const id = s.model.register({
      name: 'broken',
      stage: 'region',
      apply: (hit) => ({ ...hit, amounts: { slash: Number.NaN } }),
    });
    expect(() => s.hit({ amounts: { slash: 1 } })).toThrow(/"broken": slash/);
    s.model.unregister(id);
    s.model.register({
      name: 'holy',
      stage: 'region',
      apply: (hit) => ({ ...hit, amounts: { holy: 1 } as never }),
    });
    expect(() => s.hit({ amounts: { slash: 1 } })).toThrow(/unknown damage type "holy"/);
  });

  it('registers, lists and unregisters modifiers', () => {
    const { model } = setup({ health: 1 });
    const noop = (name: string, stage: DamageStage): DamageModifier => ({
      name,
      stage,
      apply: () => undefined,
    });
    const a = model.register(noop('a', 'armor'));
    const b = model.register(noop('b', 'attacker'));
    expect(model.modifiers()).toEqual([
      { id: b, name: 'b', stage: 'attacker' },
      { id: a, name: 'a', stage: 'armor' },
    ]);
    expect(model.unregister(a)).toBe(true);
    expect(model.unregister(a)).toBe(false);
    expect(model.modifiers()).toEqual([{ id: b, name: 'b', stage: 'attacker' }]);
    expect(() => model.register(noop('x', 'nope' as DamageStage))).toThrow(/unknown damage stage/);
    expect(() => model.register(noop('', 'guard'))).toThrow(/name/);
  });

  describe('difficulty multipliers', () => {
    it('scale damage the player deals (damageDealt) and takes (damageTaken), nobody else', () => {
      const s = setup({ health: 100 }, { damageDealt: 2, damageTaken: 0.5 });
      const player = s.world.spawn();
      giveCombatant(s.world, player, { health: 100, player: true });
      const bystander = s.world.spawn();
      expect(s.hit({ amounts: { slash: 10 }, instigator: player })?.total).toBe(20);
      expect(s.hit({ amounts: { slash: 10 }, instigator: bystander })?.total).toBe(10);
      expect(s.hit({ amounts: { slash: 10 } })?.total).toBe(10);
      expect(s.hit({ amounts: { slash: 10 }, instigator: s.target }, player)?.total).toBe(5);
      // The player's own fireball: only damageTaken applies.
      expect(s.hit({ amounts: { fire: 10 }, instigator: player }, player)?.total).toBe(5);
    });

    it('fallDamage scales environmental damage the player takes, on top of damageTaken; 0 turns it off', () => {
      const s = setup({ health: 100, player: true }, { damageTaken: 2, fallDamage: 0.5 });
      expect(s.hit({ amounts: { blunt: 10 }, tags: ['environment', 'fall'] })?.total).toBe(10);
      expect(s.hit({ amounts: { blunt: 10 } })?.total).toBe(20);
      const off = setup({ health: 100, player: true }, { fallDamage: 0 });
      expect(off.hit({ amounts: { fire: 8 }, tags: ['environment', 'hazard'] })?.total).toBe(0);
      const creature = setup({ health: 100 }, { fallDamage: 0 });
      expect(creature.hit({ amounts: { blunt: 10 }, tags: ['environment'] })?.total).toBe(10);
    });

    it('damageTaken applies after armor', () => {
      const s = setup({ health: 100, player: true, armor: { slash: 4 } }, { damageTaken: 2 });
      expect(s.hit({ amounts: { slash: 10 } })?.total).toBe(12);
    });
  });
});

describe('damage helpers', () => {
  it('scaleDamage scales all or some types and rejects bad factors', () => {
    expect(scaleDamage({ slash: 10, fire: 3 }, 1.5)).toEqual({ slash: 15, fire: 4.5 });
    expect(scaleDamage({ slash: 10, fire: 3 }, 0.5, ['fire'])).toEqual({ slash: 10, fire: 1.5 });
    expect(() => scaleDamage({ slash: 1 }, -1)).toThrow(RangeError);
  });

  it('reduceDamage spreads a flat cut by share with a deterministic largest remainder', () => {
    expect(reduceDamage({ slash: 30, fire: 10 }, 8)).toEqual({ slash: 24, fire: 8 });
    expect(reduceDamage({ slash: 0.01, fire: 0.01, frost: 0.01 }, 0.02)).toEqual({
      slash: 0,
      fire: 0,
      frost: 0.01,
    });
    expect(reduceDamage({ slash: 5, poison: 0 }, 100)).toEqual({ slash: 0, poison: 0 });
    const untouched = { slash: 5 };
    expect(reduceDamage(untouched, 0)).toBe(untouched);
    expect(reduceDamage({}, 3)).toEqual({});
    expect(() => reduceDamage({ slash: 1 }, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
