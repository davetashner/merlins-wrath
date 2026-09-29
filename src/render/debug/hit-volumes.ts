// The hit-volume debug overlay (mw-e04.2): wireframes of exactly the shapes the sim's hit-volume
// system tested on the latest tick — each hitbox's sweep (where it was, dim; where it is, bright) and
// every hurtbox, coloured by region (armored ones in steel). It draws sim poses and never feeds
// anything back: the render follows the sim. Not interpolated, so what is drawn is what was tested.
//
// Every drawn object keeps the sim shape it draws (`userData.shape`), so `drawnShapes()` can be
// hashed against the sim's (hashShapes) on every rendered frame (AC-6, tests/integration).
//
// Render-only glue (excluded from unit coverage with the rest of src/render); the integration test
// drives it headless, since building Three.js objects needs no GPU.

import {
  debugShapes,
  hitVolumeDebug,
  type GeomShape,
  type HitRegion,
  type HitVolumeDebug,
  type World,
} from '@sim/index';
import {
  BoxGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from 'three';

const REGION_COLOURS: Readonly<Record<HitRegion, number>> = {
  weakpoint: 0xff3df2,
  head: 0xffd23d,
  torso: 0x3dd8ff,
  limb: 0x5dff7a,
};
const ARMORED_COLOUR = 0x9aa4b2;
const HITBOX_COLOUR = 0xff4a3d;
const HITBOX_FROM_OPACITY = 0.35;
const UP = new Vector3(0, 1, 0);

/** The overlay: add `object` to the scene and call `sync` every drawn frame. */
export interface HitVolumeOverlay {
  /** Root of every wireframe. */
  readonly object: Object3D;
  /** Hidden and skipped while false. */
  enabled: boolean;
  /** Redraws from the sim's latest tick (only when the tick changed, or `force`). */
  sync(world: World<never>, force?: boolean): void;
  /** The sim shapes currently drawn, in draw order (empty while disabled). */
  drawnShapes(): readonly GeomShape[];
  dispose(): void;
}

function geometryOf(shape: GeomShape): BufferGeometry {
  switch (shape.kind) {
    case 'sphere':
      return new SphereGeometry(shape.radius, 12, 8);
    case 'capsule': {
      const length = new Vector3(
        shape.to.x - shape.from.x,
        shape.to.y - shape.from.y,
        shape.to.z - shape.from.z,
      ).length();
      return new CapsuleGeometry(shape.radius, length, 4, 10);
    }
    case 'box':
      return new BoxGeometry(
        2 * shape.halfExtents.x,
        2 * shape.halfExtents.y,
        2 * shape.halfExtents.z,
      );
  }
}

function place(mesh: Mesh, shape: GeomShape): void {
  switch (shape.kind) {
    case 'sphere':
      mesh.position.set(shape.center.x, shape.center.y, shape.center.z);
      return;
    case 'capsule': {
      const { from, to } = shape;
      mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
      const axis = new Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
      if (axis.lengthSq() > 0) mesh.quaternion.setFromUnitVectors(UP, axis.normalize());
      return;
    }
    case 'box': {
      const { center, rotation: q } = shape;
      mesh.position.set(center.x, center.y, center.z);
      mesh.quaternion.copy(new Quaternion(q.x, q.y, q.z, q.w));
      return;
    }
  }
}

/** Builds the overlay (disabled until `enabled` is set). */
export function createHitVolumeOverlay(): HitVolumeOverlay {
  const root = new Group();
  root.name = 'hit-volume-overlay';
  root.visible = false;
  root.renderOrder = 999;
  const materials = new Map<string, MeshBasicMaterial>();
  const material = (colour: number, opacity: number): MeshBasicMaterial => {
    const key = `${String(colour)}/${String(opacity)}`;
    let found = materials.get(key);
    if (found === undefined) {
      found = new MeshBasicMaterial({
        color: colour,
        wireframe: true,
        transparent: opacity < 1,
        opacity,
        depthTest: false,
      });
      materials.set(key, found);
    }
    return found;
  };
  let drawnTick: number | undefined;

  const clear = (): void => {
    for (const child of [...root.children]) {
      root.remove(child);
      if (child instanceof Mesh) (child.geometry as BufferGeometry).dispose();
    }
    drawnTick = undefined;
  };

  const draw = (debug: HitVolumeDebug): void => {
    clear();
    const add = (shape: GeomShape, colour: number, opacity: number): void => {
      const mesh = new Mesh(geometryOf(shape), material(colour, opacity));
      place(mesh, shape);
      mesh.userData['shape'] = shape;
      mesh.renderOrder = 999;
      root.add(mesh);
    };
    // Draw order matches debugShapes: hitbox sweeps (from, to), then hurtboxes.
    for (const hitbox of debug.hitboxes) {
      add(hitbox.from, HITBOX_COLOUR, HITBOX_FROM_OPACITY);
      add(hitbox.to, HITBOX_COLOUR, 1);
    }
    for (const hurtbox of debug.hurtboxes) {
      add(hurtbox.shape, hurtbox.armored ? ARMORED_COLOUR : REGION_COLOURS[hurtbox.region], 0.8);
    }
    drawnTick = debug.tick;
  };

  const overlay: HitVolumeOverlay = {
    object: root,
    get enabled() {
      return root.visible;
    },
    set enabled(on: boolean) {
      root.visible = on;
      if (!on) clear();
    },
    sync(world, force = false) {
      if (!root.visible) return;
      if (!force && drawnTick === world.tick) return;
      const debug = hitVolumeDebug(world);
      draw(debug);
      // Keep the invariant visible in development: what is drawn is what the sim tested.
      if (root.children.length !== debugShapes(debug).length) {
        throw new Error('hit-volume overlay drew a different number of shapes than the sim tested');
      }
    },
    drawnShapes() {
      return root.children.map((child) => child.userData['shape'] as GeomShape);
    },
    dispose() {
      clear();
      for (const m of materials.values()) m.dispose();
      materials.clear();
    },
  };
  return overlay;
}
