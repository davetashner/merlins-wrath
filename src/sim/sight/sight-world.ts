// Line of sight's view of physics (mw-e09.1): every collider a sight line crosses, not just the
// first one, because glass and foliage let the line carry on. Engine-free, so the LOS service is
// unit-testable against the in-memory fake (fake-sight-world.ts); the Rapier port implements it too
// (src/sim/physics/rapier-sight-world.ts), and both pass sight-world.contract.ts.

import type { BodyId } from '../character/collision-world';
import type { Vec3 } from '../stimulus/shapes';

/**
 * Called once per collider the segment crosses, in no particular (but deterministic) order.
 * Return false to stop the query early (e.g. on an opaque collider), true to carry on.
 */
export type SightVisitor = (body: BodyId) => boolean;

/** Segment queries against the collision world. Results must be deterministic. */
export interface SightWorld {
  /**
   * The collider the segment `from`→`to` touches first (nearest `from`; a collider containing `from`
   * is nearest), or undefined when it touches none. Cheaper than visiting every crossing, so line of
   * sight tries it first: most sight lines are clear or end at an opaque wall.
   */
  firstCrossing(from: Vec3, to: Vec3): BodyId | undefined;

  /**
   * Visits every collider the segment `from`→`to` touches, each once; a collider containing `from`
   * counts. `from` and `to` are distinct points.
   */
  forEachCrossing(from: Vec3, to: Vec3, visit: SightVisitor): void;
}
