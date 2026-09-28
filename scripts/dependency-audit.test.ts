import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluate,
  main,
  parseAudit,
  parseWaivers,
  renderSummary,
  validateWaivers,
  type Advisory,
  type Waiver,
} from './dependency-audit.ts';

// Trimmed from a real `pnpm audit --json` run against minimist@0.0.8 and lodash@4.17.20.
const REPORT = {
  advisories: {
    '1097677': {
      id: 1097677,
      github_advisory_id: 'GHSA-xvch-5gv4-984h',
      module_name: 'minimist',
      severity: 'critical',
      title: 'Prototype Pollution in minimist',
      url: 'https://github.com/advisories/GHSA-xvch-5gv4-984h',
      findings: [{ version: '0.0.8', paths: ['.>minimist'], dev: false }],
    },
    '1106913': {
      id: 1106913,
      github_advisory_id: 'GHSA-35jh-r3h4-6jhm',
      module_name: 'lodash',
      severity: 'high',
      title: 'Command Injection in lodash',
      url: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm',
      findings: [{ version: '4.17.20', paths: ['.>lodash'], dev: true }],
    },
    '1108258': {
      id: 1108258,
      github_advisory_id: 'GHSA-29mw-wpgm-hmr9',
      module_name: 'lodash',
      severity: 'moderate',
      title: 'ReDoS in lodash',
      url: 'https://github.com/advisories/GHSA-29mw-wpgm-hmr9',
      findings: [{ version: '4.17.20', paths: ['.>lodash'], dev: true }],
    },
  },
  metadata: {},
};

const TODAY = '2026-09-27';
const waiver = (overrides: Partial<Waiver> = {}): Waiver => ({
  advisory: 'GHSA-xvch-5gv4-984h',
  reason: 'only reachable from a build-time script with trusted input',
  bead: 'mw-e00.99',
  expires: '2026-10-31',
  ...overrides,
});

describe('parseAudit', () => {
  it('reads GHSA ids, severities, paths and whether only dev dependencies are affected', () => {
    const [critical, high] = parseAudit(REPORT);
    expect(critical).toEqual({
      id: 'GHSA-xvch-5gv4-984h',
      module: 'minimist',
      severity: 'critical',
      title: 'Prototype Pollution in minimist',
      url: 'https://github.com/advisories/GHSA-xvch-5gv4-984h',
      paths: ['.>minimist'],
      dev: false,
    });
    expect(high?.dev).toBe(true);
  });

  it('treats odd entries conservatively (unknown severity counts as critical)', () => {
    const advisories = parseAudit({
      advisories: {
        a: { id: 7, severity: 'catastrophic', findings: [{ paths: 'x' }] },
        b: 'junk',
        c: {},
      },
    });
    expect(advisories).toEqual([
      { id: '7', module: '', severity: 'critical', title: '', url: '', paths: [], dev: false },
      {
        id: 'undefined',
        module: '',
        severity: 'critical',
        title: '',
        url: '',
        paths: [],
        dev: false,
      },
    ]);
  });

  it('rejects output without advisories (e.g. a registry error)', () => {
    expect(() => parseAudit({ error: 'ENOTFOUND' })).toThrow(/no "advisories" object/);
    expect(() => parseAudit(null)).toThrow(/no "advisories" object/);
  });
});

describe('waivers', () => {
  it('parses the file and requires a waivers array', () => {
    expect(parseWaivers({ waivers: [waiver(), 'junk'] })).toEqual([
      waiver(),
      { advisory: '', reason: '', bead: '', expires: '' },
    ]);
    expect(() => parseWaivers({})).toThrow(/"waivers" array/);
    expect(() => parseWaivers([])).toThrow(/"waivers" array/);
  });

  it('a complete, unexpired waiver is valid (expiry day itself still counts)', () => {
    expect(validateWaivers([waiver(), waiver({ expires: TODAY })], TODAY)).toEqual([]);
  });

  it('AC-3: an expired waiver fails naming the advisory', () => {
    expect(validateWaivers([waiver({ expires: '2026-09-26' })], TODAY)).toEqual([
      'GHSA-xvch-5gv4-984h: waiver expired on 2026-09-26.',
    ]);
  });

  it('AC-4: a waiver missing a bead id or reason fails', () => {
    expect(validateWaivers([waiver({ bead: 'TODO', reason: '' })], TODAY)).toEqual([
      'GHSA-xvch-5gv4-984h: waiver needs a reason.',
      'GHSA-xvch-5gv4-984h: waiver needs a mw- bead id.',
    ]);
  });

  it('requires a GHSA id and a well-formed expiry date', () => {
    expect(validateWaivers([waiver({ advisory: '', expires: 'soon' })], TODAY)).toEqual([
      'waiver #1: waiver needs a GHSA advisory id.',
      'waiver #1: waiver needs an expiry date (YYYY-MM-DD).',
    ]);
  });
});

describe('evaluate and renderSummary', () => {
  const advisories = parseAudit(REPORT);

  it('AC-1: a critical advisory fails; AC-2: a high advisory is only a warning', () => {
    const result = evaluate(advisories, [], TODAY);
    expect(result.failures.map((a) => a.id)).toEqual(['GHSA-xvch-5gv4-984h']);
    expect(result.warnings.map((a) => a.id)).toEqual(['GHSA-35jh-r3h4-6jhm']);
    expect(result.problems).toEqual([]);
    const summary = renderSummary(result);
    expect(summary).toContain('### ❌ Critical (fails the build)');
    expect(summary).toContain(
      '| minimist | Prototype Pollution in minimist | .>minimist | runtime |',
    );
    expect(summary).toContain('### ⚠️ High (warning)');
    expect(summary).toContain('| lodash | Command Injection in lodash | .>lodash | dev |');
  });

  it('a valid waiver moves a critical out of failures; an expired one does not', () => {
    const waived = evaluate(advisories, [waiver()], TODAY);
    expect(waived.failures).toEqual([]);
    expect(waived.waived.map((a) => a.id)).toEqual(['GHSA-xvch-5gv4-984h']);
    expect(renderSummary(waived)).toContain('### Waived critical');
    const expired = evaluate(advisories, [waiver({ expires: '2026-01-01' })], TODAY);
    expect(expired.failures).toHaveLength(1);
    expect(renderSummary(expired)).toContain(
      '- ❌ GHSA-xvch-5gv4-984h: waiver expired on 2026-01-01.',
    );
  });

  it('says so when there is nothing to report', () => {
    const empty: Advisory[] = [];
    expect(renderSummary(evaluate(empty, [], TODAY))).toBe(
      '## Dependency audit\n\nNo critical or high advisories.\n',
    );
  });
});

describe('main and the CLI', () => {
  let dir: string;
  const argv = process.argv;
  const path = (name: string) => join(dir, name);
  const write = (name: string, value: unknown) => {
    writeFileSync(path(name), JSON.stringify(value));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vesper-audit-'));
    write('audit.json', REPORT);
    write('clean.json', { advisories: {} });
    write('waivers.json', { waivers: [] });
    writeFileSync(path('summary.md'), '');
    writeFileSync(path('output.txt'), '');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true });
  });

  it('AC-1/AC-2: fails on the critical, annotates both, and writes the summary and critical ids', () => {
    const env = { GITHUB_STEP_SUMMARY: path('summary.md'), GITHUB_OUTPUT: path('output.txt') };
    expect(
      main(['--audit', path('audit.json'), '--waivers', path('waivers.json')], env, TODAY),
    ).toBe(1);
    expect(console.log).toHaveBeenCalledWith(
      '::error title=Critical advisory GHSA-xvch-5gv4-984h::minimist: Prototype Pollution in minimist (.>minimist) https://github.com/advisories/GHSA-xvch-5gv4-984h',
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/^::warning title=High advisory GHSA-35jh-r3h4-6jhm::/),
    );
    expect(readFileSync(path('summary.md'), 'utf8')).toContain('## Dependency audit');
    expect(readFileSync(path('output.txt'), 'utf8')).toBe('critical=GHSA-xvch-5gv4-984h\n');
  });

  it('passes on a clean report', () => {
    expect(
      main(['--audit', path('clean.json'), '--waivers', path('waivers.json')], {}, TODAY),
    ).toBe(0);
    expect(console.log).toHaveBeenCalledWith(
      'Dependency audit passed: no unwaived critical advisories.',
    );
  });

  it('AC-3: --waivers-only fails on an expired waiver without needing an audit report', () => {
    write('waivers.json', { waivers: [waiver({ expires: '2026-01-01' })] });
    expect(main(['--waivers-only', '--waivers', path('waivers.json')], {}, TODAY)).toBe(1);
    expect(console.log).toHaveBeenCalledWith(
      '::error title=Audit waivers::GHSA-xvch-5gv4-984h: waiver expired on 2026-01-01.',
    );
  });

  it('fails with exit 2 on unreadable input (a flag with no value uses the default path)', () => {
    write('audit-waivers.json', { waivers: [] });
    rmSync(path('audit.json'));
    process.chdir(dir);
    try {
      expect(main(['--audit'], {}, TODAY)).toBe(2);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/^::error title=Dependency audit::/),
      );
    } finally {
      process.chdir(join(__dirname, '..'));
    }
  });

  it('the committed audit-waivers.json is valid', () => {
    expect(main(['--waivers-only'], {})).toBe(0);
  });

  it('the CLI sets the process exit code from main', async () => {
    process.argv = [
      'node',
      'dependency-audit-cli.ts',
      '--audit',
      path('clean.json'),
      '--waivers',
      path('waivers.json'),
    ];
    await import('./dependency-audit-cli.ts');
    expect(process.exitCode).toBe(0);
  });
});
