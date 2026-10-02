// Placeholder creature bodies (mw-e12.4): every spawned creature is drawn as a grey-box capsule the
// size of its nav agent (the `placeholder-capsule` mesh of CreatureDef.presentation) until its own
// mesh lands with the asset integration beads. Origin at the feet, facing +z: a dark visor on the
// front shows which way it faces. A creature carrying attacks is rust-red, one without is slate, so
// a glance tells what might fight back.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright creature e2e (e2e/creatures.spec.ts).

import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three';

const SLATE = 0x6f7f8c;
const RUST = 0x9c4a32;
const VISOR = 0x22222e;

/** A capsule body of `radius` and `height` metres, feet at the origin; see the file header. */
export function createCreatureProxy({
  id,
  radius,
  height,
  armed,
}: {
  readonly id: string;
  readonly radius: number;
  readonly height: number;
  readonly armed: boolean;
}): Object3D {
  const group = new Group();
  group.name = `creature:${id}`;
  const length = Math.max(height - 2 * radius, 0);
  const skin = new MeshStandardMaterial({ color: new Color(armed ? RUST : SLATE), roughness: 1 });
  const body = new Mesh(new CapsuleGeometry(radius, length, 4, 12), skin);
  body.position.y = radius + length / 2;
  const visor = new Mesh(
    new BoxGeometry(radius * 1.2, Math.min(0.12, height * 0.15), radius * 0.5),
    new MeshStandardMaterial({ color: new Color(VISOR), roughness: 0.6 }),
  );
  visor.position.set(0, Math.max(height - radius * 0.9, radius), radius * 0.8);
  for (const mesh of [body, visor]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
