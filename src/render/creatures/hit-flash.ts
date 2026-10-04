// The hit flash (mw-e29.4): a creature that takes damage flashes white for 80 ms, so a hit reads on
// the body at once, before any particle drifts. It lights the body's material emissive and then puts
// back whatever glow the telegraph (index.ts) has left there, kept in the body's userData.glow, so a
// flash never wipes a wind-up's glow and a wind-up never leaves a stale one.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright slice e2e.

import { Mesh, MeshStandardMaterial, type Object3D } from 'three';

/** How long the flash lasts, milliseconds. */
export const HIT_FLASH_MS = 80;

/** The glow a telegraph (or nothing) leaves on a body's material. */
export interface BodyGlow {
  readonly hex: number;
  readonly intensity: number;
}

/** The body mesh and material of `proxy`, if it has them. */
function bodyOf(proxy: Object3D): { body: Object3D; material: MeshStandardMaterial } | undefined {
  const body = proxy.getObjectByName('body');
  if (!(body instanceof Mesh) || !(body.material instanceof MeshStandardMaterial)) return undefined;
  return { body, material: body.material };
}

/** Writes `glow` as the body's resting glow, and shows it unless a flash is on. */
export function setBodyGlow(proxy: Object3D, glow: BodyGlow, flashing = false): void {
  const found = bodyOf(proxy);
  if (found === undefined) return;
  found.body.userData['glow'] = glow;
  if (flashing) return;
  found.material.emissive.setHex(glow.hex);
  found.material.emissiveIntensity = glow.intensity;
}

export class HitFlashes {
  readonly #until = new Map<Object3D, number>();

  /** Flashes `proxy` white from `nowMs`. */
  flash(proxy: Object3D, nowMs: number): void {
    const found = bodyOf(proxy);
    if (found === undefined) return;
    found.material.emissive.setHex(0xffffff);
    found.material.emissiveIntensity = 1;
    this.#until.set(proxy, nowMs + HIT_FLASH_MS);
  }

  /** How many are flashing. */
  get size(): number {
    return this.#until.size;
  }

  /** Ends the flashes whose 80 ms is up, restoring each body's resting glow. */
  update(nowMs: number): void {
    for (const [proxy, until] of this.#until) {
      if (nowMs < until) continue;
      this.#until.delete(proxy);
      const found = bodyOf(proxy);
      if (found === undefined) continue;
      const glow = found.body.userData['glow'] as BodyGlow | undefined;
      found.material.emissive.setHex(glow?.hex ?? 0);
      found.material.emissiveIntensity = glow?.intensity ?? 0;
    }
  }
}
