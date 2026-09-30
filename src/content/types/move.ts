// The move content type (mw-e04.3): one data format for every committed combat action — the knight's
// sword chain, a shield bash, a dodge roll, a training dummy's swing and, later, creature attacks
// (e04.20, e12.5) and archers — so designers tune timing without code changes and every attacker
// plays by the same parry, block and poise rules (technical constitution: combat is data-driven).
// One file per move at `src/content/data/move/<id>.json`; the field reference in
// docs/content/move-schema.md is generated from this file (`pnpm content:docs`).
//
// Timing: the sim runs at a fixed 60 Hz and every frame number here is a sim tick. A move's ticks
// are counted from 0 (its first startup tick): startup occupies 0…startup−1, active the next
// `active` ticks, recovery the rest, so a 12/4/18 move is active on ticks 12–15 and lasts 34 ticks.
// Tick ranges (`from`/`to`) are inclusive and must lie inside the move. There are no ms fields;
// design durations in ms become ticks through SimClock.ticksFor.
//
// Reuse: damage amounts are keyed by the damage model's DAMAGE_TYPES (damage.ts) and the damage
// template carries exactly the DamagePacketInput fields a move can know in advance (instigator,
// source, direction and region are filled in when it hits). Hit volumes use the stimulus shape
// vocabulary (sphere, capsule, box from src/sim/stimulus/shapes.ts) in the attacker's local frame:
// origin at the root, +z forward, +y up, +x right. Stamina costs are points, spent through
// `spendStamina(world, e, move.verb, move.staminaCost)`.
//
// Validation has two levels. Errors (the schema below, plus the loader's reference check for
// chainNext/charge.from) make content fail to load. Warnings (`moveWarnings`) flag legal but unusual
// data — a parryable unblockable move, a presentation cue id no asset declares yet — and never fail:
// placeholder assets may lag the data. `compileMoves` turns loaded moves into the flat runtime table
// the action timeline (e04.4) reads.

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId, ref } from '../schema.ts';
import { DAMAGE_TYPES } from './damage.ts';
import { HIT_STOP_TIERS, type HitStopTier } from './hit-stop.ts';

/** Current MoveDef schema version; bump it (and add a migration) on breaking changes. */
export const MOVE_SCHEMA_VERSION = 1;

/**
 * The abstract combat verb a move is performed as. It names the stamina action
 * (`spendStamina(…, verb, cost)`) and is what a cancel window's `into` matches.
 */
export const MOVE_VERBS = ['attack', 'dodge', 'parry'] as const;
/** What a cancel window lets the move be cancelled into. */
export const CANCEL_TARGETS = ['attack', 'dodge', 'block'] as const;
/** The motion of a hitting move (hit reactions, block direction, animation choice). */
export const SWING_KINDS = ['horizontal', 'vertical', 'thrust'] as const;
/** Coarse reach buckets for AI spacing (e04.20 `rangeFor`); the hit volume is authoritative. */
export const REACH_CLASSES = ['close', 'short', 'medium', 'long'] as const;

/** Animation clip ids (style bible §15.1), e.g. `anim-knight-sword-light-1`. */
export const ANIM_ID_PATTERN = /^anim-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Audio cue ids (audio bible §6, without the round-robin number), e.g. `sfx-knight-sword-swing-light`. */
export const AUDIO_CUE_PATTERN = /^sfx-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** VFX cue ids (style bible §15.1), e.g. `vfx-sword-trail-light`. */
export const VFX_CUE_PATTERN = /^vfx-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A combat verb. */
export type MoveVerb = (typeof MOVE_VERBS)[number];
/** A cancel target. */
export type CancelTarget = (typeof CANCEL_TARGETS)[number];
/** A swing kind. */
export type SwingKind = (typeof SWING_KINDS)[number];
/** A reach class. */
export type ReachClass = (typeof REACH_CLASSES)[number];

const ticks = z.int().nonnegative();
const points = z.number().nonnegative();
const finite = z.number();
const positive = z.number().positive();

const vec3 = z.strictObject({ x: finite, y: finite, z: finite });

const tickRangeShape = {
  from: ticks.describe('First tick (inclusive), counted from the move’s first startup tick.'),
  to: ticks.describe('Last tick (inclusive); at least from, and inside the move.'),
};
const tickRange = z.strictObject(tickRangeShape);

const framesSchema = z
  .strictObject({
    startup: ticks.describe('Windup ticks before the hit can land.'),
    active: ticks.describe('Ticks the hitbox (or the dodge’s motion) is live.'),
    recovery: ticks.describe('Ticks after active before the move ends.'),
  })
  .describe('Frame data in sim ticks (60 Hz); the move lasts startup + active + recovery ticks.');

const cancelWindowSchema = z.strictObject({
  into: z.enum(CANCEL_TARGETS).describe('What the move may be cancelled into.'),
  ...tickRangeShape,
  move: ref('move')
    .optional()
    .describe(
      'The move a request of kind `into` starts instead when it cancels through this window, e.g. ' +
        'a roll’s attack window starts the roll attack (e04.8); absent = the requested move.',
    ),
});

/** Directions a move's motion can travel (resolved by the dodge rule, e04.8). */
export const MOTION_DIRECTIONS = ['input', 'backward'] as const;
/** A motion direction. */
export type MotionDirection = (typeof MOTION_DIRECTIONS)[number];

const motionSchema = z
  .strictObject({
    distance: points.describe(
      'Metres travelled, spread evenly over the active ticks; the character stands still (grounded) ' +
        'on the move’s other ticks. Walls stop it; ledges do not.',
    ),
    direction: z
      .enum(MOTION_DIRECTIONS)
      .describe(
        '"input": the direction held when the move was requested, relative to the camera or ' +
          'lock-on target (facing when none); "backward": away from the facing.',
      ),
  })
  .describe('Root motion of a committed move, e.g. a roll’s 3.0 m (e04.8); absent = none.');

/**
 * A damage packet template: the DamagePacketInput fields known before a hit lands. Shared by moves and
 * creature attacks' extra packets (attack.ts), so every hit is described in one vocabulary.
 */
export const damageTemplateSchema = z
  .strictObject({
    amounts: z
      .partialRecord(z.enum(DAMAGE_TYPES), points)
      .describe('Damage points per damage type (before resistances); unlisted types deal 0.'),
    poiseDamage: points.default(0).describe('Poise damage in points.'),
    staminaDamage: points
      .default(0)
      .describe('Stamina drained from a blocker, in points (before shield stability).'),
    impulse: vec3
      .prefault({ x: 0, y: 0, z: 0 })
      .describe('Knockback impulse, N·s, in the attacker’s frame (+z forward, +y up).'),
    impactForce: points.default(0).describe('Peak impact force, N (breakables, knockdown).'),
    tags: z
      .array(contentId)
      .prefault([])
      .describe('Damage-packet tags every hit carries, e.g. "critical" (damage model tags).'),
  })
  .describe(
    'Damage packet template: what each hit applies through the damage model. Required with a hitbox.',
  );

const sphereSchema = z.strictObject({
  kind: z.literal('sphere'),
  center: vec3.describe('Centre, metres, attacker frame.'),
  radius: positive.describe('Radius, metres.'),
});
const capsuleSchema = z.strictObject({
  kind: z.literal('capsule'),
  from: vec3.describe('One end of the axis (e.g. the hilt), metres, attacker frame.'),
  to: vec3.describe('Other end of the axis (e.g. the tip), metres, attacker frame.'),
  radius: positive.describe('Radius around the axis, metres.'),
});
const boxSchema = z.strictObject({
  kind: z.literal('box'),
  center: vec3.describe('Centre, metres, attacker frame.'),
  halfExtents: z
    .strictObject({ x: positive, y: positive, z: positive })
    .describe('Half the size on each axis, metres.'),
});

const hitboxSchema = z
  .strictObject({
    track: contentId.describe(
      'Socket track (socket-track content, e04.26) that animates the volume across the active ' +
        'ticks, e.g. "knight-sword-arc-light-1"; it must exist and have at most active + 1 keys.',
    ),
    shape: z
      .discriminatedUnion('kind', [sphereSchema, capsuleSchema, boxSchema])
      .describe(
        'Hit volume in the attacker’s frame at the track’s rest pose, metres, using the stimulus ' +
          'shape vocabulary: { kind: "sphere", center, radius }, { kind: "capsule", from, to, ' +
          'radius } or { kind: "box", center, halfExtents }.',
      ),
    reach: z.enum(REACH_CLASSES).describe('Reach class for AI spacing.'),
    swing: z.enum(SWING_KINDS).describe('Swing motion: horizontal, vertical or thrust.'),
    friendlyFire: z
      .boolean()
      .optional()
      .describe(
        'The volume also strikes the attacker’s allies (e04.2), so creatures can be tricked into ' +
          'hitting each other; absent = false (allies are ignored).',
      ),
  })
  .describe('Hit volume of a move that can hit; absent = it never hits (dodges, parries).');

const flagsSchema = z
  .strictObject({
    parryable: z
      .boolean()
      .default(true)
      .describe('A parry in its window deflects it (e04.12). Only meaningful with a hitbox.'),
    unblockable: z
      .boolean()
      .default(false)
      .describe(
        'Passes through shields (grabs, some slams); otherwise a hitting move is blockable.',
      ),
    parryNote: z
      .string()
      .min(1)
      .optional()
      .describe('Why a move is both parryable and unblockable (silences that warning).'),
    interruptible: z
      .boolean()
      .default(false)
      .describe('A shield bash (e04.14) can interrupt it, e.g. spell windups.'),
    hyperarmor: z
      .strictObject({
        ...tickRangeShape,
        poiseCap: positive.describe('Poise damage it absorbs before it breaks, in points.'),
      })
      .optional()
      .describe('Ticks during which hits do not interrupt the move, up to poiseCap poise damage.'),
    iframes: tickRange
      .optional()
      .describe('Invulnerable ticks: hits apply no damage, poise or reaction (e04.8).'),
  })
  .prefault({})
  .describe('Defence-related flags and tick windows.');

const chargeSchema = z
  .strictObject({
    from: ref('move').describe('The uncharged move this is the full charge of (e.g. the heavy).'),
    minHoldTicks: ticks.describe('Hold ticks below which the uncharged move is used instead.'),
    fullHoldTicks: z
      .int()
      .positive()
      .describe('Hold ticks at which the charge is full; values lerp from the uncharged move.'),
    autoReleaseTicks: z.int().positive().describe('Hold ticks at which it releases on its own.'),
  })
  .describe(
    'A charged move: its damage and stamina cost are the full-charge values, lerped from `from` ' +
      'by hold time (e04.13).',
  );

const presentationSchema = z
  .strictObject({
    anim: z
      .string()
      .regex(ANIM_ID_PATTERN, 'must be an animation id, e.g. "anim-knight-sword-light-1"')
      .describe('Animation clip id (style bible §15.1), e.g. "anim-knight-sword-light-1".'),
    audioCue: z
      .string()
      .regex(AUDIO_CUE_PATTERN, 'must be an audio cue id, e.g. "sfx-knight-sword-swing-light"')
      .optional()
      .describe(
        'Audio cue id (audio bible §6) of the move’s sound, e.g. "sfx-knight-sword-swing-light".',
      ),
    vfxCue: z
      .string()
      .regex(VFX_CUE_PATTERN, 'must be a VFX cue id, e.g. "vfx-sword-trail-light"')
      .optional()
      .describe('VFX cue id (style bible §15.1), e.g. "vfx-sword-trail-light".'),
  })
  .describe('Presentation ids: unknown ids warn (assets may lag) but never fail validation.');

interface RangeCheck {
  readonly path: readonly (string | number)[];
  readonly range: { readonly from: number; readonly to: number } | undefined;
}

/** Schema of one move file, `src/content/data/move/<id>.json`. */
export const moveSchema = z
  .strictObject({
    id: contentId.describe('Unique move id, e.g. "sword-light-1". Stable once shipped (saves).'),
    schemaVersion: z
      .literal(MOVE_SCHEMA_VERSION)
      .default(MOVE_SCHEMA_VERSION)
      .describe('MoveDef schema version, for future migrations.'),
    notes: z
      .string()
      .min(1)
      .describe('Where the numbers come from (bead, design intent), for owner review.'),
    verb: z.enum(MOVE_VERBS).describe('Combat verb: the stamina action and cancel-into category.'),
    frames: framesSchema,
    staminaCost: points.default(0).describe('Stamina points spent on the first startup tick.'),
    cancelWindows: z
      .array(cancelWindowSchema)
      .prefault([])
      .describe('Tick ranges in which the move may be cancelled into another action.'),
    damage: damageTemplateSchema.optional(),
    hitbox: hitboxSchema.optional(),
    flags: flagsSchema,
    telegraphTick: ticks
      .default(0)
      .describe(
        'Tick the telegraph (TelegraphStarted, e04.20) fires; before the first active tick.',
      ),
    chainNext: ref('move')
      .optional()
      .describe('Move the next attack press chains into (e.g. light 1 → light 2); absent = none.'),
    charge: chargeSchema.optional(),
    motion: motionSchema.optional(),
    hitStop: z
      .enum(HIT_STOP_TIERS)
      .optional()
      .describe(
        'Hit-stop tier of its hits (e04.11): how long a hit freezes attacker and victim, from the ' +
          'hit-stop table (light, heavy, charged, parry, critical). Only with a hitbox; absent = light.',
      ),
    presentation: presentationSchema,
  })
  .superRefine((move, ctx) => {
    const { startup, active, recovery } = move.frames;
    const total = startup + active + recovery;
    const fail = (path: readonly (string | number)[], message: string) => {
      ctx.addIssue({ code: 'custom', path: [...path], message: `move "${move.id}": ${message}` });
    };
    if (total === 0) fail(['frames'], 'must last at least one tick');

    const ranges: RangeCheck[] = [
      { path: ['flags', 'hyperarmor'], range: move.flags.hyperarmor },
      { path: ['flags', 'iframes'], range: move.flags.iframes },
      ...move.cancelWindows.map((range, i) => ({ path: ['cancelWindows', i], range })),
    ];
    for (const { path, range } of ranges) {
      if (range === undefined) continue;
      if (range.to < range.from) {
        fail([...path, 'to'], `to (${String(range.to)}) is before from (${String(range.from)})`);
      } else if (range.to >= total) {
        fail(
          [...path, 'to'],
          `to (${String(range.to)}) extends beyond the move's last tick (${String(total - 1)}; ` +
            `startup + active + recovery = ${String(total)})`,
        );
      }
    }

    if (move.verb === 'attack' && move.hitbox === undefined) {
      fail(['hitbox'], 'an attack needs a hitbox');
    }
    if ((move.hitbox === undefined) !== (move.damage === undefined)) {
      fail(
        move.hitbox === undefined ? ['hitbox'] : ['damage'],
        'hitbox and damage go together: a move that can hit needs both',
      );
    }
    if (move.hitbox !== undefined && active === 0) {
      fail(['frames', 'active'], 'a move with a hitbox needs at least one active tick');
    }
    if (move.hitbox !== undefined && move.telegraphTick >= startup) {
      fail(
        ['telegraphTick'],
        `telegraphTick (${String(move.telegraphTick)}) must come before the first active tick ` +
          `(${String(startup)})`,
      );
    } else if (move.telegraphTick >= Math.max(total, 1)) {
      fail(['telegraphTick'], `telegraphTick (${String(move.telegraphTick)}) is past the move`);
    }
    if (move.chainNext?.id === move.id) fail(['chainNext'], 'a move cannot chain into itself');
    move.cancelWindows.forEach((window, i) => {
      if (window.move?.id === move.id) {
        fail(['cancelWindows', i, 'move'], 'a move cannot cancel into itself');
      }
    });
    if (move.hitStop !== undefined && move.hitbox === undefined) {
      fail(['hitStop'], 'only a move with a hitbox has a hit-stop tier');
    }
    if (move.motion !== undefined && move.motion.distance > 0 && active === 0) {
      fail(['motion'], 'a move with motion needs at least one active tick to travel on');
    }

    const charge = move.charge;
    if (charge !== undefined) {
      if (charge.from.id === move.id) fail(['charge', 'from'], 'cannot be the move itself');
      if (charge.minHoldTicks > charge.fullHoldTicks) {
        fail(['charge', 'minHoldTicks'], 'must be at most fullHoldTicks');
      }
      if (charge.fullHoldTicks > charge.autoReleaseTicks) {
        fail(['charge', 'fullHoldTicks'], 'must be at most autoReleaseTicks');
      }
    }
  });

/** A MoveDef as written in JSON (optional sections may be omitted). */
export type MoveDefInput = z.input<typeof moveSchema>;
/** A validated MoveDef with every default filled and refs parsed. */
export type MoveDef = z.output<typeof moveSchema>;
/** A loaded (deeply frozen) MoveDef. */
export type MoveEntry = Frozen<MoveDef>;

/** A loaded damage packet template (see `damageTemplateSchema`). */
export type DamageTemplate = NonNullable<MoveEntry['damage']>;

/** A legal but unusual move, reported by `moveWarnings`. */
export interface MoveWarning {
  /** The move's id. */
  readonly move: string;
  /** Dotted path of the field, e.g. `presentation.audioCue`. */
  readonly path: string;
  readonly message: string;
}

/**
 * Presentation ids that exist (from the sound manifest, VFX and animation registries). A kind left
 * out is not checked, since nothing is known about it yet.
 */
export interface KnownCues {
  readonly audio?: Iterable<string>;
  readonly vfx?: Iterable<string>;
  readonly anim?: Iterable<string>;
}

/**
 * Warnings for legal but unusual moves; they never fail validation. Reports a move that is both
 * parryable and unblockable without a `flags.parryNote`, and every presentation id (anim, audioCue,
 * vfxCue) missing from the matching `known` list. Order: by move, then field.
 */
export function moveWarnings(moves: Iterable<MoveEntry>, known: KnownCues = {}): MoveWarning[] {
  const sets = {
    anim: known.anim === undefined ? undefined : new Set(known.anim),
    audioCue: known.audio === undefined ? undefined : new Set(known.audio),
    vfxCue: known.vfx === undefined ? undefined : new Set(known.vfx),
  };
  const warnings: MoveWarning[] = [];
  for (const move of moves) {
    const { flags } = move;
    if (flags.parryable && flags.unblockable && flags.parryNote === undefined) {
      warnings.push({
        move: move.id,
        path: 'flags',
        message:
          `move "${move.id}" is both parryable and unblockable (legal but unusual); ` +
          'add flags.parryNote to explain it, or set parryable: false',
      });
    }
    for (const field of ['anim', 'audioCue', 'vfxCue'] as const) {
      const id = move.presentation[field];
      const set = sets[field];
      if (id !== undefined && set !== undefined && !set.has(id)) {
        warnings.push({
          move: move.id,
          path: `presentation.${field}`,
          message: `move "${move.id}": unknown ${field} id "${id}" (placeholder until the asset lands)`,
        });
      }
    }
  }
  return warnings;
}

/** An inclusive tick range inside a move. */
export interface TickRange {
  readonly from: number;
  readonly to: number;
}

/** A cancel window as the action timeline reads it. */
export interface RuntimeCancelWindow extends TickRange {
  readonly into: CancelTarget;
  /** Id of the move a request of kind `into` starts instead through this window, or null. */
  readonly move: string | null;
}

/** Root motion as the dodge rule (e04.8) reads it. */
export interface RuntimeMotion {
  /** Metres over the active ticks. */
  readonly distance: number;
  readonly direction: MotionDirection;
}

/** A move as the action timeline (e04.4) reads it: flat, derived numbers, plain ids, nulls. */
export interface RuntimeMove {
  readonly id: string;
  readonly verb: MoveVerb;
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
  /** startup + active + recovery; the move occupies ticks 0…totalTicks−1. */
  readonly totalTicks: number;
  /** First active tick (= startup). */
  readonly activeFrom: number;
  /** First recovery tick (= startup + active). */
  readonly recoveryFrom: number;
  readonly staminaCost: number;
  readonly cancelWindows: readonly RuntimeCancelWindow[];
  /** Damage packet template (DamagePacketInput fields; impulse in the attacker's frame). */
  readonly damage: DamageTemplate | null;
  readonly hitbox: NonNullable<MoveEntry['hitbox']> | null;
  /** Can be parried (only moves that can hit). */
  readonly parryable: boolean;
  /** Can be blocked: it can hit and is not unblockable. */
  readonly blockable: boolean;
  readonly unblockable: boolean;
  readonly interruptible: boolean;
  readonly hyperarmor: (TickRange & { readonly poiseCap: number }) | null;
  readonly iframes: TickRange | null;
  readonly telegraphTick: number;
  /** Id of the move the next attack press chains into, or null. */
  readonly chainNext: string | null;
  readonly charge: {
    readonly from: string;
    readonly minHoldTicks: number;
    readonly fullHoldTicks: number;
    readonly autoReleaseTicks: number;
  } | null;
  /** Root motion (a dodge's travel), or null. */
  readonly motion: RuntimeMotion | null;
  /** Hit-stop tier of its hits (light unless the move names one), or null for a move that cannot hit. */
  readonly hitStop: HitStopTier | null;
  readonly presentation: MoveEntry['presentation'];
}

/** Every move by id (iteration in id order), frozen. */
export type MoveTable = ReadonlyMap<string, RuntimeMove>;

/** The runtime form of one loaded move. */
export function compileMove(move: MoveEntry): RuntimeMove {
  const { startup, active, recovery } = move.frames;
  const canHit = move.hitbox !== undefined;
  const { flags, charge } = move;
  return Object.freeze({
    id: move.id,
    verb: move.verb,
    startup,
    active,
    recovery,
    totalTicks: startup + active + recovery,
    activeFrom: startup,
    recoveryFrom: startup + active,
    staminaCost: move.staminaCost,
    cancelWindows: Object.freeze(
      move.cancelWindows.map(({ into, from, to, move: target }) =>
        Object.freeze({ into, from, to, move: target?.id ?? null }),
      ),
    ),
    damage: move.damage ?? null,
    hitbox: move.hitbox ?? null,
    parryable: canHit && flags.parryable,
    blockable: canHit && !flags.unblockable,
    unblockable: canHit && flags.unblockable,
    interruptible: flags.interruptible,
    hyperarmor: flags.hyperarmor ?? null,
    iframes: flags.iframes ?? null,
    telegraphTick: move.telegraphTick,
    chainNext: move.chainNext?.id ?? null,
    charge:
      charge === undefined
        ? null
        : Object.freeze({
            from: charge.from.id,
            minHoldTicks: charge.minHoldTicks,
            fullHoldTicks: charge.fullHoldTicks,
            autoReleaseTicks: charge.autoReleaseTicks,
          }),
    motion:
      move.motion === undefined
        ? null
        : Object.freeze({ distance: move.motion.distance, direction: move.motion.direction }),
    hitStop: canHit ? (move.hitStop ?? 'light') : null,
    presentation: move.presentation,
  });
}

/** The runtime move table built from loaded moves (e.g. `content.all('move')`). */
export function compileMoves(moves: Iterable<MoveEntry>): MoveTable {
  const table = new Map<string, RuntimeMove>();
  for (const move of [...moves].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    table.set(move.id, compileMove(move));
  }
  return table;
}
