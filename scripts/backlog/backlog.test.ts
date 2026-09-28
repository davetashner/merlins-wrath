import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gitHead, main, sourceSha } from './generate.ts';
import { buildModel, labelValue, type PrRef } from './model.ts';
import { ParseError, parseIssues, type Issue } from './parse.ts';
import { formatUtc, renderPage } from './render.ts';

interface Line {
  id: string;
  title?: string;
  status?: string;
  type?: string;
  priority?: number;
  labels?: string[];
  parent?: string;
  blocks?: string[];
  description?: string;
  acceptance?: string;
  closed_at?: string;
  close_reason?: string;
}

/** One bd export line; every field is given so the fixture has no defaults of its own. */
const line = ({ type, acceptance, parent, blocks, ...rest }: Line): string =>
  JSON.stringify({
    _type: 'issue',
    title: `Title of ${rest.id}`,
    status: 'open',
    issue_type: type ?? 'task',
    priority: 1,
    labels: [],
    description: '',
    acceptance_criteria: acceptance ?? '',
    ...rest,
    dependencies: [
      ...(parent === undefined
        ? []
        : [{ issue_id: rest.id, depends_on_id: parent, type: 'parent-child' }]),
      ...(blocks ?? []).map((to) => ({ issue_id: rest.id, depends_on_id: to, type: 'blocks' })),
    ],
  });
const jsonl = (...lines: Line[]): string => `${lines.map(line).join('\n')}\n`;
const issues = (...lines: Line[]): Issue[] => parseIssues(jsonl(...lines));

const NOW = new Date('2026-09-27T12:34:56Z');
const SHA = '0123456789abcdef0123456789abcdef01234567';
const page = (list: readonly Issue[], prStatus: readonly PrRef[] = []): string =>
  renderPage({ issues: list, prStatus, now: NOW, sha: SHA });
/** The HTML of one tab panel. */
const panel = (html: string, key: string): string => {
  const start = html.indexOf(`<section class="panel" role="tabpanel" id="panel-${key}"`);
  return html.slice(start, html.indexOf('</section>\n', start));
};
const count = (html: string, needle: string): number => html.split(needle).length - 1;

const E09 = [
  { id: 'mw-e09', type: 'epic', title: 'E09 — Stealth', description: '## Outcome\n\nSneak well.' },
  { id: 'mw-e09.1', parent: 'mw-e09', status: 'closed', labels: ['milestone:m1'] },
  { id: 'mw-e09.2', parent: 'mw-e09', labels: ['milestone:m1'] },
  { id: 'mw-e09.3', parent: 'mw-e09', labels: ['milestone:m2'], blocks: ['mw-e09.2'] },
];

describe('parseIssues', () => {
  it('reads bd records, skipping blank lines, CRLF endings and non-issue records', () => {
    const text = `${line({ id: 'mw-e01' })}\r\n\r\n{"_type":"memory","key":"x"}\n${line({ id: 'mw-e01.1', parent: 'mw-e01', blocks: ['mw-e02'], closed_at: '2026-09-01T00:00:00Z', close_reason: 'Done' })}`;
    expect(parseIssues(text)).toEqual([
      {
        id: 'mw-e01',
        title: 'Title of mw-e01',
        type: 'task',
        status: 'open',
        priority: 1,
        labels: [],
        description: '',
        acceptance: '',
        parent: null,
        blocksOn: [],
        closedAt: null,
        closeReason: '',
      },
      expect.objectContaining({
        id: 'mw-e01.1',
        parent: 'mw-e01',
        blocksOn: ['mw-e02'],
        closedAt: '2026-09-01T00:00:00Z',
        closeReason: 'Done',
      }),
    ]);
  });

  it('tolerates missing or odd optional fields', () => {
    const text = [
      JSON.stringify({ id: 'mw-a', title: 'A', priority: 9, labels: 'x', dependencies: 'y' }),
      JSON.stringify({
        id: 'mw-b',
        title: 'B',
        priority: 0,
        labels: ['ok', '', 3],
        dependencies: [null, { type: 'blocks' }, { type: 'blocks', depends_on_id: 'mw-a' }],
      }),
    ].join('\n');
    expect(parseIssues(text)).toEqual([
      expect.objectContaining({
        type: 'task',
        status: 'open',
        priority: 2,
        labels: [],
        blocksOn: [],
      }),
      expect.objectContaining({ priority: 0, labels: ['ok'], blocksOn: ['mw-a'] }),
    ]);
  });

  it('refuses lines it cannot render, naming the line', () => {
    const fail = (text: string): ParseError => {
      try {
        parseIssues(text);
      } catch (error) {
        return error as ParseError;
      }
      throw new Error('expected a ParseError');
    };
    expect(fail(`${line({ id: 'mw-a' })}\n{"id":`)).toMatchObject({
      line: 2,
      message: 'line 2: not valid JSON',
    });
    expect(fail('[1]').message).toBe('line 1: not a JSON object');
    expect(fail('{"id":"mw-a"}').message).toBe('line 1: issue needs an id and a title');
    expect(fail('{"title":"t"}')).toBeInstanceOf(ParseError);
  });
});

describe('buildModel', () => {
  it('AC-1: splits beads between the tabs under their epic with progress over all children', () => {
    const model = buildModel(issues(...E09), []);
    expect(model.completed.count).toBe(1);
    expect(model.upcoming.count).toBe(2);
    const [upcoming] = model.upcoming.epics;
    expect(upcoming).toMatchObject({
      id: 'mw-e09',
      number: 'E09',
      name: 'Stealth',
      outcome: 'Sneak well.',
      closed: 1,
      total: 3,
    });
    expect(upcoming?.milestones.map((m) => [m.label, m.items.map((i) => i.issue.id)])).toEqual([
      ['M1 Grey-box slice', ['mw-e09.2']],
      ['M2 Class fantasies', ['mw-e09.3']],
    ]);
    expect(model.tally).toEqual({ epics: 1, items: 3, inProgress: 0, completed: 1, ready: 1 });
  });

  it('orders milestones m0 → post-mvp, then unknown ones, then unscheduled', () => {
    const model = buildModel(
      issues(
        { id: 'mw-1', labels: ['milestone:zeta'] },
        { id: 'mw-2' },
        { id: 'mw-3', labels: ['milestone:post-mvp'] },
        { id: 'mw-4', labels: ['milestone:alpha'] },
        { id: 'mw-5', labels: ['milestone:m0'] },
      ),
      [],
    );
    expect(model.milestones.map((m) => m.label)).toEqual([
      'M0 Foundation',
      'Post-MVP',
      'alpha',
      'zeta',
      'Unscheduled',
    ]);
  });

  it('sorts in-progress beads first, then priority, then natural id order', () => {
    const model = buildModel(
      issues(
        { id: 'mw-e1.10', priority: 1 },
        { id: 'mw-e1.9', priority: 1 },
        { id: 'mw-e1.1', priority: 2, status: 'in_progress' },
        { id: 'mw-e1.2', priority: 0 },
      ),
      [],
    );
    const ids = model.upcoming.epics[0]?.milestones[0]?.items.map((i) => i.issue.id);
    expect(ids).toEqual(['mw-e1.1', 'mw-e1.2', 'mw-e1.9', 'mw-e1.10']);
  });

  it('puts beads without an epic parent under "Other work", after the epics', () => {
    const model = buildModel(
      issues(
        { id: 'mw-e02', type: 'epic', title: 'Loose epic', description: '## Outcome\n## Next' },
        { id: 'mw-e02.1', parent: 'mw-e02' },
        { id: 'mw-e03', type: 'epic', title: 'E03 - No outcome', description: 'Just text.' },
        { id: 'mw-x', parent: 'mw-e02.1' },
        { id: 'mw-y' },
      ),
      [],
    );
    expect(model.upcoming.epics.map((e) => [e.id, e.number, e.name, e.outcome, e.total])).toEqual([
      ['mw-e02', '', 'Loose epic', '', 1],
      ['', '', 'Other work', '', 2],
    ]);
  });

  it('marks beads blocked by status or by an open dependency; unknown and closed deps do not block', () => {
    const model = buildModel(
      issues(
        { id: 'mw-1', status: 'closed' },
        { id: 'mw-2', blocks: ['mw-1', 'mw-404'] },
        { id: 'mw-3', blocks: ['mw-2'] },
        { id: 'mw-4', status: 'blocked' },
        { id: 'mw-5', status: 'closed', blocks: ['mw-2'] },
      ),
      [],
    );
    const items = model.upcoming.epics.flatMap((e) => e.milestones.flatMap((m) => m.items));
    expect(items.map((i) => [i.issue.id, i.blocked])).toEqual([
      ['mw-2', false],
      ['mw-3', true],
      ['mw-4', true],
    ]);
    expect(items[0]?.deps).toEqual([
      { id: 'mw-1', title: 'Title of mw-1', status: 'closed' },
      { id: 'mw-404', title: null, status: 'unknown' },
    ]);
    expect(model.completed.epics[0]?.milestones[0]?.items[0]?.blocked).toBe(false);
  });

  it('applies the PR overlay seam: merged closes, open marks in progress, jsonl closed wins', () => {
    const pr = (id: string, n: number, state: PrRef['state']): PrRef => ({
      id,
      number: n,
      state,
      url: `https://github.com/o/r/pull/${String(n)}`,
    });
    const model = buildModel(
      issues({ id: 'mw-1' }, { id: 'mw-2' }, { id: 'mw-3', status: 'closed' }, { id: 'mw-4' }),
      [
        pr('mw-1', 57, 'merged'),
        pr('mw-1', 58, 'open'),
        pr('mw-2', 60, 'open'),
        pr('mw-3', 61, 'open'),
        pr('mw-4', 62, 'open'),
        pr('mw-4', 63, 'merged'),
      ],
    );
    const status = (tab: typeof model.upcoming): string[][] =>
      tab.epics.flatMap((e) =>
        e.milestones.flatMap((m) =>
          m.items.map((i) => [i.issue.id, i.status, String(i.pr?.number)]),
        ),
      );
    expect(status(model.completed)).toEqual([
      ['mw-1', 'closed', '57'],
      ['mw-3', 'closed', '61'],
      ['mw-4', 'closed', '63'],
    ]);
    expect(status(model.upcoming)).toEqual([['mw-2', 'in_progress', '60']]);
  });

  it('collects class labels for the filter', () => {
    const list = issues(
      { id: 'mw-1', labels: ['class:thief'] },
      { id: 'mw-2', labels: ['class:knight'] },
    );
    expect(buildModel(list, []).classes).toEqual(['knight', 'thief']);
    expect(list.map((i) => labelValue(i, 'milestone'))).toEqual([null, null]);
  });
});

describe('renderPage', () => {
  it('AC-1: Completed lists 1 and Upcoming lists 2 under the E09 heading with a 1/3 progress bar', () => {
    const html = page(issues(...E09));
    const completed = panel(html, 'completed');
    const upcoming = panel(html, 'upcoming');
    expect(count(completed, 'class="row"')).toBe(1);
    expect(count(upcoming, 'class="row"')).toBe(2);
    for (const tab of [completed, upcoming]) {
      expect(tab).toContain(
        '<span class="eno">E09</span><span><span class="etitle">Stealth</span>',
      );
      expect(tab).toContain('1/3 done · 33%');
      expect(tab).toContain('aria-valuemax="3" aria-valuenow="1"><i style="width:33%">');
    }
    expect(html).toContain('Completed <span class="n">1</span>');
    expect(html).toContain('Upcoming and in progress <span class="n">2</span>');
  });

  it('AC-2: hostile bead text renders escaped and inert', () => {
    const html = page(
      issues({
        id: 'mw-e01.1',
        title: '<script>alert(1)</script>',
        description:
          '<img src=x onerror=alert(2)>\n[x](javascript:alert(3))\n"><svg onload=alert(4)>',
        acceptance: '- <script>alert(5)</script>',
        labels: ['milestone:"><script>alert(6)</script>', 'class:<b>'],
        close_reason: '<iframe src=javascript:alert(7)>',
        status: 'closed',
      }),
    );
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // The page's own two scripts are the only script elements.
    expect(count(html, '<script')).toBe(2);
    expect(html).not.toMatch(/<(?:img|svg|iframe)|href="javascript:|onerror=alert\(2\)>/i);
  });

  it('AC-3: ACs sit in a collapsed <details>; the row shows ID, priority, status, labels and dependency links', () => {
    const html = page(
      issues(
        { id: 'mw-1', status: 'deferred' },
        {
          id: 'mw-2',
          priority: 0,
          labels: ['milestone:m0', 'area:tools', 'class:thief'],
          acceptance: '- AC-1 [unit] Given x, then y.',
          description: 'Why it matters.',
          blocks: ['mw-1'],
        },
      ),
    );
    const start = html.indexOf('<li class="row" id="mw-2"');
    const row = html.slice(start, html.indexOf('</details></li>', start));
    expect(row).toMatch(
      /^<li class="row" id="mw-2" data-ms="m0" data-class="thief" data-p="0"><details><summary>/,
    );
    expect(row).not.toContain('<details open');
    expect(row).toContain('<span class="rid">mw-2</span><span class="rtitle">Title of mw-2</span>');
    expect(row).toContain(
      '<span class="pill st-blocked">blocked</span><span class="pill p0">P0</span><span class="pill">M0</span>',
    );
    expect(row).toContain('<h4>Description</h4><div class="md"><p>Why it matters.</p></div>');
    expect(row).toContain(
      '<h4>Acceptance criteria</h4><div class="md"><ul><li>AC-1 <span class="tag">unit</span> Given x, then y.</li></ul></div>',
    );
    expect(row).toContain(
      '<h4>Waits on</h4><ul class="deps"><li><a href="#mw-1">mw-1</a> Title of mw-1 <span class="pill st-deferred">deferred</span></li></ul>',
    );
    expect(row).toContain('<span class="pill">area:tools</span>');
    expect(html).toContain('<li class="row" id="mw-1" data-ms="none" data-class="" data-p="1">');
    expect(html).toContain('<option value="none">Unscheduled</option>');
  });

  it('AC-4: a dependency on an id missing from the file shows as "unknown"', () => {
    const html = page(issues({ id: 'mw-1', blocks: ['mw-e99.7'] }));
    expect(html).toContain(
      '<li><span class="rid">mw-e99.7</span> <span class="pill st-unknown">unknown</span></li>',
    );
    expect(html).not.toContain('href="#mw-e99.7"');
  });

  it('AC-5: an empty export renders an empty state in both tabs', () => {
    const html = page([]);
    expect(panel(html, 'completed')).toContain('<p class="empty">Nothing is completed yet.');
    expect(panel(html, 'upcoming')).toContain(
      '<p class="empty">Nothing is planned or in progress.',
    );
    expect(html).not.toContain('class="empty filter-empty"');
  });

  it('is deterministic, stamps time and commit, and makes no external requests', () => {
    const list = issues(...E09);
    const html = page(list);
    expect(page(list)).toBe(html);
    expect(html).toContain(
      'Generated <time datetime="2026-09-27T12:34:56.000Z">2026-09-27 12:34 UTC</time>',
    );
    expect(html).toContain(`<code title="${SHA}">0123456</code>`);
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
    expect(html).not.toMatch(/@import|url\(/);
    expect(formatUtc(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02 03:04 UTC');
  });

  it('renders status pills, PR links and close details', () => {
    const html = page(
      issues(
        { id: 'mw-1', status: 'in_progress', blocks: ['mw-2'] },
        { id: 'mw-2', status: 'weird<x>' },
        { id: 'mw-3', status: 'closed', close_reason: 'Completed in PR #9' },
        { id: 'mw-4', status: 'closed', closed_at: '2026-09-20T10:00:00Z' },
        { id: 'mw-5', labels: ['milestone:post-mvp'] },
        { id: 'mw-6' },
      ),
      [
        { id: 'mw-5', number: 70, state: 'open', url: 'https://github.com/o/r/pull/70' },
        { id: 'mw-6', number: 71, state: 'merged', url: 'javascript:alert(1)' },
      ],
    );
    expect(html).toContain('<span class="pill st-in_progress">in progress</span>');
    expect(html).toContain('<span class="pill">weird&lt;x&gt;</span>');
    expect(html).toContain('<span class="pill st-closed">done</span>');
    expect(html).toContain('<h4>Closed</h4><p class="md">Completed in PR #9</p>');
    expect(html).toContain(
      '<h4>Closed</h4><p class="md"> <span class="rid">(2026-09-20)</span></p>',
    );
    expect(html).toContain(
      '<a class="pill" href="https://github.com/o/r/pull/70">PR #70 open</a><span class="pill p1">P1</span><span class="pill">post-MVP</span>',
    );
    expect(html).toContain('<span class="pill">PR #71 merged</span>');
    expect(html).toContain('<span class="eno"></span><span><span class="etitle">Other work</span>');
  });
});

describe('main', () => {
  const dirs: string[] = [];
  const tmp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'backlog-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('AC-5: an empty issues.jsonl writes a page with both empty states and exits 0', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const dir = tmp();
    writeFileSync(join(dir, 'issues.jsonl'), '');
    const out = join(dir, 'nested', 'backlog.html');
    expect(main([join(dir, 'issues.jsonl'), out], { GITHUB_SHA: SHA }, NOW, dir)).toBe(0);
    const html = readFileSync(out, 'utf8');
    expect(count(html, '<p class="empty">')).toBe(2);
    expect(html).toContain('0123456');
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^Wrote .*backlog\.html \(0 issues, \d+ bytes\)\.$/),
    );
  });

  it('defaults to .beads/issues.jsonl and backlog.html in the working directory', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const dir = tmp();
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      expect(main([], {}, NOW, dir)).toBe(2);
      writeFileSync(join(dir, 'issues.jsonl'), jsonl({ id: 'mw-1' }));
      expect(main(['issues.jsonl'], {}, NOW, dir)).toBe(0);
      expect(existsSync(join(dir, 'backlog.html'))).toBe(true);
      expect(readFileSync(join(dir, 'backlog.html'), 'utf8')).toContain(
        'commit <code title="unknown">unknown</code>',
      );
    } finally {
      process.chdir(cwd);
    }
  });

  it('fails with an annotation naming the line when the export is malformed', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const dir = tmp();
    const src = join(dir, 'issues.jsonl');
    writeFileSync(src, `${line({ id: 'mw-1' })}\n{"id":`);
    expect(main([src, join(dir, 'out.html')], {}, NOW, dir)).toBe(1);
    expect(log).toHaveBeenCalledWith(
      `::error file=${src},line=2,title=Backlog page::line 2: not valid JSON`,
    );
    expect(existsSync(join(dir, 'out.html'))).toBe(false);
  });

  it('fails when the output cannot be written', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const dir = tmp();
    writeFileSync(join(dir, 'issues.jsonl'), '');
    const out = join(dir, 'issues.jsonl', 'backlog.html');
    expect(main([join(dir, 'issues.jsonl'), out], {}, NOW, dir)).toBe(2);
    expect(log).toHaveBeenCalledWith(`::error title=Backlog page::Cannot write ${out}.`);
  });

  it('takes the commit from GITHUB_SHA, else git HEAD, else "unknown"', () => {
    expect(sourceSha({ GITHUB_SHA: SHA }, tmp())).toBe(SHA);
    expect(sourceSha({ GITHUB_SHA: '' }, process.cwd())).toMatch(/^[0-9a-f]{40}$/);
    expect(gitHead(tmp())).toBeNull();
    expect(sourceSha({}, tmp())).toBe('unknown');
  });

  it('the CLI sets the process exit code from main', async () => {
    const argv = process.argv;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const dir = tmp();
    writeFileSync(join(dir, 'issues.jsonl'), jsonl(...E09));
    process.argv = ['node', 'generate-cli.ts', join(dir, 'issues.jsonl'), join(dir, 'out.html')];
    try {
      await import('./generate-cli.ts');
      expect(process.exitCode).toBe(0);
      expect(readFileSync(join(dir, 'out.html'), 'utf8')).toContain('Stealth');
    } finally {
      process.argv = argv;
      process.exitCode = undefined;
    }
  });
});
