// The knight's model (mw-e37.21): the Tripo image-to-3D mesh of char-knight-base-01, skinned onto the
// animation rig. The model arrives unrigged and facing +x with its origin at the middle of its
// height; it is turned to face −z (the rig's forward), stood on the ground, and each vertex is bound
// to the nearest grey-box bones (autoSkin), so the animation runtime poses it with no per-model
// skeleton. Sword and shield are part of the mesh until they are modelled as separate props.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright testbed player e2e (e2e/testbed-player.spec.ts).

import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  type Material,
  type Object3D,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { autoSkin, restSegments, type GreyboxRig, type Pose, type Rig } from '../animation/index';

/** Where the optimised model is served from (public/assets/model). */
export const KNIGHT_MODEL_URL = '/assets/model/model-char-knight-01.glb';

/** The knight mesh and its material, in rig space (feet at y = 0, facing −z). */
export interface KnightModel {
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

/** A float copy of `attribute` (a quantised glTF attribute holds normalised integers). */
function toFloat(attribute: BufferAttribute): Float32BufferAttribute {
  const out = new Float32Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i++) {
    for (let k = 0; k < attribute.itemSize; k++)
      out[i * attribute.itemSize + k] = attribute.getComponent(i, k);
  }
  return new Float32BufferAttribute(out, attribute.itemSize);
}

/** Loads the knight GLB and puts its mesh in rig space. Rejects when the file cannot be loaded. */
export async function loadKnightModel(url: string = KNIGHT_MODEL_URL): Promise<KnightModel> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  let found: Mesh | undefined;
  gltf.scene.traverse((object: Object3D) => {
    if (found === undefined && object instanceof Mesh) found = object;
  });
  if (found === undefined) throw new Error(`${url} contains no mesh`);
  const source = found.geometry;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', toFloat(source.getAttribute('position') as BufferAttribute));
  geometry.setAttribute('normal', toFloat(source.getAttribute('normal') as BufferAttribute));
  if (source.hasAttribute('uv')) {
    geometry.setAttribute('uv', toFloat(source.getAttribute('uv') as BufferAttribute));
  }
  if (source.index !== null) geometry.setIndex(source.index);
  // The mesh's node transform (quantisation scale), then +90° about y: its +x (front) becomes −z.
  geometry.applyMatrix4(found.matrixWorld);
  geometry.applyMatrix4(new Matrix4().makeRotationY(Math.PI / 2));
  geometry.computeBoundingBox();
  geometry.translate(0, -(geometry.boundingBox?.min.y ?? 0), 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = Array.isArray(found.material) ? found.material[0] : found.material;
  if (material === undefined) throw new Error(`${url} has no material`);
  return { geometry, material };
}

/**
 * The knight skinned to `rig`: a bone hierarchy at the rig's rest offsets (the same shape
 * createGreyboxRig builds) with the model's mesh bound to it. `apply` and `lower` pose it exactly as
 * the grey-box view, so either drives the same animation.
 */
export function createKnightRig(rig: Rig, model: KnightModel): GreyboxRig {
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
  const geometry = model.geometry.clone();
  const position = geometry.getAttribute('position');
  const skin = autoSkin(position.array, restSegments(rig));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skin.indices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skin.weights, 4));
  const mesh = new SkinnedMesh(geometry, model.material);
  mesh.name = 'knight-mesh';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // The bounding sphere is the bind pose's; poses swing the sword and shield past it.
  mesh.frustumCulled = false;
  root.add(mesh);
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
