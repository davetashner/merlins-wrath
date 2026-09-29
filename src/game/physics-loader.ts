// Lazy physics loading (mw-e00.19, ADR-0001). Rapier's deterministic build ships its WASM as a
// separate file, so the module is imported dynamically: the initial bundle stays small and the WASM
// is only fetched once the game asks for it. The sim never awaits this: once the module is here it
// is injected into the sim's physics port (mw-e03.35), like the clock and RNG.
import { RapierPhysics, type RapierModule } from '@sim/index';

export type PhysicsModule = RapierModule;
export type PhysicsLoadState = 'loading' | 'ready' | 'failed';

/**
 * Imports the physics module. The browser bootstrap passes
 * `() => import('@dimforge/rapier3d-deterministic')`, which Vite splits into its own chunk.
 */
export type PhysicsImporter = () => Promise<PhysicsModule>;

/** How starting the sim's physics went: a port ready to hand to the World, or why not. */
export type PhysicsBoot =
  | { readonly ok: true; readonly module: PhysicsModule; readonly physics: RapierPhysics }
  | { readonly ok: false; readonly error: unknown };

/**
 * Loads the physics module and creates the sim's Rapier port from it, reporting each state change
 * ('loading', then 'ready' or 'failed'). Never rejects (mw-e03.35 AC-5): a failed download, WASM
 * compile or world creation reports 'failed' and resolves with the error, so the caller shows an
 * error state instead of meeting an uncaught exception.
 */
export async function bootPhysics(
  importer: PhysicsImporter,
  onState: (state: PhysicsLoadState) => void,
): Promise<PhysicsBoot> {
  onState('loading');
  try {
    const module = await importer();
    const physics = new RapierPhysics(module);
    onState('ready');
    return { ok: true, module, physics };
  } catch (error) {
    onState('failed');
    return { ok: false, error };
  }
}
