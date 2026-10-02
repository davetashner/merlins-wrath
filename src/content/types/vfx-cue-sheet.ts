// VFX cue sheets as content (mw-e29.3): `src/content/data/vfx-cue-sheet/<id>.json`. A sheet is a list
// of rules mapping sim events to effects, the visual twin of audio cue sheets (types/cue-sheet.ts):
// the same events, facts, layers and most-specific-wins matcher, so a metal-on-metal hit both clangs
// and sparks from one table of facts: {event, match, layer, effect, at, socket, attach, orientTo,
// scaleBy, stopOn, cooldownMs}. The effect id may interpolate string facts (`{trail}` plays the
// arrow's own trail). An effect id that is no vfx-effect yet is allowed — a dev marker shows where it
// would play — and `vfxCueSheetWarnings` names it with its rule index. src/game/cues runs the sheets.

import { z } from 'zod';
import {
  checkCueRule,
  CUE_DIRECTIONS,
  CUE_EVENT_NAMES,
  cueDirections,
  cueEventSpec,
  cuePlaceholders,
  cueRuleBaseFields,
  type CueEventName,
} from '../cue-events.ts';
import { contentId } from '../schema.ts';

/** An effect template: a VFX effect id whose segments may be `{fact}` placeholders. */
export const VFX_EFFECT_TEMPLATE_PATTERN =
  /^(?:\{[a-zA-Z]+\}|vfx(?:-(?:[a-z0-9]+|\{[a-zA-Z]+\}))+)$/;

const scaleBySchema = z
  .strictObject({
    fact: z.string().min(1).describe('A number fact of the event, e.g. "total" or "energy".'),
    min: z.number().describe('Fact value at (or below) which the effect emits at `floor`.'),
    max: z.number().describe('Fact value at (or above) which the effect emits fully.'),
    floor: z
      .number()
      .min(0)
      .max(1)
      .default(0.25)
      .describe('Emission at `min`, 0–1; linear up to 1 at `max`.'),
  })
  .refine((v) => v.max > v.min, { message: 'max must be greater than min', path: ['max'] });

/** One rule of a VFX cue sheet. */
export const vfxCueRuleSchema = z
  .strictObject({
    ...cueRuleBaseFields,
    effect: z
      .string()
      .regex(
        VFX_EFFECT_TEMPLATE_PATTERN,
        'must be a VFX effect id, optionally with {fact} segments, e.g. "vfx-impact-{target}"',
      )
      .describe(
        'vfx-effect id to spawn; `{fact}` segments are filled from string facts (a missing fact spawns nothing).',
      ),
    at: z
      .string()
      .optional()
      .describe('Event anchor to spawn at; default: the event’s first anchor.'),
    socket: contentId
      .optional()
      .describe('Socket on the anchor entity (e.g. "hand-r"); default: the effect’s own socket.'),
    attach: z
      .boolean()
      .default(true)
      .describe(
        'Follow the anchor entity while it exists (when it is destroyed the effect stops emitting and its particles finish); false spawns at where it is now.',
      ),
    orientTo: z
      .enum(CUE_DIRECTIONS)
      .optional()
      .describe(
        'Point the effect’s up axis (its launch cone) along a direction of the event: "hitNormal" out of the struck surface, "attackerForward" along the blow.',
      ),
    scaleBy: scaleBySchema
      .optional()
      .describe('Scale emission by a number fact (intensity: damage dealt, impact energy…).'),
    stopOn: z
      .array(
        z.enum(CUE_EVENT_NAMES, {
          error: (issue) => `unknown sim event "${String(issue.input)}"`,
        }),
      )
      .default([])
      .describe(
        'Events that stop a looping effect this rule started on the same entity (their default anchor), e.g. a fire loop stopped by fireExtinguished.',
      ),
    cooldownMs: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Minimum ms between two spawns of this rule on the same anchor.'),
  })
  .superRefine((rule, ctx) => {
    checkCueRule(rule, ctx);
    checkPresentation(rule, ctx);
  });

/** The fields `checkPresentation` validates. */
interface PresentationShape {
  readonly event: CueEventName;
  readonly effect: string;
  readonly at?: string | undefined;
  readonly orientTo?: (typeof CUE_DIRECTIONS)[number] | undefined;
  readonly scaleBy?: { readonly fact: string } | undefined;
}

/** Placeholders are string facts, `at` an anchor, `orientTo` a direction the event carries. */
function checkPresentation(rule: PresentationShape, ctx: z.RefinementCtx): void {
  const spec = cueEventSpec(rule.event);
  for (const name of cuePlaceholders(rule.effect)) {
    if (spec.facts[name] !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['effect'],
        message: `{${name}} must be a string fact of ${rule.event}`,
      });
    }
  }
  if (rule.at !== undefined && !spec.anchors.includes(rule.at)) {
    ctx.addIssue({
      code: 'custom',
      path: ['at'],
      message: `${rule.event} has no anchor "${rule.at}"; it has: ${spec.anchors.join(', ')}`,
    });
  }
  const directions = cueDirections(rule.event);
  if (rule.orientTo !== undefined && !directions.includes(rule.orientTo)) {
    ctx.addIssue({
      code: 'custom',
      path: ['orientTo'],
      message: `${rule.event} carries no "${rule.orientTo}"; it has: ${directions.join(', ') || 'none'}`,
    });
  }
  if (rule.scaleBy !== undefined && spec.facts[rule.scaleBy.fact] !== 'number') {
    ctx.addIssue({
      code: 'custom',
      path: ['scaleBy', 'fact'],
      message: `"${rule.scaleBy.fact}" must be a number fact of ${rule.event}`,
    });
  }
}

/** One VFX cue sheet: `src/content/data/vfx-cue-sheet/<id>.json`. */
export const vfxCueSheetSchema = z
  .strictObject({
    id: contentId.describe('Sheet id, e.g. "combat".'),
    notes: z.string().min(1).describe('What the sheet covers and why, for owner review.'),
    rules: z
      .array(vfxCueRuleSchema)
      .min(1)
      .describe('The rules, most specific wins per event and layer.'),
  })
  .superRefine((sheet, ctx) => {
    const seen = new Map<string, number>();
    sheet.rules.forEach((rule, index) => {
      const match = Object.entries(rule.match).sort(([a], [b]) => (a < b ? -1 : 1));
      const key = JSON.stringify([rule.event, rule.layer, match]);
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, index);
        return;
      }
      ctx.addIssue({
        code: 'custom',
        path: ['rules', index],
        message: `rule ${String(index)} has the same event, layer and match as rule ${String(first)}, so it can never win`,
      });
    });
  });

/** A VFX cue sheet as written in a data file. */
export type VfxCueSheetDefInput = z.input<typeof vfxCueSheetSchema>;
/** A loaded VFX cue sheet. */
export type VfxCueSheetDef = z.output<typeof vfxCueSheetSchema>;
/** A loaded VFX cue rule. */
export type VfxCueRuleDef = z.output<typeof vfxCueRuleSchema>;

/**
 * mw-e29.3 AC-4: warnings (never errors: a placeholder is allowed) for rules whose effect id names
 * no known effect, each with its sheet and rule index. Templated ids are checked when they spawn.
 */
export function vfxCueSheetWarnings(
  sheets: readonly {
    readonly id: string;
    readonly rules: readonly { readonly effect: string }[];
  }[],
  effectIds: ReadonlySet<string>,
): string[] {
  return sheets.flatMap((sheet) =>
    sheet.rules.flatMap((rule, index) =>
      cuePlaceholders(rule.effect).length === 0 && !effectIds.has(rule.effect)
        ? [
            `vfx-cue-sheet "${sheet.id}" rule ${String(index)}: effect "${rule.effect}" is not a vfx-effect yet (placeholder: a dev marker shows where it would play)`,
          ]
        : [],
    ),
  );
}
