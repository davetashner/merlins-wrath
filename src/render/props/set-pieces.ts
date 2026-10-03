// The slice's wall torch and floor brazier models (mw-546): Tripo image-to-3D meshes of the unlit
// props, loaded once and shared by every torch and brazier. The flame and the light come from the
// light rig at the spawn point (src/render/light), so the models carry no fire: a torch's head ends just
// below the spawn point (the flame sits on it) and a brazier rim just above it (the flame burns in the
// coals, so a brazier spawns at the height of its coals, not on the floor). A wall torch is placed with its
// wall plate on −x; the greybox view turns it to face the room from whichever side wall it hangs on.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright light and slice e2e specs.

import { placeGeometry, readGlbMesh, type GlbModel, type Placement } from '../models/glb';

export const TORCH_URL = '/assets/model/model-prop-wall-torch-01.glb';
export const BRAZIER_URL = '/assets/model/model-prop-brazier-floor-01.glb';

/**
 * The torch: 0.7 m tall, its head 5 cm under the spawn point. Tripo leaves its wall plate on −z; the
 * 90° turn about y puts it on −x, where the greybox view expects it.
 */
export const TORCH_PLACEMENT: Placement = {
  rotateDeg: [0, 90, 0],
  length: 0.7,
  anchor: 'top',
  offset: [0, -0.05, 0],
};

/** The brazier's height, metres: its rim stands 15 cm above a spawn point at the height of its coals. */
export const BRAZIER_HEIGHT = 0.9;

/** A brazier standing on the floor `spawnHeight` metres below its spawn point. */
export function brazierPlacement(spawnHeight: number): Placement {
  return {
    rotateDeg: [0, 0, 0],
    length: BRAZIER_HEIGHT,
    anchor: 'bottom',
    offset: [0, -spawnHeight, 0],
  };
}

const loading = new Map<string, Promise<GlbModel>>();

/** Loads `url` placed as `placement`, once per distinct request; a failure is forgotten so a retry can go. */
function loadPlaced(key: string, url: string, placement: Placement): Promise<GlbModel> {
  const cached = loading.get(key);
  if (cached !== undefined) return cached;
  const pending = readGlbMesh(url)
    .then((model) => {
      placeGeometry(model.geometry, placement, url);
      return model;
    })
    .catch((error: unknown) => {
      loading.delete(key);
      throw error;
    });
  loading.set(key, pending);
  return pending;
}

/** The wall torch, placed (see TORCH_PLACEMENT). */
export function loadTorch(): Promise<GlbModel> {
  return loadPlaced('torch', TORCH_URL, TORCH_PLACEMENT);
}

/** The brazier for a spawn point `spawnHeight` metres above the floor. */
export function loadBrazier(spawnHeight: number): Promise<GlbModel> {
  return loadPlaced(`brazier:${String(spawnHeight)}`, BRAZIER_URL, brazierPlacement(spawnHeight));
}
