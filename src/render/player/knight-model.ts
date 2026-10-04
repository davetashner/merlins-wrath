// The knight's models (mw-e37.21, mw-juy): the Tripo image-to-3D body of char-knight-base-01 skinned
// onto the animation rig, with the sword and shield as separate props on the rig's hands. Image-to-3D
// tools return static meshes facing +x, so each is turned and placed here: the body is turned to face
// −z (the rig's forward), stood on the ground and bound to the nearest grey-box bones (autoSkin), so
// the animation runtime poses it with no per-model skeleton; each prop is scaled, turned and fixed to
// one bone, so it moves exactly as that bone does.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright testbed player e2e (e2e/testbed-player.spec.ts).

import {
  Bone,
  Group,
  Mesh,
  Float32BufferAttribute,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from 'three';
import {
  placeGeometry,
  readGlbMesh,
  turnAndGround,
  type GlbModel,
  type Placement,
} from '../models/glb';
import { autoSkin, restSegments, type GreyboxRig, type Pose, type Rig } from '../animation/index';

/** Where the optimised models are served from (public/assets/model). */
export const KNIGHT_MODEL_URL = '/assets/model/model-char-knight-01.glb';

/** A mesh and its material, in the space its consumer expects. */
export type KnightModel = GlbModel;

/** How a held prop sits on its bone: a placement (see Placement) plus the file and the bone. */
export interface PropPlacement extends Placement {
  readonly url: string;
  /** The rig bone the prop is fixed to. */
  readonly bone: string;
}

/** A prop loaded and placed, ready to attach to `bone`. */
export interface KnightProp extends KnightModel {
  readonly bone: string;
}

/** The knight: the body, and whichever props loaded (a missing prop is left off, not fatal). */
export interface KnightAssets {
  readonly body: KnightModel;
  readonly props: readonly KnightProp[];
}

/** The sword, in the right hand (the rig's `sword` bone hangs from the right forearm). */
export const SWORD_PLACEMENT: PropPlacement = {
  url: '/assets/model/model-prop-arming-sword-01.glb',
  bone: 'sword',
  // Tripo leaves the sword tilted 37.3° in the y–z plane, hilt up and back: this stands it blade-down.
  rotateDeg: [37.3, 0, 0],
  length: 0.85,
  anchor: 'top',
  // The grip, not the pommel, sits in the hand.
  offset: [0, 0.1, 0],
};

/** The shield, on the left forearm. */
export const SHIELD_PLACEMENT: PropPlacement = {
  url: '/assets/model/model-prop-wooden-shield-01.glb',
  bone: 'forearm-l',
  // Tripo's shield faces +x with the boss toward +x: +90° about y turns it to face −z, like the body.
  rotateDeg: [0, 90, 0],
  length: 0.75,
  anchor: 'centre',
  offset: [-0.12, -0.1, -0.16],
};

/** Loads the knight's body and puts it in rig space (feet at y = 0, facing −z). */
export async function loadKnightModel(url: string = KNIGHT_MODEL_URL): Promise<KnightModel> {
  const model = await readGlbMesh(url);
  // +90° about y: the mesh's +x (front) becomes −z.
  turnAndGround(model.geometry, 90);
  return model;
}

/** Loads a held prop and places it as `placement` says, in its bone's space. */
export async function loadKnightProp(placement: PropPlacement): Promise<KnightProp> {
  const { geometry, material } = await readGlbMesh(placement.url);
  placeGeometry(geometry, placement, placement.url);
  return { geometry, material, bone: placement.bone };
}

/**
 * Loads the knight: the body (required; rejects if it cannot load) and the sword and shield (each
 * optional: one that fails is left off).
 */
export async function loadKnight(): Promise<KnightAssets> {
  const [body, sword, shield] = await Promise.allSettled([
    loadKnightModel(),
    loadKnightProp(SWORD_PLACEMENT),
    loadKnightProp(SHIELD_PLACEMENT),
  ]);
  if (body.status === 'rejected') throw body.reason as Error;
  const props: KnightProp[] = [];
  for (const prop of [sword, shield]) {
    if (prop.status === 'fulfilled') props.push(prop.value);
    else console.warn('A knight prop did not load; leaving it off.', prop.reason);
  }
  return { body: body.value, props };
}

/**
 * The knight skinned to `rig`: a bone hierarchy at the rig's rest offsets (the same shape
 * createGreyboxRig builds) with the body mesh bound to it and each prop fixed to its bone. `apply` and
 * `lower` pose it exactly as the grey-box view, so either drives the same animation.
 */
export function createKnightRig(rig: Rig, assets: KnightAssets): GreyboxRig {
  const root = new Group();
  root.name = `${rig.id}-knight`;
  const bones: Bone[] = [];
  rig.defs.forEach((def, i) => {
    const bone = new Bone();
    bone.name = def.bone;
    bone.position.set(def.offset[0], def.offset[1], def.offset[2]);
    const parent = rig.parents[i] ?? -1;
    (parent < 0 ? root : (bones[parent] ?? root)).add(bone);
    bones.push(bone);
  });
  const geometry = assets.body.geometry.clone();
  const position = geometry.getAttribute('position');
  // The sword is its own prop, so no body vertex binds to the sword bone.
  const held = new Set<number>(rig.index.has('sword') ? [rig.index.get('sword') ?? -1] : []);
  const skin = autoSkin(position.array, restSegments(rig), held);
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skin.indices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skin.weights, 4));
  const mesh = new SkinnedMesh(geometry, assets.body.material);
  mesh.name = 'knight-mesh';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // The bounding sphere is the bind pose's; poses swing the arms past it.
  mesh.frustumCulled = false;
  root.add(mesh);
  for (const prop of assets.props) {
    const bone = bones[rig.index.get(prop.bone) ?? -1];
    if (bone === undefined) continue;
    const propMesh = new Mesh(prop.geometry, prop.material);
    propMesh.name = `knight-${prop.bone}-prop`;
    propMesh.castShadow = true;
    propMesh.receiveShadow = true;
    bone.add(propMesh);
  }
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones), mesh.matrixWorld);
  return {
    root,
    apply(pose: Pose) {
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
    lower(metres) {
      const pelvis = bones[0];
      const rest = rig.defs[0]?.offset[1] ?? 0;
      if (pelvis !== undefined) pelvis.position.y = rest - metres;
    },
  };
}
