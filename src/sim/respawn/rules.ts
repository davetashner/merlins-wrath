// Respawn rules (mw-e01.8): where and how the player comes back after dying, from content
// (src/content/data/respawn-rules). A rule applies in one region (the scene the player died in) when
// its conditions over world facts hold; of every rule that applies, the highest priority wins and a
// tie goes to the lowest rule id (code-unit order), so the choice never depends on file order. The
// winner says the mode (reload the last save, or wake in place: e01-contextual-respawn), the
// destination spawn and the facts to set. When no rule applies the player reloads the last save, and
// the content gap is reported as a warning: every region the player can die in should have a rule.

import { compileCondition, type CompiledCondition, type Condition } from '../facts/conditions';
import type { FactReader } from '../facts/conditions';
import type { FactValue } from '../facts/store';

/** How the player comes back. */
export const RESPAWN_MODES = ['reload', 'wake-in-place'] as const;

export type RespawnMode = (typeof RESPAWN_MODES)[number];

/** A scene spawn point: where a wake-in-place puts the player, or where a reload with no save starts. */
export interface RespawnDestination {
  /** Scene (area) id. */
  readonly scene: string;
  /** Spawn id in that scene. */
  readonly spawn: string;
}

/** A fact a rule writes when it is chosen. */
export interface RespawnFact {
  readonly fact: string;
  readonly value: FactValue;
}

/** One respawn rule (the content's rule with its refs resolved to ids). */
export interface RespawnRule {
  /** Unique among the rules; breaks priority ties. */
  readonly id: string;
  /** The region (scene id) the rule applies in. */
  readonly region: string;
  /** Higher wins. */
  readonly priority: number;
  /** Must hold over world facts for the rule to apply; absent: always. */
  readonly conditions?: Condition | undefined;
  readonly destination: RespawnDestination;
  readonly mode: RespawnMode;
  readonly factsToSet: readonly RespawnFact[];
}

/** What a death is resolved against. */
export interface RespawnContext {
  /** The region (scene id) the player died in. */
  readonly region: string;
  readonly facts: FactReader;
}

/** The chosen respawn. */
export interface RespawnResolution {
  /** The winning rule's id; null for the fallback. */
  readonly rule: string | null;
  readonly mode: RespawnMode;
  /** The winning rule's destination; null for the fallback (the area's own start). */
  readonly destination: RespawnDestination | null;
  readonly factsToSet: readonly RespawnFact[];
}

/** No rule applied: reload the last save. */
export const FALLBACK_RESPAWN: RespawnResolution = Object.freeze({
  rule: null,
  mode: 'reload',
  destination: null,
  factsToSet: Object.freeze([]),
});

interface Entry {
  readonly rule: RespawnRule;
  readonly condition: CompiledCondition | undefined;
}

/** Priority, highest first, then id in code-unit order. */
function byPriorityThenId(a: Entry, b: Entry): number {
  if (a.rule.priority !== b.rule.priority) return b.rule.priority - a.rule.priority;
  return a.rule.id < b.rule.id ? -1 : 1;
}

/** A compiled rule table. */
export class RespawnRules {
  private readonly entries: readonly Entry[];

  /**
   * @throws RangeError when two rules share an id (content validation rejects that first);
   *   ConditionError for a malformed condition.
   */
  constructor(rules: readonly RespawnRule[]) {
    const ids = new Set<string>();
    for (const { id } of rules) {
      if (ids.has(id)) throw new RangeError(`respawn rule "${id}" is defined twice`);
      ids.add(id);
    }
    this.entries = rules
      .map((rule) => ({
        rule,
        condition: rule.conditions === undefined ? undefined : compileCondition(rule.conditions),
      }))
      .sort(byPriorityThenId);
  }

  /** The rule ids, in resolution order. */
  get order(): readonly string[] {
    return this.entries.map(({ rule }) => rule.id);
  }

  /**
   * The respawn for a death in `context`: the first rule in resolution order whose region matches
   * and whose conditions hold, or FALLBACK_RESPAWN with a content warning through `warn`.
   */
  resolve(context: RespawnContext, warn?: (message: string) => void): RespawnResolution {
    for (const { rule, condition } of this.entries) {
      if (rule.region !== context.region) continue;
      if (condition !== undefined && !condition.evaluate(context.facts)) continue;
      return {
        rule: rule.id,
        mode: rule.mode,
        destination: rule.destination,
        factsToSet: rule.factsToSet,
      };
    }
    warn?.(
      `respawn: no respawn rule matches region "${context.region}"; reloading the last save ` +
        `(add a rule to src/content/data/respawn-rules/respawn-rules.json)`,
    );
    return FALLBACK_RESPAWN;
  }
}
