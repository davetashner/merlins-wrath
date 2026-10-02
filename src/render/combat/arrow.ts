// An arrow's placeholder shaft (mw-e05.21): a pale wooden shaft with a dark head and light fletching,
// tip at the origin, pointing along +z (the shaft trails back along −z), 0.75 m long. Final arrow
// art and trails are mw-e29.11's.
//
// Cheap by design: every arrow shares one geometry and one material per part, casts no shadow, and
// is a handful of triangles, so a quiver's worth stuck about a room costs next to nothing. Because
// the resources are shared, a despawned arrow's shaft is only taken out of the scene
// (`disposeArrowShaft`), never freed.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright bow e2e (e2e/bow.spec.ts).

import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three';

/** Shaft length, metres. */
export const ARROW_LENGTH = 0.75;

const HEAD_LENGTH = 0.05;

let parts:
  | {
      readonly shaft: CylinderGeometry;
      readonly head: ConeGeometry;
      readonly fletch: BoxGeometry;
      readonly wood: MeshStandardMaterial;
      readonly iron: MeshStandardMaterial;
      readonly feather: MeshStandardMaterial;
    }
  | undefined;

function shared() {
  if (parts !== undefined) return parts;
  // Cylinders and cones stand along +y; turn them to lie along +z.
  const shaft = new CylinderGeometry(0.008, 0.008, ARROW_LENGTH - HEAD_LENGTH, 5);
  shaft.rotateX(Math.PI / 2);
  shaft.translate(0, 0, -(HEAD_LENGTH + (ARROW_LENGTH - HEAD_LENGTH) / 2));
  const head = new ConeGeometry(0.018, HEAD_LENGTH, 5);
  head.rotateX(Math.PI / 2);
  head.translate(0, 0, -HEAD_LENGTH / 2);
  const fletch = new BoxGeometry(0.002, 0.04, 0.12);
  fletch.translate(0, 0, -ARROW_LENGTH + 0.08);
  parts = {
    shaft,
    head,
    fletch,
    wood: new MeshStandardMaterial({ color: new Color(0xb8925a), roughness: 0.9 }),
    iron: new MeshStandardMaterial({ color: new Color(0x3a3a40), roughness: 0.5, metalness: 0.6 }),
    feather: new MeshStandardMaterial({ color: new Color(0xe8e0d0), roughness: 1 }),
  };
  return parts;
}

/** A new arrow shaft (see the file header). */
export function createArrowShaft(): Object3D {
  const { shaft, head, fletch, wood, iron, feather } = shared();
  const group = new Group();
  group.name = 'arrow';
  const vane = new Mesh(fletch, feather);
  const crossed = new Mesh(fletch, feather);
  crossed.rotation.z = Math.PI / 2;
  group.add(new Mesh(shaft, wood), new Mesh(head, iron), vane, crossed);
  return group;
}

/** Takes a shaft out of the scene, keeping the shared geometry and materials. */
export function disposeArrowShaft(object: Object3D): void {
  object.removeFromParent();
}
