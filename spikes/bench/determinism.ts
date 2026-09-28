// mw-e00.13 AC-2: runs the committed 600-step physics input script (spikes/determinism/input-script.json)
// in several browsers and in Node, and compares final state hashes and snapshot/restore continuations.
//
//   node bench/determinism.ts                                  # chrome, chrome, firefox, webkit + node
//   node bench/determinism.ts --browsers chrome,brave,firefox  # any of chrome|brave|edge|chromium|firefox|webkit
//   --external Firefox,Safari                                  # real apps via `open -a`, results POSTed back
//   --headed firefox|all|none                                   # which browsers get a window (default firefox)
//
// Needs Playwright's Firefox/WebKit builds for those runs: pnpm exec playwright install firefox webkit
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox, webkit, type BrowserType } from 'playwright';
import type { RunResult } from '../determinism/src/script.ts';
import { SPIKES_DIR, chooseBrowser, machineInfo, parseArgs, run, serve, stamp } from './lib.ts';

const args = parseArgs(process.argv.slice(2));
const browserIds = (args.get('browsers') ?? 'chrome,chrome,firefox,webkit').split(',');
// Browsers to launch with a window. Playwright's Firefox 1543 exits with "Could not find profile folder"
// in headless mode on macOS 27 (seen 2026-09-28), so Firefox runs headed by default.
const headed = new Set((args.get('headed') ?? 'firefox').split(','));
const outDir = resolve(args.get('out') ?? join(SPIKES_DIR, 'bench/results'));
const log = (s: string): void => console.log(s);

if (args.get('no-build') !== 'true') run('pnpm --filter determinism build');

interface RuntimeRun {
  runtime: string;
  version: string;
  results: RunResult[];
  errors: string[];
}

// Real browsers opened with `open -a <App>` that post their results back (e.g. --external Firefox,Safari).
const externals = (args.get('external') ?? '').split(',').filter(Boolean);

const runs: RuntimeRun[] = [];
let onReport: ((body: unknown) => void) | null = null;
const server = await serve(join(SPIKES_DIR, 'determinism/dist'), (b) => onReport?.(b));
const types: Record<string, BrowserType> = { chromium, firefox, webkit };

for (const [i, id] of browserIds.entries()) {
  const choice = chooseBrowser(id);
  try {
  const browser = await types[choice.engine]!.launch({
    headless: !headed.has(id) && !headed.has('all'),
    ...(choice.executablePath ? { executablePath: choice.executablePath } : {}),
  });
  const page = await browser.newPage();
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => window.__determinism?.done, null, { timeout: 300_000 });
  const d = await page.evaluate(() => window.__determinism);
  const version = `${choice.label}${choice.appVersion ? ` ${choice.appVersion}` : ''} (${choice.engine} ${browser.version()})`;
  runs.push({ runtime: `${id}#${String(i + 1)}`, version, results: d.results, errors: d.errors });
  log(`${id}#${String(i + 1)} ${version}: ${d.results.map((r) => `${r.engine}=${r.finalHash}${r.restoreMatches ? ' (restore ok)' : ' (restore DIFFERS)'}`).join(', ')}${d.errors.length ? ` errors: ${d.errors.join('; ')}` : ''}`);
  await browser.close();
  } catch (e) {
    const msg = String(e).split('\n')[0] ?? String(e);
    runs.push({ runtime: `${id}#${String(i + 1)}`, version: choice.label, results: [], errors: [`launch/run failed: ${msg}`] });
    log(`${id}#${String(i + 1)} FAILED: ${msg}`);
  }
}
for (const app of externals) {
  const got = new Promise<Window['__determinism']>((res) => (onReport = (b) => res(b as Window['__determinism'])));
  const url = `${server.url}/index.html?report=${encodeURIComponent(app)}`;
  log(`Opening ${url} in ${app}; waiting for it to report (close the tab afterwards)…`);
  try {
    execFileSync('open', ['-a', app, url]);
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('no report within 5 min')), 300_000));
    const d = await Promise.race([got, timeout]);
    runs.push({ runtime: `${app} (external)`, version: d.userAgent, results: d.results, errors: d.errors });
    log(`${app}: ${d.results.map((r) => `${r.engine}=${r.finalHash}${r.restoreMatches ? ' (restore ok)' : ' (restore DIFFERS)'}`).join(', ')}`);
  } catch (e) {
    runs.push({ runtime: `${app} (external)`, version: app, results: [], errors: [String(e)] });
    log(`${app} FAILED: ${String(e)}`);
  }
}
await server.close();

// Node reference run (V8 outside a browser).
const nodeOut = JSON.parse(
  execFileSync(process.execPath, [join(SPIKES_DIR, 'determinism/src/node-run.ts')], { encoding: 'utf8', cwd: join(SPIKES_DIR, 'determinism') }),
) as { runtime: string; results: RunResult[] };
runs.push({ runtime: 'node', version: nodeOut.runtime, results: nodeOut.results, errors: [] });
log(`node ${nodeOut.runtime}: ${nodeOut.results.map((r) => `${r.engine}=${r.finalHash}`).join(', ')}`);

// ---------------------------------------------------------------- compare

const engines = [...new Set(runs.flatMap((r) => r.results.map((x) => x.engine)))];
const summary = engines.map((engine) => {
  const rs = runs.map((r) => ({ runtime: r.runtime, res: r.results.find((x) => x.engine === engine) }));
  const present = rs.filter((r) => r.res);
  const ref = present[0]?.res;
  const hashes = new Set(present.map((r) => r.res!.finalHash));
  const firstDivergence = present.map((r) => {
    const idx = r.res!.checkpoints.findIndex((h, i) => h !== ref?.checkpoints[i]);
    return { runtime: r.runtime, firstDivergentCheckpoint: idx < 0 ? null : (idx + 1) * 60 };
  });
  return {
    engine,
    runs: present.length,
    allFinalHashesMatch: hashes.size === 1,
    distinctFinalHashes: [...hashes],
    allRestoresMatch: present.every((r) => r.res!.restoreMatches === true),
    snapshotBytesIdentical: new Set(present.map((r) => r.res!.snapshotBytesHash)).size === 1,
    firstDivergence,
    missing: rs.filter((r) => !r.res).map((r) => r.runtime),
  };
});

const machine = machineInfo();
const md: string[] = [];
md.push('# Physics determinism check (mw-e00.13 AC-2)', '');
md.push(`- **Date:** ${new Date().toISOString()}`);
md.push(`- **Machine:** ${machine.model}, ${machine.chip}; ${machine.os}`);
md.push('- **Script:** `spikes/determinism/input-script.json` — 200 bodies, 600 steps of 1/60 s, 244 scripted impulses; snapshot before step 300; hash = FNV over float64 bits of position, rotation, linear and angular velocity of every body.');
md.push('');
md.push('## Summary', '');
md.push('| Engine | Runs | Final hashes match across runtimes | Snapshot/restore continuation identical | Snapshot bytes identical |');
md.push('|---|---|---|---|---|');
for (const s of summary) {
  md.push(
    `| ${s.engine} | ${String(s.runs)} | ${s.allFinalHashesMatch ? 'yes' : `NO (${s.distinctFinalHashes.join(', ')})`} | ${s.allRestoresMatch ? 'yes' : 'NO'} | ${s.engine === 'havok' ? 'n/a (no snapshot API)' : s.snapshotBytesIdentical ? 'yes' : 'no'} |`,
  );
}
md.push('', '## Runs', '');
md.push('| Runtime | Version | Engine | Final hash | Restore continuation | ms | Errors |');
md.push('|---|---|---|---|---|---|---|');
for (const r of runs) {
  for (const x of r.results) {
    md.push(`| ${r.runtime} | ${r.version} | ${x.engine} ${x.engineVersion} | \`${x.finalHash}\` | ${x.restoreMatches ? 'identical' : 'differs'} | ${String(Math.round(x.ms))} | |`);
  }
  if (r.errors.length) md.push(`| ${r.runtime} | ${r.version} | — | — | — | — | ${r.errors.join('; ')} |`);
}
md.push('', 'Restore methods:', '');
for (const e of engines) {
  const any = runs.flatMap((r) => r.results).find((x) => x.engine === e);
  if (any) md.push(`- **${e}:** ${any.restoreMethod}`);
}

mkdirSync(outDir, { recursive: true });
const base = join(outDir, `${stamp()}-determinism`);
writeFileSync(`${base}.json`, JSON.stringify({ machine, runs, summary }, null, 2) + '\n');
writeFileSync(`${base}.md`, md.join('\n') + '\n');
log(`\n${md.join('\n')}\n\nWrote ${base}.json and ${base}.md`);
