// Load-time fact checks (mw-e27.2): the fact registry (src/content/types/fact.ts) is only worth
// having if content cannot name a fact it doesn't declare. After every file has parsed, these checks
// report keys declared twice across registry files, and every fact a content file names that the
// registry does not declare (exactly or by an `entity:*` template), naming the file, the JSON pointer
// and the fact. Each content type that names facts registers where it does so in FACT_USAGES:
// signal graphs today; dialogue (mw-e22) and quests (mw-e23) add a line. Facts named inside
// conditions are checked, with their operators, by src/content/condition-checks.ts (mw-e27.5).

import type { ContentCheck, ContentIssue, Frozen, LoadedEntry } from './loader.ts';
import { FACT_KEY_PATTERN, factTemplateOf, type FactDef, type FactGroup } from './types/fact.ts';
import type { SignalGraphEntry } from './types/signal-graph.ts';

/** One place a content entry names a fact. */
export interface FactUsage {
  /** JSON pointer into the entry's file. */
  readonly pointer: string;
  readonly key: string;
}

/** Content type → the facts one of its entries names. */
export const FACT_USAGES: Readonly<Record<string, (entry: never) => readonly FactUsage[]>> = {
  'signal-graph': (graph: SignalGraphEntry) =>
    graph.nodes.flatMap((node, i) =>
      node.kind === 'receiver' && node.receiver === 'fact' && node.key !== undefined
        ? [{ pointer: `/nodes/${String(i)}/key`, key: node.key }]
        : [],
    ),
};

/** Every declared fact by key (templates under their `entity:*.<fact>` key). */
export type FactIndex = ReadonlyMap<string, Frozen<FactDef>>;

/** Indexes the registry's facts by key (the first declaration wins; the load check rejects repeats). */
export function factIndex(groups: readonly Frozen<FactGroup>[]): FactIndex {
  const index = new Map<string, Frozen<FactDef>>();
  for (const group of groups) {
    for (const fact of group.facts) if (!index.has(fact.key)) index.set(fact.key, fact);
  }
  return index;
}

/** The declaration governing `key`: its own, else its entity template's; undefined if undeclared. */
export function lookupFact(index: FactIndex, key: string): Frozen<FactDef> | undefined {
  return index.get(key) ?? index.get(factTemplateOf(key) ?? key);
}

/** Registry keys declared in more than one file (repeats within a file fail the schema). */
function duplicateKeys(groups: readonly LoadedEntry[]): ContentIssue[] {
  const firstFile = new Map<string, string>();
  const issues: ContentIssue[] = [];
  for (const { file, value } of groups) {
    (value as FactGroup).facts.forEach(({ key }, i) => {
      const first = firstFile.get(key);
      if (first === undefined) firstFile.set(key, file);
      else {
        issues.push({
          file,
          pointer: `/facts/${String(i)}/key`,
          message: `fact "${key}" is already declared in ${first}`,
        });
      }
    });
  }
  return issues;
}

/**
 * The content check for facts: registry keys are unique across files, and every fact named by
 * content is well formed and declared.
 */
export const checkFacts: ContentCheck = (entries) => {
  const groups = entries.filter((entry) => entry.type === 'fact');
  const index = factIndex(groups.map((entry) => entry.value as FactGroup));
  const issues = duplicateKeys(groups);
  for (const { type, file, value } of entries) {
    const usages = Object.hasOwn(FACT_USAGES, type) ? FACT_USAGES[type] : undefined;
    for (const { pointer, key } of usages?.(value as never) ?? []) {
      const at = `${type}:${value.id}`;
      if (!FACT_KEY_PATTERN.test(key)) {
        issues.push({ file, pointer, message: `${at} names "${key}", which is not a fact key` });
      } else if (lookupFact(index, key) === undefined) {
        issues.push({
          file,
          pointer,
          message: `${at} names undeclared fact "${key}": declare it in src/content/data/fact/`,
        });
      }
    }
  }
  return issues;
};
