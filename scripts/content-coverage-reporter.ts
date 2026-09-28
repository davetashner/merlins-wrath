// Vitest reporter for the content-coverage check (mw-e00.18, contract §3). Collects the content
// entries that passing tests exercised (recorded by describeContent / markExercised in
// src/content/testing.ts) and writes them to coverage/content-coverage.json at the end of the run,
// for `pnpm content:coverage` to compare against all loaded content. Registered in vite.config.ts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The slice of Vitest's TestModule this reporter reads. */
export interface ReportedModule {
  readonly children: {
    allTests(state: 'passed'): Iterable<{ meta(): { contentEntries?: readonly string[] } }>;
  };
}

/** Where the reporter writes and the check reads, relative to the repo root. */
export const CONTENT_COVERAGE_REPORT = 'coverage/content-coverage.json';

export class ContentCoverageReporter {
  readonly reportPath: string;

  constructor(reportPath: string = CONTENT_COVERAGE_REPORT) {
    this.reportPath = reportPath;
  }

  /** Writes `{ exercised: [...] }`: every `type:id` some passing test exercised, sorted. */
  onTestRunEnd(modules: readonly ReportedModule[]): void {
    const exercised = new Set<string>();
    for (const module of modules) {
      for (const test of module.children.allTests('passed')) {
        for (const entry of test.meta().contentEntries ?? []) exercised.add(entry);
      }
    }
    mkdirSync(dirname(this.reportPath), { recursive: true });
    const report = { exercised: [...exercised].sort() };
    writeFileSync(this.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
}
