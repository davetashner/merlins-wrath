// Dependency audit gate (mw-e00.6): reads `pnpm audit --json` and audit-waivers.json. Any CRITICAL
// advisory fails (runtime or dev dependency); HIGH is a job-summary warning; waivers must be complete
// and unexpired. Run through scripts/dependency-audit-cli.ts.
import { appendFileSync, readFileSync } from 'node:fs';

export const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Advisory {
  id: string;
  module: string;
  severity: Severity;
  title: string;
  url: string;
  paths: string[];
  dev: boolean;
}

export interface Waiver {
  advisory: string;
  reason: string;
  bead: string;
  expires: string;
}

export interface Result {
  failures: Advisory[];
  warnings: Advisory[];
  waived: Advisory[];
  problems: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const BEAD = /\bmw-[a-z0-9]+(?:\.[0-9]+)*\b/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Advisories from pnpm's (npm v6-style) `audit --json` report. */
export function parseAudit(json: unknown): Advisory[] {
  if (!isRecord(json) || !isRecord(json['advisories'])) {
    throw new Error('pnpm audit output has no "advisories" object');
  }
  return Object.values(json['advisories'])
    .filter(isRecord)
    .map((a) => {
      const findings = Array.isArray(a['findings']) ? a['findings'].filter(isRecord) : [];
      const severity = str(a['severity']);
      return {
        id: str(a['github_advisory_id']) || String(a['id']),
        module: str(a['module_name']),
        severity: (SEVERITIES as readonly string[]).includes(severity)
          ? (severity as Severity)
          : 'critical',
        title: str(a['title']),
        url: str(a['url']),
        paths: findings.flatMap((f) => (Array.isArray(f['paths']) ? f['paths'].map(String) : [])),
        dev: findings.length > 0 && findings.every((f) => f['dev'] === true),
      };
    });
}

export function parseWaivers(json: unknown): Waiver[] {
  if (!isRecord(json) || !Array.isArray(json['waivers'])) {
    throw new Error('audit-waivers.json needs a "waivers" array');
  }
  return json['waivers'].map((w) => {
    const r = isRecord(w) ? w : {};
    return {
      advisory: str(r['advisory']),
      reason: str(r['reason']),
      bead: str(r['bead']),
      expires: str(r['expires']),
    };
  });
}

/** Problems with the waiver file itself; `today` is YYYY-MM-DD. */
export function validateWaivers(waivers: readonly Waiver[], today: string): string[] {
  const problems: string[] = [];
  waivers.forEach((w, i) => {
    const name = w.advisory || `waiver #${String(i + 1)}`;
    if (!w.advisory.startsWith('GHSA-')) problems.push(`${name}: waiver needs a GHSA advisory id.`);
    if (!w.reason) problems.push(`${name}: waiver needs a reason.`);
    if (!BEAD.test(w.bead)) problems.push(`${name}: waiver needs a mw- bead id.`);
    if (!DATE.test(w.expires)) problems.push(`${name}: waiver needs an expiry date (YYYY-MM-DD).`);
    else if (w.expires < today) problems.push(`${name}: waiver expired on ${w.expires}.`);
  });
  return problems;
}

export function evaluate(
  advisories: readonly Advisory[],
  waivers: readonly Waiver[],
  today: string,
): Result {
  const waivedIds = new Set(waivers.filter((w) => w.expires >= today).map((w) => w.advisory));
  const critical = advisories.filter((a) => a.severity === 'critical');
  return {
    failures: critical.filter((a) => !waivedIds.has(a.id)),
    waived: critical.filter((a) => waivedIds.has(a.id)),
    warnings: advisories.filter((a) => a.severity === 'high'),
    problems: validateWaivers(waivers, today),
  };
}

const row = (a: Advisory): string =>
  `| [${a.id}](${a.url}) | ${a.module} | ${a.title} | ${a.paths.join('<br>')} | ${a.dev ? 'dev' : 'runtime'} |`;

export function renderSummary(result: Result): string {
  const section = (title: string, list: readonly Advisory[]): string[] =>
    list.length === 0
      ? []
      : [
          `### ${title}`,
          '',
          '| Advisory | Package | Title | Paths | Scope |',
          '|---|---|---|---|---|',
          ...list.map(row),
          '',
        ];
  const lines = [
    '## Dependency audit',
    '',
    ...section('❌ Critical (fails the build)', result.failures),
    ...section('⚠️ High (warning)', result.warnings),
    ...section('Waived critical', result.waived),
    ...result.problems.map((p) => `- ❌ ${p}`),
  ];
  if (lines.length === 2) lines.push('No critical or high advisories.');
  return `${lines.join('\n')}\n`;
}

/** Returns the exit code: 0 pass, 1 critical advisory or waiver problem, 2 unreadable input. */
export function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  today: string = new Date().toISOString().slice(0, 10),
): number {
  const arg = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i === -1 ? fallback : (argv[i + 1] ?? fallback);
  };
  let result: Result;
  try {
    const waivers = parseWaivers(
      JSON.parse(readFileSync(arg('--waivers', 'audit-waivers.json'), 'utf8')),
    );
    const advisories = argv.includes('--waivers-only')
      ? []
      : parseAudit(JSON.parse(readFileSync(arg('--audit', 'audit.json'), 'utf8')));
    result = evaluate(advisories, waivers, today);
  } catch (error) {
    // readFileSync, JSON.parse and the parsers only throw Errors.
    console.log(`::error title=Dependency audit::${(error as Error).message}`);
    return 2;
  }

  for (const a of result.failures) {
    console.log(
      `::error title=Critical advisory ${a.id}::${a.module}: ${a.title} (${a.paths.join(', ')}) ${a.url}`,
    );
  }
  for (const a of result.warnings) {
    console.log(
      `::warning title=High advisory ${a.id}::${a.module}: ${a.title} (${a.paths.join(', ')}) ${a.url}`,
    );
  }
  for (const p of result.problems) console.log(`::error title=Audit waivers::${p}`);

  const summaryFile = env['GITHUB_STEP_SUMMARY'];
  if (summaryFile) appendFileSync(summaryFile, renderSummary(result));
  const outputFile = env['GITHUB_OUTPUT'];
  if (outputFile)
    appendFileSync(outputFile, `critical=${result.failures.map((a) => a.id).join(' ')}\n`);

  const failed = result.failures.length > 0 || result.problems.length > 0;
  if (!failed) console.log('Dependency audit passed: no unwaived critical advisories.');
  return failed ? 1 : 0;
}
