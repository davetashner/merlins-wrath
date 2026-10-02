// Placeholder creature bodies (mw-e12.4): every spawned creature is drawn as a grey-box capsule the
// size of its nav agent (the `placeholder-capsule` mesh of CreatureDef.presentation) until its own
// mesh lands with the asset integration beads. Origin at the feet, facing +z: a dark visor on the
// front shows which way it faces. A creature carrying attacks is rust-red, one without is slate, so
// a glance tells what might fight back.
//
// Telegraphs (mw-e04.20): while a creature winds up a telegraphed move its body glows — ember for a
// swing a parry deflects, pale steel for one only a shield stops, red for an unblockable move or a
// grab — until the move turns active. `showCreatureTelegraph` only touches the body's material when
// the game reports a change, so idle creatures cost nothing per frame.
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

/** Body glow per telegraph look (see the file header). */
const TELEGRAPH_GLOW = { parry: 0xe0912e, block: 0xc8d4e8, unblockable: 0xd2321e } as const;

/** How a creature's telegraph reads (the game's TelegraphLook). */
export type CreatureTelegraphLook = keyof typeof TELEGRAPH_GLOW;

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
  body.name = 'body';
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

/** Lights `proxy`'s body for a telegraph of `look`, or puts it out (null). */
export function showCreatureTelegraph(proxy: Object3D, look: CreatureTelegraphLook | null): void {
  const body = proxy.getObjectByName('body');
  if (!(body instanceof Mesh) || !(body.material instanceof MeshStandardMaterial)) return;
  body.material.emissive.setHex(look === null ? 0x000000 : TELEGRAPH_GLOW[look]);
  body.material.emissiveIntensity = look === null ? 0 : 0.85;
}
