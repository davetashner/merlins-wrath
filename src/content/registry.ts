// The content-type registry (mw-e00.18): every content type the game loads, keyed by its folder
// name under src/content/data/. Adding a content type = a schema module + one line here + a folder.
// `contentChecks` are the checks across entries every load runs: fact references (mw-e27.2),
// conditions against the fact registry (mw-e27.5), animation (mw-e02.20) and socket tracks
// (mw-e04.26), capability ids and puzzles against their scenes, capabilities and facts (mw-e15.1).

import { checkAnimation } from './anim-checks.ts';
import { checkConditions } from './condition-checks.ts';
import { checkFacts } from './fact-checks.ts';
import { checkPuzzles } from './puzzle-checks.ts';
import type { Catalogue, ContentCheck, EntryOf } from './loader.ts';
import { animClipSchema } from './types/anim-clip.ts';
import { animGraphSchema } from './types/anim-graph.ts';
import { attackSchema } from './types/attack.ts';
import { cameraSchema } from './types/camera.ts';
import { capabilitySchema, checkCapabilities } from './types/capability.ts';
import { namedConditionSchema } from './types/condition.ts';
import { controllerSchema } from './types/controller.ts';
import { creatureSchema } from './types/creature.ts';
import { cueSheetSchema } from './types/cue-sheet.ts';
import { factSchema } from './types/fact.ts';
import { factionSchema } from './types/faction.ts';
import { kitSchema } from './types/kit.ts';
import { locomotionSchema } from './types/locomotion.ts';
import { materialSchema } from './types/material.ts';
import { moveSchema } from './types/move.ts';
import { puzzleSchema } from './types/puzzle.ts';
import { sandboxSchema } from './types/sandbox.ts';
import { sceneSchema } from './types/scene.ts';
import { senseSchema } from './types/sense.ts';
import { shieldSchema } from './types/shield.ts';
import { signalGraphSchema } from './types/signal-graph.ts';
import { checkSocketTracks, socketTrackSchema } from './types/socket-track.ts';
import { spellSchema } from './types/spell.ts';
import { testPropSchema } from './types/testprop.ts';
import { vfxEffectSchema } from './types/vfx-effect.ts';

/** Content type name → schema of one entry. */
export const contentTypes = {
  'anim-clip': animClipSchema,
  'anim-graph': animGraphSchema,
  attack: attackSchema,
  camera: cameraSchema,
  capability: capabilitySchema,
  condition: namedConditionSchema,
  controller: controllerSchema,
  creature: creatureSchema,
  'cue-sheet': cueSheetSchema,
  fact: factSchema,
  faction: factionSchema,
  kit: kitSchema,
  locomotion: locomotionSchema,
  material: materialSchema,
  move: moveSchema,
  puzzle: puzzleSchema,
  sandbox: sandboxSchema,
  scene: sceneSchema,
  sense: senseSchema,
  shield: shieldSchema,
  'signal-graph': signalGraphSchema,
  'socket-track': socketTrackSchema,
  spell: spellSchema,
  testprop: testPropSchema,
  'vfx-effect': vfxEffectSchema,
};

/** Checks across entries, run on every load of the registered types (see loader.ts). */
export const contentChecks: readonly ContentCheck[] = [
  checkFacts,
  checkConditions,
  checkAnimation,
  checkSocketTracks,
  checkCapabilities,
  checkPuzzles,
];

export type ContentTypes = typeof contentTypes;
/** A registered content type name (its folder under src/content/data/). */
export type ContentType = keyof ContentTypes;
/** The game's loaded content. */
export type GameContent = Catalogue<ContentTypes>;
/** A loaded entry of the game's content type `K`, e.g. `GameEntry<'testprop'>`. */
export type GameEntry<K extends ContentType> = EntryOf<ContentTypes, K>;
