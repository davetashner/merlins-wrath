// mw-e00.13 benchmark harness. Builds each prototype, serves its production bundle, launches a real
// (headed) Chromium-family browser at a fixed window and records TTFF, frame-time percentiles, JS heap and
// bundle size. Engines run interleaved (round 1: A B C, round 2: B C A, …) so background noise hits all.
//
//   node bench/run.ts --preset official --browser chrome        # reference browser (contract §1)
//   node bench/run.ts --preset official --browser brave         # owner's daily browser
//   node bench/run.ts --preset quick --headless                 # smoke test of the harness itself
//
// Options (override the preset): --rounds N --warmup S --sample S --vsync on|off|both
//   --prototypes three-rapier,babylon-havok,babylon-rapier --load-threshold 3 --load-wait-min 0
//   --no-build --out DIR --window 1280x720 --screenshots false
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { BenchInfo, BenchSample } from '../shared/bench-hook.ts';
import {
  SPIKES_DIR,
  chooseBrowser,
  distSize,
  frameStats,
  loadGate,
  machineInfo,
  median,
  noise,
  parseArgs,
  round2,
  run,
  serve,
  sizeOf,
  stamp,
  type FrameStats,
  type NoiseSample,
  type SizeReport,
} from './lib.ts';

const PROTOTYPES: Record<string, { dist: string; page: string; label: string }> = {
  'three-rapier': { dist: 'engine-three/dist', page: 'index.html', label: 'Three.js + Rapier' },
  'babylon-havok': { dist: 'engine-babylon/dist-havok', page: 'index.html', label: 'Babylon.js + Havok' },
  'babylon-rapier': { dist: 'engine-babylon/dist-rapier', page: 'rapier.html', label: 'Babylon.js + Rapier' },
};

const PRESETS = {
  quick: { rounds: 1, warmup: 2, sample: 5, vsync: 'on' },
  official: { rounds: 3, warmup: 5, sample: 30, vsync: 'both' },
} as const;

const args = parseArgs(process.argv.slice(2));
const presetName = (args.get('preset') ?? 'quick') as keyof typeof PRESETS;
const preset = PRESETS[presetName];
if (!preset) throw new Error(`unknown preset ${presetName}`);
const rounds = Number(args.get('rounds') ?? preset.rounds);
const warmupS = Number(args.get('warmup') ?? preset.warmup);
const sampleS = Number(args.get('sample') ?? preset.sample);
const vsyncArg = args.get('vsync') ?? preset.vsync;
const vsyncModes: ('on' | 'off')[] = vsyncArg === 'both' ? ['on', 'off'] : [vsyncArg === 'off' ? 'off' : 'on'];
const protoIds = (args.get('prototypes') ?? Object.keys(PROTOTYPES).join(',')).split(',');
const headless = args.get('headless') === 'true';
const loadThreshold = Number(args.get('load-threshold') ?? 3);
const loadWaitMin = Number(args.get('load-wait-min') ?? 0);
const [winW, winH] = (args.get('window') ?? '1280x720').split('x').map(Number) as [number, number];
const browserChoice = chooseBrowser(args.get('browser') ?? 'chrome');
if (browserChoice.engine !== 'chromium') throw new Error('the frame benchmark needs a Chromium-family browser (heap via CDP)');
const outDir = resolve(args.get('out') ?? join(SPIKES_DIR, 'bench/results'));
const screenshots = args.get('screenshots') !== 'false';
const runBase = join(outDir, `${stamp()}-${browserChoice.id}-${presetName}${headless ? '-headless' : ''}`);
mkdirSync(outDir, { recursive: true });
const log = (s: string): void => console.log(s);

for (const id of protoIds) if (!PROTOTYPES[id]) throw new Error(`unknown prototype ${id}`);

if (args.get('no-build') !== 'true') {
  log('Building prototypes…');
  run('pnpm --filter engine-three --filter engine-babylon build');
}

interface RoundResult {
  round: number;
  vsync: 'on' | 'off';
  ttffMs: number;
  interval: FrameStats;
  cpu: FrameStats;
  gpu: FrameStats | null;
  heapUsedMB: number;
  heapTotalMB: number;
  cdpHeapUsedMB: number | null;
  loaded: SizeReport;
  noiseBefore: NoiseSample;
  noiseAfter: NoiseSample;
  noisy: boolean;
  consoleErrors: string[];
}

interface ProtoResult {
  id: string;
  label: string;
  dist: SizeReport;
  info: BenchInfo | null;
  rounds: RoundResult[];
}

const results: Record<string, ProtoResult> = {};
for (const id of protoIds) {
  results[id] = { id, label: PROTOTYPES[id]!.label, dist: distSize(join(SPIKES_DIR, PROTOTYPES[id]!.dist)), info: null, rounds: [] };
}
const servers = Object.fromEntries(
  await Promise.all(protoIds.map(async (id) => [id, await serve(join(SPIKES_DIR, PROTOTYPES[id]!.dist))] as const)),
);

const baseArgs = [
  `--window-size=${String(winW)},${String(winH + 80)}`,
  '--window-position=0,0',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--enable-precise-memory-info',
  '--ignore-gpu-blocklist',
  '--no-first-run',
  '--no-default-browser-check',
];
const uncappedArgs = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];

async function rafCadence(browser: Browser): Promise<number> {
  const ctx = await browser.newContext(headless ? { viewport: { width: winW, height: winH } } : { viewport: null });
  const page = await ctx.newPage();
  await page.setContent('<body style="background:#000"></body>');
  const ms = await page.evaluate(
    () =>
      new Promise<number>((res) => {
        const ts: number[] = [];
        const tick = (t: number): void => {
          ts.push(t);
          if (ts.length < 121) requestAnimationFrame(tick);
          else {
            const d = ts.slice(1).map((x, i) => x - ts[i]!).sort((a, b) => a - b);
            res(d[Math.floor(d.length / 2)]!);
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  await ctx.close();
  return round2(ms);
}

async function measure(browser: Browser, id: string, round: number, vsync: 'on' | 'off'): Promise<RoundResult> {
  const server = servers[id]!;
  const noiseBefore = noise();
  const noisy = await loadGate(loadThreshold, loadWaitMin, log);
  const ctx = await browser.newContext(headless ? { viewport: { width: winW, height: winH } } : { viewport: null });
  const page: Page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  server.served.clear();
  await page.goto(`${server.url}/${PROTOTYPES[id]!.page}`);
  await page.waitForFunction(() => window.__bench?.ready || (window.__bench?.errors.length ?? 0) > 0, null, { timeout: 180_000 });
  const boot = await page.evaluate(() => ({ ttff: window.__bench.ttffMs, errors: window.__bench.errors, info: window.__bench.info }));
  if (boot.errors.length) throw new Error(`${id} failed to boot: ${boot.errors.join('; ')}`);
  results[id]!.info ??= boot.info;
  const loaded = sizeOf([...server.served]);
  await page.waitForTimeout(warmupS * 1000);
  await page.evaluate(() => window.__bench.startSampling());
  await page.waitForTimeout(sampleS * 1000);
  const sample: BenchSample = await page.evaluate(() => window.__bench.stopSampling());
  const heap = await page.evaluate(() => window.__bench.heap());
  // One screenshot per prototype (first round, first vsync mode), after sampling so it cannot perturb it.
  if (screenshots && round === 1 && vsync === vsyncModes[0]) await page.screenshot({ path: `${runBase}-${id}.png` });
  let cdpHeapUsedMB: number | null = null;
  try {
    const h = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
    cdpHeapUsedMB = round2(h.usedSize / 2 ** 20);
  } catch {
    cdpHeapUsedMB = null;
  }
  await ctx.close();
  const r: RoundResult = {
    round,
    vsync,
    ttffMs: round2(boot.ttff ?? NaN),
    interval: frameStats(sample.intervals),
    cpu: frameStats(sample.cpu),
    gpu: sample.gpu.length ? frameStats(sample.gpu) : null,
    heapUsedMB: heap ? round2(heap.usedJSHeapSize / 2 ** 20) : NaN,
    heapTotalMB: heap ? round2(heap.totalJSHeapSize / 2 ** 20) : NaN,
    cdpHeapUsedMB,
    loaded,
    noiseBefore,
    noiseAfter: noise(),
    noisy,
    consoleErrors,
  };
  log(
    `  ${id.padEnd(15)} vsync ${vsync} r${String(round)}: p50 ${String(r.interval.p50)} p95 ${String(r.interval.p95)} p99 ${String(r.interval.p99)} ms | cpu p95 ${String(r.cpu.p95)} | gpu p95 ${String(r.gpu?.p95 ?? 'n/a')} | ttff ${String(r.ttffMs)} ms | heap ${String(r.heapUsedMB)} MB | load ${String(noiseBefore.load1)}→${String(r.noiseAfter.load1)}`,
  );
  return r;
}

const machine = machineInfo();
const cadence: Record<string, number> = {};
let browserVersion = '';
const started = new Date().toISOString();
log(`Machine: ${machine.model} ${machine.chip}, ${machine.os}; browser ${browserChoice.label}; preset ${presetName}`);

for (const vsync of vsyncModes) {
  const browser = await chromium.launch({
    headless,
    ...(browserChoice.executablePath ? { executablePath: browserChoice.executablePath } : {}),
    args: vsync === 'off' ? [...baseArgs, ...uncappedArgs] : baseArgs,
  });
  browserVersion = browser.version();
  cadence[vsync] = await rafCadence(browser);
  log(`vsync ${vsync}: empty-page rAF cadence ${String(cadence[vsync])} ms`);
  for (let round = 1; round <= rounds; round++) {
    const order = protoIds.map((_, i) => protoIds[(i + round - 1) % protoIds.length]!);
    for (const id of order) results[id]!.rounds.push(await measure(browser, id, round, vsync));
  }
  await browser.close();
}
await Promise.all(Object.values(servers).map((s) => s.close()));

// ---------------------------------------------------------------- aggregate + report

interface Summary {
  id: string;
  label: string;
  vsync: 'on' | 'off';
  rounds: number;
  p50: number;
  p95: number;
  p99: number;
  cpuP50: number;
  cpuP95: number;
  gpuP50: number | null;
  gpuP95: number | null;
  fps: number;
  over25pct: number;
  ttffMs: number;
  heapUsedMB: number;
  cdpHeapUsedMB: number | null;
  loadedCodeGzKB: number;
  loadedJsGzKB: number;
  distCodeGzKB: number;
  load1Min: number;
  load1Max: number;
  power: string;
  noisyRounds: number;
  consoleErrors: number;
}

const summaries: Summary[] = [];
for (const vsync of vsyncModes) {
  for (const id of protoIds) {
    const p = results[id]!;
    const rs = p.rounds.filter((r) => r.vsync === vsync);
    const loads = rs.flatMap((r) => [r.noiseBefore.load1, r.noiseAfter.load1]);
    summaries.push({
      id,
      label: p.label,
      vsync,
      rounds: rs.length,
      p50: median(rs.map((r) => r.interval.p50)),
      p95: median(rs.map((r) => r.interval.p95)),
      p99: median(rs.map((r) => r.interval.p99)),
      cpuP50: median(rs.map((r) => r.cpu.p50)),
      cpuP95: median(rs.map((r) => r.cpu.p95)),
      gpuP50: rs.every((r) => r.gpu) ? median(rs.map((r) => r.gpu!.p50)) : null,
      gpuP95: rs.every((r) => r.gpu) ? median(rs.map((r) => r.gpu!.p95)) : null,
      fps: median(rs.map((r) => r.interval.fps)),
      over25pct: median(rs.map((r) => r.interval.over25pct)),
      ttffMs: median(rs.map((r) => r.ttffMs)),
      heapUsedMB: median(rs.map((r) => r.heapUsedMB)),
      cdpHeapUsedMB: rs.every((r) => r.cdpHeapUsedMB !== null) ? median(rs.map((r) => r.cdpHeapUsedMB!)) : null,
      loadedCodeGzKB: median(rs.map((r) => r.loaded.codeGzKB)),
      loadedJsGzKB: median(rs.map((r) => r.loaded.jsGzKB)),
      distCodeGzKB: p.dist.codeGzKB,
      load1Min: Math.min(...loads),
      load1Max: Math.max(...loads),
      power: [...new Set(rs.map((r) => r.noiseBefore.power))].join('/'),
      noisyRounds: rs.filter((r) => r.noisy).length,
      consoleErrors: rs.reduce((n, r) => n + r.consoleErrors.length, 0),
    });
  }
}

const browserLine = `${browserChoice.label}${browserChoice.appVersion ? ` ${browserChoice.appVersion}` : ''} (Chromium ${browserVersion})`;
const report = {
  bead: 'mw-e00.13',
  started,
  finished: new Date().toISOString(),
  preset: presetName,
  settings: { rounds, warmupS, sampleS, vsyncModes, headless, window: `${String(winW)}x${String(winH)}`, loadThreshold, loadWaitMin },
  browser: { id: browserChoice.id, label: browserChoice.label, appVersion: browserChoice.appVersion, chromiumVersion: browserVersion },
  machine,
  rafCadenceMs: cadence,
  prototypes: results,
  summaries,
};

const md: string[] = [];
md.push(`# Engine spike benchmark (${presetName})`, '');
md.push(`- **Date:** ${started}`);
md.push(`- **Browser:** ${browserLine}${headless ? ' — HEADLESS (smoke only, not official)' : ''}`);
md.push(`- **Machine:** ${machine.model}, ${machine.chip}, ${String(machine.cores)} cores, ${String(machine.memoryGB)} GB`);
md.push(`- **OS:** ${machine.os}`);
md.push(`- **GPU:** ${machine.gpu}; WebGL: ${Object.values(results).find((r) => r.info)?.info?.gpu ?? 'n/a'}`);
md.push(`- **Display:** ${machine.display}`);
md.push(
  `- **Render size:** ${Object.values(results)
    .map((r) => `${r.id} ${String(r.info?.drawingBuffer.width)}×${String(r.info?.drawingBuffer.height)}`)
    .join(', ')}; window ${String(winW)}×${String(winH)} CSS px`,
);
md.push(`- **Method:** ${String(rounds)} interleaved round(s) per engine; ${String(warmupS)} s warm-up, ${String(sampleS)} s sampled; median across rounds.`);
md.push(
  `- **vsync:** ${vsyncModes
    .map((v) =>
      v === 'on'
        ? `on (default flags; frame interval capped at the display refresh, empty-page rAF ${String(cadence[v])} ms)`
        : 'off (--disable-gpu-vsync --disable-frame-rate-limit; uncapped, so the interval is real CPU+GPU throughput)',
    )
    .join('; ')}`,
);
md.push('');
md.push('Frame = interval between successive frame starts (rAF cadence). CPU = main-thread time inside the frame callback. GPU = EXT_disjoint_timer_query_webgl2 time of the frame’s GL commands (n/a when not exposed).');
md.push('Bundle = gzip -9 of JS + WASM actually fetched by the page (glTF model excluded, identical for all); dist = whole build output.');
md.push('');
for (const vsync of vsyncModes) {
  md.push(`## vsync ${vsync}`, '');
  md.push('| Prototype | Frame p50 / p95 / p99 ms | FPS | >25 ms | CPU p50 / p95 ms | GPU p50 / p95 ms | Bundle gz KB (JS) | dist gz KB | TTFF ms | JS heap MB | Noise: load1 min–max, power |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of summaries.filter((x) => x.vsync === vsync)) {
    md.push(
      `| ${s.label} | ${String(s.p50)} / ${String(s.p95)} / ${String(s.p99)} | ${String(s.fps)} | ${String(s.over25pct)}% | ${String(s.cpuP50)} / ${String(s.cpuP95)} | ${s.gpuP50 === null ? 'n/a' : `${String(s.gpuP50)} / ${String(s.gpuP95)}`} | ${String(s.loadedCodeGzKB)} (${String(s.loadedJsGzKB)}) | ${String(s.distCodeGzKB)} | ${String(s.ttffMs)} | ${String(s.heapUsedMB)}${s.cdpHeapUsedMB !== null ? ` (CDP ${String(s.cdpHeapUsedMB)})` : ''} | ${String(s.load1Min)}–${String(s.load1Max)}, ${s.power}${s.noisyRounds ? `, ${String(s.noisyRounds)} noisy` : ''}${s.consoleErrors ? `, ${String(s.consoleErrors)} console errors` : ''} |`,
    );
  }
  md.push('');
  md.push('<details><summary>Per round</summary>', '');
  md.push('| Prototype | Round | p50 / p95 / p99 ms | CPU p95 | TTFF | heap MB | load1 before→after |');
  md.push('|---|---|---|---|---|---|---|');
  for (const id of protoIds) {
    for (const r of results[id]!.rounds.filter((x) => x.vsync === vsync)) {
      md.push(
        `| ${results[id]!.label} | ${String(r.round)} | ${String(r.interval.p50)} / ${String(r.interval.p95)} / ${String(r.interval.p99)} | ${String(r.cpu.p95)} | ${String(r.ttffMs)} | ${String(r.heapUsedMB)} | ${String(r.noiseBefore.load1)}→${String(r.noiseAfter.load1)} |`,
      );
    }
  }
  md.push('', '</details>', '');
}

const base = runBase;
writeFileSync(`${base}.json`, JSON.stringify(report, null, 2) + '\n');
writeFileSync(`${base}.md`, md.join('\n') + '\n');
log(`\n${md.join('\n')}\nWrote ${base}.json and ${base}.md`);
