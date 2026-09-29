// Projects a world point to normalised device coordinates for HUD markers (lock-on, mw-e02.16).
import { Vector3, type Camera } from 'three';

const scratch = new Vector3();

/** `point` in `camera`'s normalised device coordinates (x right, y up, −1…1 on screen; z > 1 behind). */
export function projectToNdc(
  camera: Camera,
  point: { readonly x: number; readonly y: number; readonly z: number },
): { readonly x: number; readonly y: number; readonly z: number } {
  scratch.set(point.x, point.y, point.z).project(camera);
  return { x: scratch.x, y: scratch.y, z: scratch.z };
}
