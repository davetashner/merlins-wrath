// Door leaves on screen (mw-e03.18): one box per door, sized to its leaf and hung from its pivot (the
// hinge of a hinged door or trapdoor, the foot of a portcullis or sliding door), so following the
// sim's leaf pose (src/game/mechanisms `readDoorLeaf`) swings, lifts or slides it. Cheap by design:
// every leaf shares one unit box and one set of materials per material class (wood, iron, stone),
// casts a shadow like the level it stands in, and only scenes with doors make any. A removed leaf is
// only taken out of the scene (`disposeDoorLeaf`): the shared geometry and materials are never freed.
//
// Wood and iron leaves wear a painted door front on their two big faces (mw-546, public/assets/door):
// the painting has its hinges on the left, so each face is mapped (the far one mirrored) to put the
// hinges on the pivot side. The edges stay plain colour, and a leaf whose picture has not loaded, or
// never does, shows that colour.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright mechanisms e2e (e2e/mechanisms.spec.ts).

import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Object3D,
} from 'three';
import type { Vec3 } from '@sim/index';

/** Leaf colours by material; anything else reads as the greybox interactive blue. */
const LEAF_COLOURS: Readonly<Record<string, number>> = {
  wood: 0x8a5a32,
  iron: 0x4b4f57,
  stone: 0x8d8f94,
};
const OTHER_COLOUR = 0x3d7bc4;

/** The painted door front per material class (hinges on the left, 1.2 : 2.2 like every leaf). */
const DOOR_ART: Readonly<Record<string, string>> = {
  wood: '/assets/door/door-wood-01.webp',
  iron: '/assets/door/door-iron-01.webp',
};

let box: BoxGeometry | undefined;
const materials = new Map<number, MeshStandardMaterial>();

function materialFor(colour: number): MeshStandardMaterial {
  let material = materials.get(colour);
  if (material === undefined) {
    material = new MeshStandardMaterial({ color: new Color(colour), roughness: 0.85 });
    materials.set(colour, material);
  }
  return material;
}

/** A face material showing the door front at `url`, mirrored left to right when `mirrored`. */
function artMaterial(url: string, colour: number, mirrored: boolean): MeshStandardMaterial {
  const face = new MeshStandardMaterial({ color: new Color(0xffffff), roughness: 0.85 });
  new TextureLoader().load(
    url,
    (texture) => {
      texture.colorSpace = SRGBColorSpace;
      if (mirrored) {
        texture.wrapS = MirroredRepeatWrapping;
        texture.repeat.x = -1;
        texture.offset.x = 1;
      }
      face.map = texture;
      face.needsUpdate = true;
    },
    undefined,
    () => {
      face.color.setHex(colour);
    },
  );
  return face;
}

/** The six face materials of a leaf of `material` whose box extends toward `side` (±1) from its pivot. */
const leafFaces = new Map<string, MeshStandardMaterial[]>();

function facesFor(material: string, side: number): MeshStandardMaterial[] {
  const key = `${material}:${String(side)}`;
  let faces = leafFaces.get(key);
  if (faces === undefined) {
    const colour = LEAF_COLOURS[material] ?? OTHER_COLOUR;
    const plain = materialFor(colour);
    const art = DOOR_ART[material];
    if (art === undefined) {
      faces = [plain, plain, plain, plain, plain, plain];
    } else {
      // The picture's hinge edge (u = 0) must land on the pivot. A box extending toward +x has its pivot
      // at its −x edge, which is u = 0 on the +z face and u = 1 on the −z face (so that one is mirrored).
      const front = artMaterial(art, colour, false);
      const back = artMaterial(art, colour, true);
      faces =
        side > 0
          ? [plain, plain, plain, plain, front, back]
          : [plain, plain, plain, plain, back, front];
    }
    leafFaces.set(key, faces);
  }
  return faces;
}

/**
 * A door leaf of `size` metres whose box sits at `centre` from its pivot (the object's origin), in
 * the colour of `material` (with its painted front, for wood and iron).
 */
export function createDoorLeaf(size: Vec3, centre: Vec3, material: string): Object3D {
  box ??= new BoxGeometry(1, 1, 1);
  const leaf = new Mesh(box, facesFor(material, centre.x >= 0 ? 1 : -1));
  leaf.name = 'door-leaf';
  leaf.scale.set(size.x, size.y, size.z);
  leaf.position.set(centre.x, centre.y, centre.z);
  leaf.castShadow = true;
  leaf.receiveShadow = true;
  const pivot = new Group();
  pivot.name = 'door';
  pivot.add(leaf);
  return pivot;
}

/** Takes a leaf out of the scene, keeping the shared geometry and materials. */
export function disposeDoorLeaf(object: Object3D): void {
  object.removeFromParent();
}
