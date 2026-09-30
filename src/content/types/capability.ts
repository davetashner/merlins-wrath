// Capability ids as content (mw-e15.1): `src/content/data/capability/<group>.json` declares the verbs
// a player can have ("can the player do X?"): spell.mage-hand, arrow.rope, verb.climb.ledge. Puzzle
// solutions (and later obstacles, dialogue and equipment) name capabilities, so a typo'd id must fail
// at load rather than silently make a solution unreachable. This is only the id registry: the
// runtime per-actor registry with source-tracked grants, and richer fields (name/description keys,
// icon, class affinity, supporting flag), are mw-e19.2. Ids are unique across every group file
// (`checkCapabilities`); a capability's id is not a content id, so groups are the entries.

import { z } from 'zod';
import type { ContentCheck, ContentIssue, LoadedEntry } from '../loader.ts';
import { contentId } from '../schema.ts';

/** Capability ids: a family, a dot, then kebab-case segments joined by dots (mw-e19.2 AC-4). */
export const CAPABILITY_ID_PATTERN = /^(verb|spell|arrow|tool|trick|technique|sense)\.[a-z0-9.-]+$/;

/** A capability id field, e.g. in a puzzle solution. Checked against the registry at load. */
export const capabilityId = z
  .string()
  .regex(CAPABILITY_ID_PATTERN, 'must be a capability id, e.g. "spell.mage-hand"')
  .describe('Capability id declared in src/content/data/capability/, e.g. "spell.mage-hand".');

const capabilityDefSchema = z.strictObject({
  id: capabilityId.describe(
    'Capability id: verb., spell., arrow., tool., trick., technique. or sense. then a name.',
  ),
  name: z.string().min(1).describe('Display name, e.g. "Mage Hand".'),
  description: z
    .string()
    .min(1)
    .describe('What the capability lets the player do in the world, for designers and review.'),
});

/** One file of the capability registry: `src/content/data/capability/<id>.json`. */
export const capabilitySchema = z
  .strictObject({
    id: contentId.describe('Group id, e.g. "sorcerer-spells". Capabilities are keyed by their id.'),
    name: z.string().min(1).describe('Display name of the group (docs and debug tools).'),
    notes: z.string().min(1).describe('What the group covers and where it comes from, for review.'),
    capabilities: z.array(capabilityDefSchema).min(1).describe('The capabilities it declares.'),
  })
  .superRefine((group, ctx) => {
    const seen = new Set<string>();
    group.capabilities.forEach(({ id }, index) => {
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['capabilities', index, 'id'],
          message: `"${id}" is declared twice in this file`,
        });
      }
      seen.add(id);
    });
  });

/** A capability group as written in JSON. */
export type CapabilityGroupInput = z.input<typeof capabilitySchema>;
/** A validated capability group. */
export type CapabilityGroup = z.output<typeof capabilitySchema>;

/** Every declared capability id across the loaded capability groups. */
export function capabilityIds(entries: readonly LoadedEntry[]): ReadonlySet<string> {
  return new Set(
    entries
      .filter((entry) => entry.type === 'capability')
      .flatMap((entry) => (entry.value as CapabilityGroup).capabilities.map(({ id }) => id)),
  );
}

/** The load check for the registry: a capability id is declared in one file only. */
export const checkCapabilities: ContentCheck = (entries) => {
  const firstFile = new Map<string, string>();
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'capability') continue;
    (value as CapabilityGroup).capabilities.forEach(({ id }, i) => {
      const first = firstFile.get(id);
      if (first === undefined) firstFile.set(id, file);
      else {
        issues.push({
          file,
          pointer: `/capabilities/${String(i)}/id`,
          message: `capability "${id}" is already declared in ${first}`,
        });
      }
    });
  }
  return issues;
};
