// The player's placeholder body (mw-e02.23): a capsule the size of the controller's standing capsule,
// with a small visor on its front so the facing reads at a glance. Its origin is the feet and it
// faces −z (look yaw 0), matching the transform the testbed player binds to it. Animation and the
// real character model replace it (mw-e02.6).
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright testbed player e2e (e2e/testbed-player.spec.ts).

import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three';

const BODY_COLOUR = 0xd8d2c4;
const VISOR_COLOUR = 0x2f6fb3;

/** A standing capsule of `radius` and total `height` (metres), feet at the origin, facing −z. */
export function createPlayerCapsule({
  radius,
  height,
}: {
  readonly radius: number;
  readonly height: number;
}): Object3D {
  const group = new Group();
  group.name = 'player';
  const body = new Mesh(
    new CapsuleGeometry(radius, Math.max(0, height - 2 * radius), 6, 16),
    new MeshStandardMaterial({ color: new Color(BODY_COLOUR), roughness: 0.7 }),
  );
  body.position.y = height / 2;
  const visor = new Mesh(
    new BoxGeometry(radius * 1.2, radius * 0.4, radius * 0.5),
    new MeshStandardMaterial({ color: new Color(VISOR_COLOUR), roughness: 0.4 }),
  );
  visor.position.set(0, height - radius * 0.9, -radius * 0.85);
  for (const mesh of [body, visor]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
