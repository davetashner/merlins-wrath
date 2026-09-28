// Lints a pull request body (mw-e00.8): every PR closes at least one bead with a `Closes mw-…` line, and
// every id it closes exists in .beads/issues.jsonl on the PR head. `parseCloses` is the shared parser
// the backlog generator's GitHub overlay (mw-e00.12) uses, so both read Closes lines identically.
// Run in CI through scripts/pr-body-lint-cli.ts with the body in an env var.
import { readFileSync } from 'node:fs';

/** One id per line, nothing else on the line; case-insensitive keyword. Shared with mw-e00.12. */
export const CLOSES_LINE = /^\s*Closes\s+(mw-[a-z0-9.]+)\s*$/i;
/** A bead id as bd writes it: `mw-e00`, `mw-e00.8`, `mw-e00.8.1`. */
export const BEAD_ID = /^mw-[a-z0-9]+(?:\.[0-9]+)*$/;
/** Maintainer-applied label for trivial chores with no bead (labels need triage access to apply). */
export const NO_BEAD_LABEL = 'no-bead';
/** Bots whose PRs never carry a bead (Dependabot's login in the event payload and in `gh`). */
export const EXEMPT_AUTHORS: readonly string[] = ['dependabot[bot]', 'app/dependabot'];

const FORMAT =
  'Add one line per completed bead, e.g. "Closes mw-e00.8" (full id, nothing else on the line).';

/**
 * Lines that could close a bead: HTML comments (template hints) and fenced code blocks (examples)
 * never do.
 */
function liveLines(body: string): string[] {
  const lines = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '').split(/\r?\n/);
  let fenced = false;
  return lines.filter((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      return false;
    }
    return !fenced;
  });
}

/** Bead ids named by well-formed `Closes mw-…` lines, in order, without duplicates. */
export function parseCloses(body: string): string[] {
  const ids: string[] = [];
  for (const line of liveLines(body)) {
    const id = CLOSES_LINE.exec(line)?.[1];
    if (id !== undefined && BEAD_ID.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Lines that start with "Closes" and mention a bead but are not a valid Closes line. */
function malformedLines(body: string): string[] {
  return liveLines(body)
    .filter((line) => /^\s*closes\b/i.test(line) && /mw-/i.test(line))
    .filter((line) => {
      const id = CLOSES_LINE.exec(line)?.[1];
      return id === undefined || !BEAD_ID.test(id);
    })
    .map((line) => line.trim());
}

/** Issue ids in a bd export. Unparseable lines are skipped: beads-validate reports those. */
export function knownIds(jsonl: string): Set<string> {
  const ids = new Set<string>();
  for (const line of jsonl.split('\n')) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record !== 'object' || record === null) continue;
    const { _type: type, id } = record as Record<string, unknown>;
    if ((type === undefined || type === 'issue') && typeof id === 'string') ids.add(id);
  }
  return ids;
}

export interface PullRequest {
  body: string;
  author: string;
  labels: readonly string[];
}

export interface LintResult {
  errors: string[];
  notices: string[];
  ids: string[];
}

export function lintPrBody(pr: PullRequest, known: ReadonlySet<string>): LintResult {
  const errors: string[] = [];
  const notices: string[] = [];
  if (EXEMPT_AUTHORS.includes(pr.author)) {
    return { errors, notices: [`${pr.author} PRs are exempt from Closes lines.`], ids: [] };
  }
  const ids = parseCloses(pr.body);
  for (const line of malformedLines(pr.body)) {
    errors.push(`Malformed Closes line "${line}". ${FORMAT}`);
  }
  for (const id of ids) {
    if (!known.has(id)) {
      errors.push(
        `${id} is not in .beads/issues.jsonl. Check the id, or if the bead is new, add a fresh ` +
          '`bd export -o .beads/issues.jsonl` to this PR.',
      );
    }
  }
  if (ids.length === 0) {
    if (pr.labels.includes(NO_BEAD_LABEL)) {
      notices.push(`No Closes line; allowed by the "${NO_BEAD_LABEL}" label.`);
    } else {
      errors.push(
        `The PR body has no Closes line. ${FORMAT} Trivial chores without a bead need the ` +
          `"${NO_BEAD_LABEL}" label from a maintainer.`,
      );
    }
  }
  return { errors, notices, ids };
}

/** PR_LABELS is `toJSON(github.event.pull_request.labels.*.name)`; anything else means no labels. */
export function parseLabels(raw: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Reads PR_BODY, PR_AUTHOR and PR_LABELS from the environment (set from the event payload, never
 * interpolated into the shell). Returns the exit code: 0 pass, 1 lint errors, 2 unreadable export.
 */
export function main(argv: readonly string[], env: Record<string, string | undefined>): number {
  const path = argv[0] ?? '.beads/issues.jsonl';
  let known: Set<string>;
  try {
    known = knownIds(readFileSync(path, 'utf8'));
  } catch {
    console.log(`::error title=PR body::Cannot read ${path}.`);
    return 2;
  }
  const result = lintPrBody(
    {
      body: env['PR_BODY'] ?? '',
      author: env['PR_AUTHOR'] ?? '',
      labels: parseLabels(env['PR_LABELS']),
    },
    known,
  );
  for (const e of result.errors) console.log(`::error title=PR body::${e}`);
  for (const n of result.notices) console.log(`::notice title=PR body::${n}`);
  if (result.errors.length === 0 && result.ids.length > 0) {
    console.log(`PR body closes ${result.ids.join(', ')}.`);
  }
  return result.errors.length > 0 ? 1 : 0;
}
