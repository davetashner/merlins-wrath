import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lintGitleaksConfig, main } from './check-gitleaks-config.ts';

const toml = (...lines: string[]): string => lines.join('\n');

describe('lintGitleaksConfig', () => {
  it('the committed .gitleaks.toml passes', () => {
    expect(main([])).toBe(0);
  });

  it('accepts entries explained by a comment above or at the end of the line', () => {
    const config = toml(
      '[extend]',
      'useDefault = true',
      '',
      '[allowlist]',
      'description = "x"',
      'regexes = [',
      '  # plan keys look like API keys',
      "  '''key-\\d+''',",
      "  'fixture-token', # test fixture, never a real secret",
      '',
      ']',
      'paths = []',
      '# the lockfile hashes are integrity digests, not secrets',
      "stopwords = ['sha512']",
      "commits = ['abc123'] # history rewrite is not an option for this commit",
    );
    expect(lintGitleaksConfig(config)).toEqual([]);
  });

  it('AC-5: an allowlist entry without an explanatory comment fails', () => {
    const config = toml(
      '[allowlist]',
      'regexes = [',
      "  '''key-\\d+''',",
      ']',
      "paths = ['''vendor/''']",
    );
    expect(lintGitleaksConfig(config)).toEqual([
      'line 3: regexes entry has no explanatory comment.',
      'line 5: paths entry has no explanatory comment.',
    ]);
  });

  it('AC-5: a comment separated by a blank line or hidden in a string does not count', () => {
    const config = toml(
      '[[allowlists]]',
      '# explains nothing below',
      '',
      "regexes = ['''a#b''']",
      '[[rules.allowlists]]',
      "stopwords = ['x#y']",
    );
    expect(lintGitleaksConfig(config)).toEqual([
      'line 4: regexes entry has no explanatory comment.',
      'line 6: stopwords entry has no explanatory comment.',
    ]);
  });

  it('requires one entry per line so each can be explained', () => {
    const config = toml(
      '[allowlist]',
      '# two things',
      "paths = ['a', 'b']",
      "regexes = ['c',",
      '  # d',
      "  'd',",
      ']',
    );
    expect(lintGitleaksConfig(config)).toEqual([
      'line 3: put one paths entry per line so each can be explained.',
      'line 4: put regexes entries on their own lines.',
    ]);
  });

  it('ignores arrays outside allowlist tables', () => {
    const config = toml('[[rules]]', "regexes = ['''secret-\\w+''']", 'keywords = ["secret"]');
    expect(lintGitleaksConfig(config)).toEqual([]);
  });
});

describe('main', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true });
  });
  const file = (text: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'vesper-gitleaks-'));
    dirs.push(dir);
    writeFileSync(join(dir, '.gitleaks.toml'), text);
    return join(dir, '.gitleaks.toml');
  };

  it('reports problems as GitHub error annotations', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const path = file(toml('[allowlist]', "paths = ['''x''']"));
    expect(main([path])).toBe(1);
    expect(log).toHaveBeenCalledWith(
      `::error file=${path},title=gitleaks config::line 2: paths entry has no explanatory comment.`,
    );
  });

  it('fails when the config cannot be read', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main(['/nonexistent/.gitleaks.toml'])).toBe(2);
  });

  it('the CLI sets the process exit code from main', async () => {
    const argv = process.argv;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.argv = ['node', 'check-gitleaks-config-cli.ts', file('[extend]\nuseDefault = true\n')];
    try {
      await import('./check-gitleaks-config-cli.ts');
      expect(process.exitCode).toBe(0);
    } finally {
      process.argv = argv;
      process.exitCode = undefined;
    }
  });
});
