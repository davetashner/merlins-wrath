// The six-state alert machine (mw-e11.7): escalation on awareness, timed de-escalation (from the
// last stimulus), Combat → Searching with the last-known position, standing down on edge (the
// heightened baseline), unseen damage → Alerted with an estimated last-known position, and a fuzz of
// the transition table. The guard below is the bead's reference table, written tersely with the
// schema's defaults and the built-in alert tuning filled (sim tests may not load content).

import type { BehaviourDef, BehaviourEvent, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { DAMAGE_COMPONENTS, giveCombatant } from '../combat/damage/components';
import { DamageModel } from '../combat/damage/model';
import { CombatFacingComponent } from '../combat/melee/components';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { entitySource, perceived, percept, type PerceptSource } from '../perception/percept';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { fuzzAlertMachine } from '../testing/alert-fuzz';
import { DEFAULT_UNSEEN_ATTACKER_M, installAlertTriggers, isPostAlert } from './alert';
import { awarenessOf, installAwareness } from './awareness';
import { alertMoves, compileBehaviour, compileBehaviours } from './behaviour';
import { AlertStateChanged, type AlertStateChange, type Brain } from './components';
import { introspectBrain } from './introspect';
import { brainOf, giveBrain, installAi, queueAiEvent, writeBlackboard } from './runtime';

type Loose = Readonly<Record<string, unknown>>;

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value');
  return value;
};

const UNSEEN = { event: 'damaged-by-unseen' } as const;
const ALARM = { event: 'ally-alarm' } as const;
const SEES = { input: 'targetVisible', gte: 1 } as const;

const state = (s: Loose) => ({
  transitions: [],
  timeoutFrom: 'entered',
  postAlert: false,
  ...s,
});
const activity = (steps: readonly Loose[], weight = 1) => ({
  weight,
  interruptible: true,
  retryAfterS: 2,
  considerations: [],
  steps: steps.map((s) => (s['do'] === 'move-to' ? { within: 0.5, gait: 'walk', ...s } : s)),
});

/** The reference guard: all six states, tuning = the built-in alert defaults. */
const GUARD = {
  id: 'guard',
  schemaVersion: 1,
  tuning: {
    suspiciousAt: 0.3,
    investigateAt: 0.6,
    suspiciousTimeoutS: 6,
    investigatingTimeoutS: 20,
    searchingTimeoutS: 60,
    alertedTimeoutS: 120,
    combatLostS: 5,
    postAlertS: 300,
    postAlertAwarenessRate: 1.5,
  },
  thinkHz: 10,
  inertia: 0.1,
  initial: 'unaware',
  states: {
    unaware: state({
      transitions: [
        { to: 'suspicious', when: { input: 'awareness', gte: { tuning: 'suspiciousAt' } } },
        { to: 'alerted', when: UNSEEN },
        { to: 'alerted', when: ALARM },
      ],
      activities: ['stand-post'],
    }),
    suspicious: state({
      timeoutS: { tuning: 'suspiciousTimeoutS' },
      timeoutFrom: 'stimulus',
      onTimeout: 'unaware',
      transitions: [
        { to: 'investigating', when: { input: 'awareness', gte: { tuning: 'investigateAt' } } },
        { to: 'combat', when: SEES },
        { to: 'alerted', when: UNSEEN },
        { to: 'alerted', when: ALARM },
      ],
      activities: ['look'],
    }),
    investigating: state({
      timeoutS: { tuning: 'investigatingTimeoutS' },
      onTimeout: 'searching',
      transitions: [
        { to: 'combat', when: SEES },
        { to: 'alerted', when: UNSEEN },
        { to: 'unaware', when: { done: 'investigate' } },
        { to: 'searching', when: { failed: 'investigate' } },
      ],
      activities: ['investigate'],
    }),
    searching: state({
      timeoutS: { tuning: 'searchingTimeoutS' },
      onTimeout: 'unaware',
      postAlert: true,
      transitions: [
        { to: 'combat', when: SEES },
        { to: 'alerted', when: UNSEEN },
        { to: 'alerted', when: ALARM },
      ],
      activities: ['search'],
    }),
    alerted: state({
      timeoutS: { tuning: 'alertedTimeoutS' },
      onTimeout: 'searching',
      transitions: [{ to: 'combat', when: SEES }],
      activities: ['hunt'],
    }),
    combat: state({
      transitions: [
        { to: 'searching', when: { input: 'targetLostS', gte: { tuning: 'combatLostS' } } },
      ],
      activities: ['hold'],
    }),
  },
  activities: {
    'stand-post': activity([{ do: 'wait', seconds: 1 }]),
    look: activity([{ do: 'look-at', target: 'stimulus', seconds: 1 }]),
    investigate: activity([
      { do: 'move-to', target: 'stimulus' },
      { do: 'look-around', seconds: 3 },
      { do: 'forget-stimulus' },
    ]),
    search: activity([
      { do: 'move-to', target: 'lkp' },
      { do: 'look-around', seconds: 5 },
    ]),
    hunt: activity([
      { do: 'move-to', target: 'lkp', gait: 'run' },
      { do: 'look-around', seconds: 3 },
    ]),
    hold: activity([{ do: 'wait', seconds: 1 }]),
  },
} as unknown as Frozen<BehaviourDef>;

const SIX: readonly Brain['state'][] = [
  'unaware',
  'suspicious',
  'investigating',
  'searching',
  'alerted',
  'combat',
];

const PLAYER_AT: Vec3 = { x: 0, y: 0, z: 12 };

/** A world with the guard at the origin, the player 12 m in front, AI and awareness running. */
function setup() {
  const world = new World<never>({ seed: 3, hz: 60 });
  world.register(PlacementComponent, CombatFacingComponent, ...DAMAGE_COMPONENTS);
  installAi(world, { behaviours: compileBehaviours([GUARD]) });
  const guard = world.spawn();
  const player = world.spawn();
  placeEntity(world, guard, { x: 0, y: 0, z: 0 });
  placeEntity(world, player, PLAYER_AT);
  const playerSource = entitySource(player);
  const target = (s: PerceptSource) => (s === playerSource ? player : undefined);
  installAwareness(world, { target });
  giveBrain(world, guard, { behaviour: 'guard', gaits: { sneak: 1, walk: 1, run: 3 } });
  world.step();
  const changes: AlertStateChange[] = [];
  world.events.on(AlertStateChanged, (e) => changes.push(e));
  const brain = () => must(brainOf(world, guard));
  /** Steps `n` ticks. */
  const run = (n: number) => {
    for (let i = 0; i < n; i++) world.step();
  };
  /** One tick in which the guard perceives `percepts` (none = it perceives nothing). */
  const sense = (percepts: Parameters<typeof percept>[0][] = []) => {
    world.events.emit(perceived, {
      tick: world.tick,
      agent: guard,
      seconds: 1 / 60,
      percepts: percepts.map(percept),
    });
    world.step();
  };
  const sight = (source: PerceptSource, position: Vec3) => ({
    source,
    kind: 'seen-target' as const,
    sense: 'sight',
    position,
    strength: 1,
    certainty: 1,
  });
  /** Puts the guard in `to` the way the table would, with the board as given. */
  const force = (to: Brain['state']) => {
    const b = brainOf(world, guard) as Brain;
    b.state = to;
    b.enteredTick = world.tick;
    b.activity = null;
  };
  return { world, guard, player, playerSource, brain, run, sense, sight, changes, force };
}

const moves = (changes: readonly AlertStateChange[]) =>
  changes.map((c) => `${c.from}>${c.to} (${c.cause})`);

describe('the six-state alert machine (mw-e11.7)', () => {
  it('AC-1: an Unaware guard whose awareness crosses 0.3 becomes Suspicious and says why', () => {
    const s = setup();
    writeBlackboard(s.world, s.guard, { awareness: 0.29, stimulus: { x: 1, y: 0, z: 1 } });
    s.run(12);
    expect(s.brain().state).toBe('unaware');
    writeBlackboard(s.world, s.guard, { awareness: 0.3, stimulus: { x: 1, y: 0, z: 1 } });
    s.run(6);
    expect(s.brain().state).toBe('suspicious');
    expect(s.changes).toEqual([
      {
        tick: expect.any(Number) as number,
        entity: s.guard,
        from: 'unaware',
        to: 'suspicious',
        cause: 'input:awareness',
      },
    ]);
  });

  it('AC-2: a Suspicious guard that gets no stimulus for 6 s stands down, not on edge, to its routine', () => {
    const s = setup();
    writeBlackboard(s.world, s.guard, { awareness: 0.35, stimulus: { x: 1, y: 0, z: 1 } });
    s.run(6);
    expect(s.brain().state).toBe('suspicious');
    // A fresh stimulus at 4 s restarts the 6 s.
    s.run(4 * 60);
    writeBlackboard(s.world, s.guard, { awareness: 0.2, stimulus: { x: 2, y: 0, z: 1 } });
    const restarted = s.world.tick;
    s.run(5.5 * 60);
    expect(s.brain().state).toBe('suspicious');
    s.run(0.6 * 60);
    expect(s.brain().state).toBe('unaware');
    const stood = s.changes.at(-1);
    expect(stood).toMatchObject({ from: 'suspicious', to: 'unaware', cause: 'timeout' });
    expect((stood?.tick ?? 0) - restarted).toBeGreaterThanOrEqual(6 * 60);
    expect((stood?.tick ?? 0) - restarted).toBeLessThan(6 * 60 + 6);
    expect(s.brain().postAlertUntil).toBe(-1);
    expect(isPostAlert(s.brain(), s.world.tick)).toBe(false);
    expect(introspectBrain(s.world, s.guard)?.postAlert).toBe(false);
    expect(s.brain().activity).toBe('stand-post'); // back to its routine
  });

  it('AC-3: a guard in Combat whose target is out of perception for 5 s searches its last-known position, never Unaware', () => {
    const s = setup();
    // The player in plain sight: awareness climbs the ladder to Combat.
    let seenAt: Vec3 = PLAYER_AT;
    for (let i = 0; i < 90; i++) {
      seenAt = { x: i * 0.02, y: 0, z: 12 - i * 0.05 };
      s.sense([s.sight(s.playerSource, seenAt)]);
    }
    expect(s.brain().state).toBe('combat');
    expect(s.brain().blackboard.lkp).toEqual(seenAt);
    // Out of sight: it holds Combat for 5 s, then searches.
    const lost = s.world.tick;
    for (let i = 0; i < 4.9 * 60; i++) s.sense();
    expect(s.brain().state).toBe('combat');
    for (let i = 0; i < 0.3 * 60; i++) s.sense();
    expect(s.brain().state).toBe('searching');
    const search = s.changes.at(-1);
    expect(search).toMatchObject({ from: 'combat', to: 'searching', cause: 'input:targetLostS' });
    expect((search?.tick ?? 0) - lost).toBeGreaterThanOrEqual(5 * 60);
    expect(s.brain().blackboard.lkp).toEqual(seenAt);
    expect(moves(s.changes)).toEqual([
      'unaware>suspicious (input:awareness)',
      'suspicious>investigating (input:awareness)',
      'investigating>combat (input:targetVisible)',
      'combat>searching (input:targetLostS)',
    ]);
    expect(s.changes.some((c) => c.from === 'combat' && c.to === 'unaware')).toBe(false);
  });

  it('AC-4: a Searching guard that does not re-acquire in 60 s stands down on edge: awareness ×1.5 for 300 s', () => {
    const s = setup();
    writeBlackboard(s.world, s.guard, { lkp: { x: 3, y: 0, z: 3 } });
    s.force('searching');
    for (let i = 0; i < 59.9 * 60; i++) s.sense();
    expect(s.brain().state).toBe('searching');
    for (let i = 0; i < 0.2 * 60; i++) s.sense();
    expect(s.brain().state).toBe('unaware');
    const stood = s.changes.at(-1);
    expect(stood).toMatchObject({ from: 'searching', to: 'unaware', cause: 'timeout' });
    const since = stood?.tick ?? 0;
    expect(isPostAlert(s.brain(), s.world.tick)).toBe(true);
    expect(s.brain()).toMatchObject({ postAlertUntil: since + 300 * 60, postAlertRate: 1.5 });
    expect(introspectBrain(s.world, s.guard)?.postAlert).toBe(true);

    // On edge, a glimpse builds awareness 1.5 times as fast.
    const rat = entitySource(900);
    s.sense([s.sight(rat, { x: 1, y: 0, z: 5 })]);
    expect(awarenessOf(s.world, s.guard).find((r) => r.source === rat)?.level).toBeCloseTo(
      (1 / 60) * 1.5,
      9,
    );
    // A Suspicious scare that times out does not cut the window short.
    writeBlackboard(s.world, s.guard, { awareness: 0.4, stimulus: { x: 1, y: 0, z: 1 } });
    s.run(6);
    expect(s.brain().state).toBe('suspicious');
    writeBlackboard(s.world, s.guard, { awareness: 0 });
    s.run(6.2 * 60);
    expect(s.brain().state).toBe('unaware');
    expect(s.brain().postAlertUntil).toBe(since + 300 * 60);

    // 300 s after standing down it is calm again, and awareness builds at the normal rate.
    s.run(since + 300 * 60 - s.world.tick - 1);
    expect(isPostAlert(s.brain(), s.world.tick)).toBe(true);
    s.run(12);
    expect(isPostAlert(s.brain(), s.world.tick)).toBe(false);
    expect(s.brain()).toMatchObject({ postAlertUntil: -1, postAlertRate: 1 });
    const moth = entitySource(901);
    s.sense([s.sight(moth, { x: 1, y: 0, z: 5 })]);
    expect(awarenessOf(s.world, s.guard).find((r) => r.source === moth)?.level).toBeCloseTo(
      1 / 60,
      9,
    );
  });

  describe('AC-5: damage from an unperceived source', () => {
    function shot(spec: { instigator?: EntityId; direction?: Vec3; lethal?: boolean } = {}) {
      const s = setup();
      installAlertTriggers(s.world);
      giveCombatant(s.world, s.guard, { health: 50 });
      const shooter = s.world.spawn();
      placeEntity(s.world, shooter, { x: 0, y: 3, z: -20 });
      s.run(1);
      const fire = () => {
        new DamageModel().apply(s.world, s.guard, {
          amounts: { pierce: spec.lethal === true ? 80 : 10 },
          instigator: spec.instigator ?? shooter,
          ...(spec.direction !== undefined && { direction: spec.direction }),
        });
        s.run(6);
      };
      return { ...s, shooter, fire };
    }

    it('AC-5: an Unaware guard hit by an arrow it did not see becomes Alerted (not Combat), its LKP guessed back along the arrow', () => {
      const s = shot({ direction: { x: 0, y: -0.6, z: 0.8 } }); // from behind, plunging
      s.fire();
      expect(s.brain().state).toBe('alerted');
      expect(moves(s.changes)).toEqual(['unaware>alerted (event:damaged-by-unseen)']);
      // Back along the flight, on the level, DEFAULT_UNSEEN_ATTACKER_M away; not the shooter's spot.
      expect(s.brain().blackboard.lkp).toEqual({ x: 0, y: 0, z: -DEFAULT_UNSEEN_ATTACKER_M });
      expect(s.brain().blackboard.lkp).not.toEqual({ x: 0, y: 3, z: -20 });
    });

    it('edge: the estimate distance is configurable; a blow with no level direction leaves the LKP alone', () => {
      const s = setup();
      installAlertTriggers(s.world, { unseenAttackerM: 3 });
      giveCombatant(s.world, s.guard, { health: 50 });
      s.run(1);
      const model = new DamageModel();
      model.apply(s.world, s.guard, { amounts: { blunt: 1 }, direction: { x: 1, y: 0, z: 0 } });
      s.run(1);
      expect(s.brain().blackboard.lkp).toEqual({ x: -3, y: 0, z: 0 });
      model.apply(s.world, s.guard, { amounts: { blunt: 1 }, direction: { x: 0, y: -1, z: 0 } });
      model.apply(s.world, s.guard, { amounts: { blunt: 1 } });
      s.run(6);
      expect(s.brain().blackboard.lkp).toEqual({ x: -3, y: 0, z: 0 });
      expect(s.brain().state).toBe('alerted');
    });

    it('edge: a hit from the target it sees is not unseen; a killing blow and brainless or unplaced targets are ignored', () => {
      const s = shot({ direction: { x: 0, y: 0, z: 1 } });
      writeBlackboard(s.world, s.guard, { target: s.shooter, targetVisible: true });
      s.fire();
      expect(s.brain().events).toEqual([]);
      expect(s.changes).toEqual([]);
      // Visible, but someone else's arrow: unseen.
      const sniper = s.world.spawn();
      writeBlackboard(s.world, s.guard, { target: s.shooter, targetVisible: true });
      new DamageModel().apply(s.world, s.guard, {
        amounts: { pierce: 1 },
        instigator: sniper,
        direction: { x: 0, y: 0, z: 1 },
      });
      s.world.events.flush();
      expect(s.brain().events).toEqual(['damaged-by-unseen']);

      const dead = shot({ lethal: true, direction: { x: 0, y: 0, z: 1 } });
      dead.fire();
      expect(dead.brain().state).toBe('unaware');
      expect(dead.brain().blackboard.lkp).toBeNull();

      const crate = s.world.spawn();
      giveCombatant(s.world, crate, { health: 5 });
      const unplaced = s.world.spawn();
      giveCombatant(s.world, unplaced, { health: 5 });
      giveBrain(s.world, unplaced, { behaviour: 'guard' });
      s.run(1);
      expect(() => {
        new DamageModel().apply(s.world, crate, { amounts: { blunt: 1 } });
        new DamageModel().apply(s.world, unplaced, {
          amounts: { blunt: 1 },
          direction: { x: 1, y: 0, z: 0 },
        });
        s.world.events.flush();
      }).not.toThrow();
      expect(brainOf(s.world, unplaced)?.events).toEqual(['damaged-by-unseen']);
      expect(brainOf(s.world, unplaced)?.blackboard.lkp).toBeNull();
    });
  });

  it('AC-6: 10,000 random event sequences never take a move absent from the table, and the state is always one of the six', () => {
    const report = fuzzAlertMachine(compileBehaviours([GUARD]), 'guard', {
      sequences: 10_000,
      steps: 8,
      seed: 11,
    });
    expect(report.sequences).toBe(10_000);
    expect(report.thinks).toBeGreaterThan(80_000);
    const table = alertMoves(compileBehaviour(GUARD));
    const absent = [...report.taken.keys()].filter((move) => !table.has(move));
    expect(absent).toEqual([]);
    expect([...report.states].every((st) => SIX.includes(st))).toBe(true);
    // Not vacuous: the sequences visited every state and took every move in the table.
    expect(report.states.size).toBe(6);
    expect([...report.taken.keys()].sort()).toEqual([...table].sort());
  });

  it('AC-6: a move absent from the table would be caught (control: the table without its timeouts)', () => {
    const compiled = compileBehaviour(GUARD);
    const report = fuzzAlertMachine(new Map([['guard', compiled]]), 'guard', {
      sequences: 300,
      seed: 2,
      steps: 4,
    });
    const doctored = alertMoves({
      ...compiled,
      states: new Map([...compiled.states].map(([name, st]) => [name, { ...st, onTimeout: null }])),
    });
    expect([...report.taken.keys()].filter((move) => !doctored.has(move))).toContain(
      'searching>unaware',
    );
  });

  it('alertMoves lists every transition and timeout fallback of the table', () => {
    expect([...alertMoves(compileBehaviour(GUARD))].sort()).toEqual(
      [
        'unaware>suspicious',
        'unaware>alerted',
        'suspicious>investigating',
        'suspicious>combat',
        'suspicious>alerted',
        'suspicious>unaware',
        'investigating>combat',
        'investigating>alerted',
        'investigating>unaware',
        'investigating>searching',
        'searching>combat',
        'searching>alerted',
        'searching>unaware',
        'alerted>combat',
        'alerted>searching',
        'combat>searching',
      ].sort(),
    );
  });

  it('an ally alarm raises an Unaware guard to Alerted', () => {
    const s = setup();
    const event: BehaviourEvent = 'ally-alarm';
    queueAiEvent(s.world, s.guard, event);
    s.run(6);
    expect(moves(s.changes)).toEqual(['unaware>alerted (event:ally-alarm)']);
  });
});
