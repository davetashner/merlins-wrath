// The content-type registry (mw-e00.18): every content type the game loads, keyed by its folder
// name under src/content/data/. Adding a content type = a schema module + one line here + a folder.

import type { Catalogue, EntryOf } from './loader.ts';
import { creatureSchema } from './types/creature.ts';
import { testPropSchema } from './types/testprop.ts';

/** Content type name → schema of one entry. */
export const contentTypes = {
  creature: creatureSchema,
  testprop: testPropSchema,
};

export type ContentTypes = typeof contentTypes;
/** A registered content type name (its folder under src/content/data/). */
export type ContentType = keyof ContentTypes;
/** The game's loaded content. */
export type GameContent = Catalogue<ContentTypes>;
/** A loaded entry of the game's content type `K`, e.g. `GameEntry<'testprop'>`. */
export type GameEntry<K extends ContentType> = EntryOf<ContentTypes, K>;
