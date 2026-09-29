import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { VFX_PARTICLE_CAPS, VfxSystem } from '@game/vfx/index';
import {
  DEMO_COUNT,
  DEMO_EFFECTS,
  DEMO_REPEAT_SECONDS,
  demoPlacements,
  formatVfxStats,
  parseVfxParam,
  STRESS_COUNT,
  STRESS_EFFECT,
  VfxDemo,
} from './index.ts';

const CENTRE = { x: 10, y: 0, z: -5 };
const effects = loadGameContent().all('vfx-effect');

describe('?vfx parameter', () => {
  it('parses the modes', () => {
    expect(parseVfxParam('')).toBeUndefined();
    expect(parseVfxParam('?vfx')).toBe('stats');
    expect(parseVfxParam('?vfx=whatever')).toBe('stats');
    expect(parseVfxParam('?scene=testbed&vfx=demo')).toBe('demo');
    expect(parseVfxParam('?vfx=stress')).toBe('stress');
  });
});

describe('VFX demo', () => {
  it('AC-6: the demo spawns 20 test effects around the centre and keeps one-shots repeating', () => {
    const vfx = new VfxSystem({ effects, dev: false });
    const placed = demoPlacements('demo', CENTRE);
    expect(placed).toHaveLength(DEMO_COUNT);
    expect(new Set(placed.map((p) => p.effect))).toEqual(new Set(DEMO_EFFECTS));
    for (const { position } of placed) {
      expect(Math.hypot(position.x - CENTRE.x, position.z - CENTRE.z)).toBeCloseTo(3, 5);
    }
    const demo = new VfxDemo(vfx, 'demo', CENTRE);
    expect(demo.running).toBe(DEMO_COUNT);
    for (let t = 0; t < 3; t += 1 / 60) {
      vfx.update(1 / 60, CENTRE);
      demo.update(1 / 60);
    }
    // The sparks ended and were spawned again on the last repeat tick.
    expect(demo.running).toBeGreaterThanOrEqual(DEMO_COUNT - DEMO_EFFECTS.length);
    demo.update(DEMO_REPEAT_SECONDS);
    expect(demo.running).toBe(DEMO_COUNT);
    expect(vfx.stats().particles).toBeGreaterThan(0);
  });

  it('AC-7: the stress scene runs 50 effects that fill the High cap exactly', ({ task }) => {
    markExercised(task, 'vfx-effect', STRESS_EFFECT);
    const vfx = new VfxSystem({ effects, dev: false });
    expect(demoPlacements('stress', CENTRE)).toHaveLength(STRESS_COUNT);
    const demo = new VfxDemo(vfx, 'stress', CENTRE);
    expect(demo.running).toBe(STRESS_COUNT);
    expect(vfx.stats()).toMatchObject({ reserved: VFX_PARTICLE_CAPS.high, refused: 0 });
  });

  it('retries one-shots the budget refused; loops wait dormant with a handle', () => {
    const vfx = new VfxSystem({ effects, dev: false, caps: { high: 0, low: 0 } });
    const demo = new VfxDemo(vfx, 'demo', CENTRE);
    const oneShots = DEMO_COUNT / DEMO_EFFECTS.length; // the sparks
    expect(demo.running).toBe(DEMO_COUNT - oneShots);
    demo.update(DEMO_REPEAT_SECONDS);
    expect(demo.running).toBe(DEMO_COUNT - oneShots);
    expect(vfx.stats().refused).toBe(DEMO_COUNT + oneShots);
  });

  it('formats stats for the overlay', () => {
    const vfx = new VfxSystem({ effects, dev: false });
    expect(formatVfxStats(vfx.stats())).toBe(
      [
        'VFX high · particles 0 / reserved 0 / cap 2000',
        'effects 0 · dormant 0 · pooled 0 · allocated 0',
        'culled 0 · refused 0 · evicted 0 · missing 0',
      ].join('\n'),
    );
  });
});
