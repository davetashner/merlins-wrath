// The game's save sections (mw-e30.3): the one list of everything the current build saves. Saving,
// loading and the save-schema gate (pnpm save:check, tests/save-fixtures) all build their registry
// here, so a system that adds a section registers it in exactly one place and the gate fingerprints
// it automatically. Sections: the built-in world section, then inventory (mw-e17.8).

import { SaveRegistry } from './format';
import { inventorySaveSection, type InventorySectionOptions } from './inventory';

/** What the game's sections need from the running build. */
export type GameSaveOptions = InventorySectionOptions;

/**
 * A registry holding every save section this build writes, world first, in apply order. Returns a
 * fresh registry each call (registries are cheap and hold no world state). The game passes its
 * content's item ids (`knownItem`) and a logger (`warn`) so a save holding a removed item still loads.
 */
export function createGameSaveRegistry(options: GameSaveOptions = {}): SaveRegistry {
  return new SaveRegistry().register(inventorySaveSection(options));
}
