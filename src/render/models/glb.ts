// Loading and placing image-to-3D models (mw-e37.21): the tools return static meshes, so each model
// is read as float geometry and then turned, scaled and anchored where its consumer needs it. Shared
// by the knight (src/render/player/knight-model.ts) and the creatures (src/render/creatures).
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright player and creature e2e specs.

import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** A mesh and its material. */
export interface GlbModel {
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

/**
 * How a mesh is placed: first turned by `rotateDeg` (x, y, z Euler degrees), then scaled so its extent
 * along y is `length` metres, then moved so `anchor` of that extent (the grip end for a tool) and the
 * centre of its x and z extents land on `offset`.
 */
export interface Placement {
  readonly rotateDeg: readonly [number, number, number];
  readonly length: number;
  readonly anchor: 'top' | 'bottom' | 'centre';
  readonly offset: readonly [number, number, number];
}

/** A float copy of `attribute` (a quantised glTF attribute holds normalised integers). */
function toFloat(attribute: BufferAttribute): Float32BufferAttribute {
  const out = new Float32Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i++) {
    for (let k = 0; k < attribute.itemSize; k++) {
      out[i * attribute.itemSize + k] = attribute.getComponent(i, k);
    }
  }
  return new Float32BufferAttribute(out, attribute.itemSize);
}

/** The first mesh of the GLB at `url`, as float attributes with its node transform applied. */
export async function readGlbMesh(url: string): Promise<GlbModel> {
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
  geometry.applyMatrix4(found.matrixWorld);
  const material = Array.isArray(found.material) ? found.material[0] : found.material;
  if (material === undefined) throw new Error(`${url} has no material`);
  return { geometry, material };
}

/** Turns `geometry` about y by `degrees` and stands it on the ground (lowest point at y = 0). */
export function turnAndGround(geometry: BufferGeometry, degrees: number): void {
  geometry.applyMatrix4(new Matrix4().makeRotationY((degrees * Math.PI) / 180));
  geometry.computeBoundingBox();
  geometry.translate(0, -(geometry.boundingBox?.min.y ?? 0), 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/** Places `geometry` as `placement` says (see Placement). Throws if it has no extent along y. */
export function placeGeometry(geometry: BufferGeometry, placement: Placement, name: string): void {
  const [rx, ry, rz] = placement.rotateDeg.map((d) => (d * Math.PI) / 180) as [
    number,
    number,
    number,
  ];
  geometry.applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz)));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const height = box === null ? 0 : box.max.y - box.min.y;
  if (box === null || height <= 0) throw new Error(`${name} has no extent`);
  const scale = placement.length / height;
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  const placed = geometry.boundingBox;
  if (placed === null) throw new Error(`${name} has no extent`);
  const y =
    placement.anchor === 'top'
      ? placed.max.y
      : placement.anchor === 'bottom'
        ? placed.min.y
        : (placed.min.y + placed.max.y) / 2;
  geometry.translate(
    placement.offset[0] - (placed.min.x + placed.max.x) / 2,
    placement.offset[1] - y,
    placement.offset[2] - (placed.min.z + placed.max.z) / 2,
  );
  geometry.computeBoundingSphere();
}
