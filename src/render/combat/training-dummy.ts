// A training dummy's placeholder body (mw-e04.6): a straw-coloured post with a crossbar, the size of
// the sim dummy's torso hurtbox (src/game/combat/training-dummy.ts). Origin at the feet. The combat
// sandbox's dummy creatures (mw-e04.9) replace it.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright knight combat e2e (e2e/knight-combat.spec.ts).

import {
  BoxGeometry,
  CylinderGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three';

const STRAW = 0xc9a45c;
const WOOD = 0x6b4a2b;

/** A dummy `height` metres tall with a body of `radius` metres, feet at the origin. */
export function createTrainingDummy({
  radius,
  height,
}: {
  readonly radius: number;
  readonly height: number;
}): Object3D {
  const group = new Group();
  group.name = 'training-dummy';
  const post = new Mesh(
    new CylinderGeometry(0.06, 0.06, height, 8),
    new MeshStandardMaterial({ color: new Color(WOOD), roughness: 0.9 }),
  );
  post.position.y = height / 2;
  const body = new Mesh(
    new CylinderGeometry(radius, radius * 0.85, height * 0.55, 12),
    new MeshStandardMaterial({ color: new Color(STRAW), roughness: 1 }),
  );
  body.position.y = height * 0.6;
  const arms = new Mesh(
    new BoxGeometry(radius * 4, 0.12, 0.12),
    new MeshStandardMaterial({ color: new Color(WOOD), roughness: 0.9 }),
  );
  arms.position.y = height * 0.75;
  for (const mesh of [post, body, arms]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
