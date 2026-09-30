// Locomotion profiles (mw-e12.6). Verticality and alternate routes only matter if creatures move
// differently: a Loom Spider on the ceiling, a Hushling drifting over a flooded gallery, a Briar Wolf
// that outruns you but cannot climb after you, Brother Horn too big for the goblins' crawlspaces.
// A profile is pure data: the nav-mesh agent size, one entry per locomotion mode (walk, climb, fly,
// swim, burrow, wallcrawl, or `stationary`) with sneak/walk/run speeds and that mode's limits (step
// and jump height, slope, wade depth, climbing grade, altitude, diggable materials), whether it
// squeezes through crawlspaces or opens doors, and per-area path-cost multipliers.
//
// Like senses (sense.ts), reusable profiles are a content type (`src/content/data/locomotion/<id>.json`)
// because a family moves alike: every goblin climbs and squeezes, every Forgotten shambles. A creature
// names one ("goblin"), overrides one (`{ "base": "goblin", "agent": { "radius": 0.45 } }`, `null`
// removes a mode or area cost) or writes a complete profile inline. Modes are keyed by name, so a mode
// can never repeat and overrides merge mode by mode. `resolveLocomotion` merges and re-validates.
//
// Navigation (e11.4) never reads profiles directly: `deriveNavAgent` turns one into a NavAgent with a
// capability bitfield, so nav queries stay cheap bitwise tests. Off-mesh links (jump, drop, climb,
// door, fly, burrow) and nav areas each require capability bits (`LINK_REQUIREMENTS`,
// `AREA_REQUIREMENTS`); the bake can store those masks on the navmesh, and `canTraverseLink` /
// `canEnterArea` add the numeric limits (jump rise, drop height, climb difficulty 1–3 of the world
// property `climbable` via `climbDifficulty` in src/sim/climb, diggable `material` presets). Pathfinding itself is e11.4's job in src/sim.
//
// Units: metres, metres per second, degrees. Cost multipliers are unitless (1 = neutral).

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { ContentRef, contentId, ref } from '../schema.ts';

/** Locomotion modes. `stationary` is how a creature that never moves declares it (alone). */
export const LOCOMOTION_MODES = [
  'walk',
  'climb',
  'fly',
  'swim',
  'burrow',
  'wallcrawl',
  'stationary',
] as const;

/** A locomotion mode name. */
export type LocomotionMode = (typeof LOCOMOTION_MODES)[number];

/**
 * Gaits, slowest first (audio bible §7.3 footstep gaits). AI picks the gait, the profile the speed:
 * patrol and idle walk, investigate and stalk sneak, chase, combat and flee run.
 */
export const GAITS = ['sneak', 'walk', 'run'] as const;

/** A gait name. */
export type Gait = (typeof GAITS)[number];

/**
 * Nav capability bits, one per moving mode plus the area permissions. Order is stable (the baked
 * navmesh stores link and area masks built from it): append new capabilities, never reorder.
 */
export const NAV_CAPABILITIES = [
  'walk',
  'climb',
  'fly',
  'swim',
  'burrow',
  'wallcrawl',
  'wade',
  'squeeze',
  'open-doors',
] as const;

/** A nav capability name. */
export type NavCapability = (typeof NAV_CAPABILITIES)[number];

/** Bit value of each nav capability, e.g. `NAV_BITS.climb`. */
export const NAV_BITS = Object.fromEntries(
  NAV_CAPABILITIES.map((capability, index) => [capability, 1 << index]),
) as Readonly<Record<NavCapability, number>>;

/** The mask with every bit of `capabilities` set. */
export function navMask(...capabilities: readonly NavCapability[]): number {
  return capabilities.reduce((mask, capability) => mask | NAV_BITS[capability], 0);
}

/**
 * Nav areas the bake marks on navmesh polygons: open ground, wadeable water (the `water-shallow`
 * footstep surface), water too deep to wade, and crawlspaces (low or narrow gaps marked by the level).
 */
export const NAV_AREAS = ['ground', 'water-shallow', 'water-deep', 'crawlspace'] as const;

/** A nav area name. */
export type NavArea = (typeof NAV_AREAS)[number];

/** Capabilities that let an agent enter each area (any one suffices). */
export const AREA_REQUIREMENTS: Readonly<Record<NavArea, number>> = {
  ground: navMask('walk', 'wallcrawl', 'fly', 'burrow'),
  'water-shallow': navMask('wade', 'swim', 'fly'),
  'water-deep': navMask('swim', 'fly'),
  crawlspace: navMask('squeeze'),
};

/** Off-mesh link kinds. Mode transitions (walk → climb, walk → fly…) are links of these kinds. */
export const NAV_LINK_KINDS = ['jump', 'drop', 'climb', 'door', 'fly', 'burrow'] as const;

/** An off-mesh link kind. */
export type NavLinkKind = (typeof NAV_LINK_KINDS)[number];

/** Capabilities that may traverse each link kind (any one; `canTraverseLink` adds the limits). */
export const LINK_REQUIREMENTS: Readonly<Record<NavLinkKind, number>> = {
  jump: navMask('walk', 'fly'),
  drop: navMask('walk', 'wallcrawl', 'fly'),
  climb: navMask('climb', 'wallcrawl'),
  door: navMask('open-doors'),
  fly: navMask('fly'),
  burrow: navMask('burrow'),
};

const metres = z.number().nonnegative();
const positiveMetres = z.number().positive();
const speed = z.number().positive();

const speedsShape = {
  sneak: speed.describe('Sneak speed, m/s (investigate, stalk).'),
  walk: speed.describe('Walk speed, m/s (patrol, idle); at least sneak.'),
  run: speed.describe('Run speed, m/s (chase, combat, flee); at least walk.'),
};
const speedsSchema = z.strictObject(speedsShape).describe('Speed per gait, m/s.');

const walkShape = {
  stepHeight: metres.describe('Tallest step it walks up without a jump, m; at most agent.height.'),
  maxSlope: z.number().min(0).max(90).describe('Steepest walkable slope, degrees.'),
  jumpHeight: metres.describe(
    'Highest ledge it can jump up onto, m (jump links); 0 = never jumps.',
  ),
  maxDrop: metres.describe('Highest drop it takes deliberately, m (drop links).'),
  wadeDepth: metres.describe('Deepest water it wades through, m; 0 = keeps out of water.'),
};

const climbShape = {
  maxGrade: z
    .int()
    .min(1)
    .max(3)
    .describe(
      'Hardest climb difficulty it climbs: 1 ladders, ropes and ivy, 2 rough walls, 3 sheer or frozen.',
    ),
};

const wallcrawlShape = {
  ceilings: z.boolean().describe('Whether it also crawls upside down across ceilings.'),
};

const flyShape = {
  maxAltitude: positiveMetres.describe(
    'Highest it flies above the ground below, m (height-offset flight, e11.4).',
  ),
};

const swimShape = {
  dives: z.boolean().describe('Whether it swims underwater (false = surface only).'),
};

const burrowShape = {
  materials: z
    .array(ref('material'))
    .min(1)
    .describe('Material presets it digs through (burrow links), e.g. "earth".'),
};

const modeShapes = {
  walk: walkShape,
  climb: climbShape,
  fly: flyShape,
  swim: swimShape,
  burrow: burrowShape,
  wallcrawl: wallcrawlShape,
};

/** The modes that move (every mode but stationary), each with gait speeds. */
const MOVING_MODES = ['walk', 'climb', 'fly', 'swim', 'burrow', 'wallcrawl'] as const;

const modeDescriptions: Readonly<Record<LocomotionMode, string>> = {
  walk: 'Walking on the navmesh.',
  climb: 'Climbing surfaces marked `climbable` (climb links).',
  fly: 'Kinematic flight at a height offset; also crosses gaps and water.',
  swim: 'Swimming in water too deep to wade.',
  burrow: 'Digging through diggable materials (burrow links).',
  wallcrawl: 'Crawling on any solid wall, whatever its climbing grade.',
  stationary: 'Never moves; must be its only mode.',
};

const stationarySchema = z.strictObject({});

/** A moving mode: its gait speeds plus the mode's own limits. */
function mode<S extends z.ZodRawShape>(shape: S, name: LocomotionMode) {
  return z
    .strictObject({ speeds: speedsSchema, ...shape })
    .optional()
    .describe(modeDescriptions[name]);
}

const modesSchema = z
  .strictObject({
    walk: mode(walkShape, 'walk'),
    climb: mode(climbShape, 'climb'),
    fly: mode(flyShape, 'fly'),
    swim: mode(swimShape, 'swim'),
    burrow: mode(burrowShape, 'burrow'),
    wallcrawl: mode(wallcrawlShape, 'wallcrawl'),
    stationary: stationarySchema.optional().describe(modeDescriptions.stationary),
  })
  .describe('Locomotion modes by name, at least one; absent = it cannot move that way.');

const agentSchema = z
  .strictObject({
    radius: positiveMetres.describe('Nav agent radius, m (clearance from walls).'),
    height: positiveMetres.describe('Nav agent height, m (headroom it needs).'),
  })
  .describe('Nav-mesh agent size.');

const areaCost = z
  .number()
  .min(0.1)
  .max(100)
  .describe('Path-cost multiplier, 0.1–100: below 1 prefers the area, above 1 avoids it.');

const areaList = NAV_AREAS.join(', ');

/** The fields of one profile (no id): what a resolved creature hands to navigation and movement. */
const profileShape = {
  agent: agentSchema,
  modes: modesSchema,
  squeezes: z
    .boolean()
    .default(false)
    .describe('Whether it fits through crawlspaces (nav area `crawlspace`).'),
  opensDoors: z.boolean().default(false).describe('Whether it opens unlocked doors (door links).'),
  areaCosts: z
    .partialRecord(z.enum(NAV_AREAS), areaCost)
    .prefault({})
    .describe(`Path-cost multiplier per nav area (${areaList}); unlisted areas cost 1.`),
};

/**
 * Runs a cross-field check only once every field passed its own bounds, so one bad value is reported
 * once (zod otherwise runs refinements after recoverable issues).
 */
const whenValid = {
  when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0,
};

type ProfileFields = z.output<z.ZodObject<typeof profileShape>>;
type Speeds = z.output<typeof speedsSchema>;

/** Adds an issue when the gait speeds of `mode` are not ordered sneak ≤ walk ≤ run. */
function checkSpeeds(mode: string, s: Speeds, ctx: z.RefinementCtx): void {
  const name = (gait: Gait) => `modes.${mode}.speeds.${gait}`;
  const order = (slower: Gait, faster: Gait) => {
    if (s[faster] >= s[slower]) return;
    ctx.addIssue({
      code: 'custom',
      path: ['modes', mode, 'speeds', faster],
      message: `${name(faster)} (${String(s[faster])} m/s) must not be lower than ${name(slower)} (${String(s[slower])} m/s)`,
    });
  };
  order('sneak', 'walk');
  order('walk', 'run');
}

/** Adds an issue for every cross-field inconsistency, naming the fields involved. */
function checkProfile(p: ProfileFields, ctx: z.RefinementCtx): void {
  const modes = Object.keys(p.modes);
  if (modes.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['modes'],
      message:
        'at least one locomotion mode is required; a creature that never moves declares stationary',
    });
  }
  if (p.modes.stationary !== undefined && modes.length > 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['modes', 'stationary'],
      message: `stationary must be the only mode (also has ${modes.filter((m) => m !== 'stationary').join(', ')})`,
    });
  }
  for (const mode of MOVING_MODES) {
    const fields = p.modes[mode];
    if (fields !== undefined) checkSpeeds(mode, fields.speeds, ctx);
  }
  const walk = p.modes.walk;
  if (walk !== undefined && walk.stepHeight > p.agent.height) {
    ctx.addIssue({
      code: 'custom',
      path: ['modes', 'walk', 'stepHeight'],
      message: `modes.walk.stepHeight (${String(walk.stepHeight)} m) must not exceed agent.height (${String(p.agent.height)} m)`,
    });
  }
  const mask = capabilityMask(p);
  for (const area of Object.keys(p.areaCosts) as NavArea[]) {
    if ((mask & AREA_REQUIREMENTS[area]) !== 0) continue;
    ctx.addIssue({
      code: 'custom',
      path: ['areaCosts', area],
      message: `areaCosts.${area} is set but it cannot enter ${area}`,
    });
  }
}

/** A complete locomotion profile: at least one mode, ordered gait speeds, consistent limits. */
export const locomotionProfileSchema = z
  .strictObject(profileShape)
  .superRefine(checkProfile, whenValid);

/** A complete, validated locomotion profile (what movement and navigation read). */
export type LocomotionProfile = z.output<typeof locomotionProfileSchema>;

/** One reusable locomotion profile: `src/content/data/locomotion/<id>.json`. */
export const locomotionSchema = z
  .strictObject({
    id: contentId.describe('Profile id creatures refer to, e.g. "goblin".'),
    name: z.string().min(1).describe('Display name (editor and docs).'),
    notes: z
      .string()
      .min(1)
      .describe(
        'Why these values (canon, real-world reference, intended users), for owner review.',
      ),
    ...profileShape,
  })
  .superRefine(checkProfile, whenValid);

/** A locomotion profile as written in a data file. */
export type LocomotionDefInput = z.input<typeof locomotionSchema>;
/** A loaded locomotion profile. */
export type LocomotionDef = z.output<typeof locomotionSchema>;

const PROFILE_KEYS = ['agent', 'modes', 'squeezes', 'opensDoors', 'areaCosts'] as const;

/** Keeps only the profile keys that hold a value (drops `base` and absent keys). */
function profileFields(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    PROFILE_KEYS.flatMap((key) => (value[key] === undefined ? [] : [[key, value[key]]])),
  );
}

/** A mode's override: any subset of its fields, with any subset of its gait speeds. */
function modeOverride<S extends z.ZodRawShape>(shape: S, mode: LocomotionMode) {
  return z
    .strictObject({
      speeds: z.strictObject(speedsShape).partial().describe('Gait speeds to override, m/s.'),
      ...shape,
    })
    .partial()
    .nullable()
    .optional()
    .describe(`${modeDescriptions[mode]} Fields to override; null = cannot move this way.`);
}

/** Object form of a creature's locomotion: a base profile plus overrides, or a complete profile. */
const locomotionOverrideSchema = z
  .strictObject({
    base: ref('locomotion')
      .optional()
      .describe(
        'Locomotion profile to start from; the other fields override it. Absent = the object is ' +
          'a complete inline profile.',
      ),
    agent: agentSchema.partial().optional().describe('Agent size fields to override.'),
    modes: z
      .strictObject({
        walk: modeOverride(modeShapes.walk, 'walk'),
        climb: modeOverride(modeShapes.climb, 'climb'),
        fly: modeOverride(modeShapes.fly, 'fly'),
        swim: modeOverride(modeShapes.swim, 'swim'),
        burrow: modeOverride(modeShapes.burrow, 'burrow'),
        wallcrawl: modeOverride(modeShapes.wallcrawl, 'wallcrawl'),
        stationary: stationarySchema
          .nullable()
          .optional()
          .describe(`${modeDescriptions.stationary} null removes it.`),
      })
      .optional()
      .describe(
        'Modes to override or add, field by field; a mode the base lacks is given in full.',
      ),
    squeezes: z.boolean().optional().describe('Overrides whether it fits through crawlspaces.'),
    opensDoors: z.boolean().optional().describe('Overrides whether it opens unlocked doors.'),
    areaCosts: z
      .partialRecord(z.enum(NAV_AREAS), areaCost.nullable())
      .optional()
      .describe(`Area costs to override (${areaList}); null resets one to 1.`),
  })
  .superRefine((value, ctx) => {
    // Without a base the object must stand alone: validate it as a complete profile. Field bounds
    // were already checked above (whenValid), so each issue here is new.
    if (value.base !== undefined) return;
    const result = locomotionProfileSchema.safeParse(profileFields(value));
    for (const issue of result.error?.issues ?? []) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  }, whenValid);

/**
 * A creature's `locomotion` field: a `locomotion` profile id, a base profile plus overrides, or a
 * complete inline profile. Merge rules (see `resolveLocomotion`): objects merge field by field (a
 * mode's `speeds` gait by gait); `null` removes a mode or resets an area cost; lists (burrow
 * materials) replace; a mode the base lacks must be given in full.
 */
export const creatureLocomotionSchema = z
  .union([ref('locomotion'), locomotionOverrideSchema])
  .describe(
    'A `locomotion` profile id; or `{ base, …overrides }` (named fields replace the base’s, null ' +
      'removes a mode or area cost); or a complete inline profile (no base).',
  );

/** A creature's parsed `locomotion` field. */
export type CreatureLocomotion = z.output<typeof creatureLocomotionSchema>;

/** Where `resolveLocomotion` looks up referenced profiles; a loaded `GameContent` is one. */
export interface LocomotionProfileLookup {
  resolve(target: ContentRef<'locomotion'>): Frozen<LocomotionDef>;
}

/** Thrown by `resolveLocomotion` when a creature's merged locomotion is not a valid profile. */
export class LocomotionResolutionError extends Error {
  override readonly name = 'LocomotionResolutionError';
}

type Plain = Readonly<Record<string, unknown>>;

const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `base` with `override` applied: objects merge key by key, null removes, anything else replaces. */
function merge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (override === null) return undefined;
  if (!isPlain(override)) return override;
  const from = isPlain(base) ? base : {};
  const keys = new Set([...Object.keys(from), ...Object.keys(override)]);
  return Object.fromEntries(
    [...keys].flatMap((key) => {
      const next = merge(from[key], override[key]);
      return next === undefined ? [] : [[key, next]];
    }),
  );
}

/** Loaded content as its JSON form (refs back to plain ids), ready to merge and re-parse. */
const toJson = (value: unknown): Plain => JSON.parse(JSON.stringify(value)) as Plain;

/**
 * A creature's complete locomotion profile: its referenced profile, or the base with its overrides
 * applied, or its inline profile. The result is validated again (a valid base plus valid overrides
 * can still be inconsistent, e.g. a run speed below the base's walk speed) and throws a
 * LocomotionResolutionError naming every problem. Returns a fresh, unfrozen object.
 */
export function resolveLocomotion(
  locomotion: Frozen<CreatureLocomotion>,
  profiles: LocomotionProfileLookup,
): LocomotionProfile {
  const baseRef = locomotion instanceof ContentRef ? locomotion : locomotion.base;
  const override = locomotion instanceof ContentRef ? {} : toJson(locomotion);
  const merged =
    baseRef === undefined
      ? profileFields(override)
      : profileFields(merge(toJson(profiles.resolve(baseRef)), override) as Plain);
  const label =
    baseRef === undefined ? 'inline locomotion profile' : `locomotion based on ${String(baseRef)}`;
  const result = locomotionProfileSchema.safeParse(merged);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new LocomotionResolutionError(`invalid ${label}: ${problems.join('; ')}`);
  }
  return result.data;
}

/** The locomotion fields capability derivation reads (a profile or a loaded profile entry). */
type ProfileLike = Frozen<Pick<LocomotionProfile, 'modes' | 'squeezes' | 'opensDoors'>>;

/**
 * The nav capability bitfield of a profile: one bit per moving mode it has, `wade` when it walks
 * and wades (`wadeDepth` > 0), `squeeze` and `open-doors` from its flags. Stationary = 0.
 */
export function capabilityMask(profile: ProfileLike): number {
  const { walk, climb, fly, swim, burrow, wallcrawl } = profile.modes;
  const has = (capability: NavCapability, yes: boolean) => (yes ? NAV_BITS[capability] : 0);
  return (
    has('walk', walk !== undefined) |
    has('climb', climb !== undefined) |
    has('fly', fly !== undefined) |
    has('swim', swim !== undefined) |
    has('burrow', burrow !== undefined) |
    has('wallcrawl', wallcrawl !== undefined) |
    has('wade', walk !== undefined && walk.wadeDepth > 0) |
    has('squeeze', profile.squeezes) |
    has('open-doors', profile.opensDoors)
  );
}

/** What navigation needs of one creature: its capability mask plus the numeric limits. */
export interface NavAgent {
  /** Nav capability bitfield (`NAV_BITS`). */
  readonly mask: number;
  /** Agent radius, m. */
  readonly radius: number;
  /** Agent height, m. */
  readonly height: number;
  /** Tallest step walked up, m (0 when it does not walk). */
  readonly stepHeight: number;
  /** Steepest walkable slope, degrees (0 when it does not walk). */
  readonly maxSlope: number;
  /** Highest jump link it takes, m (0 when it does not walk). */
  readonly jumpHeight: number;
  /** Highest drop link it takes on foot, m (0 when it does not walk). */
  readonly maxDrop: number;
  /** Deepest water waded, m (0 when it does not walk). */
  readonly wadeDepth: number;
  /** Hardest climb difficulty climbed, 1–3 (0 when it does not climb). */
  readonly maxClimbGrade: number;
  /** Highest flight above the ground, m (0 when it does not fly). */
  readonly maxAltitude: number;
  /** Material preset ids it burrows through (empty when it does not burrow). */
  readonly burrowMaterials: readonly string[];
  /** Path-cost multiplier for every area it can enter; areas it cannot enter are absent. */
  readonly areaCosts: Readonly<Partial<Record<NavArea, number>>>;
}

/** The NavAgent of a resolved profile (the capability mask derivation navigation consumes). */
export function deriveNavAgent(profile: Frozen<LocomotionProfile>): NavAgent {
  const { walk, climb, fly, burrow } = profile.modes;
  const mask = capabilityMask(profile);
  const areaCosts = Object.fromEntries(
    NAV_AREAS.filter((area) => (mask & AREA_REQUIREMENTS[area]) !== 0).map((area) => [
      area,
      profile.areaCosts[area] ?? 1,
    ]),
  );
  return {
    mask,
    radius: profile.agent.radius,
    height: profile.agent.height,
    stepHeight: walk?.stepHeight ?? 0,
    maxSlope: walk?.maxSlope ?? 0,
    jumpHeight: walk?.jumpHeight ?? 0,
    maxDrop: walk?.maxDrop ?? 0,
    wadeDepth: walk?.wadeDepth ?? 0,
    maxClimbGrade: climb?.maxGrade ?? 0,
    maxAltitude: fly?.maxAltitude ?? 0,
    burrowMaterials: burrow?.materials.map((material) => material.id) ?? [],
    areaCosts,
  };
}

/** An off-mesh link as navigation sees it, with the measure its kind is limited by. */
export type NavLink =
  | { readonly kind: 'jump'; /** Height gained, m. */ readonly rise: number }
  | { readonly kind: 'drop'; /** Height lost, m. */ readonly fall: number }
  | {
      readonly kind: 'climb';
      /** Climb difficulty of the surface's `climbable` grade, 1–3. */ readonly grade: number;
    }
  | { readonly kind: 'door' }
  | { readonly kind: 'fly' }
  | { readonly kind: 'burrow'; /** Material preset id dug through. */ readonly material: string };

/** Whether `agent` has a capability in `mask`. */
const hasAny = (agent: NavAgent, mask: number) => (agent.mask & mask) !== 0;

/**
 * Whether `agent` can traverse `link`: it needs one of the link kind's capabilities
 * (`LINK_REQUIREMENTS`) and must be within that capability's limit — jump rise ≤ jumpHeight (or ≤
 * maxAltitude flying), drop fall ≤ maxDrop (any height flying or wallcrawling), climb grade ≤
 * maxClimbGrade (any grade wallcrawling), burrow material among its burrowMaterials.
 */
export function canTraverseLink(agent: NavAgent, link: NavLink): boolean {
  switch (link.kind) {
    case 'jump':
      return (
        (hasAny(agent, NAV_BITS.walk) && link.rise <= agent.jumpHeight) ||
        (hasAny(agent, NAV_BITS.fly) && link.rise <= agent.maxAltitude)
      );
    case 'drop':
      return (
        hasAny(agent, navMask('fly', 'wallcrawl')) ||
        (hasAny(agent, NAV_BITS.walk) && link.fall <= agent.maxDrop)
      );
    case 'climb':
      return (
        hasAny(agent, NAV_BITS.wallcrawl) ||
        (hasAny(agent, NAV_BITS.climb) && link.grade <= agent.maxClimbGrade)
      );
    case 'burrow':
      return agent.burrowMaterials.includes(link.material);
    case 'door':
    case 'fly':
      return hasAny(agent, LINK_REQUIREMENTS[link.kind]);
  }
}

/** Whether `agent` may enter nav area `area` (it has one of `AREA_REQUIREMENTS[area]`). */
export function canEnterArea(agent: NavAgent, area: NavArea): boolean {
  return hasAny(agent, AREA_REQUIREMENTS[area]);
}
