// Structural lint of behaviour definitions (mw-e11.19, ADR-0005): data mistakes that load fine but
// strand a guard in a playtest. Pure functions over a parsed behaviour (whose `tuning` already has
// the built-in alert tuning filled in); every problem names the behaviour id and the offender:
//
// - a state no path reaches from `initial` (transitions and timeout fallbacks are the edges);
// - a state with neither a timeout nor any transition has no exit, except Combat, which is held to
//   its own rule: it must leave on a lost target (a transition on `targetLostS`, or on
//   `targetVisible` below a threshold);
// - an activity no state lists;
// - a listed activity that can never score above 0: its weight is 0, or one consideration's curve
//   is 0 over the whole range its input declares (BEHAVIOUR_INPUT_RANGES), and the score is a product;
// - a `done`/`failed` condition naming an activity its state does not list (the schema rejects this
//   too; the lint keeps the rule for definitions that do not come through it).
//
// `lintBehaviour` returns the problems of one behaviour; `checkBehaviours` is the ContentCheck that
// runs it over every behaviour on every load (so `pnpm content:schemas` and the content tests fail).

import type { ContentCheck, ContentIssue, Frozen } from './loader.ts';
import {
  behaviourInputRange,
  type BehaviourCurveDef,
  type BehaviourDef,
  type InputRange,
} from './types/behaviour.ts';

/** One problem in a behaviour: where (a JSON pointer into the file) and what. */
export interface BehaviourProblem {
  readonly pointer: string;
  readonly message: string;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** The highest value `curve` takes while its input stays in `range`. */
function curveMax(curve: Frozen<BehaviourCurveDef>, range: InputRange): number {
  switch (curve.kind) {
    case 'linear':
      // Monotone: its best is at the end the slope points to (an unbounded end reads as 1, or 0).
      return clamp01(
        curve.slope > 0
          ? curve.slope * range.max + curve.intercept
          : curve.slope * range.min + curve.intercept,
      );
    case 'step': {
      const above = range.max >= curve.at ? curve.above : 0;
      const below = range.min < curve.at ? curve.below : 0;
      return Math.max(above, below);
    }
    case 'power':
      return clamp01(range.max) ** curve.exponent;
  }
}

/** Every structural problem of `def`, in a stable order. */
export function lintBehaviour(def: Frozen<BehaviourDef>): BehaviourProblem[] {
  const problems: BehaviourProblem[] = [];
  const report = (pointer: string, message: string) => {
    problems.push({ pointer, message });
  };
  const states = Object.entries(def.states);
  const byName = new Map(states);

  // Reachability from `initial`: transitions and timeout fallbacks are the edges.
  const reached = new Set<string>([def.initial]);
  const queue: string[] = [def.initial];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    const state = byName.get(name);
    if (state === undefined) continue;
    const next = [state.onTimeout, ...state.transitions.map((t) => t.to)];
    for (const to of next) {
      if (to !== undefined && !reached.has(to)) {
        reached.add(to);
        queue.push(to);
      }
    }
  }

  const listed = new Set<string>();
  for (const [name, state] of states) {
    const at = `/states/${name}`;
    if (!reached.has(name)) {
      report(at, `state "${name}" is unreachable from initial state "${def.initial}"`);
    }
    if (name === 'combat') {
      const leavesOnLostTarget = state.transitions.some(
        (t) =>
          'input' in t.when &&
          (t.when.input === 'targetLostS' ||
            (t.when.input === 'targetVisible' && t.when.lt !== undefined)),
      );
      if (!leavesOnLostTarget) {
        report(at, `state "combat" has no lost-target exit (a transition on targetLostS)`);
      }
    } else if (state.timeoutS === undefined && state.transitions.length === 0) {
      report(at, `state "${name}" has no exit (no timeout and no transitions)`);
    }
    for (const activity of state.activities) listed.add(activity);
    state.transitions.forEach((t, i) => {
      const ends = 'done' in t.when ? t.when.done : 'failed' in t.when ? t.when.failed : undefined;
      if (ends !== undefined && !state.activities.includes(ends)) {
        report(
          `${at}/transitions/${String(i)}/when`,
          `state "${name}" waits on activity "${ends}", which it does not list`,
        );
      }
    });
  }

  for (const [id, activity] of Object.entries(def.activities)) {
    const at = `/activities/${id}`;
    if (!listed.has(id)) {
      report(at, `activity "${id}" is listed by no state`);
      continue;
    }
    if (activity.weight === 0) {
      report(`${at}/weight`, `activity "${id}" is never selectable: its weight is 0`);
    }
    activity.considerations.forEach((c, i) => {
      if (curveMax(c.curve, behaviourInputRange(c.input)) === 0) {
        report(
          `${at}/considerations/${String(i)}`,
          `activity "${id}" is never selectable: its ${c.curve.kind} curve on "${c.input}" is 0 over the whole input range`,
        );
      }
    });
  }
  return problems;
}

/** The check: lints every behaviour file (see the file header). */
export const checkBehaviours: ContentCheck = (entries) => {
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'behaviour') continue;
    const def = value as BehaviourDef;
    for (const { pointer, message } of lintBehaviour(def)) {
      issues.push({ file, pointer, message: `behaviour "${def.id}": ${message}` });
    }
  }
  return issues;
};
