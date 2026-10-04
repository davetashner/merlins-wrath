// Fades the player's body while it hides a fighter from the camera (src/game/camera/occlusion.ts), so
// the player can see a foe the knight's back would otherwise cover. Each material the body draws is
// made transparent only while it is partly faded, so a body in the clear costs nothing extra.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright creature e2e.

import { Mesh, type Material, type Object3D } from 'three';

/** How see-through the body gets at most (1 = solid). */
export const FADED_OPACITY = 0.3;
/** Seconds to fade fully in either direction. */
export const FADE_SECONDS = 0.25;

export class OcclusionFade {
  readonly #root: Object3D;
  #opacity = 1;

  constructor(root: Object3D) {
    this.#root = root;
  }

  /** The body's opacity now (tests and the e2e read it). */
  get opacity(): number {
    return this.#opacity;
  }

  /** Moves the fade a frame of `seconds` towards faded (`hiding`) or solid. */
  update(hiding: boolean, seconds: number): void {
    const target = hiding ? FADED_OPACITY : 1;
    const step = ((1 - FADED_OPACITY) * seconds) / FADE_SECONDS;
    const next =
      this.#opacity < target
        ? Math.min(target, this.#opacity + step)
        : Math.max(target, this.#opacity - step);
    if (next === this.#opacity) return;
    this.#opacity = next;
    this.#root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        apply(material as Material, next);
      }
    });
  }
}

function apply(material: Material, opacity: number): void {
  const faded = opacity < 1;
  if (material.transparent !== faded) {
    material.transparent = faded;
    material.needsUpdate = true;
  }
  material.depthWrite = !faded;
  material.opacity = opacity;
}
