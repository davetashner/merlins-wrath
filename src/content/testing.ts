// Per-entry content test harness (mw-e00.18). Contract §3: every spell, creature, item… has at least
// one automated test exercising it. `describeContent` turns every entry of a content type into its
// own named test; `markExercised` credits a hand-written test with the entries it uses. Both record
// the entries on the test's meta, a Vitest reporter (scripts/content-coverage-reporter.ts) collects
// them from passing tests, and `pnpm content:coverage` fails CI listing any entry no test exercised.
// Test-only: imports vitest, so it is not exported from index.ts.

import { describe, it, type TaskMeta } from 'vitest';
import { loadGameContent } from './game-content.ts';
import type { ContentType, GameContent, GameEntry } from './registry.ts';

declare module 'vitest' {
  interface TaskMeta {
    /** `type:id` of every content entry this test exercises (read by the content-coverage check). */
    contentEntries?: string[];
  }
}

/** Records on a test's meta that it exercises content entry `type:id`. */
export function markExercised(task: { meta: TaskMeta }, type: ContentType, id: string): void {
  task.meta.contentEntries = [...(task.meta.contentEntries ?? []), `${type}:${id}`];
}

/**
 * One test per entry of `type`, named `<title> [type:id]`, each credited as exercising its entry.
 * Name the AC in `title`, e.g. `describeContent('spell', 'AC-1: passes the readability rule', …)`.
 */
export function describeContent<K extends ContentType>(
  type: K,
  title: string,
  test: (entry: GameEntry<K>, content: GameContent) => void | Promise<void>,
): void {
  const content = loadGameContent();
  describe(`${type} content`, () => {
    for (const entry of content.all(type)) {
      it(`${title} [${type}:${entry.id}]`, async ({ task }) => {
        markExercised(task, type, entry.id);
        await test(entry, content);
      });
    }
  });
}
