// Lazy physics loading (mw-e00.19, ADR-0001). Rapier's deterministic build ships its WASM as a
// separate file, so the module is imported dynamically: the initial bundle stays small and the WASM
// is only fetched once the game asks for it. The sim never awaits this: it will receive the
// already-initialised module through its physics port (mw-e03.10), like the clock and RNG.
import type * as Rapier from '@dimforge/rapier3d-deterministic';

export type PhysicsModule = typeof Rapier;
export type PhysicsLoadState = 'loading' | 'ready' | 'failed';

/**
 * Imports the physics module. The browser bootstrap passes
 * `() => import('@dimforge/rapier3d-deterministic')`, which Vite splits into its own chunk.
 */
export type PhysicsImporter = () => Promise<PhysicsModule>;

/**
 * Loads the physics module, reporting each state change. Resolves with the module, or rejects with
 * the import error after reporting 'failed'.
 */
export async function loadPhysics(
  importer: PhysicsImporter,
  onState: (state: PhysicsLoadState) => void,
): Promise<PhysicsModule> {
  onState('loading');
  try {
    const physics = await importer();
    onState('ready');
    return physics;
  } catch (error) {
    onState('failed');
    throw error;
  }
}
