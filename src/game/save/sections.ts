// The game's save sections (mw-e30.3): the one list of everything the current build saves. Saving,
// loading and the save-schema gate (pnpm save:check, tests/save-fixtures) all build their registry
// here, so a system that adds a section registers it in exactly one place and the gate fingerprints
// it automatically. Today only the built-in world section exists.

import { SaveRegistry } from './format';

/**
 * A registry holding every save section this build writes, world first, in apply order. Returns a
 * fresh registry each call (registries are cheap and hold no world state).
 */
export function createGameSaveRegistry(): SaveRegistry {
  return new SaveRegistry();
}
