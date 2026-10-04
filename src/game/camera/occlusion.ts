// Whether the player's own body hides a fighter from the camera. The orbit camera sits behind the
// player, so a foe in front of the player and in line with the camera is drawn behind the knight's
// back, just where the player most needs to see it. Presentation only: the game fades the player's
// body while this holds (src/render/player/occlusion-fade.ts); nothing in the sim reads it.

/** A point in world metres. */
export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** How wide the player's body hides things from the camera, metres either side of the view line. */
export const BODY_HALF_WIDTH = 0.6;
/** Only foes this near the player (metres) are worth seeing through the body. */
export const FADE_RANGE = 10;

/**
 * Whether `target` lies behind the player seen from `camera`: past `player` along the view line and
 * within BODY_HALF_WIDTH of it, and within FADE_RANGE of the player.
 */
export function bodyHides(camera: Point, player: Point, target: Point): boolean {
  const toPlayer = { x: player.x - camera.x, y: player.y - camera.y, z: player.z - camera.z };
  const toTarget = { x: target.x - camera.x, y: target.y - camera.y, z: target.z - camera.z };
  const along = Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z);
  if (along < 1e-6) return false;
  if (Math.hypot(target.x - player.x, target.y - player.y, target.z - player.z) > FADE_RANGE) {
    return false;
  }
  const unit = { x: toPlayer.x / along, y: toPlayer.y / along, z: toPlayer.z / along };
  const projected = toTarget.x * unit.x + toTarget.y * unit.y + toTarget.z * unit.z;
  if (projected <= along) return false;
  const off = {
    x: toTarget.x - unit.x * projected,
    y: toTarget.y - unit.y * projected,
    z: toTarget.z - unit.z * projected,
  };
  return Math.hypot(off.x, off.y, off.z) < BODY_HALF_WIDTH * (projected / along);
}

/** Whether any of `targets` is hidden by the player's body (see bodyHides). */
export function anyHiddenByBody(camera: Point, player: Point, targets: Iterable<Point>): boolean {
  for (const target of targets) if (bodyHides(camera, player, target)) return true;
  return false;
}
