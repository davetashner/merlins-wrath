// mw-e02.20 AC-7: animation update cost for 24 animated characters over 30 s. Half the crowd stands
// beyond 30 m of the camera and updates at the reduced LOD rate. Every character loops idle → move →
// attack → hit-react through sim state (the testbed's animation demo), so base blends, masked action
// layers, additive hit reactions and crossfades are all exercised. Only the animation work of each
// frame is timed — AnimationDriver.frame(): parameter interpolation, controller updates, pose
// evaluation and copying poses into the grey-box bones — not the sim step or rendering. Budget:
// p95 ≤ 1.5 ms per frame on the reference machine (High); CI runners are slower, so this is a
// ceiling, not a measurement. Run with `pnpm bench`.
import { describe, expect, test } from 'vitest';
import { loadGameContent } from '@content/index';
import { RenderSync } from '@game/loop/render-sync';
import { World } from '@sim/index';
import {
  setupAnimationDemo,
  TESTBED_ANIM_DEMO,
  type AnimDemoCharacter,
} from '@tools/anim-demo/setup';

const CHARACTERS = 24;
const SECONDS = 30;
const BUDGET_MS = 1.5;

/** 24 demo characters: rows of humanoids and beasts, every other one 40 m away. */
function crowd(): AnimDemoCharacter[] {
  return Array.from({ length: CHARACTERS }, (_, i) => {
    const template = TESTBED_ANIM_DEMO[i % TESTBED_ANIM_DEMO.length];
    if (template === undefined) throw new Error('no demo template');
    const far = i % 2 === 1;
    return { ...template, at: { x: (i % 6) * 2, y: 0, z: (far ? 40 : 4) + Math.floor(i / 6) * 2 } };
  });
}

describe('animation update', () => {
  test('mw-e02.20 AC-7: 24 characters (beyond 30 m at reduced rate) cost ≤ 1.5 ms per frame p95 over 30 s', () => {
    const world = new World({ seed: 1 });
    const sync = new RenderSync(world);
    const demo = setupAnimationDemo({
      world,
      sync,
      content: loadGameContent(),
      characters: crowd(),
      binding: (object, read) => ({
        object,
        read,
        apply: (o, t) => o.position.set(t.position.x, t.position.y, t.position.z),
        dispose: () => undefined,
      }),
    });
    const focus = { x: 5, y: 1.6, z: 0 };
    const costs: number[] = [];
    let deferred = 0;
    for (let frame = 0; frame < SECONDS * 60; frame++) {
      world.step();
      sync.capture();
      demo.driver.capture();
      sync.render(0.5);
      const start = performance.now();
      demo.driver.frame(0.5, 1 / 60, focus);
      costs.push(performance.now() - start);
      deferred += demo.driver.lastFrame.deferred;
    }
    costs.sort((a, b) => a - b);
    const p95 = costs[Math.floor(costs.length * 0.95)] ?? Infinity;
    console.log(
      `[perf] animation frame p50/p95 ${String(costs[costs.length >> 1]?.toFixed(3))}/${p95.toFixed(3)} ms for ${String(CHARACTERS)} characters`,
    );
    // The far half really ran at the reduced rate: 3 of every 4 of their frames were skipped.
    expect(deferred).toBe((CHARACTERS / 2) * SECONDS * 60 * 0.75);
    expect(p95).toBeLessThanOrEqual(BUDGET_MS);
  });
});
