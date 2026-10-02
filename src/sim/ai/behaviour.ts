// Compiling behaviours (mw-e11.2, ADR-0005): a validated behaviour definition (content `behaviour`)
// becomes closures the runtime calls without string work — inputs resolved to accessors, curves to
// functions, tuning references to readers, steps to primitive runners, names to indices. Content
// validation already rejects unknown names; compiling checks them again, because a behaviour can
// also reach the runtime from code (tests, tools), and fails with a BehaviourError naming the
// behaviour and the unknown primitive, input, state, activity or tuning key (ADR-0005 §5, AC-2).

import type {
  AlertState,
  BehaviourConditionDef,
  BehaviourCurveDef,
  BehaviourDef,
  Frozen,
  Tunable,
} from '@content/index';
import { resolveInput, type InputFn } from './inputs';
import { compileStep, isPrimitive, type StepRunner } from './primitives';
import { at } from './util';
import type { AgentView, Num } from './view';

/** Thrown when a behaviour cannot be compiled; the message names the behaviour and the problem. */
export class BehaviourError extends Error {
  override readonly name = 'BehaviourError';
}

/** A response curve as a function (output 0–1). */
export type Curve = (x: number) => number;

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** The function of curve `def` (ADR-0005 §3: outputs clamped to 0–1). */
export function compileCurve(def: Frozen<BehaviourCurveDef>): Curve {
  switch (def.kind) {
    case 'linear':
      return (x) => clamp01(def.slope * x + def.intercept);
    case 'step':
      return (x) => clamp01(x >= def.at ? def.above : def.below);
    case 'power': {
      const k = def.exponent;
      return (x) => {
        const v = clamp01(x);
        let r = v;
        for (let i = 1; i < k; i++) r *= v;
        return r;
      };
    }
  }
}

/** One consideration of an activity. */
export interface CompiledConsideration {
  readonly input: string;
  readonly read: InputFn;
  readonly curve: Curve;
  readonly def: Frozen<BehaviourCurveDef>;
}

export interface CompiledActivity {
  readonly name: string;
  readonly weight: number;
  readonly interruptible: boolean;
  readonly retryAfterS: number;
  readonly considerations: readonly CompiledConsideration[];
  readonly steps: readonly StepRunner[];
}

export interface CompiledTransition {
  readonly to: AlertState;
  /** `input:<name>`, `event:<name>`, `done:<activity>` or `failed:<activity>`. */
  readonly cause: string;
  readonly test: (view: AgentView) => boolean;
}

export interface CompiledState {
  readonly name: AlertState;
  /** Seconds before `onTimeout`, or null for none. */
  readonly timeout: Num | null;
  readonly onTimeout: AlertState | null;
  readonly transitions: readonly CompiledTransition[];
  readonly activities: readonly CompiledActivity[];
}

/** A behaviour ready to run. */
export interface CompiledBehaviour {
  readonly id: string;
  readonly thinkHz: number;
  readonly inertia: number;
  readonly initial: AlertState;
  readonly tuning: Readonly<Record<string, number>>;
  readonly states: ReadonlyMap<AlertState, CompiledState>;
  readonly activities: ReadonlyMap<string, CompiledActivity>;
}

/** Compiled behaviours by id. */
export type BehaviourTable = ReadonlyMap<string, CompiledBehaviour>;

/** Activity `a`'s score for this agent: weight × Π curve(input), stopping at 0. */
export function scoreActivity(a: CompiledActivity, view: AgentView): number {
  let score = a.weight;
  for (let i = 0; i < a.considerations.length && score > 0; i++) {
    const c = at(a.considerations, i);
    score *= c.curve(c.read(view));
  }
  return score;
}

/** Compiles one behaviour (see the file header). */
export function compileBehaviour(def: Frozen<BehaviourDef>): CompiledBehaviour {
  const fail = (where: string, message: string): never => {
    throw new BehaviourError(`behaviour "${def.id}"${where}: ${message}`);
  };
  const num =
    (where: string) =>
    (value: Tunable): Num => {
      if (typeof value === 'number') return () => value;
      const key = value.tuning;
      const fallback = def.tuning[key] ?? fail(where, `unknown tuning key "${key}"`);
      return (v) => v.creature?.tuning[key] ?? fallback;
    };
  const input = (where: string, name: string): InputFn =>
    resolveInput(name) ?? fail(where, `unknown input "${name}"`);

  const activities = new Map<string, CompiledActivity>();
  for (const [name, a] of Object.entries(def.activities)) {
    const where = ` activity "${name}"`;
    activities.set(name, {
      name,
      weight: a.weight,
      interruptible: a.interruptible,
      retryAfterS: a.retryAfterS,
      considerations: a.considerations.map((c) => ({
        input: c.input,
        read: input(where, c.input),
        curve: compileCurve(c.curve),
        def: c.curve,
      })),
      steps: a.steps.map((step, i) =>
        isPrimitive(step.do)
          ? compileStep(step, num(`${where} step ${String(i)}`))
          : fail(`${where} step ${String(i)}`, `unknown primitive "${String(step.do)}"`),
      ),
    });
  }

  const defined = new Set(Object.keys(def.states));
  const state = (where: string, name: string): AlertState =>
    defined.has(name) ? (name as AlertState) : fail(where, `unknown state "${name}"`);
  const activity = (where: string, name: string): CompiledActivity =>
    activities.get(name) ?? fail(where, `unknown activity "${name}"`);

  const condition = (where: string, when: Frozen<BehaviourConditionDef>) => {
    if ('event' in when) {
      const event = when.event;
      return { cause: `event:${event}`, test: (v: AgentView) => v.brain.events.includes(event) };
    }
    if ('done' in when || 'failed' in when) {
      const ok = 'done' in when;
      const name = activity(where, ok ? when.done : when.failed).name;
      return {
        cause: `${ok ? 'done' : 'failed'}:${name}`,
        test: (v: AgentView) => v.brain.ended?.activity === name && v.brain.ended.ok === ok,
      };
    }
    const read = input(where, when.input);
    const gte = when.gte === undefined ? null : num(where)(when.gte);
    const lt = when.lt === undefined ? null : num(where)(when.lt);
    return {
      cause: `input:${when.input}`,
      test: (v: AgentView) => {
        const x = read(v);
        return (gte === null || x >= gte(v)) && (lt === null || x < lt(v));
      },
    };
  };

  const states = new Map<AlertState, CompiledState>();
  for (const [key, s] of Object.entries(def.states)) {
    const name = key as AlertState;
    const where = ` state "${name}"`;
    states.set(name, {
      name,
      timeout: s.timeoutS === undefined ? null : num(where)(s.timeoutS),
      onTimeout: s.onTimeout === undefined ? null : state(where, s.onTimeout),
      transitions: s.transitions.map((t) => ({
        to: state(where, t.to),
        ...condition(where, t.when),
      })),
      activities: s.activities.map((a) => activity(where, a)),
    });
  }
  return {
    id: def.id,
    thinkHz: def.thinkHz,
    inertia: def.inertia,
    initial: state('', def.initial),
    tuning: def.tuning,
    states,
    activities,
  };
}

/** Compiles every behaviour (e.g. `content.all('behaviour')`), keyed by id. */
export function compileBehaviours(defs: Iterable<Frozen<BehaviourDef>>): BehaviourTable {
  const table = new Map<string, CompiledBehaviour>();
  for (const def of defs) table.set(def.id, compileBehaviour(def));
  return table;
}
