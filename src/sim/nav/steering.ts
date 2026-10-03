// Simple local avoidance between walking agents (mw-e11.4): separation. Each agent near another
// (closer than their radii added up) is pushed straight away from it in proportion to the overlap,
// on top of the step its path asks for. Crowd simulation (velocity obstacles, lanes, formations) is
// out of scope; this only keeps two guards on crossing routes from walking through each other.
// Pure arithmetic over the positions it is given, so the caller decides the (ascending id) order.

/** A neighbour as avoidance sees it: where it stands and how much room it takes. */
export interface NavNeighbour {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** How much of the overlap one tick pushes away, 0–1. */
export const NAV_SEPARATION_GAIN = 0.5;

/**
 * The horizontal push (dx, dz) that separates an agent of `radius` at (x, z) from `neighbours`,
 * at most `limit` metres long. Neighbours exactly on top of it push along +x (a fixed, deterministic
 * choice), so two agents spawned on one spot still come apart.
 */
export function separation(
  x: number,
  z: number,
  radius: number,
  neighbours: readonly NavNeighbour[],
  limit: number,
): { readonly dx: number; readonly dz: number } {
  let dx = 0;
  let dz = 0;
  for (const n of neighbours) {
    const reach = radius + n.radius;
    const ox = x - n.x;
    const oz = z - n.z;
    const d = Math.sqrt(ox * ox + oz * oz);
    if (d >= reach) continue;
    const push = (reach - d) * NAV_SEPARATION_GAIN;
    if (d > 1e-9) {
      dx += (ox / d) * push;
      dz += (oz / d) * push;
    } else {
      dx += push;
    }
  }
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length > limit) {
    dx = (dx / length) * limit;
    dz = (dz / length) * limit;
  }
  return { dx, dz };
}
