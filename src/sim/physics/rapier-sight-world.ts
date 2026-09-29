// Line of sight's SightWorld on the sim's Rapier physics (mw-e09.1). `firstCrossing` is one `castRay`;
// `forEachCrossing` is one `intersectionsWithRay`, where Rapier reports every collider the ray crosses
// in its own deterministic traversal order and the visitor can stop it early. Both are solid, so a
// collider containing the origin counts at distance 0. Like RapierCollisionWorld, it answers from the
// physics world as of the port's last step. One Ray is reused for every query (Rapier copies it into
// WASM per call), since line of sight casts many per tick.

import type * as Rapier from '@dimforge/rapier3d-deterministic';
import type { BodyId } from '../character/collision-world';
import type { Vec3 } from '../stimulus/shapes';
import type { SightVisitor, SightWorld } from '../sight/sight-world';
import type { RapierPhysics } from './rapier';

export class RapierSightWorld implements SightWorld {
  private readonly ray: Rapier.Ray;

  constructor(private readonly physics: RapierPhysics) {
    this.ray = new physics.rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  }

  firstCrossing(from: Vec3, to: Vec3): BodyId | undefined {
    const length = this.aim(from, to);
    const hit = this.physics.rapierWorld.castRay(this.ray, length, true);
    return hit === null ? undefined : this.physics.handleOf(hit.collider.handle);
  }

  forEachCrossing(from: Vec3, to: Vec3, visit: SightVisitor): void {
    const length = this.aim(from, to);
    this.physics.rapierWorld.intersectionsWithRay(this.ray, length, true, (hit) =>
      visit(this.physics.handleOf(hit.collider.handle)),
    );
  }

  /** Points the reused ray from `from` towards `to`; returns the distance between them. */
  private aim(from: Vec3, to: Vec3): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.ray.origin = from;
    this.ray.dir = { x: dx / length, y: dy / length, z: dz / length };
    return length;
  }
}
