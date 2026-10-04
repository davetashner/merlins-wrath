// A fallen creature topples (the Forgotten miner dying): its body falls backward about its feet and
// lies on the ground, where it stays. The sim only says it died (Died; its AI then stops, see
// src/sim/ai/runtime.ts); this is the drawn collapse. It turns the proxy's pivot — everything the
// proxy draws hangs from it — so the transform render sync writes for the creature is never touched,
// and the fall does not depend on whether the model has loaded.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright slice e2e.

import type { Object3D } from 'three';

/** The name of the group a proxy hangs everything from (see createCreatureProxy). */
export const COLLAPSE_PIVOT = 'pivot';

/** Seconds from standing to lying down. */
export const COLLAPSE_SECONDS = 0.9;
/** The fall, in degrees about the creature's x axis: backward, onto its back. */
export const COLLAPSE_DEGREES = -90;
/** How far the body is lifted as it lies down so its back rests on the ground, metres per metre tall. */
const REST_LIFT = 0.085;

interface Falling {
  readonly pivot: Object3D;
  readonly lift: number;
  elapsed: number;
}

/** Accelerating fall that lands with a small bounce: 0 standing … 1 flat. */
export function collapseProgress(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  if (x < 0.8) return (x / 0.8) ** 2 * 1.04;
  return 1.04 - 0.04 * ((x - 0.8) / 0.2);
}

export class CreatureDeaths {
  readonly #falling = new Map<Object3D, Falling>();

  /**
   * Starts `proxy` falling (no-op if it is already, or has no pivot). `height` is its height in
   * metres; `lying` lays it down at once (a creature that was already dead when it was drawn).
   */
  start(proxy: Object3D, height: number, lying = false): void {
    const pivot = proxy.getObjectByName(COLLAPSE_PIVOT);
    if (pivot === undefined || this.#falling.has(proxy)) return;
    this.#falling.set(proxy, {
      pivot,
      lift: REST_LIFT * height,
      elapsed: lying ? COLLAPSE_SECONDS : 0,
    });
    if (lying) this.update(0);
  }

  /** How many are still falling. */
  get size(): number {
    return this.#falling.size;
  }

  /** Advances every fall by a frame of `seconds`; a finished one is left lying and forgotten. */
  update(seconds: number): void {
    for (const [proxy, fall] of this.#falling) {
      fall.elapsed += seconds;
      const progress = collapseProgress(fall.elapsed / COLLAPSE_SECONDS);
      fall.pivot.rotation.x = (progress * COLLAPSE_DEGREES * Math.PI) / 180;
      fall.pivot.position.y = Math.min(progress, 1) * fall.lift;
      if (fall.elapsed >= COLLAPSE_SECONDS) this.#falling.delete(proxy);
    }
  }
}
