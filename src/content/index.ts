// Public API of the content layer (mw-e00.18): schemas + data files, validated at load into a typed,
// deeply frozen catalogue. src/sim may import these only as types (`import type`).
// Not exported here, by design: fs-sources.ts (Node only), testing.ts (Vitest only) and
// json-schema.ts (build-time tooling; keeps zod's JSON Schema generator out of the game bundle).

/** Layer marker, checked by the alias smoke test. */
export const layer = 'content' as const;

export { CONTENT_ID_PATTERN, ContentRef, contentId, ref, serializeContent } from './schema.ts';
export {
  ContentLoadError,
  dottedPath,
  jsonPointer,
  loadContent,
  type Catalogue,
  type ContentIssue,
  type ContentSchemas,
  type ContentSource,
  type EntryOf,
  type Frozen,
} from './loader.ts';
export {
  CREATURE_FAMILIES,
  CREATURE_SCHEMA_VERSION,
  PERSONALITY_TRAITS,
  SIZE_CLASSES,
  STANCES,
  creatureSchema,
  type CreatureDef,
  type CreatureDefInput,
} from './types/creature.ts';
export {
  DAMAGE_TYPES,
  MAX_RESISTANCE,
  poiseRegenSchema,
  resistancesSchema,
  type DamageTypeName,
} from './types/damage.ts';
export {
  AREA_REQUIREMENTS,
  GAITS,
  LINK_REQUIREMENTS,
  LOCOMOTION_MODES,
  LocomotionResolutionError,
  NAV_AREAS,
  NAV_BITS,
  NAV_CAPABILITIES,
  NAV_LINK_KINDS,
  canEnterArea,
  canTraverseLink,
  capabilityMask,
  creatureLocomotionSchema,
  deriveNavAgent,
  locomotionProfileSchema,
  locomotionSchema,
  navMask,
  resolveLocomotion,
  type CreatureLocomotion,
  type Gait,
  type LocomotionDef,
  type LocomotionDefInput,
  type LocomotionMode,
  type LocomotionProfile,
  type LocomotionProfileLookup,
  type NavAgent,
  type NavArea,
  type NavCapability,
  type NavLink,
  type NavLinkKind,
} from './types/locomotion.ts';
export {
  FOOTSTEP_LOUDNESS_RANGE,
  IMPACT_SOUND_PATTERN,
  materialPresets,
  materialPropertiesSchema,
  materialSchema,
  type MaterialDef,
  type MaterialDefInput,
  type MaterialProperties,
} from './types/material.ts';
export {
  SPECIAL_SENSE_CHANNELS,
  SenseResolutionError,
  creatureSensesSchema,
  resolveSenses,
  senseProfileSchema,
  senseSchema,
  type CreatureSenses,
  type SenseDef,
  type SenseDefInput,
  type SenseProfile,
  type SenseProfileLookup,
  type SpecialSenseChannel,
} from './types/sense.ts';
export { canonicalJson, fnv1a64 } from './hash.ts';
export {
  toPropertyInit,
  worldPropertiesSchema,
  type Present,
  type WorldPropertiesData,
  type WorldPropertiesInit,
} from './world-properties.ts';
export {
  contentTypes,
  type ContentType,
  type ContentTypes,
  type GameContent,
  type GameEntry,
} from './registry.ts';
export { GAME_CONTENT_ROOT, gameContentSources, loadGameContent } from './game-content.ts';
