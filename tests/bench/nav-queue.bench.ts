// mw-e11.4 AC-5: 30 path requests submitted in one tick with a 0.5 ms per-tick budget are spread
// over later ticks and all complete within 10 ticks, and a tick that spends its whole budget stays
// within 0.5 ms on the reference machine (backlog contract: M1 Pro). The budget is counted in polygon
// expansions (NAV_UNITS_PER_MS) so the sim stays deterministic; this holds the conversion to the
// time it stands for. Requests cross the grey-box testbed (room, corridor, arena, closet, ledge) with
// the humanoid and goblin locomotion profiles. Run with `pnpm bench`.
import { describe, expect, test } from 'vitest';
import { deriveNavAgent, loadGameContent, resolveLocomotion } from '@content/index';
import { navBudgetUnits, NavMesh, NavPathQueue, type NavPathRequest, type Vec3 } from '@sim/index';

const content = loadGameContent();
const mesh = new NavMesh(content.get('navmesh', 'testbed'));
const agents = ['humanoid', 'goblin'].map((id) =>
  deriveNavAgent(resolveLocomotion(content.get('locomotion', id), content)),
);
const SPOTS: readonly Vec3[] = [
  { x: 0, y: 0, z: -1 },
  { x: 0, y: 0, z: 28 },
  { x: -6, y: 0, z: 18 },
  { x: 6, y: 0, z: 25 },
  { x: 6, y: 0, z: 4 },
  { x: -3.5, y: 3, z: 4.5 },
  { x: 3, y: 0, z: 3 },
  { x: 0, y: 1, z: 29 },
];
const origin = { x: 0, y: 0, z: 0 };
const humanoid =
  agents[0] ?? deriveNavAgent(resolveLocomotion(content.get('locomotion', 'humanoid'), content));
const REQUESTS = 30;
const BUDGET_MS = 0.5;
const MAX_TICKS = 10;
const ROUNDS = 40;

function requests(round: number): NavPathRequest[] {
  return Array.from({ length: REQUESTS }, (_, n) => ({
    start: SPOTS[(n + round) % SPOTS.length] ?? origin,
    goal: SPOTS[(n * 3 + round + 1) % SPOTS.length] ?? origin,
    agent: agents[n % agents.length] ?? humanoid,
    doors: () => 'open' as const,
  }));
}

/** One round: submit 30, update until done; per-tick times (ms). */
function round(index: number) {
  const queue = new NavPathQueue(mesh, { unitsPerTick: navBudgetUnits(BUDGET_MS) });
  for (const r of requests(index)) queue.submit(r);
  const times: number[] = [];
  const full: number[] = [];
  let deferred = false;
  while (queue.pending > 0 && times.length < 100) {
    const start = performance.now();
    queue.update();
    const took = performance.now() - start;
    times.push(took);
    if (queue.lastUnits >= queue.unitsPerTick) full.push(took);
    if (times.length === 1) deferred = queue.pending > 0;
  }
  return { ticks: times.length, times, full, deferred };
}

describe('navmesh request queue', () => {
  test('AC-5: 30 requests at a 0.5 ms budget are deferred and all complete within 10 ticks', async ({
    bench,
  }) => {
    for (let n = 0; n < 5; n++) round(n); // warm up
    const ticks: number[] = [];
    const full: number[] = [];
    let deferred = 0;
    for (let n = 0; n < ROUNDS; n++) {
      const r = round(n);
      ticks.push(r.ticks);
      full.push(...r.full);
      if (r.deferred) deferred++;
    }
    await bench('30 requests, 0.5 ms budget', () => {
      round(0);
    }).run();
    const sorted = [...full].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? Infinity;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? Infinity;
    console.info(
      `nav queue: ${String(navBudgetUnits(BUDGET_MS))} units/tick; ticks to finish 30 requests ${String(Math.min(...ticks))}–${String(Math.max(...ticks))}; full-budget tick median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms over ${String(full.length)} ticks`,
    );
    expect(deferred).toBe(ROUNDS);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(MAX_TICKS);
    expect(median).toBeLessThanOrEqual(BUDGET_MS);
  });
});
