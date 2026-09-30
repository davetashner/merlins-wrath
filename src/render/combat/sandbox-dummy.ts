// The combat sandbox's dummy creatures (mw-e04.9): grey-box bodies matching the sim dummy's hurtboxes
// (src/sim/combat/sandbox: legs, a torso, a head, a weak point on the back) so what is drawn is what
// can be hit. Origin at the feet, facing +z (a nose on the head shows which way). An attacker dummy
// is rust-red and carries a wooden practice sword on its right; a training dummy is straw.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright combat sandbox e2e (e2e/combat-sandbox.spec.ts).

import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type Object3D,
} from 'three';

const STRAW = 0xc9a45c;
const RUST = 0x9c4a32;
const WOOD = 0x6b4a2b;
const MARK = 0x3b3a5a;

/** A dummy with a body of `radius` metres; `attacker` adds the sword and the attacker colour. */
export function createSandboxDummy({
  radius,
  attacker,
}: {
  readonly radius: number;
  readonly attacker: boolean;
}): Object3D {
  const group = new Group();
  group.name = attacker ? 'attacker-dummy' : 'sandbox-dummy';
  const skin = new MeshStandardMaterial({
    color: new Color(attacker ? RUST : STRAW),
    roughness: 1,
  });
  const wood = new MeshStandardMaterial({ color: new Color(WOOD), roughness: 0.9 });
  const mark = new MeshStandardMaterial({ color: new Color(MARK), roughness: 0.8 });
  const legs = new Mesh(new CapsuleGeometry(radius * 0.6, 0.55, 4, 10), wood);
  legs.position.y = 0.425;
  const torso = new Mesh(new CapsuleGeometry(radius, 0.35, 4, 12), skin);
  torso.position.y = 1.125;
  const head = new Mesh(new SphereGeometry(0.18, 14, 10), skin);
  head.position.y = 1.67;
  const nose = new Mesh(new BoxGeometry(0.06, 0.06, 0.12), mark);
  nose.position.set(0, 1.67, 0.2);
  const weakpoint = new Mesh(new SphereGeometry(0.08, 10, 8), mark);
  weakpoint.position.set(0, 1.2, -radius);
  const parts: Mesh[] = [legs, torso, head, nose, weakpoint];
  if (attacker) {
    const sword = new Mesh(new BoxGeometry(0.06, 0.06, 1.0), wood);
    sword.position.set(radius + 0.1, 1.2, 0.5);
    parts.push(sword);
  }
  for (const mesh of parts) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
