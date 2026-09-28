import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTENT_COVERAGE_REPORT,
  ContentCoverageReporter,
  type ReportedModule,
} from './content-coverage-reporter.ts';

const moduleWith = (...metas: { contentEntries?: string[] }[]): ReportedModule => ({
  children: {
    allTests: (state) => {
      expect(state).toBe('passed');
      return metas.map((meta) => ({ meta: () => meta }));
    },
  },
});

describe('ContentCoverageReporter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'content-coverage-'));
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the sorted, de-duplicated entries that passing tests exercised', () => {
    const path = join(dir, 'nested/report.json');
    new ContentCoverageReporter(path).onTestRunEnd([
      moduleWith({ contentEntries: ['testprop:plank'] }, {}),
      moduleWith({ contentEntries: ['testprop:crate', 'testprop:plank'] }),
    ]);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      exercised: ['testprop:crate', 'testprop:plank'],
    });
  });

  it('writes to coverage/content-coverage.json by default', () => {
    expect(new ContentCoverageReporter().reportPath).toBe(CONTENT_COVERAGE_REPORT);
  });
});
