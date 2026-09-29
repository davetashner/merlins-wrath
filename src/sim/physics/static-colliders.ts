// Static collision geometry, as the sim hands it to physics (mw-e00.21). Level geometry (greybox kit
// pieces today, authored levels later) never moves, so loading a scene only has to add some fixed
// shapes and unloading it has to take them away again. That is all this sink does: it is NOT a query
// interface (shape casts, raycasts and overlaps belong to the character controller's CollisionWorld,
// mw-e02.2) and it never steps anything.
//
// Descriptors are the character controller's greybox shapes (mw-e02.2, src/sim/character/greybox.ts):
// axis-aligned `{ kind: 'box', min, max }` and wedge `{ kind: 'ramp', min, max, rises }`, plain numbers
// in metres with no physics-engine types, so the scene loader stays engine-agnostic and unit-testable
// and the same geometry can feed the controller's CollisionWorld. Level geometry is static, so the
// scene loader never sets `velocity`. Kit pieces only turn in quarter turns, so every part is
// axis-aligned and these two shapes describe the whole kit.
//
// The sim-owned physics port (port.ts; RapierPhysics in rapier.ts, mw-e03.35) implements
// `StaticColliderSink` by creating fixed colliders from these descriptors, and the game hands it to
// the scene loader. `InMemoryColliderSink` just keeps the descriptors, for engine-free tests.

import type { GreyboxShape } from '../character/greybox';

/** A static collider: a greybox box or ramp (see src/sim/character/greybox.ts). */
export type StaticColliderDesc = GreyboxShape;

/** Opaque handle to one added collider; only meaningful to the sink that issued it. */
export type ColliderHandle = number & { readonly __brand: 'ColliderHandle' };

/** Where static level geometry goes. Implemented by the physics port (mw-e03.35). */
export interface StaticColliderSink {
  /** Adds one fixed collider and returns its handle. */
  add(desc: StaticColliderDesc): ColliderHandle;
  /** Removes a collider this sink added. Removing an unknown or already removed handle throws. */
  remove(handle: ColliderHandle): void;
  /** Number of colliders currently in the sink. */
  count(): number;
}

/** A sink that just keeps the descriptors, for engine-free tests. */
export class InMemoryColliderSink implements StaticColliderSink {
  private readonly colliders = new Map<ColliderHandle, StaticColliderDesc>();
  private next = 1;

  add(desc: StaticColliderDesc): ColliderHandle {
    const handle = this.next++ as ColliderHandle;
    this.colliders.set(handle, desc);
    return handle;
  }

  remove(handle: ColliderHandle): void {
    if (!this.colliders.delete(handle)) {
      throw new Error(`collider ${String(handle)} is not in this sink`);
    }
  }

  count(): number {
    return this.colliders.size;
  }

  /** The colliders currently held, in the order they were added. */
  all(): readonly StaticColliderDesc[] {
    return [...this.colliders.values()];
  }
}
