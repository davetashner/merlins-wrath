// The scenario world every prototype runs (mw-e11.1 spike). Everything that is NOT the decision
// architecture lives here and is shared byte-for-byte by every candidate: agents, patrol routes, the
// noise schedule, hearing → awareness (a stand-in for e11.5/e11.6), the action primitives (move-to,
// look-toward, look-around, follow-route, rest…) and state hashing. A prototype only supplies a
// `Brain`: what to do next (think, at the think rate) given the agent's inputs.
//
// Determinism: time is the tick counter, randomness comes from `Rng` streams derived from the scenario
// seed (src/sim/rng.ts), transcendental maths uses src/sim/math.ts, and every piece of agent and brain
// state is plain data, so it is hashed with the sim's canonical encoder (src/sim/snapshot.ts).

import { cos, log, sin } from '@sim/math';
import { Rng, type RngState } from '@sim/rng';
import { encodeCanonical, xxHash32 } from '@sim/snapshot';

export const HZ = 60;
export const ticks = (seconds: number): number => Math.round(seconds * HZ);

export interface Vec2 {
  x: number;
  z: number;
}

export const TRAITS = [
  'bravery',
  'curiosity',
  'aggression',
  'diligence',
  'sociability',
  'greed',
] as const;
export type Trait = (typeof TRAITS)[number];

export const ALERT_STATES = [
  'unaware',
  'suspicious',
  'investigating',
  'searching',
  'alerted',
  'combat',
] as const;
export type AlertState = (typeof ALERT_STATES)[number];

export type Status = 'running' | 'success' | 'failure';

/** A primitive as data: what a BT leaf or a utility activity step says to do. */
export type PrimitiveSpec =
  | { readonly do: 'follow-route' }
  | { readonly do: 'move-to'; readonly target: 'stimulus' | 'nearest-waypoint' }
  | { readonly do: 'look-toward'; readonly target: 'stimulus'; readonly seconds: number }
  | { readonly do: 'look-around'; readonly seconds: number }
  | { readonly do: 'rest'; readonly seconds: number }
  | { readonly do: 'wait'; readonly seconds: number }
  | { readonly do: 'clear-stimulus' }
  | { readonly do: 'set-alert'; readonly state: AlertState };

/** The running primitive: plain data, part of the hashed state. */
export interface PrimitiveRun {
  kind: PrimitiveSpec['do'];
  ticksLeft: number;
  target: Vec2 | null;
  /** Result once it finished, until the brain consumes it; null while running. */
  done: Status | null;
}

/** One agent. Plain data only (hashed every tick in determinism tests). */
export interface Agent {
  readonly id: number;
  pos: Vec2;
  /** Unit facing on the ground plane. */
  facing: Vec2;
  readonly route: readonly Vec2[];
  waypoint: number;
  dwellLeft: number;
  readonly traits: Readonly<Record<Trait, number>>;
  /** Need id → 0–100 (e12.12 scale). */
  needs: { sleep: number };
  /** 0–1 (stand-in for e11.6 awareness of the strongest source). */
  awareness: number;
  stimulus: { at: Vec2; tick: number } | null;
  alert: AlertState;
  alertSince: number;
  prim: PrimitiveRun | null;
  /** Which activity / BT leaf is running, for introspection and switch counting. */
  activity: string;
  switches: number;
}

export interface Noise {
  readonly at: Vec2;
  /** Loudness at 1 m, dB. */
  readonly db: number;
  readonly tick: number;
}

/** What hearing uses: the humanoid baseline sense profile (src/content/data/sense/humanoid.json). */
export const HEARING = { thresholdDb: 30, range: 25 } as const;
export const WALK = 1.6 / HZ; // m per tick
export const RUN = 3.2 / HZ;
const TURN = (Math.PI * 1.5) / HZ; // rad per tick
const AWARENESS_DECAY = 0.04 / HZ;
const SLEEP_PER_TICK = 1 / (60 * HZ); // 1 per sim minute (fixture-guard ratePerMinute)
const REST_PER_TICK = 5 / HZ; // 5 per second while resting
const ARRIVE = 0.35;
const DWELL = ticks(2);
const DB_PER_LN = 20 / Math.LN10;

const clean = (n: number): number => n + 0;
const dist2 = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const distance = (a: Vec2, b: Vec2): number => Math.sqrt(dist2(a, b));

/** The brain contract: one per architecture. */
export interface Brain<M> {
  readonly name: string;
  readonly thinkHz: number;
  /** Fresh per-agent decision memory (plain data). */
  init(agent: Agent): M;
  /** Decide (at the think rate). May start a primitive via `world.start`. */
  think(world: ScenarioWorld<M>, agent: Agent, memory: M): void;
  /** Serialisable view of the current decision: node path or score table. */
  introspect(agent: Agent, memory: M): unknown;
}

export interface AgentSpec {
  readonly at: Vec2;
  readonly route: readonly Vec2[];
  readonly traits?: Partial<Record<Trait, number>>;
  readonly sleep?: number;
}

export interface ScenarioOptions {
  readonly seed: number;
  readonly agents: readonly AgentSpec[];
  /** Scripted noises; when absent and `randomNoise` is set, noises come from the seeded schedule. */
  readonly noises?: readonly Noise[];
  /** Random noise schedule: one noise every 4–10 s, 45–75 dB, inside `bounds`. */
  readonly randomNoise?: { readonly min: Vec2; readonly max: Vec2 };
}

export interface WorldSave<M> {
  readonly tick: number;
  readonly agents: readonly Agent[];
  readonly memories: readonly M[];
  readonly rng: Readonly<Record<string, RngState>>;
  readonly nextNoise: number;
}

/** Transitions observed (state machine audit trail). */
export interface AlertChange {
  readonly agent: number;
  readonly tick: number;
  readonly from: AlertState;
  readonly to: AlertState;
}

export class ScenarioWorld<M> {
  tick = 0;
  readonly agents: Agent[];
  readonly memories: M[];
  readonly changes: AlertChange[] = [];
  readonly brain: Brain<M>;
  private noiseRng: Rng;
  private agentRng: Rng[];
  private readonly scripted: readonly Noise[];
  private readonly randomNoise: ScenarioOptions['randomNoise'];
  private nextNoise: number;
  private readonly thinkEvery: number;
  /** Per-tick timing hooks (benchmark harness only; never read by the sim). */
  perceptionTicks = 0;

  constructor(brain: Brain<M>, options: ScenarioOptions) {
    this.brain = brain;
    const root = Rng.create(options.seed);
    this.noiseRng = root.stream('noise');
    this.scripted = options.noises ?? [];
    this.randomNoise = options.randomNoise;
    this.nextNoise = this.randomNoise === undefined ? -1 : this.noiseRng.int(ticks(1), ticks(4));
    this.thinkEvery = Math.max(1, Math.round(HZ / brain.thinkHz));
    this.agents = options.agents.map((spec, i) => {
      const id = i + 1;
      const traits = Object.fromEntries(TRAITS.map((t) => [t, spec.traits?.[t] ?? 0.5])) as Record<
        Trait,
        number
      >;
      return {
        id,
        pos: { ...spec.at },
        facing: { x: 0, z: 1 },
        route: spec.route.map((p) => ({ ...p })),
        waypoint: 0,
        dwellLeft: 0,
        traits,
        needs: { sleep: spec.sleep ?? 0 },
        awareness: 0,
        stimulus: null,
        alert: 'unaware',
        alertSince: 0,
        prim: null,
        activity: '',
        switches: 0,
      };
    });
    this.agentRng = this.agents.map((a) => root.stream(`ai:${String(a.id)}`));
    this.memories = this.agents.map((a) => brain.init(a));
  }

  /** The agent's own seeded stream (look-around directions etc.). */
  rng(agent: Agent): Rng {
    return this.agentRng[agent.id - 1] as Rng;
  }

  /** One fixed step: perception, then think (staggered by id), then act. */
  step(timing?: { perception: number; decision: number; now: () => number }): void {
    const t0 = timing?.now() ?? 0;
    this.perceive();
    const t1 = timing?.now() ?? 0;
    for (let i = 0; i < this.agents.length; i++) {
      const agent = this.agents[i] as Agent;
      agent.needs.sleep = Math.min(100, agent.needs.sleep + SLEEP_PER_TICK);
      if ((this.tick + agent.id) % this.thinkEvery === 0) {
        this.brain.think(this, agent, this.memories[i] as M);
      }
      this.act(agent);
    }
    if (timing !== undefined) {
      const t2 = timing.now();
      timing.perception = t1 - t0;
      timing.decision = t2 - t1;
    }
    this.tick += 1;
  }

  run(count: number, onTick?: (world: this) => void): void {
    for (let i = 0; i < count; i++) {
      this.step();
      onTick?.(this);
    }
  }

  // ---------- perception (stand-in for e11.5 hearing + e11.6 awareness) ----------

  private noisesNow(): Noise[] {
    const out = this.scripted.filter((n) => n.tick === this.tick);
    const box = this.randomNoise;
    if (box !== undefined && this.tick === this.nextNoise) {
      const r = this.noiseRng;
      out.push({
        at: {
          x: box.min.x + r.float() * (box.max.x - box.min.x),
          z: box.min.z + r.float() * (box.max.z - box.min.z),
        },
        db: r.int(45, 75),
        tick: this.tick,
      });
      this.nextNoise = this.tick + r.int(ticks(4), ticks(10));
    }
    return out;
  }

  private perceive(): void {
    const noises = this.noisesNow();
    for (const agent of this.agents) {
      agent.awareness = Math.max(0, agent.awareness - AWARENESS_DECAY);
      for (const noise of noises) {
        const d = Math.max(1, distance(agent.pos, noise.at));
        if (d > HEARING.range) continue;
        const heard = noise.db - DB_PER_LN * log(d);
        if (heard < HEARING.thresholdDb) continue;
        const gain = Math.min(1, (heard - HEARING.thresholdDb) / 20);
        if (gain >= agent.awareness * 0.5)
          agent.stimulus = { at: { ...noise.at }, tick: this.tick };
        agent.awareness = Math.min(1, agent.awareness + gain);
      }
    }
  }

  // ---------- alert state (written by brains; the transition log is shared) ----------

  setAlert(agent: Agent, to: AlertState): void {
    if (agent.alert === to) return;
    this.changes.push({ agent: agent.id, tick: this.tick, from: agent.alert, to });
    agent.alert = to;
    agent.alertSince = this.tick;
  }

  // ---------- primitives ----------

  /** Starts `spec` for `agent`, replacing what ran. Instant primitives finish at once. */
  start(agent: Agent, spec: PrimitiveSpec, label: string): Status {
    if (agent.activity !== label) {
      agent.activity = label;
      agent.switches += 1;
    }
    switch (spec.do) {
      case 'clear-stimulus':
        agent.stimulus = null;
        agent.awareness = Math.min(agent.awareness, 0.25);
        agent.prim = null;
        return 'success';
      case 'set-alert':
        this.setAlert(agent, spec.state);
        agent.prim = null;
        return 'success';
      case 'move-to': {
        const target =
          spec.target === 'stimulus' ? (agent.stimulus?.at ?? null) : this.nearestWaypoint(agent);
        if (target === null) {
          agent.prim = null;
          return 'failure';
        }
        if (spec.target === 'nearest-waypoint') agent.waypoint = this.nearestIndex(agent);
        agent.prim = { kind: 'move-to', ticksLeft: 0, target: { ...target }, done: null };
        return 'running';
      }
      case 'look-toward': {
        const at = agent.stimulus?.at ?? null;
        if (at === null) {
          agent.prim = null;
          return 'failure';
        }
        agent.prim = {
          kind: spec.do,
          ticksLeft: ticks(spec.seconds),
          target: { ...at },
          done: null,
        };
        return 'running';
      }
      case 'follow-route':
        agent.prim = { kind: spec.do, ticksLeft: 0, target: null, done: null };
        return 'running';
      case 'look-around':
      case 'rest':
      case 'wait':
        agent.prim = { kind: spec.do, ticksLeft: ticks(spec.seconds), target: null, done: null };
        return 'running';
    }
  }

  /** The finished primitive's result (consumed), 'running', or null when nothing runs. */
  takeResult(agent: Agent): Status | null {
    const prim = agent.prim;
    if (prim === null) return null;
    if (prim.done === null) return 'running';
    agent.prim = null;
    return prim.done;
  }

  /** Stops whatever runs (preempted by a decision). */
  halt(agent: Agent): void {
    agent.prim = null;
  }

  private act(agent: Agent): void {
    const prim = agent.prim;
    if (prim === null || prim.done !== null) return;
    switch (prim.kind) {
      case 'move-to':
        if (this.moveToward(agent, prim.target as Vec2, agent.alert === 'unaware' ? WALK : RUN)) {
          prim.done = 'success';
        }
        return;
      case 'follow-route':
        this.followRoute(agent);
        return;
      case 'look-toward':
        this.turnToward(agent, prim.target as Vec2);
        break;
      case 'look-around':
        if (prim.ticksLeft % ticks(1) === 0) {
          const a = this.rng(agent).float() * Math.PI * 2;
          prim.target = { x: agent.pos.x + cos(a), z: agent.pos.z + sin(a) };
        }
        if (prim.target !== null) this.turnToward(agent, prim.target);
        break;
      case 'rest':
        agent.needs.sleep = Math.max(0, agent.needs.sleep - REST_PER_TICK);
        break;
      default:
        break;
    }
    prim.ticksLeft -= 1;
    if (prim.ticksLeft <= 0) prim.done = 'success';
  }

  private moveToward(agent: Agent, target: Vec2, speed: number): boolean {
    const dx = target.x - agent.pos.x;
    const dz = target.z - agent.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= ARRIVE) return true;
    const s = Math.min(speed, d);
    agent.pos = { x: clean(agent.pos.x + (dx / d) * s), z: clean(agent.pos.z + (dz / d) * s) };
    agent.facing = { x: clean(dx / d), z: clean(dz / d) };
    return false;
  }

  private turnToward(agent: Agent, target: Vec2): void {
    const dx = target.x - agent.pos.x;
    const dz = target.z - agent.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d === 0) return;
    // Rotate facing toward the target by at most TURN (small-angle blend, no trig in the hot path).
    const fx = agent.facing.x + (dx / d - agent.facing.x) * Math.min(1, TURN);
    const fz = agent.facing.z + (dz / d - agent.facing.z) * Math.min(1, TURN);
    const f = Math.sqrt(fx * fx + fz * fz) || 1;
    agent.facing = { x: clean(fx / f), z: clean(fz / f) };
  }

  private followRoute(agent: Agent): void {
    if (agent.route.length === 0) return;
    if (agent.dwellLeft > 0) {
      agent.dwellLeft -= 1;
      return;
    }
    const target = agent.route[agent.waypoint] as Vec2;
    if (this.moveToward(agent, target, WALK)) {
      agent.waypoint = (agent.waypoint + 1) % agent.route.length;
      agent.dwellLeft = DWELL;
    }
  }

  nearestIndex(agent: Agent): number {
    let best = 0;
    let bestD = Infinity;
    agent.route.forEach((p, i) => {
      const d = dist2(agent.pos, p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  nearestWaypoint(agent: Agent): Vec2 | null {
    return agent.route.length === 0 ? null : (agent.route[this.nearestIndex(agent)] as Vec2);
  }

  /** Metres to the nearest route waypoint (0 without a route). */
  offRoute(agent: Agent): number {
    const p = this.nearestWaypoint(agent);
    if (p === null) return 0;
    // Distance to the route polyline would be nicer; waypoints are 8 m apart, so use the segment.
    let best = Infinity;
    const n = agent.route.length;
    for (let i = 0; i < n; i++) {
      const a = agent.route[i] as Vec2;
      const b = agent.route[(i + 1) % n] as Vec2;
      best = Math.min(best, segmentDistance(agent.pos, a, b));
    }
    return best;
  }

  // ---------- state ----------

  /** Everything that defines the future, as plain data (a save). */
  save(): WorldSave<M> {
    return structuredClone({
      tick: this.tick,
      agents: this.agents,
      memories: this.memories,
      rng: Object.fromEntries([
        ['noise', this.noiseRng.serialize()],
        ...this.agents.map((a) => [`ai:${String(a.id)}`, this.rng(a).serialize()] as const),
      ]),
      nextNoise: this.nextNoise,
    });
  }

  /** Replaces this world's state with `save` (same brain and options). */
  load(save: WorldSave<M>): void {
    const copy = structuredClone(save);
    this.tick = copy.tick;
    this.agents.splice(0, this.agents.length, ...copy.agents);
    this.memories.splice(0, this.memories.length, ...copy.memories);
    this.noiseRng = Rng.restore(copy.rng['noise'] as RngState);
    this.agentRng = this.agents.map((a) => Rng.restore(copy.rng[`ai:${String(a.id)}`] as RngState));
    this.nextNoise = copy.nextNoise;
  }

  /** State hash: xxHash32 of the canonical encoding of the save (src/sim/snapshot.ts). */
  hash(): string {
    return xxHash32(encodeCanonical(this.save())).toString(16).padStart(8, '0');
  }
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
  return distance(p, { x: a.x + abx * t, z: a.z + abz * t });
}

/** A square patrol loop of side `side` m with its corner at `at`. */
export function squareRoute(at: Vec2, side = 8): Vec2[] {
  return [
    { x: at.x, z: at.z },
    { x: at.x + side, z: at.z },
    { x: at.x + side, z: at.z + side },
    { x: at.x, z: at.z + side },
  ];
}

/** The benchmark crowd: `count` guards on a 10-wide grid, 12 m apart, random noises over the area. */
export function crowd(count: number, seed: number): ScenarioOptions {
  const layout = Rng.create(seed).stream('layout');
  const agents: AgentSpec[] = [];
  for (let i = 0; i < count; i++) {
    const at = { x: (i % 10) * 12, z: Math.floor(i / 10) * 12 };
    agents.push({
      at,
      route: squareRoute(at),
      traits: { curiosity: layout.float(), diligence: layout.float() },
      sleep: layout.int(0, 95),
    });
  }
  const rows = Math.ceil(count / 10);
  return {
    seed,
    agents,
    randomNoise: { min: { x: -4, z: -4 }, max: { x: 120, z: rows * 12 + 4 } },
  };
}
