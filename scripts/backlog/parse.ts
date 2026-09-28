// Parses the bd export (.beads/issues.jsonl) into the slim issue shape the backlog page needs (mw-e00.11).
// Well-formedness is enforced separately by scripts/validate-beads.ts; this parser only refuses what it
// cannot render (bad JSON, non-objects, issues without an id or title) and tolerates everything else.

export interface Issue {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: number;
  labels: string[];
  description: string;
  acceptance: string;
  /** The parent-child dependency target (the epic), if any. */
  parent: string | null;
  /** Targets of `blocks` dependencies: the issues this one waits on. */
  blocksOn: string[];
  closedAt: string | null;
  closeReason: string;
}

export class ParseError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(`line ${String(line)}: ${message}`);
    this.line = line;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
/** bd priorities are 0 (highest) to 4; anything else falls back to bd's default of 2. */
const priority = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4 ? v : 2;

function dependencies(v: unknown): { type: string; target: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isRecord)
    .map((d) => ({ type: text(d['type']), target: text(d['depends_on_id']) }))
    .filter((d) => d.target !== '');
}

/** Issues in file order. Blank lines and non-issue bd records are skipped. */
export function parseIssues(source: string): Issue[] {
  const issues: Issue[] = [];
  source.split('\n').forEach((raw, index) => {
    const line = index + 1;
    const content = raw.replace(/\r$/, '');
    if (content.trim() === '') return;
    let record: unknown;
    try {
      record = JSON.parse(content);
    } catch {
      throw new ParseError(line, 'not valid JSON');
    }
    if (!isRecord(record)) throw new ParseError(line, 'not a JSON object');
    if (record['_type'] !== undefined && record['_type'] !== 'issue') return;
    const { id, title } = record;
    if (!nonEmpty(id) || !nonEmpty(title))
      throw new ParseError(line, 'issue needs an id and a title');
    const deps = dependencies(record['dependencies']);
    const labels = record['labels'];
    issues.push({
      id,
      title,
      type: text(record['issue_type']) || 'task',
      status: text(record['status']) || 'open',
      priority: priority(record['priority']),
      labels: Array.isArray(labels) ? labels.filter(nonEmpty) : [],
      description: text(record['description']),
      acceptance: text(record['acceptance_criteria']),
      parent: deps.find((d) => d.type === 'parent-child')?.target ?? null,
      blocksOn: deps.filter((d) => d.type === 'blocks').map((d) => d.target),
      closedAt: nonEmpty(record['closed_at']) ? record['closed_at'] : null,
      closeReason: text(record['close_reason']),
    });
  });
  return issues;
}
