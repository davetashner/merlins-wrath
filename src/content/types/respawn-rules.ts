// Respawn rules (mw-e01.8): one file, `src/content/data/respawn-rules/respawn-rules.json`, saying how
// long the death beat lasts and where and how the player comes back after dying. Each rule applies in
// one region (the scene the player died in) while its `conditions` over world facts hold; the sim's
// resolver (src/sim/respawn/rules.ts) picks the matching rule with the highest `priority`, ties going
// to the lowest id. The winner's `mode` is `reload` (the death screen's Load last save, mw-e30.7) or
// `wake-in-place` (e01-contextual-respawn, mw-e01.12), its `destination` is a spawn point of a scene
// (where a wake-in-place puts the player, or where a reload with no save starts), and `factsToSet`
// are written when it is chosen. A death in a region no rule matches falls back to reloading the last
// save and logs a content warning.
//
// Checked at load: ids unique, each region and destination scene a real scene, each destination spawn
// a spawn that scene places (checkRespawnRules), and conditions and facts against the fact registry
// (src/content/condition-checks.ts).

import { z } from 'zod';
import type { ContentCheck, ContentIssue, Frozen } from '../loader.ts';
import { contentId, ref } from '../schema.ts';
import { conditionSchema } from './condition.ts';
import { FACT_KEY_PATTERN } from './fact.ts';
import type { SceneDef } from './scene.ts';

/** The id (and file name) of the one respawn-rules entry. */
export const RESPAWN_RULES_ID = 'respawn-rules';

/** How the player comes back (mirrors the sim's RESPAWN_MODES). */
export const RESPAWN_MODES = ['reload', 'wake-in-place'] as const;

const respawnRuleSchema = z.strictObject({
  id: contentId.describe('Unique among the rules; breaks priority ties (lowest id wins).'),
  notes: z.string().min(1).optional().describe('Why the rule exists.'),
  region: ref('scene').describe('The scene the player dies in for this rule to apply.'),
  priority: z.int().default(0).describe('Of every matching rule the highest priority wins.'),
  conditions: conditionSchema
    .optional()
    .describe('A world-fact condition that must hold (docs/design/conditions.md); omit: always.'),
  destination: z
    .strictObject({
      scene: ref('scene').describe('The scene of the spawn point.'),
      spawn: contentId.describe('A spawn id that scene places.'),
    })
    .describe(
      'Where the player comes back: the wake-in-place spot, or the start when a reload finds no save.',
    ),
  mode: z
    .enum(RESPAWN_MODES)
    .describe(
      'reload: the death screen and Load last save; wake-in-place: wake at the destination.',
    ),
  factsToSet: z
    .array(
      z.strictObject({
        fact: z.string().regex(FACT_KEY_PATTERN, 'must be a fact key').describe('A declared fact.'),
        value: z
          .union([z.boolean(), z.int(), z.string().min(1)])
          .describe('A bool, a whole number or a string, fitting the fact type.'),
      }),
    )
    .default([])
    .describe('Facts written when the rule is chosen.'),
});

/** Schema of the respawn rules, `src/content/data/respawn-rules/respawn-rules.json`. */
export const respawnRulesSchema = z
  .strictObject({
    id: z.literal(RESPAWN_RULES_ID).describe('Always "respawn-rules": there is one rule table.'),
    notes: z.string().min(1).describe('What the table covers and why.'),
    deathBeatSeconds: z
      .number()
      .min(0)
      .max(10)
      .describe('Seconds of sim time from the player’s death to the death screen.'),
    rules: z.array(respawnRuleSchema).describe('The rules, in any order.'),
  })
  .superRefine((table, ctx) => {
    const seen = new Set<string>();
    table.rules.forEach(({ id }, index) => {
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['rules', index, 'id'],
          message: `"${id}" is defined twice`,
        });
      }
      seen.add(id);
    });
  });

/** The respawn rules as written in JSON. */
export type RespawnRulesInput = z.input<typeof respawnRulesSchema>;
/** The validated respawn rules. */
export type RespawnRules = z.output<typeof respawnRulesSchema>;
/** One validated respawn rule. */
export type RespawnRuleDef = RespawnRules['rules'][number];
/** The loaded (deeply frozen) respawn rules. */
export type RespawnRulesEntry = Frozen<RespawnRules>;

/**
 * The content check for respawn rules (AC-5): every destination's spawn is a spawn its scene places.
 * Missing scenes are already reported by the loader's reference check.
 */
export const checkRespawnRules: ContentCheck = (entries) => {
  const spawns = new Map<string, { file: string; ids: ReadonlySet<string> }>();
  for (const { type, file, value } of entries) {
    if (type !== 'scene') continue;
    spawns.set(value.id, { file, ids: new Set((value as SceneDef).spawns.map(({ id }) => id)) });
  }
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'respawn-rules') continue;
    (value as RespawnRules).rules.forEach(({ id, destination }, i) => {
      const scene = spawns.get(destination.scene.id);
      if (scene === undefined || scene.ids.has(destination.spawn)) return;
      issues.push({
        file,
        pointer: `/rules/${String(i)}/destination/spawn`,
        message: `respawn rule "${id}" sends the player to spawn "${destination.spawn}", which scene "${destination.scene.id}" (${scene.file}) does not place`,
      });
    });
  }
  return issues;
};
