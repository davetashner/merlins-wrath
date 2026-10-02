// World items on screen (mw-e17.7): a placeholder box per item lying in the world, sized to its body
// and coloured by category until approved item models land (mw-e37.318). Cheap by design: every box
// shares one unit geometry and one material per category (made on first use), casts no shadow and
// is scaled to its body, so a scene with a handful of items costs a handful of draw calls and one
// with none costs nothing. A removed box is only taken out of the scene, never freed.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright item e2e (e2e/items.spec.ts).

import { BoxGeometry, Color, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { Vec3 } from '@sim/index';

/** Placeholder colours by item category; anything else is the greybox interactive blue. */
const CATEGORY_COLOURS: Readonly<Record<string, number>> = {
  weapon: 0xb8bcc4,
  armor: 0x8a6f4d,
  shield: 0x9c7a46,
  ammo: 0xc9b27c,
  book: 0x7a3b2e,
  key: 0xd4a017,
  consumable: 0xc2413b,
  tool: 0x6f7d8c,
  quest: 0xe0b84c,
  artifact: 0x8e5bd1,
  currency: 0xf2c94c,
};
const DEFAULT_COLOUR = 0x3d7bc4;

let box: BoxGeometry | undefined;
const materials = new Map<string, MeshStandardMaterial>();

function materialFor(category: string): MeshStandardMaterial {
  let material = materials.get(category);
  if (material === undefined) {
    const colour = CATEGORY_COLOURS[category] ?? DEFAULT_COLOUR;
    material = new MeshStandardMaterial({ color: new Color(colour), roughness: 0.7 });
    materials.set(category, material);
  }
  return material;
}

/** A box of `size` metres for a world item of `category`. */
export function createWorldItemMesh(size: Vec3, category: string): Object3D {
  box ??= new BoxGeometry(1, 1, 1);
  const mesh = new Mesh(box, materialFor(category));
  mesh.name = `item:${category}`;
  mesh.scale.set(size.x, size.y, size.z);
  mesh.receiveShadow = true;
  return mesh;
}

/** Takes a world item's box out of the scene, keeping the shared geometry and materials. */
export function disposeWorldItemMesh(object: Object3D): void {
  object.removeFromParent();
}
