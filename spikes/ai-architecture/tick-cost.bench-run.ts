// mw-e11.1 AC-2: 50 agents run the scenario headless for 60 s of sim time; per-tick cost (mean and
// p95) of each candidate. Run with:
//   AI_SPIKE_BENCH=1 pnpm exec vitest run --config spikes/ai-architecture/vitest.config.ts
// Writes spikes/ai-architecture/results/tick-cost.json. The harness reads performance.now(); the sim
// never does.
import { writeFileSync } from 'node:fs';
import { cpus, loadavg, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { CANDIDATES } from './candidates';
import { crowd, ScenarioWorld, ticks } from './shared/world';

const AGENTS = 50;
const SECONDS = 60;
const WARMUP_SECONDS = 10;
const ROUNDS = 7;
const THINK_RATES = [10, 60] as const;

interface Stats {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

function stats(samples: number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] as number;
  return {
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: s[s.length - 1] as number,
  };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
};

function medianStats(rounds: Stats[]): Stats {
  const pick = (k: keyof Stats) => r3(median(rounds.map((r) => r[k] * 1000))); // µs
  return {
    mean: pick('mean'),
    p50: pick('p50'),
    p95: pick('p95'),
    p99: pick('p99'),
    max: pick('max'),
  };
}

it('AC-2: per-tick cost, 50 agents, 60 s of sim', () => {
  const now = () => performance.now();
  const results: Record<string, unknown>[] = [];
  const loadBefore = loadavg()[0];
  for (const hz of THINK_RATES) {
    const decision: Record<string, Stats[]> = {};
    const total: Record<string, Stats[]> = {};
    const perception: Record<string, Stats[]> = {};
    const transitions: Record<string, number[]> = {};
    const edges: Record<string, Record<string, number>> = {};
    for (let round = 0; round < ROUNDS; round++) {
      // Interleave candidates, rotating the order each round so background noise hits them equally.
      const order = CANDIDATES.map((_, i) => CANDIDATES[(i + round) % CANDIDATES.length]!);
      for (const c of order) {
        const world = new ScenarioWorld(c.make(hz), crowd(AGENTS, 100 + round));
        world.run(ticks(WARMUP_SECONDS));
        const d: number[] = [];
        const p: number[] = [];
        const t = { perception: 0, decision: 0, now };
        const changesBefore = world.changes.length;
        for (let i = 0; i < ticks(SECONDS); i++) {
          world.step(t);
          d.push(t.decision);
          p.push(t.perception);
        }
        (decision[c.key] ??= []).push(stats(d));
        (perception[c.key] ??= []).push(stats(p));
        (total[c.key] ??= []).push(stats(d.map((x, i) => x + (p[i] as number))));
        (transitions[c.key] ??= []).push(world.changes.length - changesBefore);
        const e = (edges[c.key] ??= {});
        for (const ch of world.changes.slice(changesBefore)) {
          const k = `${ch.from}>${ch.to}`;
          e[k] = (e[k] ?? 0) + 1;
        }
      }
    }
    for (const c of CANDIDATES) {
      results.push({
        candidate: c.key,
        label: c.label,
        thinkHz: hz,
        decisionUs: medianStats(decision[c.key]!),
        perceptionUs: medianStats(perception[c.key]!),
        totalUs: medianStats(total[c.key]!),
        alertTransitionsPerRun: median(transitions[c.key]!),
        alertEdgesAllRounds: edges[c.key],
      });
    }
  }
  const report = {
    bead: 'mw-e11.1',
    date: new Date().toISOString().slice(0, 10),
    machine: {
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memGb: Math.round(totalmem() / 2 ** 30),
      os: `${platform()} ${release()}`,
      node: process.version,
      loadAvg1mBefore: r3(loadBefore ?? 0),
      loadAvg1mAfter: r3(loadavg()[0] ?? 0),
    },
    method: {
      agents: AGENTS,
      simSeconds: SECONDS,
      ticksPerRound: ticks(SECONDS),
      warmupSeconds: WARMUP_SECONDS,
      rounds: ROUNDS,
      note: 'Per-tick wall time of ScenarioWorld.step: decision = think (at thinkHz, staggered by id) + act for every agent; perception = shared hearing/awareness. Each statistic is the median over rounds of the per-round value, in microseconds.',
    },
    results,
  };
  writeFileSync(
    new URL('./results/tick-cost.json', import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  expect(results).toHaveLength(CANDIDATES.length * THINK_RATES.length);
});
