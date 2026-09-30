// The player's placeholder body (mw-e02.23, mw-e02.6): the grey-box humanoid rig in the knight's
// colours, animated from the sim's locomotion. Its origin is the feet and it faces −z (look yaw 0),
// matching the transform the testbed player binds to it. Real character models replace it through the
// e37 pipeline; the animation runtime does not change.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright testbed player e2e (e2e/testbed-player.spec.ts).

import { createGreyboxRig, type GreyboxRig, type Rig } from '../animation/index';

/** The player body's tint (the old capsule's parchment). */
export const PLAYER_BODY_COLOUR = 0xd8d2c4;

/** The player's body: `rig` (the grey-box humanoid) as boxes, named "player". */
export function createPlayerBody(rig: Rig): GreyboxRig {
  const body = createGreyboxRig(rig, PLAYER_BODY_COLOUR);
  body.root.name = 'player';
  return body;
}
