// Where the HUD lock marker goes (mw-e02.16): the locked target's main lock point, projected through
// the drawn camera. Presentation only; the renderer supplies the projection (src/render/player).

import { NO_LOCK_MARKER, type LockMarkerModel } from '@ui/index';
import type { Vec3 } from '../loop/render-sync';
import type { LockTarget } from './testbed-player';

/** Projects a world point to normalised device coordinates (x right, y up, −1…1; |z| > 1 clipped). */
export type NdcProjection = (point: Vec3) => Vec3;

/**
 * The marker for `lock` on a `width` × `height` CSS-pixel HUD: over the lock point, or hidden when
 * nothing is locked or the point is behind the camera or beyond its far plane.
 */
export function lockMarkerModel(
  lock: LockTarget | undefined,
  project: NdcProjection,
  width: number,
  height: number,
): LockMarkerModel {
  if (lock === undefined) return NO_LOCK_MARKER;
  const ndc = project(lock.point);
  if (!(Math.abs(ndc.z) <= 1)) return NO_LOCK_MARKER;
  return { target: lock.entity, x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
}
