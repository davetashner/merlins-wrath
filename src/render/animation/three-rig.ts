// The grey-box placeholder view of an animation rig (mw-e02.20): one Three.js group per bone at its
// rest offset, with the bone's box shape from the graph's skeleton. Poses set bone rotations only —
// never a position — so animation cannot move a character: the entity's transform is the root
// object's, which render sync writes from the interpolated sim position (root-motion policy).
// Real skinned models replace this view through the e37 pipeline; the runtime does not change.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright animation e2e (e2e/animation.spec.ts).

import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { Rig } from './library';
import type { Pose } from './math';

/** A rig's placeholder view. */
export interface GreyboxRig {
  /** The entity's object: bind it to the entity (its transform is the sim's). */
  readonly root: Object3D;
  /** Copies a pose's local rotations into the bones. */
  apply(pose: Pose): void;
}

/** Builds the placeholder view of `rig`, its boxes tinted `colour`. */
export function createGreyboxRig(rig: Rig, colour: number): GreyboxRig {
  const root = new Group();
  root.name = rig.id;
  const material = new MeshStandardMaterial({ color: new Color(colour), roughness: 0.75 });
  const bones: Object3D[] = [];
  rig.defs.forEach((def, i) => {
    const bone = new Group();
    bone.name = def.bone;
    bone.position.set(def.offset[0], def.offset[1], def.offset[2]);
    if (def.shape !== undefined) {
      const [w, h, d] = def.shape.size;
      const mesh = new Mesh(new BoxGeometry(w, h, d), material);
      mesh.position.set(def.shape.center[0], def.shape.center[1], def.shape.center[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      bone.add(mesh);
    }
    const parent = rig.parents[i] ?? -1;
    (parent < 0 ? root : (bones[parent] ?? root)).add(bone);
    bones.push(bone);
  });
  return {
    root,
    apply(pose) {
      for (let i = 0; i < bones.length; i++) {
        const o = i * 4;
        bones[i]?.quaternion.set(
          pose[o] ?? 0,
          pose[o + 1] ?? 0,
          pose[o + 2] ?? 0,
          pose[o + 3] ?? 1,
        );
      }
    },
  };
}
