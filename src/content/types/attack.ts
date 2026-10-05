// The attack content type (mw-e12.5): what a creature can do to hurt something, as data. Creature
// attacks reuse the `move` vocabulary instead of inventing a second one: an attack *is* a move (its
// frames, hit volume, damage template, parry/block flags, telegraph tick and presentation cues all
// live in the referenced move, e04.3) plus the creature-only facts AI and the attack executor need —
// what kind of attack it is, the distance band it is used from, a telegraph cue, extra damage
// packets, a cooldown, a selection weight and preconditions. So a creature's overhead chop and the
// knight's swing are timed, parried, blocked and damaged by exactly the same rules (constitution:
// enemies are creatures, not dummies), and e04.20's readability rules read one set of frame numbers.
// One file per attack at `src/content/data/attack/<id>.json`; creatures list them by id
// (`CreatureDef.attacks`). The field reference in docs/content/attack-schema.md is generated from this
// file (`pnpm content:docs`).
//
// Units: metres, seconds (cooldown), sim ticks (inside the move). Cross-entry rules the schema cannot
// see (the move must be a hitting `attack` move; a projectile's move hit volume must be a sphere) are
// checked by `compileAttack`, which every attack entry's content test runs.

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId, ref } from '../schema.ts';
import {
  damageTemplateSchema,
  type DamageTemplate,
  type MoveTable,
  type RuntimeMove,
} from './move.ts';

/** Current AttackDef schema version; bump it (and add a migration) on breaking changes. */
export const ATTACK_SCHEMA_VERSION = 1;

/**
 * How an attack reaches its target. `melee` and `area` hit with the move's volume around the
 * attacker; `projectile` launches the volume as a travelling sphere; `grab` and `special` only emit
 * a stub event for now (their runtime belongs to the bestiary items that need them).
 */
export const ATTACK_KINDS = ['melee', 'projectile', 'area', 'grab', 'special'] as const;

/** What the target is doing, as a precondition sees it (the caller reports it; AI e11 knows). */
export const TARGET_STANCES = [
  'idle',
  'moving',
  'blocking',
  'attacking',
  'dodging',
  'staggered',
  'downed',
] as const;

/** An attack kind. */
export type AttackKind = (typeof ATTACK_KINDS)[number];
/** A target stance. */
export type TargetStance = (typeof TARGET_STANCES)[number];

const metres = z.number().nonnegative();
const unit = z.number().min(0).max(1);

const rangeSchema = z
  .strictObject({
    min: metres.describe('Closest distance to the target it is used from, metres.'),
    max: metres.describe('Farthest distance to the target it is used from, metres; at least min.'),
  })
  .describe(
    'Distance band to the target (centre to centre, metres) the attack is used from: the distance ' +
      'precondition, and what AI spacing (e11) aims for.',
  );

const preconditionsSchema = z
  .strictObject({
    targetStances: z
      .array(z.enum(TARGET_STANCES))
      .min(1)
      .optional()
      .describe('Target stances it may be used against; absent = any.'),
    health: z
      .strictObject({
        min: unit.default(0).describe('Lowest own health fraction, 0–1.'),
        max: unit.default(1).describe('Highest own health fraction, 0–1; at least min.'),
      })
      .prefault({})
      .describe(
        'Own health band (current / max health) it may be used in, e.g. a desperation move.',
      ),
  })
  .prefault({})
  .describe(
    'When the attack may be started, besides range and cooldown; evaluated deterministically by ' +
      'the sim (canStartAttack).',
  );

const projectileSchema = z
  .strictObject({
    speed: z.number().positive().describe('Flight speed, metres per second (straight line).'),
    maxRange: z.number().positive().describe('Distance after which it vanishes, metres.'),
  })
  .describe(
    'Projectile flight (required for kind "projectile", forbidden otherwise). It launches on the ' +
      'first active tick from the move’s sphere hit volume, which is its size and launch point.',
  );

/** Schema of one attack file, `src/content/data/attack/<id>.json`. */
export const attackSchema = z
  .strictObject({
    id: contentId.describe(
      'Unique attack id, e.g. "forgotten-overhead-chop". Stable once shipped.',
    ),
    schemaVersion: z
      .literal(ATTACK_SCHEMA_VERSION)
      .default(ATTACK_SCHEMA_VERSION)
      .describe('AttackDef schema version, for future migrations.'),
    notes: z
      .string()
      .min(1)
      .describe('Where the numbers come from (bead, design intent), for owner review.'),
    kind: z.enum(ATTACK_KINDS).describe('How it reaches its target.'),
    move: ref('move').describe(
      'The move it performs: windup (startup), active and recovery ticks, hit volume, damage ' +
        'template, parry/block flags, telegraph tick and cues. Must be an "attack" move.',
    ),
    telegraph: contentId.describe(
      'Telegraph cue id render and audio play when the windup reads (TelegraphStarted event, mw-e04.20), ' +
        'e.g. "guard-strike-windup"; placeholder cues can be swapped later.',
    ),
    range: rangeSchema,
    extraPackets: z
      .array(damageTemplateSchema)
      .prefault([])
      .describe(
        'Damage packets applied per hit after the move’s own damage template (e.g. a separate ' +
          'poison packet); each goes through the damage model on its own.',
      ),
    cooldown: z
      .number()
      .nonnegative()
      .default(0)
      .describe('Seconds after it starts before it may start again.'),
    weight: z
      .number()
      .positive()
      .default(1)
      .describe('Relative selection weight among usable attacks (AI, e11).'),
    preconditions: preconditionsSchema,
    projectile: projectileSchema.optional(),
  })
  .superRefine((attack, ctx) => {
    const fail = (path: readonly (string | number)[], message: string) => {
      ctx.addIssue({
        code: 'custom',
        path: [...path],
        message: `attack "${attack.id}": ${message}`,
      });
    };
    const { range, preconditions, kind } = attack;
    if (range.min > range.max) {
      fail(
        ['range', 'min'],
        `range.min (${String(range.min)}) exceeds range.max (${String(range.max)})`,
      );
    }
    const health = preconditions.health;
    if (health.min > health.max) {
      fail(['preconditions', 'health', 'min'], 'health.min exceeds health.max');
    }
    if (new Set(preconditions.targetStances).size !== (preconditions.targetStances ?? []).length) {
      fail(['preconditions', 'targetStances'], 'lists a stance twice');
    }
    if (kind === 'projectile' && attack.projectile === undefined) {
      fail(['projectile'], 'a projectile attack needs a projectile section');
    }
    if (kind !== 'projectile' && attack.projectile !== undefined) {
      fail(['projectile'], `only projectile attacks have a projectile section (kind is "${kind}")`);
    }
  });

/** An AttackDef as written in JSON (optional sections may be omitted). */
export type AttackDefInput = z.input<typeof attackSchema>;
/** A validated AttackDef with every default filled and refs parsed. */
export type AttackDef = z.output<typeof attackSchema>;
/** A loaded (deeply frozen) AttackDef. */
export type AttackEntry = Frozen<AttackDef>;

/** An attack as the sim's executor reads it: the compiled move plus the attack's own numbers. */
export interface RuntimeAttack {
  readonly id: string;
  readonly kind: AttackKind;
  /** The compiled move (frames, hitbox, flags, telegraphTick, presentation). */
  readonly move: RuntimeMove;
  /**
   * Every move the attack performs, in order: its move, then that move's `chainNext` and so on (a
   * two-hit slash is two moves, e04.20); absent = just `move`. `compileAttack` always fills it.
   */
  readonly chain?: readonly RuntimeMove[];
  /** The move's hit volume (never null for an attack). */
  readonly hitbox: NonNullable<RuntimeMove['hitbox']>;
  /** Telegraph cue id (TelegraphStarted). */
  readonly telegraph: string;
  readonly rangeMin: number;
  readonly rangeMax: number;
  /** Every packet one hit applies, in order: the move's damage template, then `extraPackets`. */
  readonly packets: readonly DamageTemplate[];
  /** Cooldown in whole milliseconds (the sim converts with `clock.ticksFor`). */
  readonly cooldownMs: number;
  readonly weight: number;
  /** Allowed target stances, or null for any. */
  readonly targetStances: readonly TargetStance[] | null;
  readonly healthMin: number;
  readonly healthMax: number;
  readonly projectile: {
    readonly speed: number;
    readonly maxRange: number;
    /** Launch point in the attacker's frame (the move's sphere centre), metres. */
    readonly origin: { readonly x: number; readonly y: number; readonly z: number };
    /** Collision radius (the move's sphere radius), metres. */
    readonly radius: number;
  } | null;
}

/** Every attack by id (iteration in id order), frozen. */
export type AttackTable = ReadonlyMap<string, RuntimeAttack>;

/** Thrown by `compileAttack` for an attack whose move cannot perform it. */
export class AttackCompileError extends Error {
  override readonly name = 'AttackCompileError';
}

/**
 * The runtime form of one loaded attack, given the compiled move table (`compileMoves`). Throws an
 * AttackCompileError when the move (or a move its chain continues into) is missing or is not a
 * hitting `attack` move, when the chain loops, or — for a projectile — its hit volume is not a
 * sphere.
 */
export function compileAttack(attack: AttackEntry, moves: MoveTable): RuntimeAttack {
  const fail = (message: string) => new AttackCompileError(`attack "${attack.id}": ${message}`);
  const hitting = (id: string) => {
    const found = moves.get(id);
    if (found === undefined) throw fail(`move "${id}" is not in the table`);
    const { damage, hitbox } = found;
    if (found.verb !== 'attack' || damage === null || hitbox === null) {
      throw fail(`move "${found.id}" must be an attack move with a hitbox and damage`);
    }
    return { move: found, damage, hitbox };
  };
  const { move, damage, hitbox } = hitting(attack.move.id);
  const chain: RuntimeMove[] = [move];
  for (let last = move; last.chainNext !== null;) {
    const id = last.chainNext;
    if (chain.some((m) => m.id === id)) {
      throw fail(`move "${last.id}" chains back into "${id}": an attack's chain must end`);
    }
    last = hitting(id).move;
    chain.push(last);
  }
  // A projectile launches from (and is as big as) its move's sphere hit volume.
  const launched = (flight: NonNullable<AttackEntry['projectile']>) => {
    const { shape } = hitbox;
    if (shape.kind !== 'sphere') {
      throw fail(`a projectile's move "${move.id}" needs a sphere hit volume, not a ${shape.kind}`);
    }
    return Object.freeze({ ...flight, origin: shape.center, radius: shape.radius });
  };
  const projectile = attack.projectile === undefined ? null : launched(attack.projectile);
  const { preconditions } = attack;
  return Object.freeze({
    id: attack.id,
    kind: attack.kind,
    move,
    chain: Object.freeze(chain),
    hitbox,
    telegraph: attack.telegraph,
    rangeMin: attack.range.min,
    rangeMax: attack.range.max,
    packets: Object.freeze([damage, ...attack.extraPackets]),
    cooldownMs: Math.round(attack.cooldown * 1000),
    weight: attack.weight,
    targetStances: preconditions.targetStances ?? null,
    healthMin: preconditions.health.min,
    healthMax: preconditions.health.max,
    projectile,
  });
}

/** The runtime attack table built from loaded attacks (e.g. `content.all('attack')`). */
export function compileAttacks(attacks: Iterable<AttackEntry>, moves: MoveTable): AttackTable {
  const table = new Map<string, RuntimeAttack>();
  for (const attack of [...attacks].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    table.set(attack.id, compileAttack(attack, moves));
  }
  return table;
}
