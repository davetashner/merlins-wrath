// The Forgotten miner's model (mw-2l9): the Tripo image-to-3D skeleton of creature-forgotten-miner-base-01
// and its mining pick, loaded once and shared by every miner. Creatures face +z (see index.ts), the
// mesh arrives facing +x, so the body is turned −90° about y and stood on the ground. The model is
// a static figure for now: creature animation lands with mw-e37.402, so it slides and does not walk.
// The pick is a separate prop held in the right hand (the creature's −x side).
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright creature e2e (e2e/creatures.spec.ts).

import {
  placeGeometry,
  readGlbMesh,
  turnAndGround,
  type GlbModel,
  type Placement,
} from '../models/glb';

/** Where the optimised models are served from (public/assets/model). */
export const FORGOTTEN_MINER_URL = '/assets/model/model-creature-forgotten-miner-01.glb';
export const MINER_PICK_URL = '/assets/model/model-prop-miner-pick-01.glb';

/**
 * The pick in the right hand, in the miner's own (unscaled) space: Tripo leaves it tilted 17.9° in
 * the y-z plane, so +17.9° about x stands the haft upright; the head swings fore and aft. The butt
 * sits 0.12 m below the hand (x −0.42, y 0.83) so the fist grips the lower haft.
 */
export const MINER_PICK_PLACEMENT: Placement = {
  rotateDeg: [17.9, 0, 0],
  length: 0.95,
  anchor: 'bottom',
  offset: [-0.42, 0.71, 0],
};

/** The miner: the body (required) and the pick (optional). */
export interface ForgottenAssets {
  readonly body: GlbModel;
  readonly pick: GlbModel | undefined;
}

let loading: Promise<ForgottenAssets> | undefined;

/**
 * Loads the miner once; every creature shares the result. Rejects when the body cannot load (a pick
 * that fails is left off), and the next call then tries again.
 */
export function loadForgottenMiner(): Promise<ForgottenAssets> {
  loading ??= (async (): Promise<ForgottenAssets> => {
    const [body, pick] = await Promise.allSettled([
      readGlbMesh(FORGOTTEN_MINER_URL),
      readGlbMesh(MINER_PICK_URL),
    ]);
    if (body.status === 'rejected') throw body.reason as Error;
    // −90° about y: the mesh's +x (front) becomes +z, the creature's forward.
    turnAndGround(body.value.geometry, -90);
    let held: GlbModel | undefined;
    if (pick.status === 'fulfilled') {
      held = pick.value;
      placeGeometry(held.geometry, MINER_PICK_PLACEMENT, MINER_PICK_URL);
    } else {
      console.warn('The miner pick did not load; leaving it off.', pick.reason);
    }
    return { body: body.value, pick: held };
  })().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
