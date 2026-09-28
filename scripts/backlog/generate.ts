// Reads .beads/issues.jsonl and writes backlog.html (mw-e00.11). The only impure part of the generator:
// file I/O, the clock and the source commit SHA are gathered here and passed to the pure renderer.
// Run through scripts/backlog/generate-cli.ts.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseIssues, type Issue, type ParseError } from './parse.ts';
import { renderPage } from './render.ts';

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

/** GITHUB_SHA in Actions, else the local HEAD, else "unknown". */
export function sourceSha(env: Record<string, string | undefined>, cwd: string): string {
  const fromEnv = env['GITHUB_SHA'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return gitHead(cwd) ?? 'unknown';
}

/** Returns the exit code: 0 written, 1 malformed export, 2 unreadable input or unwritable output. */
export function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  now: Date,
  cwd: string = process.cwd(),
): number {
  const [src = '.beads/issues.jsonl', out = 'backlog.html'] = argv;
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
  const html = renderPage({ issues, prStatus: [], now, sha: sourceSha(env, cwd) });
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
