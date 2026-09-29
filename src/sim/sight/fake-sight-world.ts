// A deterministic in-memory SightWorld of axis-aligned greybox boxes (mw-e09.1), for unit tests of
// line of sight without WASM. Passes the same contract as the Rapier port (sight-world.contract.ts).

import type { BodyId } from '../character/collision-world';
import type { GreyboxBox } from '../character/greybox';
import type { Vec3 } from '../stimulus/shapes';
import { segmentCrossesBox, segmentEntersBox } from './segment';
import type { SightVisitor, SightWorld } from './sight-world';

export class FakeSightWorld implements SightWorld {
  /** Box per body id; a removed body leaves a hole so ids are never reused. */
  private readonly boxes: (GreyboxBox | undefined)[] = [];

  constructor(boxes: readonly GreyboxBox[] = []) {
    for (const shape of boxes) this.add(shape);
  }

  /** Adds a box collider; ids are 1, 2, 3… in the order added. */
  add(shape: GreyboxBox): BodyId {
    this.boxes.push(shape);
    return this.boxes.length;
  }

  /** Moves or resizes a collider (a closing door). */
  set(body: BodyId, shape: GreyboxBox): void {
    this.check(body);
    this.boxes[body - 1] = shape;
  }

  /** Removes a collider (a destroyed crate). */
  remove(body: BodyId): void {
    this.check(body);
    this.boxes[body - 1] = undefined;
  }

  firstCrossing(from: Vec3, to: Vec3): BodyId | undefined {
    let first: BodyId | undefined;
    let nearest = Infinity;
    for (let i = 0; i < this.boxes.length; i++) {
      const shape = this.boxes[i];
      if (shape === undefined) continue;
      const t = segmentEntersBox(from, to, shape.min, shape.max);
      if (t < nearest) {
        nearest = t;
        first = i + 1;
      }
    }
    return first;
  }

  forEachCrossing(from: Vec3, to: Vec3, visit: SightVisitor): void {
    for (let i = 0; i < this.boxes.length; i++) {
      const shape = this.boxes[i];
      if (shape === undefined || !segmentCrossesBox(from, to, shape.min, shape.max)) continue;
      if (!visit(i + 1)) return;
    }
  }

  private check(body: BodyId): void {
    if (this.boxes[body - 1] === undefined) {
      throw new RangeError(`sight body ${String(body)} is not in this world`);
    }
  }
}
