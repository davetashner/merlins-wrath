// The hand-off between two areas (mw-e01.11). The game builds one scene per page boot (the death
// screen's Load and Restart area work the same way), so walking into a transition volume saves what
// must outlive the area into session storage and reloads the page into the target scene; the fresh
// page loads that scene, puts the player at the named spawn and applies what was carried. Session
// storage keeps the hand-off to this tab, and it is consumed on read, so a later refresh never
// replays it.

import { z } from 'zod';

/** Session storage key of the pending transition. */
export const TRANSIT_KEY = 'vesper.transit';

/** What crosses the reload; see carry.ts for how it is made and applied. */
export interface TransitCarry {
  /** Save-section data by section id: world facts (with the clock), level deltas, merchants. */
  readonly sections: Readonly<Record<string, unknown>>;
  /** The player's own state: pack, equipment, quick slots and a few components by name. */
  readonly player: {
    readonly inventory?: unknown;
    readonly equipment?: unknown;
    readonly quickSlots?: unknown;
    readonly components: Readonly<Record<string, unknown>>;
  };
}

/** A transition in flight. */
export interface Transit {
  /** The scene left, the scene entered and the spawn of it the player arrives at. */
  readonly from: string;
  readonly to: string;
  readonly spawn: string;
  /** Companions flagged to follow travel too (none exist yet). */
  readonly follow: boolean;
  /** Display name of the area entered, for the loading overlay. */
  readonly areaName: string;
  /** Wall-clock milliseconds when the player crossed the volume, to time the transition. */
  readonly startedAt: number;
  readonly carry: TransitCarry;
}

/** The part of `Storage` the hand-off uses. */
export type TransitStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const nonEmpty = z.string().min(1);

const transitSchema = z.strictObject({
  from: nonEmpty,
  to: nonEmpty,
  spawn: nonEmpty,
  follow: z.boolean(),
  areaName: z.string(),
  startedAt: z.number(),
  carry: z.strictObject({
    sections: z.record(z.string(), z.unknown()),
    player: z.strictObject({
      inventory: z.unknown().optional(),
      equipment: z.unknown().optional(),
      quickSlots: z.unknown().optional(),
      components: z.record(z.string(), z.unknown()),
    }),
  }),
}) satisfies z.ZodType<Transit>;

/** Records a transition for the next boot. */
export function writeTransit(storage: TransitStorage, transit: Transit): void {
  storage.setItem(TRANSIT_KEY, JSON.stringify(transit));
}

/** Reads the pending transition without consuming it; malformed: undefined. */
export function peekTransit(storage: TransitStorage): Transit | undefined {
  const text = storage.getItem(TRANSIT_KEY);
  if (text === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = transitSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Reads and removes the pending transition. Malformed hand-offs are dropped, never retried. */
export function takeTransit(storage: TransitStorage): Transit | undefined {
  const transit = peekTransit(storage);
  storage.removeItem(TRANSIT_KEY);
  return transit;
}

/**
 * The search string that boots `scene`: the page's own parameters stay (`debug`, `perf`…) except
 * the ones that choose a scene, a class, a new game, a menu or a spawn, which would fight the carried
 * state.
 */
export function transitSearch(search: string, scene: string): string {
  const params = new URLSearchParams(search);
  for (const name of ['menu', 'class', 'newgame', 'spawn']) params.delete(name);
  params.set('scene', scene);
  return params.toString();
}
