// The combat sandbox content type (mw-e04.9): the tuning of the sandbox's dummies, one file per
// sandbox at `src/content/data/sandbox/<id>.json` (the game has one, `combat-sandbox`). Everything here
// is a placeholder the owner tunes in the sandbox itself, which is what the sandbox is for:
//
// - `dummy`: what `spawn dummy` (and a scene spawn tagged `sandbox-dummy`) creates — a combatant with
//   health, poise, resistances and region-tagged hurtboxes that does not fight back; with
//   `infiniteHealth` it never dies and its health refills after `resetAfterTicks` without a hit.
//   Its `reactions` are the impulse thresholds and body mass hit reactions (e04.7) read.
// - `attacker`: what `spawn attacker-dummy` (a spawn tagged `sandbox-attacker`) adds to a dummy — a
//   selected move performed on a metronome, every `periodTicks`, for parry and dodge practice.
// - `player`: the knight's placeholder health and poise in the greybox scenes, until the player's
//   stats arrive with the character sheet.
//
// Units: sim ticks (60 Hz), points, metres, N·s, kg. The field reference in
// docs/content/sandbox-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId, ref } from '../schema.ts';
import {
  DAMAGE_TYPES,
  HIT_REACTION_DEFAULTS,
  MAX_RESISTANCE,
  type DamageTypeName,
} from './damage.ts';

/** The game's combat sandbox tuning (`src/content/data/sandbox/combat-sandbox.json`). */
export const COMBAT_SANDBOX_ID = 'combat-sandbox';

/** Hurtbox regions a dummy can have, highest priority first (the sim's HIT_REGIONS). */
export const SANDBOX_HIT_REGIONS = ['weakpoint', 'head', 'torso', 'limb'] as const;

/** A hurtbox region name. */
export type SandboxHitRegion = (typeof SANDBOX_HIT_REGIONS)[number];

const regionMultiplier = z.number().min(0).max(10);

const dummySchema = z
  .strictObject({
    health: z.int().positive().describe('Maximum health.'),
    poise: z
      .int()
      .nonnegative()
      .describe('Maximum poise; poise damage that empties it staggers the dummy.'),
    infiniteHealth: z
      .boolean()
      .describe('Never dies: health stops at 1 and refills after resetAfterTicks without a hit.'),
    resetAfterTicks: z
      .int()
      .positive()
      .describe(
        'Sim ticks without a hit after which an infinite-health dummy refills (180 = 3 s).',
      ),
    resistances: z
      .partialRecord(z.enum(DAMAGE_TYPES), z.number().min(0).max(MAX_RESISTANCE))
      .prefault({})
      .describe('Damage multiplier per type (0 immune, <1 resists, >1 vulnerable); unlisted = 1.'),
    regions: z
      .array(z.enum(SANDBOX_HIT_REGIONS))
      .min(1)
      .refine((list) => new Set(list).size === list.length, 'regions must not repeat')
      .describe('The hurtbox regions a dummy has by default: head, torso, limb and/or weakpoint.'),
    regionMultipliers: z
      .strictObject({
        weakpoint: regionMultiplier,
        head: regionMultiplier,
        torso: regionMultiplier,
        limb: regionMultiplier,
      })
      .describe('Damage multiplier of a hit on each region (the damage model’s region stage).'),
    radius: z.number().positive().max(2).describe('Body radius, metres.'),
    reactions: z
      .strictObject({
        knockbackImpulse: z
          .number()
          .positive()
          .default(HIT_REACTION_DEFAULTS.knockbackImpulse)
          .describe('Hit impulse (N·s) at or above which a hit knocks it back.'),
        knockdownImpulse: z
          .number()
          .positive()
          .default(HIT_REACTION_DEFAULTS.knockdownImpulse)
          .describe('Hit impulse (N·s) at or above which a hit knocks it down.'),
        launchSpeed: z
          .number()
          .nonnegative()
          .default(HIT_REACTION_DEFAULTS.launchSpeed)
          .describe('Upward speed (m/s) a knockback or knockdown adds.'),
        mass: z.number().positive().describe('Body mass, kg.'),
      })
      .refine((r) => r.knockdownImpulse >= r.knockbackImpulse, {
        message: 'knockdownImpulse must be ≥ knockbackImpulse',
      })
      .describe('How it reacts to hits (mw-e04.7).'),
  })
  .describe('The training dummy `spawn dummy` creates.');

const attackerSchema = z
  .strictObject({
    move: ref('move').describe('The move it performs by default (a move with a hitbox).'),
    periodTicks: z
      .int()
      .positive()
      .describe('Sim ticks between swings: each starts on a multiple of it (120 = every 2.0 s).'),
    parryable: z.boolean().describe('Its swings can be parried (parry arrives with e04.12).'),
    unblockable: z.boolean().describe('Its swings go through shields.'),
  })
  .describe(
    'The attacker dummy `spawn attacker-dummy` creates: a dummy that swings on a metronome.',
  );

const playerSchema = z
  .strictObject({
    health: z.int().positive().describe('The knight’s maximum health.'),
    poise: z.int().nonnegative().describe('The knight’s maximum poise.'),
  })
  .describe('The knight’s placeholder health and poise in the greybox scenes.');

/** Schema of one sandbox file, `src/content/data/sandbox/<id>.json`. */
export const sandboxSchema = z.strictObject({
  id: contentId.describe('Unique sandbox id, e.g. "combat-sandbox".'),
  notes: z.string().min(1).describe('What the numbers are for, and which are placeholders.'),
  scene: ref('scene').describe('The sandbox scene (`?scene=<id>`).'),
  dummy: dummySchema,
  attacker: attackerSchema,
  player: playerSchema,
});

/** A sandbox as written in JSON. */
export type SandboxDefInput = z.input<typeof sandboxSchema>;
/** A validated sandbox. */
export type SandboxDef = z.output<typeof sandboxSchema>;
/** A loaded (deeply frozen) sandbox. */
export type SandboxEntry = Frozen<SandboxDef>;

/** A training dummy's numbers as the sim reads them. */
export interface RuntimeSandboxDummy {
  readonly health: number;
  readonly poise: number;
  readonly infiniteHealth: boolean;
  readonly resetAfterTicks: number;
  readonly resistances: Readonly<Partial<Record<DamageTypeName, number>>>;
  readonly regions: readonly SandboxHitRegion[];
  readonly regionMultipliers: Readonly<Record<SandboxHitRegion, number>>;
  readonly radius: number;
  readonly reactions: {
    readonly knockbackImpulse: number;
    readonly knockdownImpulse: number;
    readonly launchSpeed: number;
    readonly mass: number;
  };
}

/** An attacker dummy's metronome as the sim reads it. */
export interface RuntimeSandboxAttacker {
  readonly move: string;
  readonly periodTicks: number;
  readonly parryable: boolean;
  readonly unblockable: boolean;
}

/** A sandbox as the game and sim read it (plain, frozen data). */
export interface RuntimeSandbox {
  readonly id: string;
  readonly scene: string;
  readonly dummy: RuntimeSandboxDummy;
  readonly attacker: RuntimeSandboxAttacker;
  readonly player: { readonly health: number; readonly poise: number };
}

/** The runtime form of one loaded sandbox. */
export function compileSandbox(sandbox: SandboxEntry): RuntimeSandbox {
  const { dummy, attacker, player } = sandbox;
  return Object.freeze({
    id: sandbox.id,
    scene: sandbox.scene.id,
    dummy: Object.freeze({
      health: dummy.health,
      poise: dummy.poise,
      infiniteHealth: dummy.infiniteHealth,
      resetAfterTicks: dummy.resetAfterTicks,
      resistances: Object.freeze({ ...dummy.resistances }),
      regions: Object.freeze([...dummy.regions]),
      regionMultipliers: Object.freeze({ ...dummy.regionMultipliers }),
      radius: dummy.radius,
      reactions: Object.freeze({ ...dummy.reactions }),
    }),
    attacker: Object.freeze({
      move: attacker.move.id,
      periodTicks: attacker.periodTicks,
      parryable: attacker.parryable,
      unblockable: attacker.unblockable,
    }),
    player: Object.freeze({ ...player }),
  });
}
