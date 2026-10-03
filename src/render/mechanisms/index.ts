// Door leaves on screen (mw-e03.18): one box per door, sized to its leaf and hung from its pivot (the
// hinge of a hinged door or trapdoor, the foot of a portcullis or sliding door), so following the
// sim's leaf pose (src/game/mechanisms `readDoorLeaf`) swings, lifts or slides it. Cheap by design:
// every leaf shares one unit box and one material per material class (wood, iron, stone), casts a
// shadow like the level it stands in, and only scenes with doors make any. A removed leaf is only
// taken out of the scene (`disposeDoorLeaf`): the shared geometry and materials are never freed.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright mechanisms e2e (e2e/mechanisms.spec.ts).

import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { Vec3 } from '@sim/index';

/** Leaf colours by material; anything else reads as the greybox interactive blue. */
const LEAF_COLOURS: Readonly<Record<string, number>> = {
  wood: 0x8a5a32,
  iron: 0x4b4f57,
  stone: 0x8d8f94,
};
const OTHER_COLOUR = 0x3d7bc4;

let box: BoxGeometry | undefined;
const materials = new Map<number, MeshStandardMaterial>();

function materialFor(colour: number): MeshStandardMaterial {
  let material = materials.get(colour);
  if (material === undefined) {
    material = new MeshStandardMaterial({ color: new Color(colour), roughness: 0.85 });
    materials.set(colour, material);
  }
  return material;
}

/**
 * A door leaf of `size` metres whose box sits at `centre` from its pivot (the object's origin), in
 * the colour of `material`.
 */
export function createDoorLeaf(size: Vec3, centre: Vec3, material: string): Object3D {
  box ??= new BoxGeometry(1, 1, 1);
  const leaf = new Mesh(box, materialFor(LEAF_COLOURS[material] ?? OTHER_COLOUR));
  leaf.name = 'door-leaf';
  leaf.scale.set(size.x, size.y, size.z);
  leaf.position.set(centre.x, centre.y, centre.z);
  leaf.castShadow = true;
  leaf.receiveShadow = true;
  const pivot = new Group();
  pivot.name = 'door';
  pivot.add(leaf);
  return pivot;
}

/** Takes a leaf out of the scene, keeping the shared geometry and materials. */
export function disposeDoorLeaf(object: Object3D): void {
  object.removeFromParent();
}
