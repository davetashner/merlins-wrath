// Reads .beads/issues.jsonl and writes backlog.html (mw-e00.11). The only impure part of the generator:
// file I/O, the clock, the source commit SHA and the GitHub PR overlay (mw-e00.12) are gathered here
// and passed to the pure renderer. Run through scripts/backlog/generate-cli.ts.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fetchPulls, prRefs, type FetchLike, type GithubError } from './github.ts';
import type { PrRef } from './model.ts';
import { parseIssues, type Issue, type ParseError } from './parse.ts';
import { renderPage, type GithubStatus } from './render.ts';

/** Skips the GitHub overlay, e.g. for offline local runs and PR checks. */
export const NO_GITHUB = '--no-github';
/** Used when GITHUB_REPOSITORY is unset (local runs). */
export const DEFAULT_REPO = 'davetashner/thevesperbell';

/** HEAD of the git checkout at `cwd`, or null outside a repository. */
export function gitHead(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch {
    return null;
  }
}

/**
 * The checked-out HEAD, else GITHUB_SHA, else "unknown". HEAD comes first because the publish workflow
 * checks out the default branch, which can be ahead of the triggering event's GITHUB_SHA.
 */
export function sourceSha(env: Record<string, string | undefined>, cwd: string): string {
  const fromEnv = env['GITHUB_SHA'];
  return gitHead(cwd) ?? (fromEnv === undefined || fromEnv === '' ? 'unknown' : fromEnv);
}

export interface Overlay {
  github: GithubStatus;
  prStatus: PrRef[];
}

/**
 * PR status from GitHub. Never fails the build: without a token, or on any API error, it logs a warning
 * and the page renders from issues.jsonl alone with a "GitHub status unavailable" banner.
 */
export async function loadOverlay(
  env: Record<string, string | undefined>,
  offline: boolean,
  fetch: FetchLike,
): Promise<Overlay> {
  if (offline) return { github: 'off', prStatus: [] };
  const set = (...values: (string | undefined)[]): string | undefined =>
    values.find((v) => v !== undefined && v !== '');
  const token = set(env['GITHUB_TOKEN'], env['GH_TOKEN']);
  const repo = set(env['GITHUB_REPOSITORY']) ?? DEFAULT_REPO;
  const unavailable = (why: string): Overlay => {
    console.log(
      `::warning title=Backlog page::GitHub status unavailable (${why}); rendering from issues.jsonl alone.`,
    );
    return { github: 'unavailable', prStatus: [] };
  };
  if (token === undefined) return unavailable('no GITHUB_TOKEN');
  try {
    const pulls = await fetchPulls({ repo, token, fetch });
    const prStatus = prRefs(pulls);
    console.log(
      `Read ${String(pulls.length)} pull requests from ${repo} (${String(prStatus.length)} Closes references).`,
    );
    return { github: 'ok', prStatus };
  } catch (error) {
    // fetchPulls only throws GithubError.
    return unavailable((error as GithubError).message);
  }
}

/**
 * Returns the exit code: 0 written, 1 malformed export, 2 unreadable input or unwritable output.
 * GitHub problems never change it. Arguments: [--no-github] [issues.jsonl] [backlog.html].
 */
export async function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  now: Date,
  cwd: string = process.cwd(),
  fetch: FetchLike = globalThis.fetch,
): Promise<number> {
  const [src = '.beads/issues.jsonl', out = 'backlog.html'] = argv.filter((a) => a !== NO_GITHUB);
  let text: string;
  try {
    text = readFileSync(src, 'utf8');
  } catch {
    console.log(`::error title=Backlog page::Cannot read ${src}.`);
    return 2;
  }
  let issues: Issue[];
  try {
    issues = parseIssues(text);
  } catch (error) {
    // parseIssues only throws ParseError.
    const { line, message } = error as ParseError;
    console.log(`::error file=${src},line=${String(line)},title=Backlog page::${message}`);
    return 1;
  }
  const { github, prStatus } = await loadOverlay(env, argv.includes(NO_GITHUB), fetch);
  const html = renderPage({ issues, prStatus, github, now, sha: sourceSha(env, cwd) });
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
  } catch {
    console.log(`::error title=Backlog page::Cannot write ${out}.`);
    return 2;
  }
  console.log(`Wrote ${out} (${String(issues.length)} issues, ${String(html.length)} bytes).`);
  return 0;
}
