// mw-e11.1 spike tests: the same patrol → hear noise → investigate → return scenario in every
// candidate, determinism (AC-3), save/restore, introspection and load-time validation.
import { describe, expect, it } from 'vitest';
import { btBrain } from './bt/runtime';
import { BT_DEF, CANDIDATES, HYBRID_DEF } from './candidates';
import { hybridBrain } from './hybrid/runtime';
import {
  crowd,
  HZ,
  ScenarioWorld,
  squareRoute,
  ticks,
  type AgentSpec,
  type Brain,
  type Noise,
  type Trait,
} from './shared/world';

const ROUTE = squareRoute({ x: 0, z: 0 });
const NOISE: Noise = { at: { x: 26, z: 4 }, db: 75, tick: ticks(10) };

interface Trace {
  readonly world: ScenarioWorld<unknown>;
  readonly alerts: string[];
  readonly reachedNoise: boolean;
  readonly standDown: number;
  readonly backOnRoute: number;
  readonly activities: string[];
}

function runGuard(
  brain: Brain<unknown>,
  spec: Partial<AgentSpec> & { traits?: Partial<Record<Trait, number>> } = {},
  seconds = 45,
): Trace {
  const world = new ScenarioWorld(brain, {
    seed: 1,
    agents: [{ at: { x: 0, z: 0 }, route: ROUTE, ...spec }],
    noises: [NOISE],
  });
  const alerts: string[] = [];
  const activities: string[] = [];
  let reachedNoise = false;
  let standDown = -1;
  let backOnRoute = -1;
  world.run(ticks(seconds), (w) => {
    const a = w.agents[0];
    if (a === undefined) return;
    alerts.push(a.alert);
    if (a.activity !== '' && activities[activities.length - 1] !== a.activity) {
      activities.push(a.activity);
    }
    if (Math.hypot(a.pos.x - NOISE.at.x, a.pos.z - NOISE.at.z) < 0.5) reachedNoise = true;
    if (standDown === -1 && a.alert === 'unaware' && alerts.some((s) => s !== 'unaware')) {
      standDown = w.tick;
    }
    if (standDown !== -1 && backOnRoute === -1 && w.offRoute(a) < 0.5) backOnRoute = w.tick;
  });
  return { world, alerts, reachedNoise, standDown, backOnRoute, activities };
}

const ladder = (w: ScenarioWorld<unknown>): string[] => w.changes.map((c) => `${c.from}>${c.to}`);

describe.each(CANDIDATES)('$label', ({ key, make }) => {
  it('patrols the route before any noise', () => {
    const { world } = runGuard(make(), {}, 9);
    const a = world.agents[0];
    expect(a?.alert).toBe('unaware');
    expect(world.offRoute(a!)).toBeLessThan(0.4);
    expect(a?.waypoint).not.toBe(0); // it has moved on from the first corner
  });

  it('hears the noise, investigates the spot and returns to its patrol', () => {
    const t = runGuard(make());
    expect(t.alerts.slice(0, NOISE.tick)).toEqual(Array(NOISE.tick).fill('unaware'));
    expect(t.reachedNoise).toBe(true);
    expect(t.alerts).toContain('investigating');
    expect(t.standDown).toBeGreaterThan(NOISE.tick);
    expect(t.backOnRoute).toBeGreaterThan(t.standDown);
    expect(t.backOnRoute - NOISE.tick).toBeLessThan(ticks(30));
    // Patrolling again at the end.
    expect(t.world.agents[0]?.activity).toBe('patrol');
    if (key === 'flat') {
      // Finding: flat utility jumps straight to Investigating (no Suspicious step on the ladder).
      expect(ladder(t.world)[0]).toBe('unaware>investigating');
    } else {
      expect(ladder(t.world)).toEqual([
        'unaware>suspicious',
        'suspicious>investigating',
        'investigating>unaware',
      ]);
    }
  });

  it('a low-curiosity guard spends less time investigating (personality as input)', () => {
    const count = (t: Trace) => t.alerts.filter((s) => s === 'investigating').length;
    const curious = runGuard(make(), { traits: { curiosity: 0.5 } });
    const incurious = runGuard(make(), { traits: { curiosity: 0.1 } });
    expect(count(incurious)).toBeLessThan(count(curious));
    expect(incurious.reachedNoise).toBe(key === 'flat' ? false : true);
  });

  it('a sleepy, lax guard naps; a sleepy, diligent one keeps patrolling (needs as input)', () => {
    const lax = runGuard(make(), { sleep: 95, traits: { diligence: 0.2 } }, 3);
    const diligent = runGuard(make(), { sleep: 95, traits: { diligence: 0.95 } }, 3);
    expect(lax.activities).toContain(key === 'bt' ? 'rest' : 'nap');
    expect(lax.world.agents[0]!.needs.sleep).toBeLessThan(95);
    expect(diligent.activities).toEqual(['patrol']);
  });

  it('AC-3: replaying 50 agents for 60 s with the same seed gives identical hash sequences', () => {
    const hashes = (seed: number): string[] => {
      const world = new ScenarioWorld(make(), crowd(50, seed));
      const out: string[] = [];
      world.run(ticks(60), (w) => out.push(w.hash()));
      return out;
    };
    const a = hashes(7);
    const b = hashes(7);
    expect(a).toHaveLength(60 * HZ);
    expect(b).toEqual(a);
    expect(hashes(8)[60 * HZ - 1]).not.toBe(a[60 * HZ - 1]);
  });

  it('saves and restores mid-run without changing the future', () => {
    const straight = new ScenarioWorld(make(), crowd(20, 3));
    straight.run(ticks(40));
    const first = new ScenarioWorld(make(), crowd(20, 3));
    first.run(ticks(20));
    const save = JSON.parse(JSON.stringify(first.save())) as ReturnType<typeof first.save>;
    const resumed = new ScenarioWorld(make(), crowd(20, 3));
    resumed.load(save);
    resumed.run(ticks(20));
    expect(resumed.hash()).toBe(straight.hash());
  });

  it('introspection is plain, serialisable data', () => {
    const t = runGuard(make(), {}, 12);
    const brain = t.world.brain;
    const view = brain.introspect(t.world.agents[0]!, t.world.memories[0]);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(JSON.stringify(view)).toMatch(key === 'bt' ? /"path":\["root"/ : /"scores":\[\{/);
  });
});

describe('alert state machine guarantees', () => {
  it('the hybrid only ever takes transitions its table lists (50 agents, 60 s)', () => {
    const allowed = new Set<string>();
    for (const [from, s] of Object.entries(HYBRID_DEF.states)) {
      for (const t of s.transitions ?? []) allowed.add(`${from}>${t.to}`);
      if (s.onTimeout !== undefined) allowed.add(`${from}>${s.onTimeout}`);
    }
    const world = new ScenarioWorld(hybridBrain(HYBRID_DEF) as Brain<unknown>, crowd(50, 11));
    world.run(ticks(60));
    expect(world.changes.length).toBeGreaterThan(20);
    for (const edge of ladder(world)) expect(allowed).toContain(edge);
  });
});

describe('load-time validation names the behaviour and the bad reference', () => {
  it('behaviour tree', () => {
    const bad = {
      ...BT_DEF,
      root: { type: 'condition' as const, test: { input: 'trait.wanderlust', gte: 1 } },
    };
    expect(() => btBrain(bad)).toThrow(
      'behaviour "fixture-guard" node 0: unknown input "trait.wanderlust"',
    );
  });

  it('hybrid', () => {
    const bad = {
      ...HYBRID_DEF,
      activities: {
        ...HYBRID_DEF.activities,
        patrol: {
          considerations: [{ input: 'mood', curve: { kind: 'power' as const, exponent: 2 } }],
          steps: [{ do: 'follow-route' as const }],
        },
      },
    };
    expect(() => hybridBrain(bad)).toThrow(
      'behaviour "fixture-guard" activity "patrol": unknown input "mood"',
    );
  });
});
