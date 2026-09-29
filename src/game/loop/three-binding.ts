// Three.js scene bindings for render sync (mw-e00.20): applies interpolated sim transforms to an
// Object3D and, when its entity is destroyed, removes it from the scene and frees its geometry and
// materials so GPU memory does not leak across spawns and despawns.
import type { Material, Object3D } from 'three';
import type { SceneBinding, SimView, Transform } from './render-sync';
import type { EntityId } from '@sim/index';

/** Binds an Object3D whose transform comes from `read` (e.g. the entity's Transform component). */
export function object3DBinding<TObject extends Object3D>(
  object: TObject,
  read: (view: SimView, entity: EntityId) => Transform | undefined,
): SceneBinding<TObject> {
  return {
    object,
    read,
    apply(target, { position, rotation }) {
      target.position.set(position.x, position.y, position.z);
      target.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    },
    dispose(target) {
      target.removeFromParent();
      target.traverse((node) => {
        const mesh = node as Partial<{
          geometry: { dispose(): void };
          material: Material | Material[];
        }>;
        mesh.geometry?.dispose();
        const materials = mesh.material === undefined ? [] : [mesh.material].flat();
        for (const material of materials) material.dispose();
      });
    },
  };
}
