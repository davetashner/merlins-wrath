// Unlock definitions as content (mw-e19.3, ADR-0004): `src/content/data/unlock/<group>.json` says how
// each capability is learned. An unlock names the capability it grants, the capabilities it builds on
// (prerequisites: the verb chain, Ember → Firebolt → Flame Jet → Fire Wall), the world-fact
// requirements that must hold, the in-world channels that may teach it (book, trainer, schematic,
// trick, deed) and, for an upgrade that replaces a verb, the capability it replaces and subsumes
// (Telekinesis still pulls levers like Mage Hand). The sim's learn API is
// src/sim/progression/unlocks.ts; the game builds it from these files (src/game/progression.ts).
//
// `checkUnlocks` runs across files at load (mw-e19.3 AC-6): every capability an unlock names is
// declared, each capability has one unlock, there is no prerequisite or replacement cycle, and no
// unlock is a pure numeric upgrade unless flagged `supporting`. A capability the registry declares
// `supporting: true` is a numeric entry, not a verb, so unlocking it is a numeric upgrade by
// declaration. The rest of ADR-0004's rules (P2–P8) are mw-e19.15.

import { z } from 'zod';
import type { ContentCheck, ContentIssue, LoadedEntry } from '../loader.ts';
import { contentId } from '../schema.ts';
import { capabilityId, type CapabilityGroup } from './capability.ts';
import { conditionSchema } from './condition.ts';

/** The channels that teach capabilities (mirrors the sim's UNLOCK_CHANNELS). */
export const UNLOCK_CHANNELS = ['book', 'trainer', 'schematic', 'trick', 'deed'] as const;

const unlockDefSchema = z
  .strictObject({
    capability: capabilityId.describe('The capability this unlock grants (source `learned`).'),
    prerequisites: z
      .array(capabilityId)
      .default([])
      .describe('Capabilities the learner must already know: the previous steps of its chain.'),
    requirements: conditionSchema
      .optional()
      .describe('World-fact condition that must hold when learning; absent = none.'),
    channels: z
      .array(z.enum(UNLOCK_CHANNELS))
      .min(1)
      .describe('The in-world channels that may teach it (ADR-0004).'),
    replaces: capabilityId
      .optional()
      .describe(
        'A capability this one replaces and subsumes: learning it moves the learned grant over.',
      ),
    supporting: z
      .boolean()
      .optional()
      .describe(
        'Marks a deliberate numeric (supporting) unlock; required when the capability is supporting.',
      ),
  })
  .superRefine((def, ctx) => {
    const seen = new Set<string>();
    def.prerequisites.forEach((id, index) => {
      const problem =
        id === def.capability
          ? 'an unlock cannot require itself'
          : seen.has(id)
            ? `"${id}" is listed twice`
            : undefined;
      if (problem !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['prerequisites', index], message: problem });
      }
      seen.add(id);
    });
    if (new Set(def.channels).size !== def.channels.length) {
      ctx.addIssue({ code: 'custom', path: ['channels'], message: 'a channel is listed twice' });
    }
    if (def.replaces === def.capability) {
      ctx.addIssue({
        code: 'custom',
        path: ['replaces'],
        message: 'an unlock cannot replace itself',
      });
    }
  });

/** One file of unlock definitions: `src/content/data/unlock/<id>.json`. */
export const unlockSchema = z
  .strictObject({
    id: contentId.describe('Group id, e.g. "sorcerer-fire". Unlocks are keyed by capability.'),
    name: z.string().min(1).describe('Display name of the group (docs and debug tools).'),
    notes: z.string().min(1).describe('What the group covers and where it comes from, for review.'),
    unlocks: z.array(unlockDefSchema).min(1).describe('The unlocks it defines.'),
  })
  .superRefine((group, ctx) => {
    const seen = new Set<string>();
    group.unlocks.forEach(({ capability }, index) => {
      if (seen.has(capability)) {
        ctx.addIssue({
          code: 'custom',
          path: ['unlocks', index, 'capability'],
          message: `"${capability}" has two unlocks in this file`,
        });
      }
      seen.add(capability);
    });
  });

/** An unlock group as written in JSON. */
export type UnlockGroupInput = z.input<typeof unlockSchema>;
/** A validated unlock group. */
export type UnlockGroup = z.output<typeof unlockSchema>;
/** One validated unlock definition. */
export type UnlockEntry = UnlockGroup['unlocks'][number];

/** An unlock with where it was declared. */
interface Located {
  readonly file: string;
  readonly pointer: string;
  readonly def: UnlockEntry;
}

/** Every unlock in the loaded entries, in file order. */
function unlocksIn(entries: readonly LoadedEntry[]): Located[] {
  return entries
    .filter((entry) => entry.type === 'unlock')
    .flatMap(({ file, value }) =>
      (value as UnlockGroup).unlocks.map((def, i) => ({
        file,
        pointer: `/unlocks/${String(i)}`,
        def,
      })),
    );
}

/** The edges a cycle may run along: prerequisites, then the replaced capability. */
const edgesOf = (def: UnlockEntry): readonly { to: string; field: string }[] => [
  ...def.prerequisites.map((to, i) => ({ to, field: `prerequisites/${String(i)}` })),
  ...(def.replaces === undefined ? [] : [{ to: def.replaces, field: 'replaces' }]),
];

/**
 * Every prerequisite/replacement cycle, once each, as the capability ids along it (first id
 * repeated at the end) with the unlock and field that closes it. Iterative depth-first search.
 */
export function unlockCycles(
  unlocks: readonly Located[],
): { path: readonly string[]; at: Located; field: string }[] {
  const byCapability = new Map(unlocks.map((u) => [u.def.capability, u]));
  const state = new Map<string, 'open' | 'done'>();
  const cycles: { path: readonly string[]; at: Located; field: string }[] = [];
  for (const root of unlocks) {
    if (state.has(root.def.capability)) continue;
    const path: string[] = [];
    const stack: { unlock: Located; next: number }[] = [{ unlock: root, next: 0 }];
    state.set(root.def.capability, 'open');
    path.push(root.def.capability);
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as { unlock: Located; next: number };
      const edges = edgesOf(top.unlock.def);
      const edge = edges[top.next];
      if (edge === undefined) {
        state.set(top.unlock.def.capability, 'done');
        stack.pop();
        path.pop();
        continue;
      }
      top.next++;
      const target = byCapability.get(edge.to);
      if (target === undefined || state.get(edge.to) === 'done') continue;
      if (state.get(edge.to) === 'open') {
        cycles.push({
          path: [...path.slice(path.indexOf(edge.to)), edge.to],
          at: top.unlock,
          field: edge.field,
        });
        continue;
      }
      state.set(edge.to, 'open');
      path.push(edge.to);
      stack.push({ unlock: target, next: 0 });
    }
  }
  return cycles;
}

/**
 * The load check for unlocks (mw-e19.3 AC-6): declared capabilities, one unlock per capability, no
 * cycles, and no pure numeric upgrade unless flagged `supporting`.
 */
export const checkUnlocks: ContentCheck = (entries) => {
  const capabilities = new Map<string, boolean>();
  for (const entry of entries) {
    if (entry.type !== 'capability') continue;
    for (const def of (entry.value as CapabilityGroup).capabilities) {
      capabilities.set(def.id, def.supporting === true);
    }
  }
  const issues: ContentIssue[] = [];
  const first = new Map<string, string>();
  const unlocks = unlocksIn(entries);
  for (const { file, pointer, def } of unlocks) {
    for (const { id, at } of [
      { id: def.capability, at: 'capability' },
      ...edgesOf(def).map(({ to, field }) => ({ id: to, at: field })),
    ]) {
      if (!capabilities.has(id)) {
        issues.push({
          file,
          pointer: `${pointer}/${at}`,
          message: `capability "${id}" is not declared: add it to src/content/data/capability/`,
        });
      }
    }
    const earlier = first.get(def.capability);
    if (earlier === undefined) first.set(def.capability, file);
    else {
      issues.push({
        file,
        pointer: `${pointer}/capability`,
        message: `"${def.capability}" already has an unlock in ${earlier}`,
      });
    }
    if (capabilities.get(def.capability) === true && def.supporting !== true) {
      issues.push({
        file,
        pointer: `${pointer}/capability`,
        message: `"${def.capability}" is a supporting (numeric) capability, so this unlock is a pure numeric upgrade: flag it "supporting": true or make it grant a new verb (ADR-0004 P1)`,
      });
    }
  }
  for (const { path, at, field } of unlockCycles(unlocks)) {
    issues.push({
      file: at.file,
      pointer: `${at.pointer}/${field}`,
      message: `prerequisite cycle: ${path.join(' → ')}`,
    });
  }
  return issues;
};
