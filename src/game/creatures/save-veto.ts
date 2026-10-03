// The creatures' autosave veto (mw-e01.7, mw-e30.5): saving waits while any living creature is in
// Combat, so a checkpoint crossed mid-fight (the slice's CP-2 with the skeleton on the knight's
// heels) saves once the fight is over, never in the middle of it. Save code knows nothing about
// creatures; it registers this check in its SafetyVetoes under COMBAT_VETO_ID. A dead creature's
// brain may still read Combat, so the dead do not count.

import { BrainComponent, zeroHealth, type World } from '@sim/index';

/** The id the combat veto is registered under. */
export const COMBAT_VETO_ID = 'combat';

/** Why saving is unsafe while a creature fights (the pause menu's Save shows it too, mw-e01.3). */
export const COMBAT_VETO_REASON = "Can't save during combat";

/** True while any living creature with a brain in `world` is in the Combat alert state. */
export function creaturesInCombat(world: World<never>): boolean {
  if (!world.isRegistered(BrainComponent)) return false;
  let fighting = false;
  world.query(BrainComponent).forEach((entity, brain) => {
    if (!fighting && brain.state === 'combat' && !zeroHealth(world, entity)) fighting = true;
  });
  return fighting;
}

/** The safety veto: COMBAT_VETO_REASON while a creature is in Combat, else null. */
export function combatVeto(world: World<never>): () => string | null {
  return () => (creaturesInCombat(world) ? COMBAT_VETO_REASON : null);
}
