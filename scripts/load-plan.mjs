#!/usr/bin/env node
// Validates plan/*.json against docs/backlog-contract.md and loads them into beads.
//   node scripts/load-plan.mjs --check            validate only
//   node scripts/load-plan.mjs                    validate, create missing beads, wire deps
// Key → bead ID mapping is persisted in plan/id-map.json so re-runs are idempotent.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const PLAN_DIR = 'plan';
const MAP_FILE = join(PLAN_DIR, 'id-map.json');
const CHECK_ONLY = process.argv.includes('--check');

const TYPES = new Set(['feature', 'task', 'spike', 'decision', 'chore', 'bug']);
const MILESTONES = new Set(['m0', 'm1', 'm2', 'm3', 'm4', 'post-mvp']);
const AC_LINE = /^- AC-\d+ \[(unit|integration|e2e|perf|manual|content)\] /;
const HEADINGS = ['## Why', '## What', '## Scope'];

const files = readdirSync(PLAN_DIR).filter((f) => f.endsWith('.json') && f !== 'id-map.json').sort();
const plans = files.map((f) => ({ file: f, ...JSON.parse(readFileSync(join(PLAN_DIR, f), 'utf8')) }));

const errors = [];
const warnings = [];
const epics = new Map();
const items = new Map();

for (const p of plans) {
  for (const e of p.epics ?? []) {
    if (!/^mw-e\d{2}$/.test(e.id)) errors.push(`${p.file}: bad epic id ${e.id}`);
    if (epics.has(e.id)) errors.push(`${p.file}: duplicate epic ${e.id} (also in ${epics.get(e.id).file})`);
    if (!e.description?.includes('## Outcome')) warnings.push(`${e.id}: epic description missing "## Outcome"`);
    epics.set(e.id, { ...e, file: p.file });
  }
}
for (const p of plans) {
  for (const it of p.items ?? []) {
    const where = `${p.file}:${it.key}`;
    if (!/^e\d{2}-[a-z0-9-]+$/.test(it.key ?? '')) errors.push(`${where}: bad key`);
    if (items.has(it.key)) errors.push(`${where}: duplicate key (also in ${items.get(it.key).file})`);
    if (!epics.has(it.epic)) errors.push(`${where}: unknown epic ${it.epic}`);
    else if (it.key.slice(0, 3) !== it.epic.slice(3)) errors.push(`${where}: key prefix doesn't match epic ${it.epic}`);
    if (!TYPES.has(it.type)) errors.push(`${where}: bad type ${it.type}`);
    if (!(Number.isInteger(it.priority) && it.priority >= 0 && it.priority <= 4)) errors.push(`${where}: bad priority`);
    if (!it.title || it.title.length > 90) errors.push(`${where}: title missing or > 90 chars`);
    const labels = it.labels ?? [];
    if (!labels.includes(`epic:${it.epic?.slice(3)}`)) errors.push(`${where}: missing epic label`);
    if (!labels.some((l) => l.startsWith('area:'))) errors.push(`${where}: missing area label`);
    const ms = labels.filter((l) => l.startsWith('milestone:'));
    if (ms.length !== 1 || !MILESTONES.has(ms[0].slice(10))) errors.push(`${where}: needs exactly one valid milestone label`);
    for (const h of HEADINGS) if (!it.description?.includes(h)) errors.push(`${where}: description missing "${h}"`);
    const acs = (it.acceptance ?? '').split('\n').filter((l) => l.startsWith('- '));
    if (acs.length < 3) errors.push(`${where}: fewer than 3 ACs`);
    for (const l of acs) if (!AC_LINE.test(l)) errors.push(`${where}: malformed AC "${l.slice(0, 60)}"`);
    items.set(it.key, { ...it, file: p.file });
  }
}
// Extra cross-group edges: { "edges": [{ "from": key, "to": key }] } in any plan file.
for (const p of plans) {
  for (const e of p.edges ?? []) {
    const it = items.get(e.from);
    if (!it) errors.push(`${p.file}: edge from unknown key ${e.from}`);
    else (it.depends_on ??= []).includes(e.to) || it.depends_on.push(e.to);
  }
}
for (const it of items.values()) {
  for (const d of it.depends_on ?? []) {
    if (d === it.key) errors.push(`${it.file}:${it.key}: depends on itself`);
    else if (!items.has(d) && !epics.has(d)) errors.push(`${it.file}:${it.key}: unknown dependency ${d}`);
  }
}

// Priority/milestone inversions: an item must not wait on lower-priority or later-milestone work.
const MS_ORDER = ['m0', 'm1', 'm2', 'm3', 'm4', 'post-mvp'];
const msOf = (i) => MS_ORDER.indexOf((i.labels.find((l) => l.startsWith('milestone:')) ?? '').slice(10));
for (const it of items.values()) {
  for (const d of it.depends_on ?? []) {
    const dep = items.get(d);
    if (!dep) continue;
    if (dep.priority > it.priority) warnings.push(`inversion: ${it.key} (P${it.priority}) waits on ${d} (P${dep.priority})`);
    if (msOf(dep) > msOf(it)) warnings.push(`inversion: ${it.key} (${MS_ORDER[msOf(it)]}) waits on ${d} (${MS_ORDER[msOf(dep)]})`);
  }
}

// Cycle detection over item→item edges.
const state = new Map();
const visit = (k, stack) => {
  if (state.get(k) === 2) return;
  if (state.get(k) === 1) return errors.push(`dependency cycle: ${[...stack, k].join(' → ')}`);
  state.set(k, 1);
  for (const d of items.get(k).depends_on ?? []) if (items.has(d)) visit(d, [...stack, k]);
  state.set(k, 2);
};
for (const k of items.keys()) visit(k, []);

console.log(`${plans.length} plan files, ${epics.size} epics, ${items.size} items`);
for (const w of warnings) console.log(`warn: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`${errors.length} error(s)`);
  process.exit(1);
}
if (CHECK_ONLY) process.exit(0);

const idMap = existsSync(MAP_FILE) ? JSON.parse(readFileSync(MAP_FILE, 'utf8')) : {};
const bd = (args) => execFileSync('bd', args, { encoding: 'utf8' }).trim();
const save = () => writeFileSync(MAP_FILE, JSON.stringify(idMap, null, 2) + '\n');

for (const e of epics.values()) {
  if (idMap[e.id]) continue;
  bd(['create', '--id', e.id, '-t', 'epic', '--title', e.title, '-p', String(e.priority ?? 1),
    '-l', (e.labels ?? []).join(','), '-d', e.description ?? '', '--acceptance', e.acceptance ?? '', '--silent']);
  idMap[e.id] = e.id;
  save();
  console.log(`created ${e.id}`);
}
for (const it of items.values()) {
  if (idMap[it.key]) continue;
  const args = ['create', '--parent', it.epic, '-t', it.type, '--title', it.title, '-p', String(it.priority),
    '-l', it.labels.join(','), '-d', it.description, '--acceptance', it.acceptance,
    '--metadata', JSON.stringify({ key: it.key }), '--silent', '--no-inherit-labels'];
  if (it.estimate_minutes) args.push('-e', String(it.estimate_minutes));
  if (it.design) args.push('--design', it.design);
  idMap[it.key] = bd(args);
  save();
  console.log(`created ${idMap[it.key]}  ${it.key}`);
}

const existing = new Set();
for (const line of execFileSync('bd', ['export'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean)) {
  const issue = JSON.parse(line);
  for (const d of issue.dependencies ?? []) existing.add(`${issue.id}>${d.depends_on_id}`);
}
const edges = [];
for (const it of items.values()) {
  for (const d of it.depends_on ?? []) {
    const from = idMap[it.key];
    const to = idMap[d];
    if (!existing.has(`${from}>${to}`)) edges.push(JSON.stringify({ from, to, type: 'blocks' }));
  }
}
if (edges.length) {
  execFileSync('bd', ['dep', 'add', '--file', '-', '--quiet'], { input: edges.join('\n') + '\n', encoding: 'utf8' });
}
console.log(`wired ${edges.length} dependencies`);
