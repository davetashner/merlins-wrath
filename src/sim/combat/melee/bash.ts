// The shield bash (mw-e04.14): the shield as a tool, not just a wall. The knight bashes by attacking
// while it blocks (block + attack: a chord on its ActionInput, the action timeline's input stage), and
// the bash is an ordinary move from content (`shield-bash`): its frames, stamina, damage and world
// impact are data. What it does comes from the same rules as every other hit, keyed by its data:
//
// - its hits are tagged `interrupt`: a target in a move flagged interruptible (a spell windup) has it
//   cancelled and flinches (the hit reactions' rule, reactions.ts);
// - and `guard-crush`: a shieldless guard (a shield of kind `weapon`) breaks outright for the guard
//   break's 60 ticks (the shield rule, guard.ts);
// - its world impact is a forward shove with a weight limit and a blunt knock (strikes.ts): things up
//   to 60 kg are pushed by physics, heavier ones resist (ImpactResisted), and breakables take the
//   knock through their own properties (mw-e03.11) — nothing here knows what a barrel or a
//   barricade is.
//
// Without a shield there is nothing to bash with: a request for the bash from an entity without a
// guard starts its fallback instead (the knight's kick, `bashRedirect`). Stamina follows the usual
// last-action rule: any stamina left pays for the bash, which leaves the pool at 0.

import type { RuntimeMove } from '@content/index';
import type { EntityId } from '../../core/component';
import type { World } from '../../core/world';
import type { MoveRedirect } from '../timeline/timeline';
import { guardOf } from './components';

/** Which request is the bash, and what a shieldless fighter does instead. */
export interface BashMoves {
  /** The bash move, e.g. `shield-bash`. */
  readonly bash: string;
  /** The move started instead when the requester carries no shield, e.g. `kick`. */
  readonly fallback: string;
}

/**
 * The action timeline's redirect for the bash: a request for `bash` from an entity without a guard
 * (no shield equipped) starts `fallback` instead.
 */
export function bashRedirect(moves: BashMoves): MoveRedirect {
  return (world, entity, requested) =>
    requested === moves.bash && guardOf(world, entity) === undefined ? moves.fallback : undefined;
}

/** The first of `redirects` that replaces a starting move, in order (undefined entries skipped). */
export function firstRedirect(...redirects: readonly (MoveRedirect | undefined)[]): MoveRedirect {
  const chain = redirects.filter((r): r is MoveRedirect => r !== undefined);
  return (world: World<never>, entity: EntityId, requested: string, resolved: RuntimeMove) => {
    for (const redirect of chain) {
      const id = redirect(world, entity, requested, resolved);
      if (id !== undefined) return id;
    }
    return undefined;
  };
}
