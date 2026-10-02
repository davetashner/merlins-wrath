// Locks (mw-e03.18): a lock id that keys name in `key.opens` (mw-e17.2), with what else gets past it.
// Thieves pick it (with lockpicks, up to its pick tier), knights break the door it sits in (a
// breakable door), sorcerers dispel a magical seal, and anyone holding a key whose `opens` lists the
// lock id or whose `opensTag` is one of its tags opens it. A scene spawn's door names the lock it
// carries (`door.lock`). One file per lock, `src/content/data/lock/<id>.json`.

import { z } from 'zod';
import { contentId } from '../schema.ts';

/** Highest lock tier. */
export const MAX_LOCK_TIER = 5;

const tier = z.int().min(0).max(MAX_LOCK_TIER);

export const lockSchema = z.strictObject({
  id: contentId.describe('The lock id keys name in `key.opens`.'),
  name: z.string().min(1).describe('Display name (debug tools and docs).'),
  notes: z.string().min(1).describe('Where it is and what opens it, for owner review.'),
  tier: tier.describe('How good the lock is, 0 (a latch) … 5 (a vault).'),
  pickTier: tier
    .nullable()
    .default(null)
    .describe(
      'Lockpicking tier needed to pick it (the minigame is mw-e10); null: it cannot be picked.',
    ),
  sealed: z
    .boolean()
    .default(false)
    .describe('A magical seal: keys and picks fail until a spell dispels it.'),
  tags: z
    .array(contentId)
    .default([])
    .describe('Tags a master key (`key.opensTag`) opens, e.g. "warden-tower".'),
  hint: z
    .string()
    .min(1)
    .default('Locked.')
    .describe('Shown when Interact finds no way past it, e.g. "Locked."'),
});

/** A lock as written in a data file. */
export type LockDefInput = z.input<typeof lockSchema>;
/** A loaded lock. */
export type LockDef = z.output<typeof lockSchema>;
