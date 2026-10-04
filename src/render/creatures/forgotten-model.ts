// The Forgotten miner's models (mw-2l9, mw-1ja): the four Tripo image-to-3D skeletons of
// creature-forgotten-miner-base-01 and the mining pick, each loaded once and shared by every miner
// wearing it (which look a miner wears: variant.ts). Creatures face +z (see index.ts), the
// mesh arrives facing +x, so the body is turned −90° about y and stood on the ground. The model is
// a static mesh; miner-rig.ts skins it onto the humanoid animation rig so it walks and swings.
// The pick is a separate prop held in the right hand (the creature's −x side).
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright creature e2e (e2e/creatures.spec.ts).

import { Vector3 } from 'three';
import {
  placeGeometry,
  readGlbMesh,
  turnAndGround,
  type GlbModel,
  type Placement,
} from '../models/glb';
import { rightHandPoint } from './variant';

/**
 * The miner's four looks, in order (public/assets/model): 01 is flat variant b (the first modelled),
 * 02 to 04 are variants a, c and d of creature-forgotten-miner-base-01.
 */
export const FORGOTTEN_MINER_URLS = [
  '/assets/model/model-creature-forgotten-miner-01.glb',
  '/assets/model/model-creature-forgotten-miner-02.glb',
  '/assets/model/model-creature-forgotten-miner-03.glb',
  '/assets/model/model-creature-forgotten-miner-04.glb',
] as const;
export const MINER_PICK_URL = '/assets/model/model-prop-miner-pick-01.glb';

/** Where a miner's right hand is when its model has none to find, in its own space. */
const DEFAULT_HAND = new Vector3(-0.42, 0.83, 0);

/**
 * The pick in the right hand, in the miner's own (unscaled) space: Tripo leaves it tilted 17.9° in
 * the y-z plane, so +17.9° about x stands the haft upright; the head swings fore and aft. The butt
 * sits 0.12 m below `hand` so the fist grips the lower haft.
 */
export function pickPlacement(hand: Vector3): Placement {
  return {
    rotateDeg: [17.9, 0, 0],
    length: 0.85,
    anchor: 'bottom',
    offset: [hand.x, hand.y - 0.12, hand.z],
  };
}

/** The miner: the body (required) and the pick (optional). */
export interface ForgottenAssets {
  readonly body: GlbModel;
  readonly pick: GlbModel | undefined;
}

const loading = new Map<number, Promise<ForgottenAssets>>();
let rawPick: Promise<GlbModel | undefined> | undefined;

/** The pick as it comes from its file, read once and copied for each look. */
function loadRawPick(): Promise<GlbModel | undefined> {
  rawPick ??= readGlbMesh(MINER_PICK_URL).catch((error: unknown) => {
    console.warn('The miner pick did not load; leaving it off.', error);
    return undefined;
  });
  return rawPick;
}

/**
 * Loads look `variant` (0 to 3) of the miner once; every miner wearing it shares the result. Each look
 * gets its own copy of the pick, set in that skeleton's own right hand. Rejects when the body cannot
 * load (a pick that fails is left off), and the next call then tries again.
 */
export function loadForgottenMiner(variant = 0): Promise<ForgottenAssets> {
  const index = Math.min(Math.max(Math.trunc(variant), 0), FORGOTTEN_MINER_URLS.length - 1);
  const cached = loading.get(index);
  if (cached !== undefined) return cached;
  const url = FORGOTTEN_MINER_URLS[index] ?? FORGOTTEN_MINER_URLS[0];
  const pending = (async (): Promise<ForgottenAssets> => {
    const [body, pick] = await Promise.all([readGlbMesh(url), loadRawPick()]);
    // −90° about y: the mesh's +x (front) becomes +z, the creature's forward.
    turnAndGround(body.geometry, -90);
    body.geometry.computeBoundingBox();
    const height = body.geometry.boundingBox?.max.y ?? 1.8;
    const hand =
      rightHandPoint(body.geometry.getAttribute('position').array, height) ?? DEFAULT_HAND;
    let held: GlbModel | undefined;
    if (pick !== undefined) {
      held = { geometry: pick.geometry.clone(), material: pick.material };
      placeGeometry(held.geometry, pickPlacement(hand), MINER_PICK_URL);
    }
    return { body, pick: held };
  })().catch((error: unknown) => {
    loading.delete(index);
    throw error;
  });
  loading.set(index, pending);
  return pending;
}
