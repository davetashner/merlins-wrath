// Changelog check (mw-e00.9, backlog contract §3 DoD item 8): a PR that changes what players or site
// visitors can see must add a note to CHANGELOG.md, or carry the `no-changelog` label when the change
// is invisible to them (a refactor, a perf-neutral engine change). CHANGELOG.md itself must always
// keep its `## [Unreleased]` section so notes have somewhere to go. Run in CI through
// scripts/changelog-check-cli.ts with the PR's changed paths in a file.
import { readFileSync } from 'node:fs';
import { EXEMPT_AUTHORS, parseLabels } from './pr-body-lint.ts';

/** Maintainer-applied label for PRs whose user-facing-path changes need no changelog note. */
export const NO_CHANGELOG_LABEL = 'no-changelog';
export const CHANGELOG_PATH = 'CHANGELOG.md';

/** The game's runtime layers, the app entry and the public site. */
const USER_FACING = [
  /^src\/(?:game|ui|render|audio|sim|content)\//,
  /^src\/main\.ts$/,
  /^index\.html$/,
  /^site\//,
];
/** Tests, benches and snapshots live beside the code but never ship. */
const NEVER_SHIPPED = /(?:\.(?:test|bench|spec)\.[cm]?[jt]sx?$|\/__snapshots__\/)/;

/** Whether a repo-relative path is something a player or site visitor experiences. */
export function isUserFacing(path: string): boolean {
  return !NEVER_SHIPPED.test(path) && USER_FACING.some((re) => re.test(path));
}

/** Whether the changelog text has a `## [Unreleased]` heading (Keep a Changelog). */
export function hasUnreleased(changelog: string): boolean {
  return /^## \[Unreleased\][ \t]*$/m.test(changelog);
}

export interface ChangelogInput {
  /** Paths changed by the PR, repo-relative. */
  files: readonly string[];
  labels: readonly string[];
  author: string;
  /** The PR head's CHANGELOG.md, or undefined when it is missing. */
  changelog: string | undefined;
}

export interface CheckResult {
  errors: string[];
  notices: string[];
}

export function checkChangelog(input: ChangelogInput): CheckResult {
  const errors: string[] = [];
  const notices: string[] = [];
  if (input.changelog === undefined) {
    errors.push(`${CHANGELOG_PATH} is missing; it must exist with a "## [Unreleased]" section.`);
  } else if (!hasUnreleased(input.changelog)) {
    errors.push(
      `${CHANGELOG_PATH} has no "## [Unreleased]" heading. Keep it at the top (Keep a Changelog); ` +
        'new notes go under it.',
    );
  }
  const userFacing = input.files.filter(isUserFacing);
  if (userFacing.length === 0) return { errors, notices };
  // Dependabot bumps are exempt, as in pr-body-lint.
  if (EXEMPT_AUTHORS.includes(input.author)) {
    notices.push(`${input.author} PRs are exempt from changelog notes.`);
  } else if (input.files.includes(CHANGELOG_PATH)) {
    notices.push(`${CHANGELOG_PATH} updated for ${String(userFacing.length)} user-facing path(s).`);
  } else if (input.labels.includes(NO_CHANGELOG_LABEL)) {
    notices.push(`No changelog note; allowed by the "${NO_CHANGELOG_LABEL}" label.`);
  } else {
    const shown = userFacing.slice(0, 5).join(', ') + (userFacing.length > 5 ? ', …' : '');
    errors.push(
      `This PR changes user-facing paths (${shown}) but not ${CHANGELOG_PATH}. Add a one-line ` +
        'note under "## [Unreleased]" (Added/Changed/Fixed/Removed) saying what players or site ' +
        `visitors will notice, or, if nothing visible changes, add the "${NO_CHANGELOG_LABEL}" label.`,
    );
  }
  return { errors, notices };
}

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * argv: `<changed-files.txt> [CHANGELOG.md]`, the first one path per line (`git diff --name-only`).
 * PR_AUTHOR and PR_LABELS come from the environment. Returns the exit code: 0 pass, 1 check errors,
 * 2 unreadable changed-files list.
 */
export function main(argv: readonly string[], env: Record<string, string | undefined>): number {
  const listPath = argv[0];
  const list = listPath === undefined ? undefined : readOptional(listPath);
  if (list === undefined) {
    console.log('::error title=Changelog::Cannot read the changed-files list.');
    return 2;
  }
  const result = checkChangelog({
    files: list
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== ''),
    labels: parseLabels(env['PR_LABELS']),
    author: env['PR_AUTHOR'] ?? '',
    changelog: readOptional(argv[1] ?? CHANGELOG_PATH),
  });
  for (const e of result.errors) console.log(`::error title=Changelog::${e}`);
  for (const n of result.notices) console.log(`::notice title=Changelog::${n}`);
  if (result.errors.length === 0) console.log('Changelog check passed.');
  return result.errors.length > 0 ? 1 : 0;
}
