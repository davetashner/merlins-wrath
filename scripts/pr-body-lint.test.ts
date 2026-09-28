import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLOSES_LINE,
  knownIds,
  lintPrBody,
  main,
  parseCloses,
  parseLabels,
  type PullRequest,
} from './pr-body-lint.ts';

const KNOWN = new Set(['mw-e00.3', 'mw-e30.1', 'mw-e00.8']);
const pr = (body: string, extra: Partial<PullRequest> = {}): PullRequest => ({
  body,
  author: 'davetashner',
  labels: [],
  ...extra,
});

describe('parseCloses', () => {
  it('AC-1: "Closes mw-e00.3" and "closes mw-e30.1" both return their ids', () => {
    expect(parseCloses('## Summary\nStuff.\n\nCloses mw-e00.3\ncloses mw-e30.1\n')).toEqual([
      'mw-e00.3',
      'mw-e30.1',
    ]);
  });

  it('AC-2: an id mentioned only in prose is not returned', () => {
    expect(parseCloses('This fixes part of mw-e00.3.\nfixes part of mw-e00.3')).toEqual([]);
    expect(parseCloses('It closes mw-e00.3 too.')).toEqual([]);
  });

  it('accepts surrounding whitespace and CRLF, and drops duplicates', () => {
    expect(parseCloses('  Closes   mw-e00.3  \r\nCLOSES mw-e00.3\r\nCloses mw-e30')).toEqual([
      'mw-e00.3',
      'mw-e30',
    ]);
  });

  it('ignores ids in HTML comments and fenced code blocks', () => {
    const body = [
      '<!-- Closes mw-e99.1 -->',
      '<!--',
      'Closes mw-e99.2',
      '-->',
      '```',
      'Closes mw-e99.3',
      '```',
      '~~~md',
      'Closes mw-e99.4',
      '~~~',
      'Closes mw-e00.8',
      '<!-- unterminated',
      'Closes mw-e99.5',
    ].join('\n');
    expect(parseCloses(body)).toEqual(['mw-e00.8']);
  });

  it('rejects ids that match the line regex but are not bead ids', () => {
    expect(CLOSES_LINE.test('Closes mw-e00.')).toBe(true);
    expect(parseCloses('Closes mw-e00.\nCloses mw-e00..3')).toEqual([]);
  });
});

describe('lintPrBody', () => {
  it('passes a body with known Closes lines', () => {
    expect(lintPrBody(pr('Closes mw-e00.3\nCloses mw-e30.1'), KNOWN)).toEqual({
      errors: [],
      notices: [],
      ids: ['mw-e00.3', 'mw-e30.1'],
    });
  });

  it('AC-3: no Closes line and no no-bead label fails, showing the expected format', () => {
    const { errors } = lintPrBody(pr('Fixes part of mw-e00.3.'), KNOWN);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no Closes line');
    expect(errors[0]).toContain('"Closes mw-e00.8"');
    expect(errors[0]).toContain('"no-bead" label');
  });

  it('the no-bead label allows a PR without Closes lines', () => {
    expect(lintPrBody(pr('Tidy a typo.', { labels: ['chore', 'no-bead'] }), KNOWN)).toEqual({
      errors: [],
      notices: ['No Closes line; allowed by the "no-bead" label.'],
      ids: [],
    });
  });

  it('AC-4: a Closes line naming an id missing from issues.jsonl fails naming the id', () => {
    const { errors } = lintPrBody(pr('Closes mw-e00.3\nCloses mw-e77.9'), KNOWN);
    expect(errors).toEqual([
      'mw-e77.9 is not in .beads/issues.jsonl. Check the id, or if the bead is new, add a fresh ' +
        '`bd export -o .beads/issues.jsonl` to this PR.',
    ]);
  });

  it('the no-bead label does not excuse unknown ids', () => {
    const { errors } = lintPrBody(pr('Closes mw-e77.9', { labels: ['no-bead'] }), KNOWN);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('mw-e77.9');
  });

  it('flags malformed Closes lines alongside valid ones', () => {
    const body =
      'Closes mw-e00.3\nCloses mw-e00.3, mw-e30.1\nCloses mw-e30.\nCloses #12\nCloses the gap';
    expect(lintPrBody(pr(body), KNOWN).errors).toEqual([
      expect.stringContaining('Malformed Closes line "Closes mw-e00.3, mw-e30.1"'),
      expect.stringContaining('Malformed Closes line "Closes mw-e30."'),
    ]);
  });

  it('Dependabot PRs are exempt', () => {
    for (const author of ['dependabot[bot]', 'app/dependabot']) {
      expect(lintPrBody(pr('Bumps vite from 8.3.1 to 8.3.2.', { author }), KNOWN)).toEqual({
        errors: [],
        notices: [`${author} PRs are exempt from Closes lines.`],
        ids: [],
      });
    }
  });

  it('AC-5: editing the body to add a valid Closes line turns a failure into a pass', () => {
    const before = 'Summary only.';
    expect(lintPrBody(pr(before), KNOWN).errors).not.toEqual([]);
    expect(lintPrBody(pr(`${before}\n\nCloses mw-e00.8`), KNOWN).errors).toEqual([]);
  });
});

describe('knownIds', () => {
  it('collects issue ids and skips other records and unparseable lines', () => {
    const text = [
      JSON.stringify({ _type: 'issue', id: 'mw-e00' }),
      JSON.stringify({ id: 'mw-e00.1' }),
      JSON.stringify({ _type: 'memory', id: 'mw-not-an-issue' }),
      JSON.stringify({ _type: 'issue' }),
      '{"id": "mw-trunc',
      '42',
      'null',
      '',
    ].join('\n');
    expect([...knownIds(text)]).toEqual(['mw-e00', 'mw-e00.1']);
  });
});

describe('parseLabels', () => {
  it('reads a JSON array of names and tolerates anything else', () => {
    expect(parseLabels('["no-bead", 3, "chore"]')).toEqual(['no-bead', 'chore']);
    expect(parseLabels(undefined)).toEqual([]);
    expect(parseLabels('{"name": "no-bead"}')).toEqual([]);
    expect(parseLabels('no-bead')).toEqual([]);
  });
});

describe('main', () => {
  const dirs: string[] = [];
  const file = (text: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'pr-body-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'issues.jsonl'), text);
    return join(dir, 'issues.jsonl');
  };
  const exportOf = (...ids: string[]): string =>
    ids.map((id) => JSON.stringify({ _type: 'issue', id })).join('\n');
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true });
  });

  it('AC-3: fails with an error annotation showing the expected format', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main([file(exportOf('mw-e00.8'))], { PR_BODY: 'No beads here.', PR_LABELS: '[]' })).toBe(
      1,
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^::error title=PR body::.*"Closes mw-e00\.8"/),
    );
  });

  it('AC-4: fails naming an id missing from the export', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main([file(exportOf('mw-e00.8'))], { PR_BODY: 'Closes mw-e41.2' })).toBe(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^::error title=PR body::mw-e41\.2 is not in/),
    );
  });

  it('AC-5: the edited body with a valid Closes line passes', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const path = file(exportOf('mw-e00.8'));
    expect(main([path], { PR_BODY: 'Summary.' })).toBe(1);
    expect(main([path], { PR_BODY: 'Summary.\n\nCloses mw-e00.8\n' })).toBe(0);
    expect(log).toHaveBeenLastCalledWith('PR body closes mw-e00.8.');
  });

  it('passes Dependabot and no-bead PRs with a notice', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const path = file(exportOf('mw-e00.8'));
    expect(main([path], { PR_BODY: 'Bumps x.', PR_AUTHOR: 'dependabot[bot]' })).toBe(0);
    expect(main([path], { PR_LABELS: '["no-bead"]' })).toBe(0);
    expect(log).toHaveBeenCalledWith(
      '::notice title=PR body::No Closes line; allowed by the "no-bead" label.',
    );
  });

  it('reads the committed export by default, which knows this bead', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main([], { PR_BODY: 'Closes mw-e00.8' })).toBe(0);
    expect(main([], {})).toBe(1);
  });

  it('fails when the export cannot be read', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main(['/nonexistent/issues.jsonl'], { PR_BODY: 'Closes mw-e00.8' })).toBe(2);
  });

  it('the PR template itself fails until a Closes line is filled in', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const template = readFileSync('.github/pull_request_template.md', 'utf8');
    expect(parseCloses(template)).toEqual([]);
    expect(main([], { PR_BODY: template })).toBe(1);
    expect(main([], { PR_BODY: `${template}\nCloses mw-e00.8\n` })).toBe(0);
  });

  it('the CLI reads the environment and sets the process exit code', async () => {
    const argv = process.argv;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubEnv('PR_BODY', 'Closes mw-e00.8');
    process.argv = ['node', 'pr-body-lint-cli.ts', file(exportOf('mw-e00.8'))];
    try {
      await import('./pr-body-lint-cli.ts');
      expect(process.exitCode).toBe(0);
    } finally {
      process.argv = argv;
      process.exitCode = undefined;
      vi.unstubAllEnvs();
    }
  });
});
