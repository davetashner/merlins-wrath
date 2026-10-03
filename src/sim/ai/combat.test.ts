// Combat behaviour (mw-e11.13): attack tokens, attack selection, spacing, out-of-reach handling and
// the stagger response, on hand-built attacks and behaviours (sim tests may not load content; the
// fixture guards' content fights in tests/integration/combat-behaviour.test.ts).

import type { BehaviourDef, Frozen, RuntimeAttack } from '@content/index';
import { describe, expect, it } from 'vitest';
import {
  ATTACK_COMPONENTS,
  AttackerComponent,
  currentAttack,
  giveAttacker,
} from '../combat/attacks/components';
import { AttackEnded } from '../combat/attacks/events';
import { cancelAttack, installAttacks } from '../combat/attacks/executor';
import { DAMAGE_COMPONENTS, giveCombatant } from '../combat/damage/components';
import { DamageModel } from '../combat/damage/model';
import { CombatFacingComponent } from '../combat/melee/components';
import { giveHitReactions, HitReactionComponent } from '../combat/reactions/components';
import { ActionTimelineComponent, giveActionTimeline } from '../combat/timeline/components';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { CreatureComponent } from '../creatures/components';
import { ON_PILLAR, IN_B, twoRooms } from '../nav/fixtures';
import { navmeshNavigation } from '../nav/navigation';
import { entitySource, percept } from '../perception/percept';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { compileBehaviours } from './behaviour';
import {
  attackWeights,
  DEFAULT_ATTACK_TOKENS,
  isStaggered,
  NO_TARGET_DISTANCE,
  pickWeighted,
  tokenHolders,
  UNREACHABLE_MOVE_M,
} from './combat';
import {
  AiTargetShared,
  BrainComponent,
  type ActivityEnd,
  type AiTargetShare,
  type Brain,
} from './components';
import { resolveInput } from './inputs';
import { observePercepts } from './memory';
import { approach, straightLineNavigation, type AiNavigation } from './navigation';
import { brainOf, giveBrain, installAi, writeBlackboard, type AiOptions } from './runtime';
import type { AgentView } from './view';

type Loose = Readonly<Record<string, unknown>>;

/** A hand-built melee attack (the sim cannot load content): a sphere 1 m ahead. */
function makeAttack(
  id: string,
  overrides: Partial<RuntimeAttack> = {},
  frames: readonly [number, number, number] = [12, 4, 10],
): RuntimeAttack {
  const [startup, active, recovery] = frames;
  const hitbox = {
    track: 'test',
    shape: { kind: 'sphere', center: { x: 0, y: 0, z: 1 }, radius: 0.5 },
    reach: 'short',
    swing: 'thrust',
  } as const;
  const packet = {
    amounts: { slash: 1 },
    poiseDamage: 0,
    staminaDamage: 0,
    impulse: { x: 0, y: 0, z: 0 },
    impactForce: 0,
    tags: [],
  };
  return {
    id,
    kind: 'melee',
    move: {
      id: `${id}-move`,
      verb: 'attack',
      startup,
      active,
      recovery,
      totalTicks: startup + active + recovery,
      activeFrom: startup,
      recoveryFrom: startup + active,
      staminaCost: 0,
      cancelWindows: [],
      damage: packet,
      hitbox,
      parryable: true,
      blockable: true,
      unblockable: false,
      interruptible: false,
      hyperarmor: null,
      iframes: null,
      telegraphTick: 0,
      chainNext: null,
      charge: null,
      motion: null,
      hitStop: 'light',
      presentation: { anim: 'anim-test' },
    },
    hitbox,
    telegraph: `${id}-windup`,
    rangeMin: 0,
    rangeMax: 2,
    packets: [packet],
    cooldownMs: 1000,
    weight: 1,
    targetStances: null,
    healthMin: 0,
    healthMax: 1,
    projectile: null,
    ...overrides,
  };
}

const step = (value: Loose): Loose =>
  value['do'] === 'circle' || value['do'] === 'strike' ? { gait: 'walk', ...value } : value;

/** The fixture guard's Combat state, tersely: press, circle, taunt (see its behaviour content). */
function fighter(
  overrides: { press?: Loose[]; tuning?: Record<string, number>; plain?: boolean } = {},
) {
  const unreachable = (below: number, above: number) => ({
    input: 'targetUnreachableS',
    curve: { kind: 'step', at: 8, below, above },
  });
  const activity = (
    weight: number,
    considerations: Loose[],
    steps: Loose[],
    interruptible = true,
  ) => ({
    weight,
    interruptible,
    retryAfterS: 2,
    considerations,
    steps: steps.map(step),
  });
  return {
    id: 'fighter',
    schemaVersion: 1,
    tuning: { preferredRange: 2.5, ...overrides.tuning },
    thinkHz: 10,
    inertia: 0.1,
    initial: 'combat',
    states: {
      combat: {
        transitions: [],
        timeoutFrom: 'entered',
        postAlert: false,
        activities: ['press', 'circle', 'taunt'],
      },
    },
    activities: {
      press: activity(
        1,
        overrides.plain === true
          ? []
          : [
              { input: 'attackToken', curve: { kind: 'step', at: 1, below: 0, above: 1 } },
              unreachable(1, 0),
            ],
        overrides.press ?? [{ do: 'share-target' }, { do: 'strike', gait: 'run', giveUpS: 8 }],
        false,
      ),
      circle: activity(
        0.5,
        [unreachable(1, 0)],
        [{ do: 'circle', range: { tuning: 'preferredRange' }, seconds: 2 }],
      ),
      taunt: activity(
        2,
        [unreachable(0, 1)],
        [
          { do: 'look-at', target: 'target', seconds: 1 },
          { do: 'play-cue', cue: 'taunt' },
          { do: 'wait', seconds: 2 },
        ],
      ),
    },
  } as unknown as Frozen<BehaviourDef>;
}

interface Arena {
  readonly world: World<never>;
  /** The target every guard fights. */
  readonly foe: EntityId;
  readonly guard: (at: Vec3, options?: GuardOptions) => EntityId;
  /** Every guard sees the foe where it stands now (as awareness would write it). */
  readonly look: () => void;
  readonly guards: EntityId[];
}

interface GuardOptions {
  readonly attacks?: readonly string[];
  readonly gaits?: Brain['gaits'];
  readonly traits?: Record<string, number>;
}

/** A world with AI fighting `foe`, the attack executor running `attacks`. */
function arena(
  attacks: readonly RuntimeAttack[],
  options: Omit<AiOptions, 'behaviours' | 'attacks'> & {
    readonly foeAt?: Vec3;
    readonly behaviour?: Frozen<BehaviourDef>;
    readonly seed?: number;
  } = {},
): Arena {
  const { foeAt, behaviour, seed, ...ai } = options;
  const world = new World<never>({ seed: seed ?? 3 });
  world.register(
    PlacementComponent,
    CombatFacingComponent,
    CreatureComponent,
    ...ATTACK_COMPONENTS,
    ...DAMAGE_COMPONENTS,
  );
  const table = new Map(attacks.map((a) => [a.id, a]));
  installAi(world, {
    behaviours: compileBehaviours([behaviour ?? fighter()]),
    attacks: table,
    ...ai,
  });
  installAttacks(world, { attacks: table, damage: new DamageModel() });
  const foe = world.spawn();
  placeEntity(world, foe, foeAt ?? { x: 0, y: 0, z: 0 }, 0.35);
  giveCombatant(world, foe, { health: 1e9 });
  const guards: EntityId[] = [];
  const guard = (at: Vec3, g: GuardOptions = {}) => {
    const entity = world.spawn();
    placeEntity(world, entity, at, 0.35);
    world.add(entity, CombatFacingComponent, { facing: { x: 0, y: 0, z: 1 } });
    giveAttacker(world, entity, g.attacks ?? attacks.map((a) => a.id));
    giveBrain(world, entity, {
      behaviour: (behaviour ?? fighter()).id,
      gaits: g.gaits ?? { sneak: 1, walk: 1.5, run: 3 },
      traits: g.traits ?? {},
    });
    guards.push(entity);
    return entity;
  };
  const look = () => {
    for (const g of guards) sees(world, g, foe);
  };
  return { world, foe, guard, look, guards };
}

/** `hunter` sees `prey` where it stands now, as awareness writes it from a percept (mw-e11.8). */
function sees(world: World<never>, hunter: EntityId, prey: EntityId): void {
  const at = must(world.get(prey, PlacementComponent));
  const position = { x: at.x, y: at.y, z: at.z };
  const source = entitySource(prey);
  const seen = percept({
    source,
    kind: 'seen-target',
    sense: 'sight',
    position,
    strength: 1,
    certainty: 1,
  });
  const brain = must(world.get(hunter, BrainComponent));
  observePercepts(brain.memory, [seen], world.tick, world.clock.hz);
  writeBlackboard(world, hunter, {
    target: prey,
    targetSource: source,
    lkp: position,
    targetVisible: true,
  });
}

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

const brain = (world: World<never>, entity: EntityId): Readonly<Brain> =>
  must(brainOf(world, entity));

/** Every activity `entity` ends from now on, in order (read after each tick, before a think clears it). */
function ends(world: World<never>, entity: EntityId): ActivityEnd[] {
  const out: ActivityEnd[] = [];
  let last: ActivityEnd | null = null;
  world.addSystem({
    name: `test-ends-${String(entity)}`,
    run: () => {
      const ended = brainOf(world, entity)?.ended ?? null;
      if (ended !== null && ended !== last) out.push({ ...ended });
      last = ended;
    },
  });
  return out;
}

const place = (world: World<never>, entity: EntityId) =>
  must(world.get(entity, PlacementComponent));

const flat = (a: Vec3, b: Vec3) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

/** A view of `entity` for reading inputs directly. */
function viewOf(world: World<never>, entity: EntityId, attackTokens = DEFAULT_ATTACK_TOKENS) {
  return {
    world,
    entity,
    brain: must(world.get(entity, BrainComponent)),
    creature: undefined,
    tuning: {},
    tick: world.tick,
    hz: world.clock.hz,
    ports: {
      navigation: straightLineNavigation,
      attacks: undefined,
      hourOfDay: undefined,
      memory: {
        decayPerS: 0.02,
        predictS: 1.5,
        secondHand: 0.7,
        velocityWindowS: 1,
        persistent: [],
      },
      attackTokens,
    },
  } as AgentView;
}

const input = (name: string) => must(resolveInput(name));

describe('attack tokens (mw-e11.13)', () => {
  it('AC-1: 4 hostile guards in Combat against one player, budget 2: never more than 2 attack at once over 10 s, and all take turns', () => {
    const strike = makeAttack('strike', { rangeMax: 1.8 });
    const a = arena([strike], { attackTokens: 2 });
    for (const at of [
      { x: 3, y: 0, z: 0 },
      { x: -3, y: 0, z: 0 },
      { x: 0, y: 0, z: 3 },
      { x: 0, y: 0, z: -3 },
    ]) {
      a.guard(at);
    }
    a.world.step();
    let most = 0;
    const attacked = new Set<EntityId>();
    for (let tick = 0; tick < 600; tick++) {
      a.look();
      a.world.step();
      const attacking = a.guards.filter((g) => currentAttack(a.world, g) !== undefined);
      most = Math.max(most, attacking.length);
      for (const g of attacking) attacked.add(g);
      expect(attacking.length).toBeLessThanOrEqual(2);
      expect(tokenHolders(a.world, a.foe)).toEqual(attacking);
    }
    expect(most).toBe(2); // the budget is reached, not avoided
    expect(attacked.size).toBe(4); // and they take turns
    for (const g of a.guards) expect(brain(a.world, g).state).toBe('combat');
  });

  it('a budget of 1 lets one attack at a time; the attackToken input reads whether one is free', () => {
    const strike = makeAttack('strike', { rangeMax: 1.8 });
    const a = arena([strike], { attackTokens: 1 });
    const first = a.guard({ x: 1, y: 0, z: 0 });
    const second = a.guard({ x: -1, y: 0, z: 0 });
    a.world.step();
    a.look();
    a.world.step(); // both think on their own ticks; the first to act takes the token
    for (let i = 0; i < 10; i++) {
      a.look();
      a.world.step();
    }
    const holders = tokenHolders(a.world, a.foe);
    expect(holders).toHaveLength(1);
    const [holder] = holders;
    const other = holder === first ? second : first;
    expect(input('attackToken')(viewOf(a.world, must(holder), 1))).toBe(1); // it holds one
    expect(input('attackToken')(viewOf(a.world, other, 1))).toBe(0);
    expect(input('attackToken')(viewOf(a.world, other, 2))).toBe(1);
    // Without a target there is no token to take.
    writeBlackboard(a.world, other, { target: null });
    expect(input('attackToken')(viewOf(a.world, other, 2))).toBe(0);
  });

  it('rejects a budget that is not a whole number of at least 1', () => {
    for (const attackTokens of [0, 1.5, Number.NaN]) {
      const world = new World<never>({ seed: 1 });
      expect(() => {
        installAi(world, { behaviours: new Map(), attackTokens });
      }).toThrow(RangeError);
    }
  });
});

describe('attack selection (mw-e11.13)', () => {
  it('AC-2: an attack whose distance precondition (≤ 2 m) is false is never chosen', () => {
    const near = makeAttack('near', { rangeMax: 2, cooldownMs: 0 });
    const far = makeAttack('far', { rangeMin: 2.5, rangeMax: 4, cooldownMs: 0 });
    const chosen = new Map<string, number>();
    for (let seed = 1; seed <= 30; seed++) {
      // The guard cannot move (it is rooted): the target stays 3 m away.
      const a = arena([near, far], { seed });
      const g = a.guard({ x: 3, y: 0, z: 0 }, { gaits: { sneak: 0, walk: 0, run: 0 } });
      a.world.events.on(AttackEnded, ({ attack }) => {
        chosen.set(attack, (chosen.get(attack) ?? 0) + 1);
      });
      for (let i = 0; i < 180; i++) {
        a.look();
        a.world.step();
        const attack = currentAttack(a.world, g);
        if (attack !== undefined) expect(attack.attack).toBe('far');
      }
    }
    expect(chosen.get('near')).toBeUndefined();
    expect(chosen.get('far')).toBeGreaterThan(0);
  });

  it('weighs options by weight and an aggression lean toward long attacks; picks in proportion', () => {
    const quick = makeAttack('quick', { weight: 1 }, [4, 2, 4]); // 10 ticks
    const heavy = makeAttack('heavy', { weight: 1 }, [20, 4, 6]); // 30 ticks
    expect(attackWeights([quick, heavy], 0.5)).toEqual([1, 1]);
    const [q, h] = attackWeights([quick, heavy], 1); // mean 20: lean 0.5 and 1.5
    expect(q).toBeCloseTo(0.5);
    expect(h).toBeCloseTo(1.5);
    const [cq, ch] = attackWeights([quick, heavy], 0);
    expect(cq).toBeCloseTo(1.5);
    expect(ch).toBeCloseTo(0.5);
    // The lean never takes an attack below a tenth of its weight; no attacks, no weights.
    const huge = makeAttack('huge', { weight: 2 }, [100, 50, 50]);
    expect(attackWeights([quick, huge], 0)[1]).toBeCloseTo(0.2);
    expect(attackWeights([], 0.5)).toEqual([]);
    // A move of no ticks has no length to lean on.
    const instant = makeAttack('instant', { weight: 3 }, [0, 0, 0]);
    expect(attackWeights([instant], 1)).toEqual([3]);

    expect(pickWeighted([1, 3], 0)).toBe(0);
    expect(pickWeighted([1, 3], 0.24)).toBe(0);
    expect(pickWeighted([1, 3], 0.26)).toBe(1);
    expect(pickWeighted([0, 2, 0], 0.5)).toBe(1);
    expect(pickWeighted([2, 0], 1)).toBe(0); // a roll of 1 (out of contract) lands on the last
    expect(pickWeighted([0, 0], 0.5)).toBe(-1);
    expect(pickWeighted([], 0.5)).toBe(-1);
  });

  it('closes in for an attack out of reach as often as its weight says, rolling once per change of what it can use', () => {
    const lunge = makeAttack('lunge', { rangeMin: 1.6, rangeMax: 2.8, cooldownMs: 0 });
    const chop = makeAttack('chop', { rangeMax: 1.4, weight: 3, cooldownMs: 0 });
    const opened = new Map<string, number>();
    for (let seed = 1; seed <= 40; seed++) {
      const a = arena([lunge, chop], { seed });
      const g = a.guard({ x: 6, y: 0, z: 0 });
      for (let i = 0; i < 200 && currentAttack(a.world, g) === undefined; i++) {
        a.look();
        a.world.step();
      }
      const first = must(currentAttack(a.world, g)).attack;
      opened.set(first, (opened.get(first) ?? 0) + 1);
    }
    // 1 : 3 for the lunge against closing in for the chop.
    expect(must(opened.get('lunge'))).toBeGreaterThan(2);
    expect(must(opened.get('chop'))).toBeGreaterThan(must(opened.get('lunge')));
  });

  it('backs off from a target it stands too close to for any ready attack', () => {
    const lunge = makeAttack('lunge', { rangeMin: 1.6, rangeMax: 2.8 });
    const a = arena([lunge]);
    const g = a.guard({ x: 0.5, y: 0, z: 0 });
    for (let i = 0; i < 120 && currentAttack(a.world, g) === undefined; i++) {
      a.look();
      a.world.step();
      expect(must(a.world.get(g, CombatFacingComponent)).facing.x).toBeLessThanOrEqual(0);
    }
    expect(currentAttack(a.world, g)?.attack).toBe('lunge');
    expect(flat(place(a.world, g), place(a.world, a.foe))).toBeGreaterThanOrEqual(1.6);
  });

  it('strike fails without a target, attacks or an attacker, with every attack cooling down, or with no token free', () => {
    const strike = makeAttack('strike', { cooldownMs: 60_000 });
    const behaviour = fighter({ plain: true, press: [{ do: 'strike', gait: 'run', giveUpS: 8 }] });
    const failed = { activity: 'press', ok: false };
    const first = (setup: (a: Arena, g: EntityId) => void, options: Loose = {}) => {
      const a = arena([strike], { behaviour, ...options });
      const g = a.guard({ x: 4, y: 0, z: 0 });
      setup(a, g);
      const log = ends(a.world, g);
      for (let i = 0; i < 8; i++) a.world.step();
      return log[0];
    };
    expect(first(() => undefined)).toEqual(failed); // no target memory
    expect(
      first(
        (a) => {
          a.look();
        },
        { attacks: undefined },
      ),
    ).toEqual(failed); // no attack table
    expect(
      first((a, g) => {
        a.look();
        a.world.remove(g, AttackerComponent);
      }),
    ).toEqual(failed); // not an attacker
    // Its one attack swung, then cooling down: nothing ready.
    const a = arena([strike], { behaviour });
    const g = a.guard({ x: 1, y: 0, z: 0 });
    a.look();
    const log = ends(a.world, g);
    for (let i = 0; i < 60; i++) a.world.step();
    expect(log.slice(0, 2)).toEqual([{ activity: 'press', ok: true }, failed]);
    // In reach, but the only token is taken by the other guard's swing.
    const b = arena([strike], { behaviour, attackTokens: 1 });
    const one = b.guard({ x: 1, y: 0, z: 0 });
    const two = b.guard({ x: -1, y: 0, z: 0 });
    b.look();
    const logs = new Map([
      [one, ends(b.world, one)],
      [two, ends(b.world, two)],
    ]);
    for (let i = 0; i < 8; i++) b.world.step();
    const swinging = [one, two].filter((e) => currentAttack(b.world, e) !== undefined);
    expect(swinging).toHaveLength(1);
    const idle = swinging[0] === one ? two : one;
    expect(must(logs.get(idle))[0]).toEqual(failed);
  });

  it('skips attacks its list names that the table lacks, and fails when it cannot back off', () => {
    const lunge = makeAttack('lunge', { rangeMin: 1.6, rangeMax: 2.8 });
    const behaviour = fighter({ plain: true, press: [{ do: 'strike', gait: 'run', giveUpS: 8 }] });
    const a = arena([lunge], {
      behaviour,
      navigation: { travel: () => 'failure' },
    });
    const g = a.guard({ x: 0.5, y: 0, z: 0 }, { attacks: ['ghost', 'lunge'] });
    a.look();
    const log = ends(a.world, g);
    for (let i = 0; i < 8; i++) a.world.step();
    expect(log[0]).toEqual({ activity: 'press', ok: false });
    expect(input('targetUnreachableS')(viewOf(a.world, g))).toBe(0);
  });

  it('aims straight ahead when it stands on its target, and knows every attack in the table without a list', () => {
    const strike = makeAttack('strike');
    const a = arena([strike]);
    const g = a.guard({ x: 0, y: 0, z: 0 });
    a.world.set(g, ATTACK_COMPONENTS[0], { current: null, readyAt: {} }); // no known-attack list
    a.world.step();
    a.look();
    for (let i = 0; i < 6; i++) a.world.step();
    expect(currentAttack(a.world, g)).toMatchObject({
      attack: 'strike',
      aim: { x: 0, y: 0, z: 1 },
    });
  });
});

describe('spacing (mw-e11.13)', () => {
  it('circles at its preferred range, facing its target, while the tokens are taken', () => {
    const strike = makeAttack('strike', { rangeMax: 1.8 });
    const a = arena([strike], { attackTokens: 1 });
    const first = a.guard({ x: 1, y: 0, z: 0 });
    a.world.step();
    for (let i = 0; i < 8; i++) {
      a.look();
      a.world.step();
    }
    expect(currentAttack(a.world, first)).toBeDefined();
    const second = a.guard({ x: -4, y: 0, z: 0 });
    a.look();
    a.world.step();
    const trail: Vec3[] = [];
    for (let i = 0; i < 20; i++) {
      a.look();
      a.world.step();
      trail.push({ ...place(a.world, second) });
    }
    expect(brain(a.world, second).activity).toBe('circle');
    const end = place(a.world, second);
    // It moved around the target, toward 2.5 m from it, not into it.
    expect(flat(end, { x: -4, y: 0, z: 0 })).toBeGreaterThan(0.3);
    expect(flat(end, place(a.world, a.foe))).toBeGreaterThan(2.4);
    const facing = must(a.world.get(second, CombatFacingComponent)).facing;
    const toward = { x: -end.x, z: -end.z };
    const length = Math.sqrt(toward.x ** 2 + toward.z ** 2);
    expect(facing.x * (toward.x / length) + facing.z * (toward.z / length)).toBeGreaterThan(0.99);
  });

  it('a circle step ends at its spot or after its seconds, and fails without a target or placement', () => {
    const circling = (seconds: number) =>
      fighter({
        plain: true,
        press: [{ do: 'circle', range: { tuning: 'preferredRange' }, seconds }],
      });
    const run = (seconds: number, at: Vec3, setup: (a: Arena, g: EntityId) => void) => {
      const a = arena([], { behaviour: circling(seconds) });
      const g = a.guard(at);
      setup(a, g);
      const log = ends(a.world, g);
      return { a, g, log };
    };
    const steps = (r: { a: Arena }, n: number) => {
      for (let i = 0; i < n; i++) {
        r.a.look();
        r.a.world.step();
      }
    };
    // At its preferred range: it strafes an eighth of a turn round and arrives, still 2.5 m out.
    const round = run(5, { x: 2.5, y: 0, z: 0 }, (a) => {
      a.look();
    });
    steps(round, 90);
    expect(round.log[0]).toEqual({ activity: 'press', ok: true });
    expect(flat(place(round.a.world, round.g), { x: 0, y: 0, z: 0 })).toBeCloseTo(2.5, 0);
    expect(place(round.a.world, round.g).z).not.toBe(0);
    // Out of time before it gets there.
    const slow = run(0.2, { x: 9, y: 0, z: 0 }, (a) => {
      a.look();
    });
    steps(slow, 20);
    expect(slow.log[0]).toEqual({ activity: 'press', ok: true });
    // No target memory: no spot.
    const blind = run(2, { x: 3, y: 0, z: 0 }, () => undefined);
    for (let i = 0; i < 8; i++) blind.a.world.step();
    expect(blind.log[0]).toEqual({ activity: 'press', ok: false });
    // Right on top of its target it strafes out along +x, turned an eighth.
    const onTop = run(2, { x: 0, y: 0, z: 0 }, (a) => {
      a.look();
    });
    steps(onTop, 150);
    expect(flat(place(onTop.a.world, onTop.g), { x: 0, y: 0, z: 0 })).toBeGreaterThan(2);
    // Without a placement there is nowhere to strafe from.
    const lost = run(2, { x: 3, y: 0, z: 0 }, (a, g) => {
      a.look();
      a.world.remove(g, PlacementComponent);
    });
    for (let i = 0; i < 8; i++) lost.a.world.step();
    expect(lost.log[0]).toEqual({ activity: 'press', ok: false });
  });

  it('targetDistance reads metres to where it believes its target is', () => {
    const a = arena([], { foeAt: { x: 3, y: 0, z: 4 } });
    const g = a.guard({ x: 0, y: 0, z: 0 });
    a.world.step();
    expect(input('targetDistance')(viewOf(a.world, g))).toBe(NO_TARGET_DISTANCE);
    a.look();
    expect(input('targetDistance')(viewOf(a.world, g))).toBeCloseTo(5);
    a.world.remove(g, PlacementComponent);
    a.world.step();
    expect(input('targetDistance')(viewOf(a.world, g))).toBe(NO_TARGET_DISTANCE);
  });
});

describe('out of reach (mw-e11.13)', () => {
  /** A guard on the floor of room B; the player on top of the 5 m pillar (two-rooms navmesh). */
  function ledge(seed = 1) {
    const mesh = twoRooms();
    const nav = navmeshNavigation({ mesh, doors: () => 'open' });
    const requests: number[] = [];
    const submit = nav.queue.submit.bind(nav.queue);
    const box: { world?: World<never> } = {};
    nav.queue.submit = (request) => {
      requests.push(must(box.world).tick);
      return submit(request);
    };
    const strike = makeAttack('strike', { rangeMax: 1.8 });
    const a = arena([strike], { navigation: nav, foeAt: ON_PILLAR, seed });
    box.world = a.world;
    const g = a.guard(IN_B);
    a.world.step();
    return { a, g, requests };
  }

  it('AC-3: a melee guard below a player on an unreachable ledge walks to the closest point, waits, and after 8 s taunts instead of jittering (≤ 1 path request a second)', () => {
    const { a, g, requests } = ledge();
    const activities: (string | null)[] = [];
    const trail: Vec3[] = [];
    for (let tick = 0; tick < 14 * 60; tick++) {
      a.look();
      a.world.step();
      activities.push(brain(a.world, g).activity);
      trail.push({ ...place(a.world, g) });
    }
    const at = (s: number) => must(trail[Math.round(s * 60) - 1]);
    // It went to the foot of the pillar (the closest reachable point) and stood there.
    expect(flat(at(4), ON_PILLAR)).toBeLessThan(2);
    expect(flat(at(4), at(7.9))).toBeLessThan(0.01);
    expect(flat(at(7.9), at(14))).toBeLessThan(0.01);
    // Pressing until 8 s after it got there… then taunting, and only taunting (no oscillation).
    expect(activities.slice(0, 60 * 8)).not.toContain('taunt');
    const first = activities.indexOf('taunt');
    expect(first).toBeGreaterThan(0);
    expect(first / 60).toBeLessThan(12);
    expect(activities.slice(first).every((x) => x === 'taunt' || x === null)).toBe(true);
    expect(input('targetUnreachableS')(viewOf(a.world, g))).toBeGreaterThan(8);
    // Path requests: never two in one second.
    for (let i = 1; i < requests.length; i++) {
      expect(must(requests[i]) - must(requests[i - 1])).toBeGreaterThanOrEqual(60);
    }
    expect(requests.length).toBeLessThanOrEqual(14);
    expect(currentAttack(a.world, g)).toBeUndefined();
  });

  it('AC-3: a player pacing the ledge costs at most one path request a second; stepping down makes the clock read 0 and it presses again', () => {
    const { a, g, requests } = ledge();
    for (let tick = 0; tick < 6 * 60; tick++) {
      if (tick % 10 === 0) {
        const x = Math.floor(tick / 10) % 2 === 0 ? 10.2 : 10.8;
        a.world.set(a.foe, PlacementComponent, { x, y: 5, z: 3, radius: 0.35 });
      }
      a.look();
      a.world.step();
    }
    for (let i = 1; i < requests.length; i++) {
      expect(must(requests[i]) - must(requests[i - 1])).toBeGreaterThanOrEqual(60);
    }
    expect(input('targetUnreachableS')(viewOf(a.world, g))).toBeGreaterThan(0);
    // The player drops to the floor more than UNREACHABLE_MOVE_M away: worth trying again.
    a.world.set(a.foe, PlacementComponent, { x: 12, y: 0, z: 4, radius: 0.35 });
    a.look();
    expect(UNREACHABLE_MOVE_M).toBe(1);
    expect(input('targetUnreachableS')(viewOf(a.world, g))).toBe(0);
    for (let tick = 0; tick < 4 * 60 && currentAttack(a.world, g) === undefined; tick++) {
      a.look();
      a.world.step();
    }
    expect(currentAttack(a.world, g)?.attack).toBe('strike');
    expect(input('targetUnreachableS')(viewOf(a.world, g))).toBe(0);
  });

  it('without an approach the travel port stands in: its failure means out of reach', () => {
    const calls: string[] = [];
    const stuck: AiNavigation = {
      travel: () => {
        calls.push('travel');
        return 'failure';
      },
    };
    const world = new World<never>({ seed: 1 });
    const request = { goal: { x: 1, y: 0, z: 0 }, within: 0.5, speed: 1, dt: 1 / 60 };
    expect(approach(stuck, world, 1, request)).toBe('unreachable');
    expect(approach({ travel: () => 'running' }, world, 1, request)).toBe('running');
    expect(approach({ ...stuck, approach: () => 'success' }, world, 1, request)).toBe('success');
    expect(calls).toEqual(['travel']);
  });

  it('gives up after giveUpS and fails when it cannot move at all', () => {
    const strike = makeAttack('strike', { rangeMax: 1.8 });
    const press = [{ do: 'strike', gait: 'run', giveUpS: 1 }];
    // A rooted guard 5 m off: straight-line travel fails, so it waits where it stands, then gives up.
    const a = arena([strike], { behaviour: fighter({ press }) });
    const g = a.guard({ x: 5, y: 0, z: 0 }, { gaits: { sneak: 0, walk: 0, run: 0 } });
    a.world.step();
    for (let i = 0; i < 50; i++) {
      a.look();
      a.world.step();
    }
    expect(brain(a.world, g).ended).toBeNull();
    expect(input('targetUnreachableS')(viewOf(a.world, g))).toBeGreaterThan(0.5);
    for (let i = 0; i < 20; i++) {
      a.look();
      a.world.step();
    }
    expect(brain(a.world, g).retry.map(([name]) => name)).toContain('press');
    // A port that cannot move it at all.
    const frozen = arena([strike], {
      behaviour: fighter({ press }),
      navigation: { travel: () => 'failure', approach: () => 'failure' },
    });
    const f = frozen.guard({ x: 5, y: 0, z: 0 });
    frozen.world.step();
    for (let i = 0; i < 7; i++) {
      frozen.look();
      frozen.world.step();
    }
    expect(brain(frozen.world, f).ended).toEqual({ activity: 'press', ok: false });
  });

  it('an arrival that leaves its target out of reach (a straight line under a ledge) counts as out of reach', () => {
    const strike = makeAttack('strike', { rangeMax: 1.8 });
    const a = arena([strike], { foeAt: { x: 0, y: 4, z: 0 } });
    const g = a.guard({ x: 3, y: 0, z: 0 });
    a.world.step();
    for (let i = 0; i < 120; i++) {
      a.look();
      a.world.step();
    }
    expect(flat(place(a.world, g), { x: 0, y: 0, z: 0 })).toBeLessThan(1.7);
    expect(input('targetUnreachableS')(viewOf(a.world, g))).toBeGreaterThan(0);
    expect(currentAttack(a.world, g)).toBeUndefined();
  });
});

describe('the stagger response (mw-e11.13)', () => {
  it('AC-5: a guard staggered mid-swing does nothing until the stagger ends, then chooses its attack afresh instead of resuming the cancelled one', () => {
    const near = makeAttack('near', { rangeMax: 1.5, cooldownMs: 0 }, [30, 4, 10]);
    const far = makeAttack('far', { rangeMin: 2, rangeMax: 3, cooldownMs: 0 }, [30, 4, 10]);
    const a = arena([near, far]);
    a.world.register(HitReactionComponent);
    const g = a.guard({ x: 1, y: 0, z: 0 }, { gaits: { sneak: 0, walk: 0, run: 0 } });
    a.world.step();
    giveHitReactions(a.world, g);
    a.world.step();
    for (let i = 0; i < 10 && currentAttack(a.world, g) === undefined; i++) {
      a.look();
      a.world.step();
    }
    expect(currentAttack(a.world, g)?.attack).toBe('near'); // winding up
    // A hit breaks its poise: the executor cancels the swing, the reaction staggers it for 45 ticks.
    const reactions = must(a.world.get(g, HitReactionComponent));
    a.world.set(g, HitReactionComponent, {
      ...reactions,
      current: {
        kind: 'stagger',
        direction: 'front',
        startedAt: a.world.tick,
        endsAt: a.world.tick + 46,
        interrupted: true,
      },
    });
    cancelAttack(a.world, g, 'staggered');
    expect(isStaggered(a.world, g)).toBe(true);
    // Meanwhile its target steps back out of the cancelled attack's reach.
    a.world.set(a.foe, PlacementComponent, { x: -1.5, y: 0, z: 0, radius: 0.35 });
    const during: (string | null)[] = [];
    for (let i = 0; i < 45; i++) {
      a.look();
      a.world.step();
      during.push(brain(a.world, g).activity);
      expect(currentAttack(a.world, g)).toBeUndefined();
    }
    expect(during.every((x) => x === null)).toBe(true);
    for (let i = 0; i < 12 && currentAttack(a.world, g) === undefined; i++) {
      a.look();
      a.world.step();
    }
    expect(isStaggered(a.world, g)).toBe(false);
    expect(brain(a.world, g).activity).toBe('press');
    expect(currentAttack(a.world, g)?.attack).toBe('far'); // chosen for where the target is now
  });

  it('a locked action timeline staggers it; a flinch does not', () => {
    const world = new World<never>({ seed: 1 });
    world.register(ActionTimelineComponent, HitReactionComponent);
    const e = world.spawn();
    world.step();
    expect(isStaggered(world, e)).toBe(false); // no timeline, no reactions
    giveActionTimeline(world, e);
    giveHitReactions(world, e);
    world.step();
    expect(isStaggered(world, e)).toBe(false);
    const timeline = must(world.get(e, ActionTimelineComponent));
    world.set(e, ActionTimelineComponent, { ...timeline, lockTicks: 5 });
    expect(isStaggered(world, e)).toBe(true);
    world.set(e, ActionTimelineComponent, timeline);
    const reactions = must(world.get(e, HitReactionComponent));
    const reaction = (kind: 'flinch' | 'knockdown', endsAt: number) => ({
      ...reactions,
      current: { kind, direction: 'front' as const, startedAt: 0, endsAt, interrupted: true },
    });
    world.set(e, HitReactionComponent, reaction('flinch', world.tick + 10));
    expect(isStaggered(world, e)).toBe(false);
    world.set(e, HitReactionComponent, reaction('knockdown', world.tick + 10));
    expect(isStaggered(world, e)).toBe(true);
    world.set(e, HitReactionComponent, reaction('knockdown', world.tick));
    expect(isStaggered(world, e)).toBe(false); // over
  });
});

describe('sharing targets (mw-e11.13)', () => {
  it('share-target tells the world where it believes its target is; with no memory it says nothing', () => {
    const a = arena([], {
      behaviour: fighter({
        plain: true,
        press: [{ do: 'share-target' }, { do: 'wait', seconds: 1 }],
      }),
    });
    const shares: AiTargetShare[] = [];
    a.world.events.on(AiTargetShared, (e) => shares.push(e));
    const g = a.guard({ x: 2, y: 0, z: 0 });
    a.world.step();
    for (let i = 0; i < 12; i++) a.world.step();
    expect(shares).toEqual([]); // no target memory
    expect(brain(a.world, g).activity).toBe('press');
    a.look();
    for (let i = 0; i < 60; i++) a.world.step();
    expect(shares.length).toBeGreaterThan(0);
    expect(shares[0]).toMatchObject({
      entity: g,
      source: entitySource(a.foe),
      position: { x: 0, y: 0, z: 0 },
    });
    expect(must(shares[0]).confidence).toBeGreaterThan(0.9);
  });
});
