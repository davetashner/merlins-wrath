// A scene's static geometry as a CollisionWorld (mw-e02.23): the in-memory FakeCollisionWorld built
// from the same solid parts the scene loader hands to the physics sink, so the character controller
// collides with exactly what the renderer draws. The Rapier-backed CollisionWorld (mw-e02.21) takes
// over from it; this stays for headless tests and as the fallback.

import { FakeCollisionWorld } from '../character/fake-collision-world';
import type { SceneLayout } from './layout';

/** A CollisionWorld of every solid part of `layout`, in part order. */
export function sceneCollisionWorld(layout: Pick<SceneLayout, 'parts'>): FakeCollisionWorld {
  return new FakeCollisionWorld(layout.parts.flatMap((part) => part.collider ?? []));
}
