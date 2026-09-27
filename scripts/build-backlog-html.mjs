#!/usr/bin/env node
// Builds a self-contained backlog.html from beads JSONL.
//   node scripts/build-backlog-html.mjs [issues.jsonl] [out.html]
// Interim version; the hardened, fully tested generator + Pages deploy is tracked in mw-e00.
import { readFileSync, writeFileSync } from 'node:fs';

const [src = '.beads/issues.jsonl', out = 'backlog.html'] = process.argv.slice(2);
const issues = readFileSync(src, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const slim = issues.map((i) => ({
  id: i.id,
  title: i.title,
  type: i.issue_type,
  status: i.status,
  priority: i.priority,
  labels: i.labels ?? [],
  description: i.description ?? '',
  acceptance: i.acceptance_criteria ?? '',
  estimate: i.estimated_minutes ?? null,
  closed_at: i.closed_at ?? null,
  close_reason: i.close_reason ?? '',
  parent: (i.dependencies ?? []).find((d) => d.type === 'parent-child')?.depends_on_id ?? null,
  blocks_on: (i.dependencies ?? []).filter((d) => d.type === 'blocks').map((d) => d.depends_on_id),
}));

const data = JSON.stringify({ generated: new Date().toISOString(), issues: slim }).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Vesper Bell Backlog</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>
:root {
  --stone: #e4e7e1; --slab: #f2f4ef; --ink: #1f2a25; --muted: #5d6a63; --rule: #c3cac2;
  --moss: #2f6f5e; --moss-soft: #d3e5dc; --arcane: #5b3f95; --arcane-soft: #e3dcf2;
  --blood: #9c2f2f; --blood-soft: #f2d9d6; --gold: #8a6a1f; --gold-soft: #efe4c8;
  --focus: #5b3f95;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --stone: #151c19; --slab: #1d2622; --ink: #dbe2dc; --muted: #93a39a; --rule: #34423b;
    --moss: #7cc3ad; --moss-soft: #203a32; --arcane: #b8a2ea; --arcane-soft: #2e2645;
    --blood: #e48b82; --blood-soft: #3d2322; --gold: #d8b563; --gold-soft: #3a3120; --focus: #b8a2ea;
  }
}
:root[data-theme="dark"] {
  --stone: #151c19; --slab: #1d2622; --ink: #dbe2dc; --muted: #93a39a; --rule: #34423b;
  --moss: #7cc3ad; --moss-soft: #203a32; --arcane: #b8a2ea; --arcane-soft: #2e2645;
  --blood: #e48b82; --blood-soft: #3d2322; --gold: #d8b563; --gold-soft: #3a3120; --focus: #b8a2ea;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--stone); color: var(--ink);
  font: 16px/1.55 "Atkinson Hyperlegible", system-ui, sans-serif; }
a { color: var(--arcane); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 3px; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 0 16px 64px; }
header { padding: 40px 0 20px; }
h1 { font: 400 clamp(2.2rem, 6vw, 3.6rem)/1.05 "IM Fell English", Georgia, serif; margin: 0 0 8px; letter-spacing: -0.01em; }
.sub { color: var(--muted); margin: 0; max-width: 62ch; }
.tally { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 18px 0 0; padding: 0; list-style: none; color: var(--muted); font-size: .95rem; }
.tally b { color: var(--ink); font-size: 1.15rem; }
.tabs { display: flex; gap: 4px; border-bottom: 2px solid var(--rule); margin-top: 24px; }
.tab { appearance: none; border: 0; background: none; color: var(--muted); font: inherit; font-weight: 700;
  padding: 10px 14px; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; }
.tab[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--moss); }
.tab .n { font-weight: 400; color: var(--muted); margin-left: 4px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 0; align-items: center; }
.filters input, .filters select { font: inherit; font-size: .92rem; color: var(--ink); background: var(--slab);
  border: 1px solid var(--rule); border-radius: 6px; padding: 7px 10px; }
.filters input { flex: 1 1 220px; min-width: 0; }
.filters label { font-size: .9rem; color: var(--muted); display: flex; gap: 6px; align-items: center; }
.theme { margin-left: auto; }
.epic { margin: 18px 0; }
.epic > summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: 3.2rem 1fr auto; gap: 12px; align-items: baseline; padding: 10px 0; border-bottom: 1px solid var(--rule); }
.epic > summary::-webkit-details-marker { display: none; }
.eno { font: 700 1.2rem/1 "Atkinson Hyperlegible", sans-serif; color: var(--moss); font-variant-numeric: tabular-nums; }
.etitle { font: 400 1.35rem/1.2 "IM Fell English", Georgia, serif; }
.eoutcome { display: block; font: .9rem/1.45 "Atkinson Hyperlegible", sans-serif; color: var(--muted); margin-top: 3px; }
.eprog { font-size: .85rem; color: var(--muted); white-space: nowrap; text-align: right; }
.bar { display: block; width: 110px; height: 5px; background: var(--rule); border-radius: 3px; margin-top: 5px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--moss); }
.rows { list-style: none; margin: 0; padding: 0; }
.row { border-bottom: 1px solid var(--rule); }
.row > details > summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: 6.2rem 1fr auto; gap: 10px; padding: 9px 0 9px 3.2rem; align-items: baseline; }
.row > details > summary::-webkit-details-marker { display: none; }
.row > details[open] > summary { background: var(--slab); }
.rid { font-size: .82rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.rtitle { min-width: 0; }
.meta { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.pill { font-size: .75rem; padding: 1px 7px; border-radius: 999px; white-space: nowrap; background: var(--slab); color: var(--muted); border: 1px solid var(--rule); }
.p0 { background: var(--blood-soft); color: var(--blood); border-color: transparent; }
.p1 { background: var(--gold-soft); color: var(--gold); border-color: transparent; }
.st-in_progress { background: var(--arcane-soft); color: var(--arcane); border-color: transparent; }
.st-closed { background: var(--moss-soft); color: var(--moss); border-color: transparent; }
.st-blocked { background: transparent; color: var(--blood); border-style: dashed; }
.body { padding: 4px 0 18px 3.2rem; background: var(--slab); }
.body .cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 28px; padding-right: 12px; }
.body h4 { font: 400 1.1rem "IM Fell English", Georgia, serif; margin: 10px 0 4px; color: var(--moss); }
.md { font-size: .93rem; max-width: 70ch; }
.md h2, .md h3 { font: 700 .9rem "Atkinson Hyperlegible", sans-serif; margin: 12px 0 2px; }
.md p { margin: 4px 0; }
.md ul { margin: 4px 0; padding-left: 1.1rem; }
.md li { margin: 3px 0; }
.md code { font-size: .88em; background: var(--stone); padding: 0 4px; border-radius: 3px; }
.tag { font-size: .72rem; font-weight: 700; color: var(--arcane); }
.labels { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 10px; }
.deps a { margin-right: 8px; font-size: .88rem; }
.empty { color: var(--muted); padding: 40px 0; }
footer { color: var(--muted); font-size: .85rem; margin-top: 40px; }
@media (max-width: 720px) {
  .epic > summary { grid-template-columns: 2.4rem 1fr; }
  .eprog { grid-column: 2; text-align: left; }
  .row > details > summary { grid-template-columns: 1fr; padding-left: 0; gap: 3px; }
  .meta { justify-content: flex-start; }
  .body { padding-left: 10px; }
  .body .cols { grid-template-columns: 1fr; gap: 0; }
}
@media (prefers-reduced-motion: no-preference) { .bar i { transition: width .4s ease; } }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>The Vesper Bell backlog</h1>
  <p class="sub">What's being built, what's next, and what's done. Every item links back to a bead in the repository's tracker.</p>
  <ul class="tally" id="tally"></ul>
  <div class="tabs" role="tablist">
    <button class="tab" role="tab" id="tab-upcoming" aria-selected="true" data-tab="upcoming">Upcoming and in progress<span class="n" id="n-upcoming"></span></button>
    <button class="tab" role="tab" id="tab-done" aria-selected="false" data-tab="done">Completed<span class="n" id="n-done"></span></button>
  </div>
  <div class="filters">
    <input id="q" type="search" placeholder="Search titles, IDs and acceptance criteria" aria-label="Search">
    <label>Milestone <select id="f-ms"><option value="">All</option></select></label>
    <label>Class <select id="f-class"><option value="">All</option></select></label>
    <label>Priority <select id="f-p"><option value="">All</option><option>0</option><option>1</option><option>2</option><option>3</option><option>4</option></select></label>
    <button class="tab theme" id="theme" type="button">Toggle theme</button>
  </div>
</header>
<main id="list" role="tabpanel"></main>
<footer id="foot"></footer>
</div>
<script id="data" type="application/json">${data}</script>
<script>
const { generated, issues } = JSON.parse(document.getElementById('data').textContent);
const byId = new Map(issues.map((i) => [i.id, i]));
const epics = issues.filter((i) => i.type === 'epic').sort((a, b) => a.id.localeCompare(b.id));
const items = issues.filter((i) => i.type !== 'epic');
const MS = { m0: 'M0 Foundation', m1: 'M1 Grey-box slice', m2: 'M2 Class fantasies', m3: 'M3 MVP content', m4: 'M4 Fun validation', 'post-mvp': 'Post-MVP' };
const label = (i, k) => (i.labels.find((l) => l.startsWith(k + ':')) || '').slice(k.length + 1);
const isBlocked = (i) => i.status !== 'closed' && i.blocks_on.some((d) => byId.get(d) && byId.get(d).status !== 'closed');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function md(src) {
  const inline = (s) => esc(s).replace(/\`([^\`]+)\`/g, '<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g, '<b>$1</b>')
    .replace(/\\[(unit|integration|e2e|perf|manual|content)\\]/g, '<span class="tag">$1</span>');
  let html = '', list = false;
  for (const line of src.split('\\n')) {
    const li = line.match(/^\\s*[-*] (.*)/);
    if (li) { if (!list) { html += '<ul>'; list = true; } html += '<li>' + inline(li[1]) + '</li>'; continue; }
    if (list) { html += '</ul>'; list = false; }
    const h = line.match(/^#{1,4} (.*)/);
    if (h) html += '<h3>' + inline(h[1]) + '</h3>';
    else if (line.trim()) html += '<p>' + inline(line) + '</p>';
  }
  return html + (list ? '</ul>' : '');
}
const classes = [...new Set(items.map((i) => label(i, 'class')).filter(Boolean))].sort();
const milestones = Object.keys(MS).filter((m) => items.some((i) => label(i, 'milestone') === m));
document.getElementById('f-ms').insertAdjacentHTML('beforeend', milestones.map((m) => '<option value="' + m + '">' + MS[m] + '</option>').join(''));
document.getElementById('f-class').insertAdjacentHTML('beforeend', classes.map((c) => '<option>' + c + '</option>').join(''));

const done = items.filter((i) => i.status === 'closed');
const active = items.filter((i) => i.status === 'in_progress');
document.getElementById('tally').innerHTML =
  '<li><b>' + epics.length + '</b> epics</li><li><b>' + items.length + '</b> work items</li>' +
  '<li><b>' + active.length + '</b> in progress</li><li><b>' + done.length + '</b> completed</li>' +
  '<li><b>' + items.filter((i) => i.status !== 'closed' && !isBlocked(i)).length + '</b> ready to start</li>';
document.getElementById('foot').textContent = 'Generated ' + new Date(generated).toLocaleString() + ' from .beads/issues.jsonl';

let tab = 'upcoming';
function row(i) {
  const st = i.status === 'closed' ? 'closed' : i.status === 'in_progress' ? 'in_progress' : isBlocked(i) ? 'blocked' : '';
  const stText = { closed: 'done', in_progress: 'in progress', blocked: 'blocked' }[st];
  const ms = label(i, 'milestone');
  const deps = i.blocks_on.map((d) => '<a href="#' + d + '">' + d + (byId.get(d) ? ' ' + esc(byId.get(d).title) : '') + '</a>').join('');
  return '<li class="row" id="' + i.id + '"><details><summary>' +
    '<span class="rid">' + i.id + '</span><span class="rtitle">' + esc(i.title) + '</span><span class="meta">' +
    (stText ? '<span class="pill st-' + st + '">' + stText + '</span>' : '') +
    '<span class="pill p' + i.priority + '">P' + i.priority + '</span>' +
    (ms ? '<span class="pill">' + ms.toUpperCase().replace('POST-MVP', 'post-MVP') + '</span>' : '') +
    '<span class="pill">' + i.type + '</span></span></summary><div class="body"><div class="cols">' +
    '<div><h4>Description</h4><div class="md">' + md(i.description) + '</div></div>' +
    '<div><h4>Acceptance criteria</h4><div class="md">' + md(i.acceptance) + '</div>' +
    (deps ? '<h4>Waits on</h4><div class="deps">' + deps + '</div>' : '') +
    (i.close_reason ? '<h4>Closed</h4><p class="md">' + esc(i.close_reason) + '</p>' : '') +
    '<div class="labels">' + i.labels.map((l) => '<span class="pill">' + esc(l) + '</span>').join('') + '</div></div>' +
    '</div></div></details></li>';
}
function render() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  const fms = document.getElementById('f-ms').value, fc = document.getElementById('f-class').value, fp = document.getElementById('f-p').value;
  const inTab = (i) => (tab === 'done') === (i.status === 'closed');
  const match = (i) => inTab(i) && (!fms || label(i, 'milestone') === fms) && (!fc || label(i, 'class') === fc) &&
    (!fp || String(i.priority) === fp) && (!q || (i.id + ' ' + i.title + ' ' + i.acceptance + ' ' + i.labels.join(' ')).toLowerCase().includes(q));
  document.getElementById('n-upcoming').textContent = items.filter((i) => i.status !== 'closed').length;
  document.getElementById('n-done').textContent = done.length;
  const order = (a, b) => (b.status === 'in_progress') - (a.status === 'in_progress') || a.priority - b.priority ||
    a.id.localeCompare(b.id, undefined, { numeric: true });
  let out = '';
  for (const e of epics) {
    const all = items.filter((i) => i.parent === e.id);
    const shown = all.filter(match).sort(tab === 'done' ? (a, b) => (b.closed_at || '').localeCompare(a.closed_at || '') : order);
    if (!shown.length) continue;
    const pct = all.length ? Math.round(100 * all.filter((i) => i.status === 'closed').length / all.length) : 0;
    const outcome = (e.description.split('## Outcome')[1] || '').split('\\n').map((s) => s.trim()).find(Boolean) || '';
    const [, num, name] = e.title.match(/^E(\\d+)\\s*[—-]\\s*(.*)$/) || [, '', e.title];
    out += '<details class="epic" open><summary><span class="eno">' + num + '</span><span><span class="etitle">' + esc(name) + '</span>' +
      (outcome ? '<span class="eoutcome">' + esc(outcome) + '</span>' : '') + '</span><span class="eprog">' + pct + '% of ' + all.length +
      ' done<span class="bar"><i style="width:' + pct + '%"></i></span></span></summary><ul class="rows">' + shown.map(row).join('') + '</ul></details>';
  }
  document.getElementById('list').innerHTML = out || '<p class="empty">' + (tab === 'done' ? 'Nothing is completed yet. Finished beads appear here after their PR merges.' : 'No items match these filters. Clear the search or pick "All" to see everything.') + '</p>';
}
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  render();
}));
['q', 'f-ms', 'f-class', 'f-p'].forEach((id) => document.getElementById(id).addEventListener('input', render));
document.getElementById('theme').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
});
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
render();
if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) { el.querySelector('details').open = true; el.scrollIntoView(); } }
</script>
</body>
</html>
`;

writeFileSync(out, html);
console.log(`wrote ${out} (${slim.length} issues)`);
