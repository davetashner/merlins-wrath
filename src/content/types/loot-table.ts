// The loot-table content type (mw-e18.1): what a container or creature yields, one file per table at
// `src/content/data/loot-table/<id>.json`. Loot is data (contract §1), and tables favour handcrafted
// guarantees over random stat-sticks: `guaranteed` items always drop, then `rolls` (a range) picks
// from the weighted `entries`. An entry yields an item (a count range of it) or rolls another table
// (that many times), so tables nest; the sim stops a chain deeper than LOOT_MAX_DEPTH at runtime and
// emits an error. `noDuplicates` lets each entry win at most once per roll of the table. Unique items
// (`flags.unique`) only drop while the world has not marked them obtained.
//
// An entry may carry `conditions`, simple predicates until the shared condition DSL (mw-e22) lands:
// `class` (the player's class is one of these) and `when` (a world-fact condition, mw-e27.5). Both
// must hold. The sim evaluates them behind one predicate interface (src/sim/loot), which the DSL will
// replace without changing it. The roller is src/sim/loot/tables.ts; the cross-table validator
// (references, uniques, cycles, weights) is mw-e18.2. The field reference in
// docs/content/loot-table-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';
import { conditionSchema } from './condition.ts';

/** The deepest a chain of nested tables may go (the root is depth 1; mirrors the sim's). */
export const LOOT_MAX_DEPTH = 4;

/** How many units or rolls: a whole number in [min, max]. */
const rangeSchema = (what: string) =>
  z
    .strictObject({
      min: z.int().nonnegative().describe(`Fewest ${what}.`),
      max: z.int().nonnegative().describe(`Most ${what}.`),
    })
    .refine((range) => range.min <= range.max, {
      message: 'min must not exceed max',
      path: ['max'],
    });

const conditionsSchema = z
  .strictObject({
    class: z
      .array(ref('class'))
      .min(1)
      .optional()
      .describe('The player’s class must be one of these.'),
    when: conditionSchema.optional().describe('A world-fact condition that must hold (mw-e27.5).'),
  })
  .refine((conditions) => conditions.class !== undefined || conditions.when !== undefined, {
    message: 'conditions need `class` or `when`; omit the field for an unconditional entry',
  })
  .describe(
    'Simple predicates until the shared condition DSL (mw-e22): every one given must hold.',
  );

const entrySchema = z
  .strictObject({
    item: ref('item').optional().describe('The item this entry yields.'),
    table: ref('loot-table').optional().describe('A loot table this entry rolls instead.'),
    weight: z.int().min(1).describe('Relative chance of this entry per roll.'),
    count: rangeSchema('units (an item) or rolls (a table)')
      .prefault({ min: 1, max: 1 })
      .describe('Units of the item, or times the table is rolled, when the entry wins.'),
    conditions: conditionsSchema.optional(),
  })
  .refine((entry) => (entry.item === undefined) !== (entry.table === undefined), {
    message: 'an entry names exactly one of `item` or `table`',
  });

/** Schema of one loot table file, `src/content/data/loot-table/<id>.json`. */
export const lootTableSchema = z.strictObject({
  id: contentId.describe('Loot table id, e.g. "testbed-supply-crate".'),
  notes: z.string().min(1).describe('What drops it and why these odds, for owner review.'),
  guaranteed: z
    .array(
      z.strictObject({
        item: ref('item').describe('The item.'),
        count: z.int().min(1).default(1).describe('Units of it.'),
      }),
    )
    .default([])
    .describe('Items that always drop (unless unique and already obtained).'),
  rolls: rangeSchema('rolls on `entries`')
    .prefault({ min: 0, max: 0 })
    .describe('How many times `entries` is rolled.'),
  entries: z.array(entrySchema).default([]).describe('Weighted entries each roll picks one of.'),
  noDuplicates: z
    .boolean()
    .default(false)
    .describe('Each entry wins at most once per roll of this table.'),
});

/** A loot table as written in JSON (optional fields may be omitted). */
export type LootTableInput = z.input<typeof lootTableSchema>;
/** A validated loot table with defaults filled and refs parsed. */
export type LootTable = z.output<typeof lootTableSchema>;
