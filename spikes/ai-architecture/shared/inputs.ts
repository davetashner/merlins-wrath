// Named numeric inputs both architectures read (BT conditions, utility considerations, HFSM
// transitions). Resolving names at load time into closures keeps the think loop free of string work.

import { HZ, TRAITS, type Agent, type ScenarioWorld, type Trait } from './world';

export type InputFn = (world: ScenarioWorld<unknown>, agent: Agent) => number;

const traitInput =
  (trait: Trait): InputFn =>
  (_w, a) =>
    a.traits[trait];

const FIXED: Readonly<Record<string, InputFn>> = {
  awareness: (_w, a) => a.awareness,
  /** Sleep need 0–1 (the creature's 0–100 level / 100). */
  'need.sleep': (_w, a) => a.needs.sleep / 100,
  /** Seconds in the current alert state. */
  timeInState: (w, a) => (w.tick - a.alertSince) / HZ,
  /** Metres from the patrol route. */
  offRoute: (w, a) => w.offRoute(a),
  hasStimulus: (_w, a) => (a.stimulus === null ? 0 : 1),
};

const INPUTS: Readonly<Record<string, InputFn>> = {
  ...FIXED,
  ...Object.fromEntries(TRAITS.map((t) => [`trait.${t}`, traitInput(t)])),
};

/** The input named `name`; throws naming the owner when unknown (load-time validation). */
export function resolveInput(name: string, owner: string): InputFn {
  const fn = INPUTS[name];
  if (fn === undefined) throw new Error(`${owner}: unknown input "${name}"`);
  return fn;
}

/** A threshold test on one input, as data. */
export interface InputTest {
  readonly input: string;
  readonly gte?: number;
  readonly lt?: number;
}

export type Test = (world: ScenarioWorld<unknown>, agent: Agent) => boolean;

export function compileTest(test: InputTest, owner: string): Test {
  const fn = resolveInput(test.input, owner);
  const { gte, lt } = test;
  return (w, a) => {
    const v = fn(w, a);
    return (gte === undefined || v >= gte) && (lt === undefined || v < lt);
  };
}
