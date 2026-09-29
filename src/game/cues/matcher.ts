// The generic cue-rule matcher (mw-e28.3), shared by audio cue sheets and VFX cue sheets (e29.3).
// A rule names an event, a layer and the facts it requires; for each event occurrence the matcher
// returns, per layer, the most specific rule whose facts all hold (most match keys; ties go to the
// earlier rule), so a sheet lists a generic fallback and specific overrides in any order and a
// material pair without its own rule still falls back to something. It knows nothing about sounds or
// effects: callers attach their own presentation fields to the rules.

import { CUE_PLACEHOLDER, cuePlaceholders } from '@content/index';

/** A fact value an event reading carries (see CUE_FACT_KINDS in src/content/cue-events.ts). */
export type CueFactValue = string | boolean | number | readonly string[];

/** Facts of one event occurrence; an absent fact is `undefined` or missing. */
export type CueFacts = Readonly<Record<string, CueFactValue | undefined>>;

/** What the matcher reads from a rule. */
export interface MatchableRule {
  readonly event: string;
  readonly layer: string;
  readonly match: Readonly<Record<string, string | boolean>>;
}

/** Whether one required value holds: equality, or membership for a list fact. */
function holds(fact: CueFactValue | undefined, wanted: string | boolean): boolean {
  if (Array.isArray(fact)) return (fact as readonly string[]).includes(wanted as string);
  return fact === wanted;
}

/** Whether every `match` entry holds in `facts`. */
export function matchesFacts(match: MatchableRule['match'], facts: CueFacts): boolean {
  return Object.entries(match).every(([key, wanted]) => holds(facts[key], wanted));
}

/** Rules indexed by event, most specific first. */
export class CueRuleSet<R extends MatchableRule> {
  readonly #byEvent = new Map<string, R[]>();

  /** Indexes `rules`; their order is the tie-break (earlier wins). */
  constructor(rules: Iterable<R>) {
    for (const rule of rules) {
      const list = this.#byEvent.get(rule.event) ?? [];
      list.push(rule);
      this.#byEvent.set(rule.event, list);
    }
    for (const list of this.#byEvent.values()) {
      // Array.prototype.sort is stable, so equal specificity keeps authoring order.
      list.sort((a, b) => Object.keys(b.match).length - Object.keys(a.match).length);
    }
  }

  /** Event names some rule uses (what a bridge needs to subscribe to). */
  events(): string[] {
    return [...this.#byEvent.keys()];
  }

  /** The winning rule of each layer for one occurrence of `event`, in first-winner order. */
  resolve(event: string, facts: CueFacts): R[] {
    const winners = new Map<string, R>();
    for (const rule of this.#byEvent.get(event) ?? []) {
      if (!winners.has(rule.layer) && matchesFacts(rule.match, facts)) {
        winners.set(rule.layer, rule);
      }
    }
    return [...winners.values()];
  }
}

/**
 * Fills a template's `{fact}` placeholders from string facts. Undefined when a placeholder's fact is
 * absent or not a string, so a rule plays nothing rather than a wrong cue.
 */
export function interpolateCue(template: string, facts: CueFacts): string | undefined {
  const complete = cuePlaceholders(template).every((name) => typeof facts[name] === 'string');
  if (!complete) return undefined;
  return template.replace(CUE_PLACEHOLDER, (_, name: string) => String(facts[name]));
}
