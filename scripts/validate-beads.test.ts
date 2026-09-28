import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main, validateBeads } from './validate-beads.ts';

interface Dep {
  issue_id?: unknown;
  depends_on_id?: unknown;
  type?: string;
}

const issue = (
  id: string,
  deps?: readonly unknown[] | string,
  extra: Record<string, unknown> = {},
): string =>
  JSON.stringify({
    _type: 'issue',
    id,
    title: `Title of ${id}`,
    status: 'open',
    dependencies: deps,
    ...extra,
  });
const dep = (from: string, to: string, type = 'blocks'): Dep => ({
  issue_id: from,
  depends_on_id: to,
  type,
});
const jsonl = (...lines: string[]): string => `${lines.join('\n')}\n`;

describe('validateBeads', () => {
  it('passes a well-formed export with epics, children and blockers', () => {
    const text = jsonl(
      issue('mw-e01'),
      issue('mw-e01.1', [dep('mw-e01.1', 'mw-e01', 'parent-child')]),
      issue('mw-e01.2', [dep('mw-e01.2', 'mw-e01', 'parent-child'), dep('mw-e01.2', 'mw-e01.1')]),
      issue('mw-e02'),
    );
    expect(validateBeads(text)).toEqual([]);
  });

  it('AC-1: a truncated line 42 is reported at line 42', () => {
    const good = Array.from({ length: 41 }, (_, i) => issue(`mw-e01.${String(i + 1)}`));
    const truncated = issue('mw-e01.42').slice(0, 30);
    expect(validateBeads(jsonl(...good, truncated))).toEqual([
      { line: 42, message: 'line is not valid JSON (truncated or merge-damaged?)' },
    ]);
  });

  it('AC-2: a dependency on a missing issue fails naming both ids', () => {
    expect(validateBeads(jsonl(issue('mw-e01.3', [dep('mw-e01.3', 'mw-e99.7')])))).toEqual([
      { line: 1, message: 'mw-e01.3: dependency mw-e99.7 does not exist' },
    ]);
  });

  it('a child whose parent epic is missing fails', () => {
    expect(
      validateBeads(jsonl(issue('mw-e05.1', [dep('mw-e05.1', 'mw-e05', 'parent-child')]))),
    ).toEqual([{ line: 1, message: 'mw-e05.1: parent mw-e05 does not exist' }]);
  });

  it('AC-3: CRLF line endings, blank lines and no trailing newline all pass', () => {
    expect(validateBeads(`${issue('mw-e01')}\r\n\r\n${issue('mw-e02')}\r\n\n`)).toEqual([]);
    expect(validateBeads(issue('mw-e01'))).toEqual([]);
  });

  it('reports duplicates with the first occurrence', () => {
    expect(validateBeads(jsonl(issue('mw-e01'), issue('mw-e02'), issue('mw-e01')))).toEqual([
      { line: 3, message: 'mw-e01: duplicate id (first on line 1)' },
    ]);
  });

  it('requires id, title and status, and ids that start with mw-', () => {
    const text = jsonl(
      JSON.stringify({ title: 'no id', status: 'open' }),
      JSON.stringify({ id: 'mw-e01', title: '', status: 'open' }),
      JSON.stringify({ id: 'bd-x1', title: 't', status: 'open' }),
    );
    expect(validateBeads(text)).toEqual([
      { line: 1, message: 'issue is missing "id"' },
      { line: 2, message: 'issue is missing "title"' },
      { line: 3, message: 'bd-x1: id does not match ^mw-' },
    ]);
  });

  it('rejects non-object lines and malformed dependencies, and skips other bd record kinds', () => {
    const text = jsonl(
      '[1, 2]',
      JSON.stringify({ _type: 'memory', key: 'anything' }),
      issue('mw-e01', 'not an array'),
      issue('mw-e02', [{ issue_id: 'mw-e03', depends_on_id: 'mw-e01' }, 'junk']),
    );
    expect(validateBeads(text)).toEqual([
      { line: 1, message: 'line is not a JSON object' },
      { line: 3, message: 'mw-e01: "dependencies" is not an array' },
      { line: 4, message: 'mw-e02: dependency on mw-e01 belongs to mw-e03' },
      { line: 4, message: 'mw-e02: dependency on (none) belongs to undefined' },
      { line: 4, message: 'mw-e02: dependency (none) does not exist' },
    ]);
  });

  it('treats an issue without a dependencies field as having none', () => {
    expect(
      validateBeads(jsonl(JSON.stringify({ id: 'mw-e01', title: 't', status: 'open' }))),
    ).toEqual([]);
  });
});

describe('main and the CLI', () => {
  const dirs: string[] = [];
  const file = (text: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'vesper-beads-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'issues.jsonl'), text);
    return join(dir, 'issues.jsonl');
  };
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true });
  });

  it('AC-4: the committed .beads/issues.jsonl is valid', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main([])).toBe(0);
  });

  it('annotates each problem with file and line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const path = file(jsonl(issue('mw-e01'), '{"id": "mw-e02", "tit'));
    expect(main([path])).toBe(1);
    expect(log).toHaveBeenCalledWith(
      `::error file=${path},line=2,title=Beads export::line is not valid JSON (truncated or merge-damaged?)`,
    );
  });

  it('fails when the export cannot be read', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main(['/nonexistent/issues.jsonl'])).toBe(2);
  });

  it('the CLI sets the process exit code from main', async () => {
    const argv = process.argv;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.argv = ['node', 'validate-beads-cli.ts', file(jsonl(issue('mw-e01')))];
    try {
      await import('./validate-beads-cli.ts');
      expect(process.exitCode).toBe(0);
    } finally {
      process.argv = argv;
      process.exitCode = undefined;
    }
  });
});
