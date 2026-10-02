// Candidate B: hierarchical state machine for the alert states + utility selection inside each state
// (mw-e11.1 spike). Also runs candidate C (flat utility) — a definition with a single state.
//
// Top layer (HFSM): states with data transitions (`when` = input thresholds or an activity finishing),
// a timeout and its fallback state. The machine takes at most one transition per think, and only the
// transitions the current state lists, so the transition table is the whole truth (e11.7 AC-6).
//
// Inner layer (utility): each state lists the activities it may run. An activity's score is
// weight × Π curve(input) over its considerations; the best wins, the running activity gets an inertia
// bonus, ties go to the earlier-listed one. An activity is a short list of primitive steps run in
// order; when the last step succeeds the activity is "done" (an event a transition can wait for),
// when one fails it is "failed". `interruptible: false` keeps it until it ends.

import { resolveInput, type InputFn } from '../shared/inputs';
import {
  ALERT_STATES,
  HZ,
  type Agent,
  type AlertState,
  type Brain,
  type PrimitiveSpec,
  type ScenarioWorld,
} from '../shared/world';

/** Response curves map an input to 0–1 (output clamped). */
export type CurveDef =
  | { readonly kind: 'linear'; readonly slope: number; readonly intercept: number }
  | { readonly kind: 'step'; readonly at: number; readonly below: number; readonly above: number }
  | { readonly kind: 'power'; readonly exponent: number };

export interface ConsiderationDef {
  readonly input: string;
  readonly curve: CurveDef;
}

export interface ActivityDef {
  readonly weight?: number;
  readonly interruptible?: boolean;
  readonly considerations: readonly ConsiderationDef[];
  readonly steps: readonly PrimitiveSpec[];
}

export type WhenDef =
  | { readonly input: string; readonly gte?: number; readonly lt?: number }
  | { readonly done: string }
  | { readonly failed: string };

export interface TransitionDef {
  readonly to: AlertState;
  readonly when: WhenDef;
}

export interface StateDef {
  readonly timeoutS?: number;
  readonly onTimeout?: AlertState;
  readonly transitions?: readonly TransitionDef[];
  readonly activities: readonly string[];
}

export interface HybridDef {
  readonly id: string;
  readonly thinkHz: number;
  /** Bonus added to the running activity's score (hysteresis). */
  readonly inertia: number;
  readonly initial: AlertState;
  readonly states: Partial<Readonly<Record<AlertState, StateDef>>>;
  readonly activities: Readonly<Record<string, ActivityDef>>;
}

export interface HybridMemory {
  /** Machine state. Equals the agent's alert label unless activities relabel it (flat utility). */
  state: AlertState;
  /** Index into the definition's activity list, -1 = none. */
  activity: number;
  step: number;
  /** Last finished activity and how: plain data for the `done`/`failed` conditions. */
  ended: { activity: number; ok: boolean } | null;
  /** Top scores of the last think, [activity index, score] (introspection; part of the state). */
  top: [number, number][];
}

type Curve = (x: number) => number;

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

function compileCurve(c: CurveDef): Curve {
  switch (c.kind) {
    case 'linear':
      return (x) => clamp01(c.slope * x + c.intercept);
    case 'step':
      return (x) => (x >= c.at ? c.above : c.below);
    case 'power': {
      if (!Number.isInteger(c.exponent) || c.exponent < 1) throw new Error('power: integer ≥ 1');
      const k = c.exponent;
      return (x) => {
        const v = clamp01(x);
        let r = v;
        for (let i = 1; i < k; i++) r *= v;
        return r;
      };
    }
  }
}

interface Activity {
  readonly name: string;
  readonly weight: number;
  readonly interruptible: boolean;
  readonly inputs: readonly InputFn[];
  readonly curves: readonly Curve[];
  readonly steps: readonly PrimitiveSpec[];
}

type When = (world: ScenarioWorld<unknown>, agent: Agent, memory: HybridMemory) => boolean;

interface State {
  readonly timeout: number;
  readonly onTimeout: AlertState | null;
  readonly transitions: readonly { readonly to: AlertState; readonly when: When }[];
  readonly activities: readonly number[];
}

/** Compiles and validates a definition (unknown inputs, states and activities fail with names). */
export function compileHybrid(def: HybridDef) {
  const names = Object.keys(def.activities);
  const indexOf = (name: string, owner: string): number => {
    const i = names.indexOf(name);
    if (i === -1) throw new Error(`${owner}: unknown activity "${name}"`);
    return i;
  };
  const checkState = (s: string, owner: string): AlertState => {
    if (
      !(ALERT_STATES as readonly string[]).includes(s) ||
      def.states[s as AlertState] === undefined
    ) {
      throw new Error(`${owner}: unknown state "${s}"`);
    }
    return s as AlertState;
  };
  const activities: Activity[] = names.map((name) => {
    const a = def.activities[name] as ActivityDef;
    const owner = `behaviour "${def.id}" activity "${name}"`;
    if (a.steps.length === 0) throw new Error(`${owner}: no steps`);
    return {
      name,
      weight: a.weight ?? 1,
      interruptible: a.interruptible ?? true,
      inputs: a.considerations.map((c) => resolveInput(c.input, owner)),
      curves: a.considerations.map((c) => compileCurve(c.curve)),
      steps: a.steps,
    };
  });
  const states = new Map<AlertState, State>();
  for (const [key, s] of Object.entries(def.states) as [AlertState, StateDef][]) {
    const owner = `behaviour "${def.id}" state "${key}"`;
    if (s.activities.length === 0) throw new Error(`${owner}: no activities`);
    if (s.timeoutS !== undefined && !(s.timeoutS > 0)) throw new Error(`${owner}: timeout ≤ 0`);
    states.set(key, {
      timeout: s.timeoutS === undefined ? Infinity : Math.round(s.timeoutS * HZ),
      onTimeout: s.onTimeout === undefined ? null : checkState(s.onTimeout, owner),
      transitions: (s.transitions ?? []).map((t) => {
        const to = checkState(t.to, owner);
        const w = t.when;
        let when: When;
        if ('done' in w) {
          const i = indexOf(w.done, owner);
          when = (_w, _a, m) => m.ended !== null && m.ended.activity === i && m.ended.ok;
        } else if ('failed' in w) {
          const i = indexOf(w.failed, owner);
          when = (_w, _a, m) => m.ended !== null && m.ended.activity === i && !m.ended.ok;
        } else {
          const fn = resolveInput(w.input, owner);
          const { gte, lt } = w;
          when = (wd, a) => {
            const v = fn(wd, a);
            return (gte === undefined || v >= gte) && (lt === undefined || v < lt);
          };
        }
        return { to, when };
      }),
      activities: s.activities.map((n) => indexOf(n, owner)),
    });
  }
  checkState(def.initial, `behaviour "${def.id}"`);
  return { activities, states };
}

export function hybridBrain(def: HybridDef, name = 'hfsm+utility'): Brain<HybridMemory> {
  const { activities, states } = compileHybrid(def);

  const score = (w: ScenarioWorld<unknown>, agent: Agent, a: Activity): number => {
    let s = a.weight;
    for (let i = 0; i < a.inputs.length && s > 0; i++) {
      s *= (a.curves[i] as Curve)((a.inputs[i] as InputFn)(w, agent));
    }
    return s;
  };

  /** Runs steps from `memory.step` until one is running; records the end when the list is over. */
  const advance = (w: ScenarioWorld<unknown>, agent: Agent, memory: HybridMemory): void => {
    const act = activities[memory.activity] as Activity;
    while (memory.step < act.steps.length) {
      const status = w.start(agent, act.steps[memory.step] as PrimitiveSpec, act.name);
      if (status === 'running') return;
      if (status === 'failure') {
        memory.ended = { activity: memory.activity, ok: false };
        memory.activity = -1;
        return;
      }
      memory.step += 1;
    }
    memory.ended = { activity: memory.activity, ok: true };
    memory.activity = -1;
  };

  return {
    name,
    thinkHz: def.thinkHz,
    init: (agent) => {
      agent.alert = def.initial;
      return { state: def.initial, activity: -1, step: 0, ended: null, top: [] };
    },
    think(world, agent, memory) {
      const w = world as ScenarioWorld<unknown>;
      // 1. Collect the running step's result; advance the activity's step list.
      if (memory.activity !== -1) {
        const r = w.takeResult(agent);
        if (r === 'success') {
          memory.step += 1;
          advance(w, agent, memory);
        } else if (r === 'failure' || r === null) {
          memory.ended = { activity: memory.activity, ok: false };
          memory.activity = -1;
        }
      }
      // 2. HFSM: timeout, then the first matching transition (one hop per think).
      const state = states.get(memory.state) as State;
      let next: AlertState | null = null;
      if (w.tick - agent.alertSince >= state.timeout) next = state.onTimeout;
      else {
        for (const t of state.transitions) {
          if (t.when(w, agent, memory)) {
            next = t.to;
            break;
          }
        }
      }
      memory.ended = null;
      if (next !== null && next !== memory.state) {
        memory.state = next;
        w.setAlert(agent, next);
        if (memory.activity !== -1) w.halt(agent);
        memory.activity = -1;
      }
      // 3. Utility: best activity of the (possibly new) state.
      const current = memory.activity;
      if (current !== -1 && !(activities[current] as Activity).interruptible) return;
      const options = (states.get(memory.state) as State).activities;
      let best = -1;
      let bestScore = -1;
      const top: [number, number][] = [];
      for (const i of options) {
        const s = score(w, agent, activities[i] as Activity) + (i === current ? def.inertia : 0);
        top.push([i, s]);
        if (s > bestScore) {
          bestScore = s;
          best = i;
        }
      }
      top.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      memory.top = top.slice(0, 3);
      if (best === current || bestScore <= 0) return;
      if (current !== -1) w.halt(agent);
      memory.activity = best;
      memory.step = 0;
      advance(w, agent, memory);
    },
    introspect(agent, memory) {
      return {
        architecture: name,
        state: memory.state,
        alert: agent.alert,
        activity: memory.activity === -1 ? null : (activities[memory.activity] as Activity).name,
        step: memory.step,
        scores: memory.top.map(([i, s]) => ({
          activity: (activities[i] as Activity).name,
          score: s,
        })),
      };
    },
  };
}
