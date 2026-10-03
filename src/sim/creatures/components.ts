// Creature state in the sim (mw-e12.4): what a spawned creature carries besides its combat body.
// Plain frozen data, so snapshots, state hashes, saves and replays carry every creature.
//
// - `creature.creature`: which creature it is and how it was spawned (so it can be respawned), its
//   behaviour profile and tuning (read by AI, e11) and its current need levels (e12.12).
// - `creature.senses`: its resolved sense profile (perception, e11).
// - `creature.nav`: its nav agent, derived from its locomotion (navigation, e12.6).

import type { Frozen, NavAgent, SenseProfile } from '@content/index';
import { defineComponent } from '../core/component';
import type { PatrolRoutine } from '../ai/routes';
import type { Vec3 } from '../stimulus/shapes';

/** Where and how a creature was spawned: enough to spawn it again (`respawnCreature`). */
export interface CreatureOrigin {
  /** Creature id (content `creature`). */
  readonly creature: string;
  /** Its feet, metres. */
  readonly at: Vec3;
  /** Unit horizontal direction it faced. */
  readonly facing: Vec3;
  /** The scene spawn point it came from; absent for console and test spawns. */
  readonly point?: string;
  /** The faction it joined instead of its definition's; absent = the definition's. */
  readonly faction?: string;
  /** Its patrol route, metres, walked in order by AI (e11); absent = none. */
  readonly patrol?: readonly Vec3[];
  /** The routes it walks, each in its window of hours (mw-e11.9); absent = none. */
  readonly routine?: readonly PatrolRoutine[];
}

/** A spawned creature. */
export interface Creature {
  readonly origin: CreatureOrigin;
  /** Behaviour profile id (e11). */
  readonly behaviour: string;
  /** Numeric overrides of the behaviour profile's tuning. */
  readonly tuning: Readonly<Record<string, number>>;
  /** Need id → current level, 0–100 (e12.12); every need starts at 0. */
  readonly needs: Readonly<Record<string, number>>;
}

/** The creature component (`creature.creature`; a snapshot and save key, never renamed). */
export const CreatureComponent = defineComponent<Creature>('creature.creature');

/** Resolved senses (`creature.senses`; a snapshot and save key, never renamed). */
export const CreatureSensesComponent = defineComponent<Frozen<SenseProfile>>('creature.senses');

/** Nav agent (`creature.nav`; a snapshot and save key, never renamed). */
export const CreatureNavComponent = defineComponent<Frozen<NavAgent>>('creature.nav');

/** Every creature component, for `world.register(...CREATURE_COMPONENTS)`. */
export const CREATURE_COMPONENTS = Object.freeze([
  CreatureComponent,
  CreatureSensesComponent,
  CreatureNavComponent,
] as const);
