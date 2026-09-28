import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkChangelog,
  hasUnreleased,
  isUserFacing,
  main,
  type ChangelogInput,
} from './changelog-check.ts';

const CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Something.\n';
const input = (files: string[], extra: Partial<ChangelogInput> = {}): ChangelogInput => ({
  files,
  labels: [],
  author: 'davetashner',
  changelog: CHANGELOG,
  ...extra,
});

describe('isUserFacing', () => {
  it('flags the runtime layers, the app entry and the public site', () => {
    for (const path of [
      'src/sim/foo.ts',
      'src/game/save/store.ts',
      'src/ui/hud.ts',
      'src/render/scene.ts',
      'src/audio/mixer.ts',
      'src/content/data/materials/wood.json',
      'src/main.ts',
      'index.html',
      'site/index.html',
      'site/audio/main-theme-v1.ogg',
    ]) {
      expect(isUserFacing(path), path).toBe(true);
    }
  });

  it('ignores tests, benches, snapshots, tooling, infra and docs', () => {
    for (const path of [
      'src/sim/foo.test.ts',
      'src/sim/foo.bench.ts',
      'src/ui/__snapshots__/hud.test.ts.snap',
      'src/tools/editor.ts',
      'scripts/pr-body-lint.ts',
      'docs/backlog-contract.md',
      '.github/workflows/ci.yml',
      'infra/site.yml',
      'tests/bench/world.bench.ts',
      'README.md',
      'CHANGELOG.md',
      'src/simulation/x.ts',
    ]) {
      expect(isUserFacing(path), path).toBe(false);
    }
  });
});

describe('hasUnreleased', () => {
  it('AC-3: a changelog without a "## [Unreleased]" heading fails the parse', () => {
    expect(hasUnreleased(CHANGELOG)).toBe(true);
    expect(hasUnreleased('# Changelog\n\n## [0.1.0] - 2026-09-27\n')).toBe(false);
    expect(hasUnreleased('# Changelog\n\n## Unreleased\n')).toBe(false);
    expect(hasUnreleased('# Changelog\n\n### [Unreleased]\n')).toBe(false);
    expect(hasUnreleased('See ## [Unreleased] below.')).toBe(false);
  });

  it('the committed CHANGELOG.md has an Unreleased section', () => {
    expect(hasUnreleased(readFileSync('CHANGELOG.md', 'utf8'))).toBe(true);
  });
});

describe('checkChangelog', () => {
  it('AC-1: a src/sim change with no CHANGELOG diff and no label fails with guidance', () => {
    const { errors } = checkChangelog(input(['src/sim/foo.ts', 'src/sim/foo.test.ts']));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('(src/sim/foo.ts)');
    expect(errors[0]).toContain('"## [Unreleased]"');
    expect(errors[0]).toContain('"no-changelog" label');
  });

  it('AC-2: a docs/** or .github/** only PR passes without an entry', () => {
    expect(checkChangelog(input(['docs/a.md', '.github/workflows/ci.yml']))).toEqual({
      errors: [],
      notices: [],
    });
  });

  it('passes when CHANGELOG.md is part of the change', () => {
    expect(checkChangelog(input(['src/ui/hud.ts', 'CHANGELOG.md']))).toEqual({
      errors: [],
      notices: ['CHANGELOG.md updated for 1 user-facing path(s).'],
    });
  });

  it('the no-changelog label allows a user-facing change without a note', () => {
    expect(checkChangelog(input(['src/sim/foo.ts'], { labels: ['no-changelog'] }))).toEqual({
      errors: [],
      notices: ['No changelog note; allowed by the "no-changelog" label.'],
    });
  });

  it('Dependabot PRs are exempt', () => {
    for (const author of ['dependabot[bot]', 'app/dependabot']) {
      expect(checkChangelog(input(['src/main.ts'], { author })).notices).toEqual([
        `${author} PRs are exempt from changelog notes.`,
      ]);
    }
  });

  it('lists at most five paths in the error', () => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `src/game/${n}.ts`);
    const { errors } = checkChangelog(input(files));
    expect(errors[0]).toContain('src/game/e.ts, …)');
    expect(errors[0]).not.toContain('src/game/f.ts');
  });

  it('AC-3: a changelog without Unreleased fails even when no user-facing path changed', () => {
    expect(checkChangelog(input(['docs/a.md'], { changelog: '# Changelog\n' })).errors).toEqual([
      expect.stringContaining('no "## [Unreleased]" heading'),
    ]);
    expect(checkChangelog(input([], { changelog: undefined })).errors).toEqual([
      'CHANGELOG.md is missing; it must exist with a "## [Unreleased]" section.',
    ]);
  });
});

describe('main', () => {
  const dirs: string[] = [];
  const dir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'changelog-'));
    dirs.push(d);
    return d;
  };
  const changed = (...files: string[]): string => {
    const path = join(dir(), 'changed.txt');
    writeFileSync(path, `${files.join('\r\n')}\n\n`);
    return path;
  };
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true });
  });

  it('AC-1: fails a src/sim change with an error annotation', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main([changed('src/sim/foo.ts')], { PR_LABELS: '[]' })).toBe(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^::error title=Changelog::.*src\/sim\/foo\.ts/),
    );
  });

  it('AC-1: the no-changelog label turns the failure into a pass', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main([changed('src/sim/foo.ts')], { PR_LABELS: '["no-changelog"]' })).toBe(0);
    expect(log).toHaveBeenCalledWith(
      '::notice title=Changelog::No changelog note; allowed by the "no-changelog" label.',
    );
    expect(log).toHaveBeenLastCalledWith('Changelog check passed.');
  });

  it('AC-2: passes a docs and .github only PR against the committed CHANGELOG.md', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main([changed('docs/x.md', '.github/pull_request_template.md')], {})).toBe(0);
  });

  it('AC-3: fails when the given CHANGELOG has no Unreleased heading, or is missing', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const d = dir();
    writeFileSync(join(d, 'CHANGELOG.md'), '# Changelog\n\n## [0.1.0]\n');
    expect(main([changed('docs/x.md'), join(d, 'CHANGELOG.md')], {})).toBe(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^::error title=Changelog::CHANGELOG\.md has no/),
    );
    expect(main([changed('docs/x.md'), join(d, 'nope.md')], {})).toBe(1);
  });

  it('fails when the changed-files list is missing or unreadable', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main([], {})).toBe(2);
    expect(main(['/nonexistent/changed.txt'], {})).toBe(2);
  });

  it('the CLI reads argv and the environment and sets the process exit code', async () => {
    const argv = process.argv;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubEnv('PR_LABELS', '[]');
    process.argv = ['node', 'changelog-check-cli.ts', changed('src/ui/hud.ts', 'CHANGELOG.md')];
    try {
      await import('./changelog-check-cli.ts');
      expect(process.exitCode).toBe(0);
    } finally {
      process.argv = argv;
      process.exitCode = undefined;
      vi.unstubAllEnvs();
    }
  });
});
