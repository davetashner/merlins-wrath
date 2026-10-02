// Every sound id the cue sheets can play (mw-e28.2 AC-1). A rule's cue is either a literal id or a
// template like `sfx-impact-{target}`; templates are expanded over every value their facts can take,
// read from content (the material impact classes and footstep surfaces, material ids, attack
// telegraph cues, move sounds). A template naming a fact with no known value set is reported rather
// than skipped, so a new templated rule forces the check to learn its values instead of silently
// passing.

import { cuePlaceholders } from '../../src/content/cue-events.ts';
import type { GameContent } from '../../src/content/registry.ts';

/** Fact name → every value it can take. */
export type FactDomains = ReadonlyMap<string, readonly string[]>;

/** Prefix of a material's impact sound set. */
const IMPACT_PREFIX = 'sfx-impact-';

/** Facts holding an impact class (events.ts `classFacts`/`materialFacts` prefixes). */
const CLASS_FACTS = ['target', 'weapon', 'entity', 'other'] as const;

/** The value sets of the facts cue templates may interpolate, from loaded content. */
export function factDomains(content: Pick<GameContent, 'all'>): FactDomains {
  const materials = content.all('material');
  const classes = [...new Set(materials.map((m) => m.impactSound.slice(IMPACT_PREFIX.length)))];
  const ids = materials.map((m) => m.id);
  const domains = new Map<string, readonly string[]>();
  for (const fact of CLASS_FACTS) {
    domains.set(fact, classes);
    domains.set(`${fact}Material`, ids);
  }
  domains.set('material', ids);
  domains.set('telegraph', [...new Set(content.all('attack').map((a) => a.telegraph))]);
  // Footstep surfaces the materials declare, plus stone, which unknown surfaces fall back to.
  domains.set('surface', [
    ...new Set(['stone', ...materials.flatMap((m) => m.footstepSurface ?? [])]),
  ]);
  // Each move's own sound (ActionPhaseChanged `sound`) and each arrow's own impact sound
  // (arrowImpact `sound`).
  domains.set('sound', [
    ...new Set([
      ...content.all('move').flatMap((m) => m.presentation.audioCue ?? []),
      ...content.all('arrow').flatMap((a) => a.cues.impactSfx ?? []),
    ]),
  ]);
  return domains;
}

/** Every id a template expands to over the domains (the cartesian product of its facts). */
export function expandTemplate(template: string, domains: FactDomains): string[] {
  return cuePlaceholders(template).reduce(
    (partials, fact) =>
      partials.flatMap((partial) =>
        (domains.get(fact) ?? []).map((value) => partial.replace(`{${fact}}`, value)),
      ),
    [template],
  );
}

/** The sound ids the sheets can play, sorted, and any template facts without a value set. */
export function cueSoundIds(
  sheets: readonly { readonly rules: readonly { readonly cue: string }[] }[],
  domains: FactDomains,
): { ids: string[]; unknownFacts: string[] } {
  const ids = new Set<string>();
  const unknownFacts = new Set<string>();
  for (const { cue } of sheets.flatMap((sheet) => sheet.rules)) {
    for (const fact of cuePlaceholders(cue)) if (!domains.has(fact)) unknownFacts.add(fact);
    for (const id of expandTemplate(cue, domains)) ids.add(id);
  }
  return { ids: [...ids].sort(), unknownFacts: [...unknownFacts].sort() };
}
