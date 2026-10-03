// Loot-table validation (mw-e18.2) for CI: loads all game content with every content check, so a
// broken reference, a cycle or over-deep nesting, or a unique item guaranteed twice fails naming the
// file (src/content/loot-checks.ts), then prints the loot warnings (unreferenced tables) without
// failing. Run through scripts/loot-check-cli.ts.

import { resolve } from 'node:path';
import { readContentSources } from '../src/content/fs-sources.ts';
import { ContentLoadError, loadContent, type ContentIssue } from '../src/content/loader.ts';
import { lootTableProblems } from '../src/content/loot-checks.ts';
import { contentChecks, contentTypes } from '../src/content/registry.ts';

const TITLE = 'Loot tables';

/** `--content <dir>` (default src/content/data). Returns the exit code. */
export function main(argv: readonly string[], root: string = process.cwd()): number {
  const i = argv.indexOf('--content');
  const contentDir = (i === -1 ? undefined : argv[i + 1]) ?? 'src/content/data';

  let warnings: readonly ContentIssue[] = [];
  let tables: number;
  try {
    const content = loadContent(
      contentTypes,
      readContentSources(resolve(root, contentDir), contentDir),
      [
        ...contentChecks,
        (entries) => {
          warnings = lootTableProblems(entries).warnings;
          return [];
        },
      ],
    );
    tables = content.all('loot-table').length;
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    for (const issue of error.issues)
      console.log(`::error title=${TITLE}::${issue.file}#${issue.pointer}: ${issue.message}`);
    return 1;
  }

  for (const w of warnings)
    console.log(`::warning title=${TITLE}::${w.file}#${w.pointer}: ${w.message}`);
  console.log(
    `Loot tables valid (${String(tables)} table(s), ${String(warnings.length)} warning(s)).`,
  );
  return 0;
}
