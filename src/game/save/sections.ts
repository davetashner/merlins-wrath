// The game's save sections (mw-e30.3): the one list of everything the current build saves. Saving,
// loading and the save-schema gate (pnpm save:check, tests/save-fixtures) all build their registry
// here, so a system that adds a section registers it in exactly one place and the gate fingerprints
// it automatically. Sections: the built-in world section, then inventory (mw-e17.8), creatures
// (mw-e12.14), world facts and level deltas (mw-e27.4).

import { creaturesSaveSection } from './creatures';
import { SaveRegistry } from './format';
import { inventorySaveSection, type InventorySectionOptions } from './inventory';
import { levelDeltasSaveSection } from './level-deltas';
import { worldFactsSaveSection } from './world-facts';

/** What the game's sections need from the running build. */
export type GameSaveOptions = InventorySectionOptions;

/**
 * A registry holding every save section this build writes, world first, in apply order. Returns a
 * fresh registry each call (registries are cheap and hold no world state). The game passes its
 * content's item ids (`knownItem`) and a logger (`warn`) so a save holding a removed item still loads;
 * `warn` also hears about renamed, dropped and damaged world state.
 */
export function createGameSaveRegistry(options: GameSaveOptions = {}): SaveRegistry {
  const { warn } = options;
  return new SaveRegistry()
    .register(inventorySaveSection(options))
    .register(creaturesSaveSection())
    .register(worldFactsSaveSection({ ...(warn && { warn }) }))
    .register(levelDeltasSaveSection({ ...(warn && { warn }) }));
}
