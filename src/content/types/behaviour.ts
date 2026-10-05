// Behaviour definitions (mw-e11.2, ADR-0005): what a creature does, as data. A behaviour is a
// hierarchical state machine over the six alert states (constitution §5) whose transitions,
// timeouts and fallbacks are a table, with utility scoring inside each state: every activity a state
// lists is scored `weight × Π curve(input)` and the best runs. An activity is a short, ordered list of
// action primitives (`move-to`, `look-at`, `wait`…). The runtime that executes these is the sim's
// (src/sim/ai); this file is the schema, and it validates every name at load: an unknown primitive,
// input, event, state or activity fails loading with its path and name (ADR-0005 §5).
//
// A creature names its behaviour with `behaviour.profile` and may override any `tuning` key with
// `behaviour.tuning`. A number in a behaviour may be written as `{ "tuning": "<key>" }` to read that
// key, so tuning changes without touching structure (the AI tuning profiles of mw-e11.16 will
// supply the defaults; until then they live in the behaviour's own `tuning`, filled from
// ALERT_TUNING_DEFAULTS for the keys it leaves out).
//
// The alert machine (mw-e11.7) is the table: a state may move only along its listed transitions and
// its timeout. Two rules of the ladder are enforced here: Combat never drops straight to Unaware (it
// searches first), and damage from an unseen source never jumps to Combat (the attacker is unknown,
// so it is Alerted at most). Every timeout, including one read from tuning, is positive. A state
// with `postAlert` de-escalates to Unaware with a heightened baseline: awareness builds
// `postAlertAwarenessRate` times faster for `postAlertS` seconds.
//
// The lists of primitives, inputs and events are the runtime's vocabulary: a new primitive is one
// step schema here plus its handler in src/sim/ai/primitives.ts (typed against this file, so the two
// cannot drift). Units: seconds, metres, dB, hertz.

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';
import { PERSONALITY_TRAITS } from './creature.ts';
import { GAITS } from './locomotion.ts';

/** Current behaviour schema version; bump it (and add a migration) on breaking changes. */
export const BEHAVIOUR_SCHEMA_VERSION = 1;

/** The six alert states, calmest first (constitution §5). A behaviour defines the ones it uses. */
export const ALERT_STATES = [
  'unaware',
  'suspicious',
  'investigating',
  'searching',
  'alerted',
  'combat',
] as const;

/** An alert state name. */
export type AlertState = (typeof ALERT_STATES)[number];

/**
 * Built-in alert tuning (mw-e11.7; PLACEHOLDER until the AI tuning profiles of mw-e11.16): every
 * behaviour's `tuning` starts from these, and its own keys win. `suspiciousAt` and `investigateAt`
 * are the same thresholds awareness uses for its bands (src/sim/ai/awareness.ts; a test pins them
 * equal), so there is one set of alert thresholds.
 */
export const ALERT_TUNING_DEFAULTS: Readonly<Record<string, number>> = Object.freeze({
  /** Awareness at which an Unaware agent becomes Suspicious. */
  suspiciousAt: 0.3,
  /** Awareness at which it investigates. */
  investigateAt: 0.6,
  /** Seconds Suspicious lasts without a new stimulus. */
  suspiciousTimeoutS: 6,
  /** Seconds it investigates before giving up. */
  investigatingTimeoutS: 20,
  /** Seconds it searches around the last-known position before standing down. */
  searchingTimeoutS: 60,
  /** Seconds it hunts while Alerted before searching. */
  alertedTimeoutS: 120,
  /** Seconds the target is out of perception before Combat becomes Searching. */
  combatLostS: 5,
  /** Seconds of heightened baseline after standing down from a `postAlert` state. */
  postAlertS: 300,
  /** Awareness accumulation multiplier during the heightened baseline. */
  postAlertAwarenessRate: 1.5,
  /**
   * Seconds a leashed creature searches at its leash edge before walking home (mw-e01.17), in place
   * of `searchingTimeoutS`.
   */
  leashSearchS: 3,
});

/** Tuning keys that are durations and so must be positive, wherever they are used. */
export const ALERT_TIMER_KEYS = [
  'suspiciousTimeoutS',
  'investigatingTimeoutS',
  'searchingTimeoutS',
  'alertedTimeoutS',
  'combatLostS',
  'postAlertS',
  'leashSearchS',
] as const;

/** What a state's timeout counts from: entering it, or its last stimulus (whichever is later). */
export const ALERT_TIMEOUT_FROM = ['entered', 'stimulus'] as const;

/**
 * Inputs every agent has, read by considerations and transition conditions (ADR-0005 §5), besides
 * `trait.<trait>` (personality, 0–1) and `need.<need>` (need level / 100, 0 when it has no such need).
 * The combat inputs (mw-e11.13): `targetDistance` is metres to where it believes its target is
 * (1000 with none); `attackToken` is 1 while it holds, or could take, one of its target's attack
 * tokens; `targetUnreachableS` is seconds its target has stood where it cannot path (0 when it can).
 * `fromPost` is metres, on the level, from its leash post (mw-e01.17; 0 without a leash).
 */
export const BEHAVIOUR_INPUTS = [
  'awareness',
  'hasStimulus',
  'targetVisible',
  'targetLostS',
  'healthFraction',
  'timeInState',
  'offRoute',
  'targetDistance',
  'attackToken',
  'targetUnreachableS',
  'fromPost',
] as const;

/** A fixed input name. */
export type BehaviourInput = (typeof BEHAVIOUR_INPUTS)[number];

/** The values an input can take, both ends included (`Infinity` for no upper bound). */
export interface InputRange {
  readonly min: number;
  readonly max: number;
}

/**
 * The range of every fixed input (mw-e11.19), typed against BEHAVIOUR_INPUTS so a new input must
 * declare one. The behaviour lint reads it to find curves that are 0 everywhere the input can be.
 * `targetDistance` reads 1000 with no target (NO_TARGET_DISTANCE, src/sim/ai/combat.ts).
 */
export const BEHAVIOUR_INPUT_RANGES: Readonly<Record<BehaviourInput, InputRange>> = Object.freeze({
  awareness: { min: 0, max: 1 },
  hasStimulus: { min: 0, max: 1 },
  targetVisible: { min: 0, max: 1 },
  targetLostS: { min: 0, max: Infinity },
  healthFraction: { min: 0, max: 1 },
  timeInState: { min: 0, max: Infinity },
  offRoute: { min: 0, max: Infinity },
  targetDistance: { min: 0, max: 1000 },
  attackToken: { min: 0, max: 1 },
  targetUnreachableS: { min: 0, max: Infinity },
  fromPost: { min: 0, max: Infinity },
});

/** The range of input `name`: a fixed input's, or 0-1 for `trait.<trait>` and `need.<need>`. */
export function behaviourInputRange(name: string): InputRange {
  return Object.hasOwn(BEHAVIOUR_INPUT_RANGES, name)
    ? BEHAVIOUR_INPUT_RANGES[name as BehaviourInput]
    : { min: 0, max: 1 };
}

/** External events queued on an agent and read by `{ "event": … }` conditions. */
export const BEHAVIOUR_EVENTS = ['damaged-by-unseen', 'ally-alarm'] as const;

/** An external AI event name. */
export type BehaviourEvent = (typeof BEHAVIOUR_EVENTS)[number];

/**
 * Where a step moves or looks: the stimulus, the target, the target's last-known position, the
 * waypoint of its route nearest by path (mw-e11.9), the spawn, its leash post (mw-e01.17: the spawn
 * without a leash; a `move-to` that arrives there turns it the way it was placed).
 */
export const BEHAVIOUR_TARGETS = [
  'stimulus',
  'target',
  'lkp',
  'nearest-waypoint',
  'origin',
  'post',
] as const;

/** A step target. */
export type BehaviourTarget = (typeof BEHAVIOUR_TARGETS)[number];

/** Action primitives, in the order of the step schemas below. */
export const BEHAVIOUR_PRIMITIVES = [
  'move-to',
  'follow-route',
  'look-at',
  'look-around',
  'wait',
  'play-cue',
  'emit-noise',
  'attack',
  'forget-stimulus',
  'strike',
  'circle',
  'guard',
  'share-target',
] as const;

/** An action primitive name. */
export type BehaviourPrimitive = (typeof BEHAVIOUR_PRIMITIVES)[number];

/** Whether `name` is an input: a fixed one, `trait.<personality trait>` or `need.<content id>`. */
export function isBehaviourInput(name: string): boolean {
  if ((BEHAVIOUR_INPUTS as readonly string[]).includes(name)) return true;
  if (name.startsWith('trait.')) {
    return (PERSONALITY_TRAITS as readonly string[]).includes(name.slice('trait.'.length));
  }
  return name.startsWith('need.') && contentId.safeParse(name.slice('need.'.length)).success;
}

const inputName = z
  .string()
  .superRefine((name, ctx) => {
    if (isBehaviourInput(name)) return;
    ctx.addIssue({
      code: 'custom',
      message: `unknown input "${name}"; inputs: ${BEHAVIOUR_INPUTS.join(', ')}, trait.<trait>, need.<need>`,
    });
  })
  .describe(`An input: ${BEHAVIOUR_INPUTS.join(', ')}, trait.<trait> or need.<need>.`);

/** A number, or `{ "tuning": key }` read from the creature's tuning, else the behaviour's. */
const tunable = (base: z.ZodNumber) =>
  z.union([
    base,
    z
      .strictObject({ tuning: z.string().min(1).describe('Tuning key.') })
      .describe('Reads this tuning key (the creature’s override, else the behaviour’s default).'),
  ]);

const seconds = tunable(z.number().nonnegative());
const unit = z.number().min(0).max(1);

/** A response curve: maps an input to 0–1 (ADR-0005 §3). */
const curveSchema = z
  .discriminatedUnion('kind', [
    z
      .strictObject({ kind: z.literal('linear'), slope: z.number(), intercept: z.number() })
      .describe('slope × input + intercept, clamped to 0–1.'),
    z
      .strictObject({ kind: z.literal('step'), at: z.number(), below: unit, above: unit })
      .describe('`above` when input ≥ at, else `below`.'),
    z
      .strictObject({ kind: z.literal('power'), exponent: z.int().min(1).max(8) })
      .describe('input (clamped to 0–1) to an integer power.'),
  ])
  .describe('Response curve.');

const considerationSchema = z.strictObject({
  input: inputName,
  curve: curveSchema,
});

const gait = z.enum(GAITS).default('walk').describe('Gait (its speed comes from the creature).');
const target = z.enum(BEHAVIOUR_TARGETS);

/** One step: a primitive and its parameters, discriminated by `do`. */
const stepSchema = z.discriminatedUnion(
  'do',
  [
    z
      .strictObject({
        do: z.literal('move-to'),
        target: target.describe('Where to go.'),
        within: tunable(z.number().positive())
          .default(0.5)
          .describe('Arrives within this many metres.'),
        gait,
      })
      .describe('Walks to a target; fails when it is gone or unreachable.'),
    z
      .strictObject({
        do: z.literal('follow-route'),
        dwellS: seconds
          .default(0)
          .describe('Seconds it stands at each waypoint that sets no dwell of its own.'),
        gait,
      })
      .describe(
        'Walks its routine’s route (loop, ping-pong, random or post; never ends), resuming at the waypoint nearest by path; skips an unreachable waypoint (RouteBlocked); fails without a route or when every waypoint is blocked.',
      ),
    z
      .strictObject({
        do: z.literal('look-at'),
        target: target.describe('What to face.'),
        seconds: seconds.describe('How long it looks.'),
      })
      .describe('Turns to face a target for a while; fails when it is gone.'),
    z
      .strictObject({
        do: z.literal('look-around'),
        seconds: seconds.describe('How long it looks around.'),
      })
      .describe('Faces a new seeded-random direction every second.'),
    z
      .strictObject({ do: z.literal('wait'), seconds: seconds.describe('How long it waits.') })
      .describe('Stands still.'),
    z
      .strictObject({ do: z.literal('play-cue'), cue: contentId.describe('Cue id.') })
      .describe('Emits a presentation cue (bark, animation) and succeeds.'),
    z
      .strictObject({
        do: z.literal('emit-noise'),
        db: tunable(z.number().min(0).max(140)).describe('Loudness at the source, dB.'),
      })
      .describe('Makes a noise at its position (stealth hearing) and succeeds.'),
    z
      .strictObject({ do: z.literal('attack'), attack: ref('attack').describe('Attack id.') })
      .describe('Performs an attack on its target; fails when the attack may not start.'),
    z
      .strictObject({ do: z.literal('forget-stimulus') })
      .describe('Drops its stimulus and awareness (it calls it off).'),
    z
      .strictObject({
        do: z.literal('strike'),
        gait,
        giveUpS: tunable(z.number().positive())
          .default(8)
          .describe(
            'Seconds it waits as close as it can get to a target it cannot reach before failing.',
          ),
      })
      .describe(
        'Closes in on its target and performs one of its attacks: those whose preconditions hold at the distance (range, cooldown, health) are weighed by their weights and its aggression, while it holds one of the target’s attack tokens (mw-e11.13). Waits at the closest point to a target it cannot reach; fails without a target, attack or token, with every attack cooling down, or after giveUpS unreachable.',
      ),
    z
      .strictObject({
        do: z.literal('circle'),
        range: tunable(z.number().positive()).describe(
          'Distance it keeps from its target, metres (its preferred range).',
        ),
        seconds: seconds.describe('Longest it strafes before the step ends.'),
        gait,
      })
      .describe(
        'Strafes an eighth of a turn around its target, a seeded-random way, at its preferred range, facing it; succeeds on arrival or after `seconds`, fails without a target or when the spot is unreachable.',
      ),
    z
      .strictObject({
        do: z.literal('guard'),
        seconds: seconds.describe('How long it holds its shield up.'),
      })
      .describe(
        'Raises the shield it carries (creature `shield`) and faces its target as it goes up, holding it for `seconds`, then succeeds; the shield stays up exactly while this is its current step (it drops when the step ends, the activity changes or a stagger breaks it). Fails without a target.',
      ),
    z
      .strictObject({ do: z.literal('share-target') })
      .describe(
        'Tells allies near it where it believes its target is (AiTargetShared; they hear it as a second-hand report) and succeeds; with no target memory it says nothing.',
      ),
  ],
  {
    error: (issue) =>
      `unknown primitive ${JSON.stringify((issue.input as { do?: unknown } | undefined)?.do)}; primitives: ${BEHAVIOUR_PRIMITIVES.join(', ')}`,
  },
);

/** What a transition waits for (ADR-0005 §2). */
const conditionSchema = z
  .union([
    z
      .strictObject({
        input: inputName,
        gte: tunable(z.number()).optional().describe('True when the input is at least this.'),
        lt: tunable(z.number()).optional().describe('True when the input is below this.'),
      })
      .refine((c) => c.gte !== undefined || c.lt !== undefined, 'needs gte, lt or both')
      .describe('An input threshold (trait, timer, stimulus, need…).'),
    z
      .strictObject({ event: z.enum(BEHAVIOUR_EVENTS).describe('Queued external event.') })
      .describe('An external event queued since the last think.'),
    z
      .strictObject({ done: contentId.describe('Activity of this state.') })
      .describe('The activity finished its last step.'),
    z
      .strictObject({ failed: contentId.describe('Activity of this state.') })
      .describe('A step of the activity failed.'),
  ])
  .describe('Transition condition.');

const transitionSchema = z.strictObject({
  to: z.enum(ALERT_STATES).describe('State it moves to (defined in this behaviour).'),
  when: conditionSchema,
});

const stateSchema = z.strictObject({
  timeoutS: tunable(z.number().positive())
    .optional()
    .describe('Seconds in this state before `onTimeout`; absent = no timeout.'),
  onTimeout: z.enum(ALERT_STATES).optional().describe('State it falls back to on timeout.'),
  timeoutFrom: z
    .enum(ALERT_TIMEOUT_FROM)
    .default('entered')
    .describe(
      'What the timeout counts from: entering the state, or the last stimulus (a new one restarts it).',
    ),
  postAlert: z
    .boolean()
    .default(false)
    .describe(
      'Standing down from this state to unaware starts the heightened baseline (postAlertS, postAlertAwarenessRate).',
    ),
  transitions: z
    .array(transitionSchema)
    .prefault([])
    .describe('Checked in order after the timeout; at most one is taken per think.'),
  activities: z.array(contentId).min(1).describe('Activities scored in this state, in tie order.'),
});

const activitySchema = z.strictObject({
  weight: z.number().nonnegative().default(1).describe('Score multiplier.'),
  interruptible: z
    .boolean()
    .default(true)
    .describe('false holds the activity until it ends or the state changes.'),
  retryAfterS: z
    .number()
    .nonnegative()
    .default(2)
    .describe('Seconds a failed activity is excluded from scoring.'),
  considerations: z
    .array(considerationSchema)
    .prefault([])
    .describe('Input × curve factors; none = always its weight.'),
  steps: z.array(stepSchema).min(1).describe('Primitives run in order.'),
});

interface BehaviourShape {
  readonly id: string;
  readonly tuning: Readonly<Record<string, number>>;
  readonly initial: AlertState;
  readonly states: Readonly<Partial<Record<AlertState, z.output<typeof stateSchema>>>>;
  readonly activities: Readonly<Record<string, z.output<typeof activitySchema>>>;
}

/** Every `{ tuning: key }` in `value` with its path (the top-level `tuning` record is not one). */
function tuningRefs(value: unknown, path: (string | number)[], out: [string, PropertyKey[]][]) {
  if (typeof value !== 'object' || value === null) return;
  const keys = Object.keys(value);
  const record = value as Record<string, unknown>;
  if (keys.length === 1 && typeof record['tuning'] === 'string') {
    out.push([record['tuning'], [...path, 'tuning']]);
    return;
  }
  for (const key of keys) tuningRefs(record[key], [...path, key], out);
}

/** Adds an issue for every reference to a state, activity or tuning key this behaviour lacks. */
function checkBehaviour(b: BehaviourShape, ctx: z.RefinementCtx): void {
  const issue = (path: PropertyKey[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message });
  };
  const hasState = (s: AlertState) => b.states[s] !== undefined;
  const timers = new Set<string>(ALERT_TIMER_KEYS);
  if (!hasState(b.initial)) issue(['initial'], `unknown state "${b.initial}"`);
  for (const [name, state] of Object.entries(b.states)) {
    const at = ['states', name];
    if ((state.timeoutS === undefined) !== (state.onTimeout === undefined)) {
      issue(at, 'timeoutS and onTimeout go together');
    }
    if (state.timeoutFrom !== 'entered' && state.timeoutS === undefined) {
      issue([...at, 'timeoutFrom'], 'timeoutFrom needs a timeoutS');
    }
    if (state.onTimeout !== undefined && !hasState(state.onTimeout)) {
      issue([...at, 'onTimeout'], `unknown state "${state.onTimeout}"`);
    }
    if (name === 'combat' && state.onTimeout === 'unaware') {
      issue([...at, 'onTimeout'], 'combat never falls back to unaware directly (search first)');
    }
    if (typeof state.timeoutS === 'object') timers.add(state.timeoutS.tuning);
    state.activities.forEach((activity, i) => {
      if (!Object.hasOwn(b.activities, activity)) {
        issue([...at, 'activities', i], `unknown activity "${activity}"`);
      }
    });
    state.transitions.forEach((t, i) => {
      const where = [...at, 'transitions', i];
      if (!hasState(t.to)) issue([...where, 'to'], `unknown state "${t.to}"`);
      else if (t.to === name) issue([...where, 'to'], `transition to its own state "${t.to}"`);
      if (name === 'combat' && t.to === 'unaware') {
        issue([...where, 'to'], 'combat never goes to unaware directly (search first)');
      }
      if ('event' in t.when && t.when.event === 'damaged-by-unseen' && t.to === 'combat') {
        issue(
          [...where, 'to'],
          'damage from an unseen source cannot start combat (the attacker is unknown: alerted)',
        );
      }
      const ends = 'done' in t.when ? t.when.done : 'failed' in t.when ? t.when.failed : null;
      if (ends !== null && !state.activities.includes(ends)) {
        issue([...where, 'when'], `unknown activity "${ends}" (not listed in state "${name}")`);
      }
    });
  }
  const refs: [string, PropertyKey[]][] = [];
  tuningRefs({ states: b.states, activities: b.activities }, [], refs);
  for (const [key, path] of refs) {
    if (!Object.hasOwn(b.tuning, key)) issue(path, `unknown tuning key "${key}"`);
  }
  for (const key of timers) {
    const value = b.tuning[key];
    if (value !== undefined && value <= 0) {
      issue(['tuning', key], `timeout "${key}" must be positive, got ${String(value)}`);
    }
  }
}

const whenValid = {
  when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0,
};

/** Schema of one behaviour file, `src/content/data/behaviour/<id>.json`. */
export const behaviourSchema = z
  .strictObject({
    id: contentId.describe('Behaviour id creatures name in `behaviour.profile`.'),
    schemaVersion: z
      .literal(BEHAVIOUR_SCHEMA_VERSION)
      .default(BEHAVIOUR_SCHEMA_VERSION)
      .describe('Behaviour schema version, for future migrations.'),
    notes: z.string().min(1).optional().describe('What it is for, for owner review.'),
    tuning: z
      .record(z.string().min(1), z.number())
      .prefault({})
      .transform((own) => ({ ...ALERT_TUNING_DEFAULTS, ...own }))
      .describe(
        'Default tuning values `{ "tuning": key }` reads; creatures override them. Keys left out come from the built-in alert tuning.',
      ),
    thinkHz: z
      .number()
      .positive()
      .max(60)
      .default(10)
      .describe('Thinks per second (it acts every tick).'),
    inertia: z
      .number()
      .nonnegative()
      .default(0.1)
      .describe('Score bonus of the running activity (hysteresis).'),
    initial: z.enum(ALERT_STATES).default('unaware').describe('State it spawns in.'),
    states: z
      .partialRecord(z.enum(ALERT_STATES), stateSchema)
      .describe('The alert states it uses, by name.'),
    activities: z.record(contentId, activitySchema).describe('Activities by id.'),
  })
  .superRefine(checkBehaviour, whenValid);

/** A behaviour as written in JSON. */
export type BehaviourDefInput = z.input<typeof behaviourSchema>;
/** A validated behaviour with defaults filled. */
export type BehaviourDef = z.output<typeof behaviourSchema>;
/** One state of a behaviour. */
export type BehaviourStateDef = z.output<typeof stateSchema>;
/** One activity of a behaviour. */
export type BehaviourActivityDef = z.output<typeof activitySchema>;
/** One step of an activity. */
export type BehaviourStepDef = z.output<typeof stepSchema>;
/** A transition condition. */
export type BehaviourConditionDef = z.output<typeof conditionSchema>;
/** A response curve. */
export type BehaviourCurveDef = z.output<typeof curveSchema>;
/** A number or a tuning reference. */
export type Tunable = number | { readonly tuning: string };
