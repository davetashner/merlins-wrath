// The content-type registry (mw-e00.18): every content type the game loads, keyed by its folder
// name under src/content/data/. Adding a content type = a schema module + one line here + a folder.
// `contentChecks` are the checks across entries (fact references, mw-e27.2) every load runs.

import { checkFacts } from './fact-checks.ts';
import type { Catalogue, ContentCheck, EntryOf } from './loader.ts';
import { attackSchema } from './types/attack.ts';
import { cameraSchema } from './types/camera.ts';
import { controllerSchema } from './types/controller.ts';
import { creatureSchema } from './types/creature.ts';
import { factSchema } from './types/fact.ts';
import { factionSchema } from './types/faction.ts';
import { kitSchema } from './types/kit.ts';
import { locomotionSchema } from './types/locomotion.ts';
import { materialSchema } from './types/material.ts';
import { moveSchema } from './types/move.ts';
import { sceneSchema } from './types/scene.ts';
import { senseSchema } from './types/sense.ts';
import { signalGraphSchema } from './types/signal-graph.ts';
import { testPropSchema } from './types/testprop.ts';

/** Content type name → schema of one entry. */
export const contentTypes = {
  attack: attackSchema,
  camera: cameraSchema,
  controller: controllerSchema,
  creature: creatureSchema,
  fact: factSchema,
  faction: factionSchema,
  kit: kitSchema,
  locomotion: locomotionSchema,
  material: materialSchema,
  move: moveSchema,
  scene: sceneSchema,
  sense: senseSchema,
  'signal-graph': signalGraphSchema,
  testprop: testPropSchema,
};

/** Checks across entries, run on every load of the registered types (see loader.ts). */
export const contentChecks: readonly ContentCheck[] = [checkFacts];

export type ContentTypes = typeof contentTypes;
/** A registered content type name (its folder under src/content/data/). */
export type ContentType = keyof ContentTypes;
/** The game's loaded content. */
export type GameContent = Catalogue<ContentTypes>;
/** A loaded entry of the game's content type `K`, e.g. `GameEntry<'testprop'>`. */
export type GameEntry<K extends ContentType> = EntryOf<ContentTypes, K>;
