// Renders backlog.html (mw-e00.11): one self-contained page with inline CSS/JS and no external requests.
// Pure and deterministic: the output depends only on (issues, prStatus, now, sha).
import { CLIENT, STYLES, THEME_BOOT } from './assets.ts';
import { escapeHtml as esc, renderMarkdown } from './markdown.ts';
import {
  buildModel,
  type DepView,
  type EpicGroup,
  type ItemView,
  type MilestoneGroup,
  type PrRef,
  type TabView,
} from './model.ts';
import type { Issue } from './parse.ts';

export interface RenderInput {
  issues: readonly Issue[];
  /** PR overlay from mw-e00.12; empty renders from issues.jsonl alone. */
  prStatus: readonly PrRef[];
  now: Date;
  /** Source commit SHA; any placeholder when unknown. */
  sha: string;
}

const STATUS_TEXT: Readonly<Record<string, string>> = {
  closed: 'done',
  in_progress: 'in progress',
  blocked: 'blocked',
  deferred: 'deferred',
  open: 'open',
  unknown: 'unknown',
};

/** Pill class and text for a status; unrecognised statuses get a neutral pill with the raw text. */
function statusPill(status: string, blocked = false): string {
  const shown = blocked && status !== 'in_progress' ? 'blocked' : status;
  const known = STATUS_TEXT[shown];
  return known === undefined
    ? `<span class="pill">${esc(shown)}</span>`
    : `<span class="pill st-${shown}">${known}</span>`;
}

const msAttr = (key: string | null): string => esc(key ?? 'none');

function dep(d: DepView): string {
  if (d.title === null) {
    return `<li><span class="rid">${esc(d.id)}</span> ${statusPill('unknown')}</li>`;
  }
  return `<li><a href="#${esc(d.id)}">${esc(d.id)}</a> ${esc(d.title)} ${statusPill(d.status)}</li>`;
}

function prLink(item: ItemView): string {
  if (item.pr === null) return '';
  const text = `PR #${String(item.pr.number)} ${item.pr.state === 'merged' ? 'merged' : 'open'}`;
  return item.pr.url.startsWith('https://')
    ? `<a class="pill" href="${esc(item.pr.url)}">${text}</a>`
    : `<span class="pill">${text}</span>`;
}

function section(title: string, body: string): string {
  return body === '' ? '' : `<h4>${title}</h4>${body}`;
}

function row(item: ItemView): string {
  const { issue } = item;
  const ms = item.milestone;
  const description = renderMarkdown(issue.description);
  const acceptance = renderMarkdown(issue.acceptance);
  const deps = item.deps.map(dep).join('');
  const closed =
    issue.closeReason === '' && issue.closedAt === null
      ? ''
      : `<p class="md">${esc(issue.closeReason)}${issue.closedAt === null ? '' : ` <span class="rid">(${esc(issue.closedAt.slice(0, 10))})</span>`}</p>`;
  return (
    `<li class="row" id="${esc(issue.id)}" data-ms="${msAttr(ms)}" data-class="${esc(item.className ?? '')}" data-p="${String(issue.priority)}">` +
    `<details><summary><span class="rid">${esc(issue.id)}</span><span class="rtitle">${esc(issue.title)}</span><span class="meta">` +
    statusPill(item.status, item.blocked) +
    prLink(item) +
    `<span class="pill p${String(issue.priority)}">P${String(issue.priority)}</span>` +
    (ms === null
      ? ''
      : `<span class="pill">${esc(ms.toUpperCase().replace('POST-MVP', 'post-MVP'))}</span>`) +
    `<span class="pill">${esc(issue.type)}</span></span></summary>` +
    `<div class="body"><div class="cols"><div>` +
    section('Description', description === '' ? '' : `<div class="md">${description}</div>`) +
    `</div><div>` +
    section('Acceptance criteria', acceptance === '' ? '' : `<div class="md">${acceptance}</div>`) +
    section('Waits on', deps === '' ? '' : `<ul class="deps">${deps}</ul>`) +
    section('Closed', closed) +
    `<div class="labels">${issue.labels.map((l) => `<span class="pill">${esc(l)}</span>`).join('')}</div>` +
    `</div></div></div></details></li>`
  );
}

function milestone(group: MilestoneGroup): string {
  return (
    `<section class="ms" data-ms="${msAttr(group.key === '' ? null : group.key)}">` +
    `<h3 class="msh">${esc(group.label)} <span class="n">${String(group.items.length)}</span></h3>` +
    `<ul class="rows">${group.items.map(row).join('')}</ul></section>`
  );
}

function epic(group: EpicGroup): string {
  // Groups exist only for epics with at least one bead, so total is never 0.
  const pct = Math.round((100 * group.closed) / group.total);
  const label = `${group.number === '' ? group.name : group.number} progress`;
  return (
    `<details class="epic" open><summary><span class="eno">${esc(group.number)}</span>` +
    `<span><span class="etitle">${esc(group.name)}</span>` +
    (group.outcome === '' ? '' : `<span class="eoutcome">${esc(group.outcome)}</span>`) +
    `</span><span class="eprog">${String(group.closed)}/${String(group.total)} done · ${String(pct)}%` +
    `<span class="bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${String(group.total)}" aria-valuenow="${String(group.closed)}">` +
    `<i style="width:${String(pct)}%"></i></span></span></summary>` +
    group.milestones.map(milestone).join('') +
    `</details>`
  );
}

const EMPTY = {
  completed: 'Nothing is completed yet. Finished beads appear here after their PR merges.',
  upcoming: 'Nothing is planned or in progress.',
};

function panel(key: 'completed' | 'upcoming', view: TabView, selected: boolean): string {
  const body =
    view.epics.length === 0
      ? `<p class="empty">${EMPTY[key]}</p>`
      : view.epics.map(epic).join('') +
        `<p class="empty filter-empty" hidden>No items match these filters. Clear the search or pick "All" to see everything.</p>`;
  return `<section class="panel" role="tabpanel" id="panel-${key}" aria-labelledby="tab-${key}"${selected ? '' : ' hidden'}>${body}</section>`;
}

function tab(
  key: 'completed' | 'upcoming',
  label: string,
  count: number,
  selected: boolean,
): string {
  return (
    `<button class="tab" role="tab" type="button" id="tab-${key}" aria-controls="panel-${key}" aria-selected="${String(selected)}" tabindex="${selected ? '0' : '-1'}">` +
    `${label} <span class="n">${String(count)}</span></button>`
  );
}

const option = (value: string, text: string): string =>
  `<option value="${esc(value)}">${esc(text)}</option>`;

/** YYYY-MM-DD HH:MM UTC, independent of the machine's locale and time zone. */
export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function renderPage({ issues, prStatus, now, sha }: RenderInput): string {
  const model = buildModel(issues, prStatus);
  const t = model.tally;
  const shortSha = esc(sha.slice(0, 7));
  const stamp =
    `Generated <time datetime="${now.toISOString()}">${formatUtc(now)}</time> from ` +
    `<code>.beads/issues.jsonl</code> at commit <code title="${esc(sha)}">${shortSha}</code>.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Vesper Bell Backlog</title>
<meta name="description" content="What's being built for The Vesper Bell, what's next, and what's done.">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#1e1b2e">
<script>${THEME_BOOT}</script>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
<header>
<h1>The Vesper Bell backlog</h1>
<p class="sub">What's being built, what's next, and what's done. Every item links back to a bead in the repository's tracker.</p>
<p class="stamp">${stamp}</p>
<ul class="tally"><li><b>${String(t.epics)}</b> epics</li><li><b>${String(t.items)}</b> work items</li><li><b>${String(t.inProgress)}</b> in progress</li><li><b>${String(t.completed)}</b> completed</li><li><b>${String(t.ready)}</b> ready to start</li></ul>
<div class="tabs" role="tablist" aria-label="Backlog">${tab('upcoming', 'Upcoming and in progress', model.upcoming.count, true)}${tab('completed', 'Completed', model.completed.count, false)}</div>
<div class="filters">
<input id="q" type="search" placeholder="Search titles, IDs and acceptance criteria" aria-label="Search">
<label>Milestone <select id="f-ms">${option('', 'All')}${model.milestones.map((m) => option(m.key === '' ? 'none' : m.key, m.label)).join('')}</select></label>
<label>Class <select id="f-class">${option('', 'All')}${model.classes.map((c) => option(c, c)).join('')}</select></label>
<label>Priority <select id="f-p">${option('', 'All')}${[0, 1, 2, 3, 4].map((p) => option(String(p), `P${String(p)}`)).join('')}</select></label>
<button class="tab theme" id="theme" type="button">Toggle theme</button>
</div>
</header>
<main>
${panel('upcoming', model.upcoming, true)}
${panel('completed', model.completed, false)}
</main>
<footer>${stamp}</footer>
</div>
<script>${CLIENT}</script>
</body>
</html>
`;
}
