// What a break leaves on screen (mw-e03.11): a box per piece of debris and per spilled prop, sized to
// its body and following it. Cheap by design: every box shares one unit geometry and one material per
// kind (debris, spilled prop), is scaled to its body, casts no shadow, and the sim caps debris with
// its budget, so a collapsing wall costs a few draw calls for a few seconds and a scene with nothing
// breakable none at all. Because the resources are shared, a removed box is only taken out of the
// scene (`disposeLeftover`), never freed.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright breakables e2e (e2e/breakables.spec.ts).

import { BoxGeometry, Color, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { Vec3 } from '@sim/index';

/** Rubble grey, a shade lighter than the blocking walls it usually comes from. */
const DEBRIS_COLOUR = 0x7a7f88;
/** Spilled props read as interactive (the greybox interactive blue). */
const SPILLED_COLOUR = 0x3d7bc4;

let parts:
  | {
      readonly box: BoxGeometry;
      readonly debris: MeshStandardMaterial;
      readonly spilled: MeshStandardMaterial;
    }
  | undefined;

function shared() {
  parts ??= {
    box: new BoxGeometry(1, 1, 1),
    debris: new MeshStandardMaterial({ color: new Color(DEBRIS_COLOUR), roughness: 1 }),
    spilled: new MeshStandardMaterial({ color: new Color(SPILLED_COLOUR), roughness: 0.9 }),
  };
  return parts;
}

/** A box of `size` metres for a piece of debris, or for a spilled prop when `spilled`. */
export function createLeftover(size: Vec3, spilled: boolean): Object3D {
  const { box, debris, spilled: prop } = shared();
  const mesh = new Mesh(box, spilled ? prop : debris);
  mesh.name = spilled ? 'spilled' : 'debris';
  mesh.scale.set(size.x, size.y, size.z);
  mesh.receiveShadow = true;
  return mesh;
}

/** Takes a leftover out of the scene, keeping the shared geometry and materials. */
export function disposeLeftover(object: Object3D): void {
  object.removeFromParent();
}
