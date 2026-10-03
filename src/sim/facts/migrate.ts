// Fact migrations (mw-e27.4): loading saved facts into a world whose fact registry has moved on. They
// are generated from the registry, not hand-written: a declaration lists the keys it was saved under
// before (`renamedFrom`), so a saved former key loads into the current key with its value; a fact the
// registry no longer declares (under the `throw` or `ignore` policy), or whose value its declaration
// no longer accepts, is dropped. Every rename and drop is reported, so the save loader can log it and
// load the rest. Runs on every load, whatever version wrote the save, and is idempotent.

import type { FactRestoreProblem, FactSnapshot, FactStore, FactValue } from './store';

/** A saved fact that did not survive migration. */
export interface DroppedFact {
  readonly key: string;
  readonly value: unknown;
  /** `superseded`: a former key whose current key the save also holds (the current one wins). */
  readonly reason: FactRestoreProblem | 'superseded';
}

/** What `migrateFacts` made of saved facts. */
export interface FactMigration {
  /** The facts to restore, keys in code-unit order; `store.prepareRestore` accepts them. */
  readonly facts: FactSnapshot;
  /** Former keys moved to their current keys, in code-unit order of the former key. */
  readonly renamed: readonly { readonly from: string; readonly to: string }[];
  readonly dropped: readonly DroppedFact[];
}

/** Code-unit order (keys are unique), without locale rules. */
const byCodeUnit = (a: string, b: string): number => Number(a > b) - Number(a < b);

/**
 * Migrates saved facts (key → value) to `store`'s declarations: renames former keys (a current key
 * the save also holds wins over its former key), then drops what `store.restoreProblem` refuses.
 */
export function migrateFacts(
  store: FactStore,
  saved: Readonly<Record<string, unknown>>,
): FactMigration {
  const keys = Object.keys(saved).sort(byCodeUnit);
  const kept = new Map<string, unknown>();
  const renamed: { from: string; to: string }[] = [];
  const dropped: DroppedFact[] = [];
  const moves: [string, string][] = [];
  for (const key of keys) {
    const to = store.currentKey(key);
    if (to === key) kept.set(key, saved[key]);
    else moves.push([key, to]);
  }
  for (const [from, to] of moves) {
    if (kept.has(to)) {
      dropped.push({ key: from, value: saved[from], reason: 'superseded' });
      continue;
    }
    kept.set(to, saved[from]);
    renamed.push({ from, to });
  }
  const facts: Record<string, FactValue> = {};
  for (const key of [...kept.keys()].sort(byCodeUnit)) {
    const value = kept.get(key);
    const problem = store.restoreProblem(key, value);
    if (problem === undefined) facts[key] = value as FactValue;
    else dropped.push({ key, value, reason: problem });
  }
  return { facts, renamed, dropped };
}
