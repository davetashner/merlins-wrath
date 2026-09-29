// The sim events presentation cue sheets may react to (mw-e28.3), with the vocabulary each one
// offers a rule: its anchors (where a cue plays: an entity to follow or a fixed position; the first
// is the default) and its facts (what a rule may match on, interpolate into a cue id or scale volume
// by). Audio cue sheets (types/cue-sheet.ts) and VFX cue sheets (e29) validate against this one
// table, so a typo in an event or fact name fails at content load, naming the rule. Content may import
// the sim only as types, so the table is written out here; src/game/cues/events.ts binds each name to
// the sim's EventType and is typed against this table, and its tests check the two agree.

import { z } from 'zod';

/**
 * How a fact can be used. `string`: matched by equality and interpolated into cue ids; `list`: a
 * set of strings, matched by membership (e.g. damage tags); `boolean`: matched by equality;
 * `number`: not matchable, only scales volume (`volumeBy`).
 */
export const CUE_FACT_KINDS = ['string', 'list', 'boolean', 'number'] as const;
export type CueFactKind = (typeof CUE_FACT_KINDS)[number];

/** What one event offers cue rules. */
export interface CueEventSpec {
  /** Anchor names (at least one); the first is the default. */
  readonly anchors: readonly [string, ...string[]];
  /** Fact name → kind. A fact may be absent from a given event (then a rule needing it skips). */
  readonly facts: Readonly<Record<string, CueFactKind>>;
}

/** Facts derived from the struck entity (`target`) and the hitting one (`weapon`). */
const HIT_FACTS = {
  /** Impact class of the weapon's material (its `impactSound` without `sfx-impact-`), e.g. "metal". */
  weapon: 'string',
  weaponMaterial: 'string',
  /** Impact class of the target's material, e.g. "bone". */
  target: 'string',
  targetMaterial: 'string',
} as const;

/** Facts of a changed value: `on` for a boolean, `to` for an id or enum, `value` for a number. */
const VALUE_FACTS = { key: 'string', on: 'boolean', to: 'string', value: 'number' } as const;

/**
 * Every sim event a cue sheet can name, keyed by the sim event name. The facts are documented in
 * docs/content/cue-sheet-schema.md via the `event` field's description.
 */
export const CUE_EVENTS = {
  DamageApplied: {
    anchors: ['target', 'instigator', 'source'],
    facts: {
      ...HIT_FACTS,
      /** The damage type that dealt the most, e.g. "slash". */
      damageType: 'string',
      /** Hurtbox region struck, e.g. "head". */
      region: 'string',
      tags: 'list',
      immune: 'boolean',
      died: 'boolean',
      poiseBroken: 'boolean',
      total: 'number',
      poiseDamage: 'number',
    },
  },
  PoiseBroken: {
    anchors: ['target', 'instigator', 'source'],
    facts: { target: 'string', targetMaterial: 'string' },
  },
  Died: {
    anchors: ['target', 'killer', 'source'],
    facts: { target: 'string', targetMaterial: 'string', tags: 'list' },
  },
  AttackTelegraph: {
    anchors: ['attacker'],
    /** `telegraph` is the attack's own telegraph cue id: a rule plays it with `cue: "{telegraph}"`. */
    facts: { attack: 'string', telegraph: 'string' },
  },
  AttackHit: {
    anchors: ['target', 'attacker', 'source'],
    facts: { ...HIT_FACTS, attack: 'string', total: 'number' },
  },
  AttackProjectileLaunched: {
    anchors: ['origin', 'attacker', 'projectile'],
    facts: { attack: 'string' },
  },
  AttackEnded: {
    anchors: ['attacker'],
    facts: { attack: 'string', reason: 'string' },
  },
  ActionRejected: {
    anchors: ['entity'],
    facts: { action: 'string', reason: 'string' },
  },
  StaminaExhausted: { anchors: ['entity'], facts: {} },
  StaminaRecovered: { anchors: ['entity'], facts: {} },
  fireIgnited: { anchors: ['entity'], facts: { material: 'string' } },
  fireExtinguished: { anchors: ['entity'], facts: { material: 'string', cause: 'string' } },
  fireBurntOut: {
    anchors: ['entity'],
    facts: { material: 'string', becomes: 'string', destroyed: 'boolean' },
  },
  stimulusResolved: {
    anchors: ['at', 'source'],
    facts: { element: 'string', shape: 'string', amount: 'number', hits: 'number' },
  },
  propertyChanged: {
    anchors: ['entity', 'source'],
    facts: { ...VALUE_FACTS, material: 'string' },
  },
  factChanged: { anchors: ['source'], facts: VALUE_FACTS },
  signalReceived: {
    anchors: ['entity'],
    /** `key` is the fact key or, for an `audio-cue` receiver, the cue id. */
    facts: { graph: 'string', node: 'string', receiver: 'string', key: 'string', value: 'boolean' },
  },
  volumeEntered: { anchors: ['entity'], facts: { graph: 'string', node: 'string' } },
  volumeExited: { anchors: ['entity'], facts: { graph: 'string', node: 'string' } },
} as const satisfies Record<string, CueEventSpec>;

/** A sim event name a cue sheet may use. */
export type CueEventName = keyof typeof CUE_EVENTS;

/** Every cue event name, in table order. */
export const CUE_EVENT_NAMES = Object.keys(CUE_EVENTS) as [CueEventName, ...CueEventName[]];

/** The spec of a cue event. */
export function cueEventSpec(name: CueEventName): CueEventSpec {
  return CUE_EVENTS[name];
}

/** Rule-level fields every cue sheet shares (audio now, VFX in e29). */
export const cueRuleBaseFields = {
  event: z
    .enum(CUE_EVENT_NAMES, {
      error: (issue) =>
        `unknown sim event "${String(issue.input)}"; cue sheets can use: ${CUE_EVENT_NAMES.join(', ')}`,
    })
    .describe(
      'The sim event that triggers the rule (see src/content/cue-events.ts for its facts).',
    ),
  match: z
    .record(z.string(), z.union([z.string(), z.boolean()]))
    .default({})
    .describe(
      'Facts the event must have: a string fact equals the value, a list fact contains it, a boolean fact equals it. The most specific matching rule (most keys) wins.',
    ),
  layer: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case')
    .default('main')
    .describe(
      'Rules compete per layer: one event plays at most one rule per layer (e.g. "impact" and "accent").',
    ),
};

/** The rule fields `checkCueRule` validates. */
export interface CueRuleShape {
  readonly event: CueEventName;
  readonly match: Readonly<Record<string, string | boolean>>;
}

/**
 * Adds an issue for every match key the event doesn't offer or whose value doesn't fit the fact's
 * kind. Use in a rule schema's superRefine; paths are relative to the rule.
 */
export function checkCueRule(rule: CueRuleShape, ctx: z.RefinementCtx): void {
  const facts = cueEventSpec(rule.event).facts;
  for (const [key, value] of Object.entries(rule.match)) {
    const kind = facts[key];
    if (kind === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['match', key],
        message: `${rule.event} has no fact "${key}"; it has: ${Object.keys(facts).join(', ') || 'none'}`,
      });
    } else if (kind === 'number') {
      ctx.addIssue({
        code: 'custom',
        path: ['match', key],
        message: `"${key}" is a number fact: scale by it with volumeBy, don't match it`,
      });
    } else if ((kind === 'boolean') !== (typeof value === 'boolean')) {
      ctx.addIssue({
        code: 'custom',
        path: ['match', key],
        message: `"${key}" is a ${kind} fact, so its match value must be a ${kind === 'boolean' ? 'boolean' : 'string'}`,
      });
    }
  }
}

/** `{fact}` placeholders in a cue template (exported for the game layer's interpolation). */
export const CUE_PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

/** Names of the `{fact}` placeholders in a cue template, in order. */
export function cuePlaceholders(template: string): string[] {
  return [...template.matchAll(CUE_PLACEHOLDER)].map((m) => String(m[1]));
}
