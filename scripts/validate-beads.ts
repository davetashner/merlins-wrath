// Validates .beads/issues.jsonl (mw-e00.7), the bd export that backlog.html is built from. bd writes one
// line per issue (a snapshot, not an append log), so a duplicate id is always an error. Run through
// scripts/validate-beads-cli.ts.
import { readFileSync } from 'node:fs';

export interface Problem {
  line: number;
  message: string;
}

const ID = /^mw-[a-z0-9]+(?:\.[0-9]+)*$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

interface Seen {
  line: number;
  deps: { line: number; target: unknown; issueId: unknown; type: unknown }[];
}

/** Every problem in the export, with 1-based line numbers. Empty means valid. */
export function validateBeads(text: string): Problem[] {
  const problems: Problem[] = [];
  const issues = new Map<string, Seen>();

  text.split('\n').forEach((raw, index) => {
    const line = index + 1;
    const content = raw.replace(/\r$/, '');
    if (content.trim() === '') return;
    let record: unknown;
    try {
      record = JSON.parse(content);
    } catch {
      problems.push({ line, message: 'line is not valid JSON (truncated or merge-damaged?)' });
      return;
    }
    if (!isRecord(record)) {
      problems.push({ line, message: 'line is not a JSON object' });
      return;
    }
    if (record['_type'] !== undefined && record['_type'] !== 'issue') return; // other bd record kinds

    const { id } = record;
    for (const field of ['id', 'title', 'status']) {
      if (!nonEmpty(record[field])) problems.push({ line, message: `issue is missing "${field}"` });
    }
    if (!nonEmpty(id)) return;
    if (!ID.test(id)) problems.push({ line, message: `${id}: id does not match ^mw-` });
    const earlier = issues.get(id);
    if (earlier) {
      problems.push({
        line,
        message: `${id}: duplicate id (first on line ${String(earlier.line)})`,
      });
      return;
    }
    const deps = record['dependencies'] ?? [];
    if (!Array.isArray(deps)) {
      problems.push({ line, message: `${id}: "dependencies" is not an array` });
    }
    issues.set(id, {
      line,
      deps: (Array.isArray(deps) ? deps : []).map((d) => ({
        line,
        target: isRecord(d) ? d['depends_on_id'] : undefined,
        issueId: isRecord(d) ? d['issue_id'] : undefined,
        type: isRecord(d) ? d['type'] : undefined,
      })),
    });
  });

  for (const [id, seen] of issues) {
    for (const dep of seen.deps) {
      const target = nonEmpty(dep.target) ? dep.target : '(none)';
      if (dep.issueId !== id) {
        problems.push({
          line: dep.line,
          message: `${id}: dependency on ${target} belongs to ${String(dep.issueId)}`,
        });
      }
      if (!issues.has(target)) {
        const kind = dep.type === 'parent-child' ? 'parent' : 'dependency';
        problems.push({ line: dep.line, message: `${id}: ${kind} ${target} does not exist` });
      }
    }
  }
  return problems.sort((a, b) => a.line - b.line);
}

/** Returns the exit code: 0 valid, 1 problems, 2 unreadable file. */
export function main(argv: readonly string[]): number {
  const path = argv[0] ?? '.beads/issues.jsonl';
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    console.log(`::error title=Beads export::Cannot read ${path}.`);
    return 2;
  }
  const problems = validateBeads(text);
  for (const p of problems) {
    console.log(`::error file=${path},line=${String(p.line)},title=Beads export::${p.message}`);
  }
  if (problems.length === 0) console.log(`${path} is well-formed.`);
  return problems.length > 0 ? 1 : 0;
}
