// Scenario layouts and player scripts (mw-e11.3): the JSON half of an AI scenario. A layout is a
// small grey-box room in metres: wall boxes (they block the player, light and the stand-in senses'
// line of sight), the light (ambient, ambient zones, point lights by id), where the player starts and
// the fixtures (creatures by id, with patrol routes) the scenario is about. A player script is the
// path the player takes: walk/crouch/sprint to points, wait, throw something that lands with a noise,
// put a light out. Both are validated here, every problem listed with its path, before any world is
// built; creature ids are checked when the scenario loads (they need the creature table).

import { z } from 'zod';
import { describeIssue } from '../replay/format';
import type { Vec3 } from '../stimulus/shapes';

/** Thrown for a layout or player script that does not match the format, or names what is not there. */
export class ScenarioLoadError extends Error {
  override readonly name = 'ScenarioLoadError';

  constructor(
    /** The scenario's name. */
    readonly scenario: string,
    /** One human-readable line per problem. */
    readonly issues: readonly string[],
  ) {
    super(`scenario "${scenario}" cannot load:\n  ${issues.join('\n  ')}`);
  }
}

const triple = z.tuple([z.number(), z.number(), z.number()]);
const id = z.string().min(1);
const unit = z.number().min(0).max(1);

/** Ids in `items` that occur more than once, as zod issues. */
const uniqueIds =
  (what: string) =>
  (items: readonly { readonly id: string }[], ctx: z.RefinementCtx): void => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'id'],
          message: `duplicate ${what} "${item.id}"`,
        });
      }
      seen.add(item.id);
    });
  };

const box = z
  .strictObject({ min: triple, max: triple })
  .refine(
    ({ min, max }) => min[0] < max[0] && min[1] < max[1] && min[2] < max[2],
    'every max must exceed its min',
  );

const layoutSchema = z.strictObject({
  id,
  description: z.string().optional(),
  walls: z.array(box).default([]),
  light: z
    .strictObject({
      ambient: unit.default(0),
      zones: z
        .array(z.strictObject({ id, min: triple, max: triple, level: unit }))
        .default([])
        .superRefine(uniqueIds('light zone')),
      lights: z
        .array(
          z.strictObject({
            id,
            at: triple,
            intensity: z.number().positive(),
            radius: z.number().positive(),
          }),
        )
        .default([])
        .superRefine(uniqueIds('light')),
    })
    .default({ ambient: 0, zones: [], lights: [] }),
  player: z.strictObject({
    at: triple,
    /** Look yaw in quarter turns (scene yaw): 0 looks along −z, 90 along −x. */
    yaw: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  }),
  fixtures: z
    .array(
      z.strictObject({
        id,
        creature: id,
        at: triple,
        /** Facing, degrees: 0 faces +z, 90 faces +x. */
        yaw: z.number().default(0),
        faction: id.optional(),
        patrol: z.array(triple).min(1).optional(),
      }),
    )
    .min(1)
    .superRefine(uniqueIds('fixture')),
});

/** A validated scenario layout. */
export type ScenarioLayout = z.output<typeof layoutSchema>;
/** A scenario layout as written in JSON. */
export type ScenarioLayoutInput = z.input<typeof layoutSchema>;

/** How the player moves while walking to a point. */
export type PlayerStance = 'walk' | 'crouch' | 'sprint';

const stance = z.enum(['walk', 'crouch', 'sprint']).default('walk');

const stepSchema = z.union([
  z.strictObject({
    /** Where to go: [x, z] or [x, y, z] (y is ignored), metres. */
    to: z.union([z.tuple([z.number(), z.number()]), triple]),
    stance,
    /** Stick deflection, 0–1. */
    speed: z.number().gt(0).max(1).default(1),
    /** Arrived within this many metres (horizontal). */
    within: z.number().positive().default(0.25),
  }),
  z.strictObject({ wait: z.number().nonnegative(), stance }),
  z.strictObject({
    /** Where the thrown thing lands, metres. */
    throw: triple,
    /** How loud it lands, dB at 1 m. */
    db: z.number().nonnegative().default(60),
  }),
  z.strictObject({ extinguish: id }),
]);

const scriptSchema = z.array(stepSchema);

/** One validated step of a player script. */
export type PlayerStep = z.output<typeof stepSchema>;
/** A player script step as written in JSON. */
export type PlayerStepInput = z.input<typeof stepSchema>;

/** A layout coordinate as a Vec3. */
export const vec3 = ([x, y, z]: readonly [number, number, number]): Vec3 =>
  Object.freeze({ x, y, z });

/**
 * Validates parsed JSON as a scenario layout.
 * @throws ScenarioLoadError listing every problem.
 */
export function parseScenarioLayout(scenario: string, data: unknown): ScenarioLayout {
  const result = layoutSchema.safeParse(data);
  if (!result.success) {
    throw new ScenarioLoadError(
      scenario,
      result.error.issues.map((issue) => `layout${describeIssue(issue).slice(1)}`),
    );
  }
  return result.data;
}

/**
 * Validates parsed JSON as a player script; `lights` are the layout's light ids, which
 * `extinguish` steps must name.
 * @throws ScenarioLoadError listing every problem.
 */
export function parsePlayerScript(
  scenario: string,
  data: unknown,
  lights: readonly string[],
): readonly PlayerStep[] {
  const result = scriptSchema.safeParse(data);
  if (!result.success) {
    throw new ScenarioLoadError(
      scenario,
      result.error.issues.map((issue) => `player${describeIssue(issue).slice(1)}`),
    );
  }
  const issues: string[] = [];
  result.data.forEach((step, i) => {
    if ('extinguish' in step && !lights.includes(step.extinguish)) {
      issues.push(`player[${String(i)}].extinguish: the layout has no light "${step.extinguish}"`);
    }
  });
  if (issues.length > 0) throw new ScenarioLoadError(scenario, issues);
  return result.data;
}
