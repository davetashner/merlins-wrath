import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameContent, vfxEffectSchema, type VfxEffectDefInput } from '@content/index';
import { markExercised } from '@content/testing';
import type { EntityId, Vec3 } from '@sim/index';
import {
  VFX_INSTANCE_FLOATS,
  VFX_MARKER_SECONDS,
  VFX_MAX_MARKERS,
  VFX_MAX_STEP,
  VfxSystem,
  flipbookFrame,
  type VfxAnchor,
  type VfxBatch,
  type VfxSystemOptions,
} from './system.ts';
import { known } from './indexing.ts';

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
const DT = 1 / 60;

type EmitterInput = VfxEffectDefInput['emitters'][number];

const parse = (
  id: string,
  overrides: Partial<VfxEffectDefInput> = {},
  emitter: Partial<EmitterInput> = {},
) =>
  vfxEffectSchema.parse({
    id: `vfx-${id}`,
    notes: 'Test effect.',
    duration: 1,
    emitters: [
      {
        id: 'core',
        texture: 'vfx-spark-01',
        blend: 'additive',
        lifetime: { min: 0.5 },
        color: '#FF7A1A',
        ...emitter,
      },
    ],
    ...overrides,
  });

/** Test effects keep short ids (the runtime does not care; content requires `vfx-…`). */
const def = (...args: Parameters<typeof parse>) => ({ ...parse(...args), id: args[0] });

/** A one-shot burst of `count` particles living 0.1 s. */
const burst = (id: string, count: number, priority = 50) =>
  def(id, { duration: 0.05, priority }, { bursts: [{ at: 0, count }], lifetime: { min: 0.1 } });

/** A looping effect emitting `rate` per second, each particle living 1 s. */
const loop = (id: string, rate: number, priority = 50) =>
  def(id, { loop: true, priority }, { rate, lifetime: { min: 1 } });

function system(effects: VfxSystemOptions['effects'], options: Partial<VfxSystemOptions> = {}) {
  const warn = vi.fn();
  const vfx = new VfxSystem({ effects, dev: true, warn, ...options });
  return { vfx, warn };
}

function run(vfx: VfxSystem, seconds: number, camera: Vec3 = ORIGIN): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) vfx.update(DT, camera);
}

const batch = (vfx: VfxSystem, texture = 'vfx-spark-01'): VfxBatch =>
  known(vfx.batches.find((b) => b.texture === texture));

/** Particle `p` of a batch as a record. */
function particle(b: VfxBatch, p: number) {
  const o = p * VFX_INSTANCE_FLOATS;
  const [x, y, z, size, r, g, bl, a, frame] = b.data.slice(o, o + VFX_INSTANCE_FLOATS);
  return { x, y, z, size, r, g, b: bl, a, frame };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VfxSystem pooling', () => {
  it('AC-3: a pool warmed to 64 instances allocates nothing over 1000 spawn/expire cycles of 64', () => {
    const { vfx } = system([burst('hit', 4)]);
    vfx.warm('hit', 64);
    expect(vfx.allocations('hit')).toBe(64);
    for (let cycle = 0; cycle < 1000; cycle++) {
      for (let i = 0; i < 64; i++) {
        expect(
          vfx.spawn('hit', { position: { x: i % 8, y: 0, z: Math.floor(i / 8) } }),
        ).not.toBeNull();
      }
      vfx.update(DT, ORIGIN);
      expect(vfx.stats().particles).toBe(256);
      vfx.update(0.2, ORIGIN); // past every particle's life and the duration: all expire
      expect(vfx.stats().effects).toBe(0);
    }
    expect(vfx.allocations('hit')).toBe(64);
    expect(vfx.stats()).toMatchObject({ allocations: 64, idle: 64, reserved: 0 });
  });

  it('warming or counting an unknown effect is harmless', () => {
    const { vfx } = system([]);
    vfx.warm('nope', 4);
    expect(vfx.allocations('nope')).toBe(0);
    expect(vfx.has('nope')).toBe(false);
  });
});

describe('VfxSystem budget', () => {
  it('AC-4: an effect 70 m from the camera is culled without consuming budget', () => {
    const { vfx } = system([burst('hit', 10), loop('torch', 10)]);
    vfx.setCamera(ORIGIN);
    expect(vfx.spawn('hit', { position: { x: 70, y: 0, z: 0 } })).toBeNull();
    expect(vfx.stats()).toMatchObject({ culled: 1, reserved: 0, effects: 0, particles: 0 });

    // A looping effect out there waits dormant, still free, and starts when the camera comes near.
    const torch = vfx.spawn('torch', { position: { x: 70, y: 0, z: 0 } });
    expect(torch).not.toBeNull();
    vfx.update(DT, ORIGIN);
    expect(vfx.stats()).toMatchObject({ culled: 2, reserved: 0, dormant: 1, effects: 0 });
    vfx.update(DT, { x: 60, y: 0, z: 0 });
    expect(vfx.stats()).toMatchObject({ dormant: 0, effects: 1 });
    expect(vfx.stats().reserved).toBeGreaterThan(0);
    // Walking away again puts it back to sleep and frees its reservation.
    run(vfx, 0.5, { x: 60, y: 0, z: 0 });
    vfx.update(DT, { x: -10, y: 0, z: 0 });
    expect(vfx.stats()).toMatchObject({ dormant: 1, reserved: 0, particles: 0 });
    expect(vfx.alive(known(torch))).toBe(true);
  });

  it('nearer LOD bands reserve fewer particles', () => {
    const { vfx } = system([burst('hit', 40)]);
    vfx.spawn('hit', { position: ORIGIN });
    const near = vfx.stats().reserved;
    vfx.spawn('hit', { position: { x: 50, y: 0, z: 0 } });
    expect(vfx.stats().reserved - near).toBe(10); // 0.25 × 40
  });

  it('AC-2: when full, a higher-priority spawn culls lower-priority effects; an equal one is refused', () => {
    const caps = { high: 4000, low: 1500 };
    const { vfx } = system(
      [
        burst('small', 1500, 10),
        loop('ambient', 1499, 10),
        burst('big', 3000, 80),
        burst('peer', 1001, 10),
      ],
      { caps },
    );
    const small = vfx.spawn('small', { position: ORIGIN });
    const ambient = vfx.spawn('ambient', { position: ORIGIN }); // 1499 × 1 s + 1 = 1500
    expect(vfx.stats().reserved).toBe(3000);
    expect(vfx.spawn('peer', { position: ORIGIN })).toBeNull();
    expect(vfx.stats().refused).toBe(1);

    // 'big' needs 3000 with 1000 free: the older priority-10 effect goes first, then the next.
    const big = vfx.spawn('big', { position: ORIGIN });
    expect(big).not.toBeNull();
    expect(vfx.alive(known(small))).toBe(false); // a one-shot is gone
    expect(vfx.alive(known(ambient))).toBe(true); // a loop waits dormant
    expect(vfx.stats()).toMatchObject({ reserved: 3000, evicted: 2, dormant: 1, effects: 1 });

    // Once 'big' ends there is room again and the loop resumes.
    run(vfx, 0.3);
    expect(vfx.stats()).toMatchObject({ dormant: 0, effects: 1, reserved: 1500 });
  });

  it('a dormant loop re-admitted during update can cull effects before or after it in the list', () => {
    const { vfx } = system([burst('a', 900, 10), loop('glow', 1799, 90), burst('b', 900, 10)], {
      caps: { high: 2000, low: 800 },
    });
    const a = vfx.spawn('a', { position: ORIGIN });
    const glow = vfx.spawn('glow', { position: { x: 100, y: 0, z: 0 } }); // dormant: far away
    const b = vfx.spawn('b', { position: ORIGIN });
    expect(vfx.stats().reserved).toBe(1800);
    vfx.update(DT, { x: 90, y: 0, z: 0 }); // glow in range: needs 1800, culls a then b
    expect(vfx.alive(known(a))).toBe(false);
    expect(vfx.alive(known(b))).toBe(false);
    expect(vfx.alive(known(glow))).toBe(true);
    vfx.update(DT, { x: 90, y: 0, z: 0 });
    expect(vfx.stats()).toMatchObject({ effects: 1, dormant: 0, reserved: 1800, idle: 2 });
  });

  it('dropping to the Low tier lowers the cap, culls to fit and scales new spawns', () => {
    const { vfx } = system([loop('big', 999, 10), burst('hit', 100)]);
    vfx.spawn('big', { position: ORIGIN });
    expect(vfx.stats().reserved).toBe(1000);
    vfx.setTier('low');
    expect(vfx.tier).toBe('low');
    expect(vfx.stats()).toMatchObject({ tier: 'low', cap: 800, reserved: 0, dormant: 1 });
    vfx.spawn('hit', { position: ORIGIN });
    expect(vfx.stats().reserved).toBe(50); // lowRateScale 0.5
  });

  it('High-only emitters do not run on Low; an effect with nothing left gets no handle', () => {
    const highOnly = def('sparkle', {}, { rate: 10, minTier: 'high' });
    const mixed = {
      ...def('mixed', {}, { rate: 10 }),
      emitters: vfxEffectSchema.shape.emitters.parse([
        {
          id: 'base',
          texture: 'vfx-a',
          blend: 'alpha',
          rate: 10,
          lifetime: { min: 1 },
          color: '#000000',
        },
        {
          id: 'extra',
          texture: 'vfx-b',
          blend: 'additive',
          rate: 10,
          lifetime: { min: 1 },
          color: '#000000',
          minTier: 'high',
        },
      ]),
    };
    const { vfx } = system([highOnly, mixed], { tier: 'low' });
    expect(vfx.spawn('sparkle', { position: ORIGIN })).toBeNull();
    vfx.spawn('mixed', { position: ORIGIN });
    run(vfx, 0.5);
    expect(batch(vfx, 'vfx-a').count).toBeGreaterThan(0);
    expect(batch(vfx, 'vfx-b').count).toBe(0);
  });
});

describe('VfxSystem unknown effects', () => {
  it('AC-5: an unknown effect id returns a null handle, shows a magenta marker in dev builds and does not throw', () => {
    const { vfx, warn } = system([]);
    const position = { x: 1, y: 2, z: 3 };
    expect(() => vfx.spawn('no-such-effect', { position })).not.toThrow();
    expect(vfx.spawn('no-such-effect', { position })).toBeNull();
    expect(vfx.markers.count).toBe(2);
    expect([...vfx.markers.data.slice(0, 3)]).toEqual([1, 2, 3]);
    expect(warn).toHaveBeenCalledTimes(1); // once per id
    expect(warn).toHaveBeenCalledWith('vfx: unknown effect "no-such-effect"');
    expect(vfx.stats().missing).toBe(2);

    // Markers fade after a few seconds.
    run(vfx, VFX_MARKER_SECONDS - 0.1);
    expect(vfx.markers.count).toBe(2);
    run(vfx, 0.2);
    expect(vfx.markers.count).toBe(0);
  });

  it('AC-5: production builds show no marker', () => {
    const { vfx } = system([], { dev: false });
    expect(vfx.spawn('nope', { position: ORIGIN })).toBeNull();
    expect(vfx.markers.count).toBe(0);
  });

  it('markers go where the entity is, need a position, and the oldest is replaced when all are used', () => {
    const anchors = (entity: EntityId): VfxAnchor | undefined =>
      entity === 1 ? { position: { x: 5, y: 0, z: 0 } } : undefined;
    const { vfx } = system([], { anchors });
    vfx.spawn('nope', { entity: 1 });
    expect([...vfx.markers.data.slice(0, 3)]).toEqual([5, 0, 0]);
    vfx.spawn('nope', {});
    expect(vfx.markers.count).toBe(1);
    vfx.update(0.1, ORIGIN);
    for (let i = 1; i < VFX_MAX_MARKERS; i++)
      vfx.spawn('nope', { position: { x: 100 + i, y: 0, z: 0 } });
    expect(vfx.markers.count).toBe(VFX_MAX_MARKERS);
    vfx.update(0.1, ORIGIN);
    vfx.spawn('nope', { position: { x: 7, y: 7, z: 7 } }); // replaces the entity marker (oldest)
    expect(vfx.markers.count).toBe(VFX_MAX_MARKERS);
    expect([...vfx.markers.data.slice(0, 3)]).toEqual([7, 7, 7]);
    vfx.spawn('nope', { position: { x: 8, y: 8, z: 8 } }); // now the oldest is in slot 1
    expect([...vfx.markers.data.slice(3, 6)]).toEqual([8, 8, 8]);
    // Markers expire out of order: the survivors are compacted.
    run(vfx, VFX_MARKER_SECONDS - 0.05);
    expect(vfx.markers.count).toBe(2);
    expect([...vfx.markers.data.slice(0, 6)]).toEqual([7, 7, 7, 8, 8, 8]);
  });

  it('the default warning goes to the console', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const vfx = new VfxSystem({ effects: [] });
    vfx.spawn('nope', { position: ORIGIN });
    expect(spy).toHaveBeenCalledWith('vfx: unknown effect "nope"');
    expect(vfx.markers.count).toBe(1); // tests run as a dev build
  });

  it('a known effect with nowhere to be warns and returns null', () => {
    const { vfx, warn } = system([burst('hit', 1)]);
    expect(vfx.spawn('hit')).toBeNull();
    expect(vfx.spawn('hit', { entity: 9 })).toBeNull(); // no resolver: no entity
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a throwing anchor resolver is caught', () => {
    const { vfx, warn } = system([burst('hit', 1)], {
      anchors: () => {
        throw new Error('boom');
      },
    });
    expect(vfx.spawn('hit', { entity: 1 })).toBeNull();
    expect(warn).toHaveBeenCalledWith('vfx: spawning "hit" failed (Error: boom)');
  });
});

describe('VfxSystem emission and particles', () => {
  it('emits at its rate, then stops at the end of its duration and expires', () => {
    const { vfx } = system([def('puff', { duration: 0.5 }, { rate: 60, lifetime: { min: 0.25 } })]);
    const handle = known(vfx.spawn('puff', { position: ORIGIN }));
    run(vfx, 0.2);
    expect(vfx.stats().particles).toBeGreaterThanOrEqual(11); // 60/s × 0.2 s, less rounding
    expect(vfx.stats().particles).toBeLessThanOrEqual(12);
    run(vfx, 0.6); // emission ends at 0.5 s, the last particles die by 0.75 s
    expect(vfx.stats().particles).toBe(0);
    expect(vfx.alive(handle)).toBe(false);
    expect(vfx.stats().reserved).toBe(0);
  });

  it('looping bursts repeat every period; intensity scales them', () => {
    const effect = def(
      'pulse',
      { loop: true, duration: 0.5 },
      {
        bursts: [
          { at: 0, count: 10 },
          { at: 0.25, count: 4 },
        ],
        lifetime: { min: 2 },
      },
    );
    const { vfx } = system([effect]);
    vfx.spawn('pulse', { position: ORIGIN });
    vfx.update(DT, ORIGIN);
    expect(vfx.stats().particles).toBe(10);
    run(vfx, 0.3);
    expect(vfx.stats().particles).toBe(14);
    run(vfx, 0.3);
    expect(vfx.stats().particles).toBe(24);
    const weak = system([effect]).vfx;
    weak.spawn('pulse', { position: ORIGIN, params: { intensity: 0.5 } });
    weak.update(DT, ORIGIN);
    expect(weak.stats().particles).toBe(5);
    expect(weak.spawn('pulse', { position: ORIGIN, params: { intensity: -1 } })).toBeNull();
    weak.spawn('pulse', { position: ORIGIN, params: { intensity: 7 } }); // clamped to 1
    weak.update(DT, ORIGIN);
    expect(weak.stats().particles).toBe(15);
  });

  it('never exceeds its reservation, even when a frame is huge', () => {
    const { vfx } = system([def('fast', { loop: true }, { rate: 100, lifetime: { min: 0.5 } })]);
    vfx.spawn('fast', { position: ORIGIN });
    const reserved = vfx.stats().reserved;
    vfx.update(10, ORIGIN); // clamped to VFX_MAX_STEP
    expect(vfx.stats().particles).toBe(VFX_MAX_STEP * 100);
    for (let i = 0; i < 100; i++) {
      vfx.update(DT, ORIGIN);
      expect(vfx.stats().particles).toBeLessThanOrEqual(reserved);
    }
    vfx.update(-1, ORIGIN); // negative time does nothing
  });

  it('writes position, size, colour, alpha and frame per particle', () => {
    const effect = def(
      'mote',
      { duration: 0.1 },
      {
        bursts: [{ at: 0, count: 1 }],
        lifetime: { min: 1 },
        speed: { min: 2 },
        gravity: 0,
        size: [
          { t: 0, v: 1 },
          { t: 1, v: 0 },
        ],
        color: '#FF0000',
        alpha: 0.5,
      },
    );
    const { vfx } = system([effect]);
    vfx.spawn('mote', { position: { x: 1, y: 2, z: 3 }, scale: 2 });
    vfx.update(0.1, ORIGIN); // emitted this frame, at age 0
    let p = particle(batch(vfx), 0);
    expect(p).toMatchObject({ x: 1, y: 2, z: 3, size: 2, r: 1, g: 0, b: 0, a: 0.5, frame: 0 });
    vfx.update(0.25, ORIGIN);
    p = particle(batch(vfx), 0);
    expect(p.y).toBeCloseTo(2 + 2 * 2 * 0.25, 5); // straight up at speed × scale
    expect(p.size).toBeCloseTo(2 * 0.75, 1);
  });

  it('launches along the effect’s rotated up axis, with gravity and drag', () => {
    const effect = def(
      'jet',
      { duration: 0.1 },
      {
        bursts: [{ at: 0, count: 8 }],
        lifetime: { min: 5 },
        speed: { min: 1 },
        gravity: 1,
        drag: 0.5,
      },
    );
    const { vfx } = system([effect]);
    // Rotated 180° about x: up becomes down.
    vfx.spawn('jet', { position: ORIGIN, rotation: { x: 1, y: 0, z: 0, w: 0 } });
    vfx.update(DT, ORIGIN);
    run(vfx, 0.5);
    const b = batch(vfx);
    for (let i = 0; i < b.count; i++) {
      const { x, y, z } = particle(b, i);
      expect(y).toBeLessThan(-0.3);
      expect(Math.abs(known(x)) + Math.abs(known(z))).toBeLessThan(1e-5);
    }
  });

  it('a world rotation ignores the anchor entity’s own rotation (e.g. turned to a hit normal)', () => {
    const effect = def(
      'jet',
      { duration: 0.1 },
      { bursts: [{ at: 0, count: 4 }], lifetime: { min: 5 }, speed: { min: 1 } },
    );
    // The entity is turned 180° about y; the effect is turned 90° about z (up becomes -x).
    const anchors = (): VfxAnchor => ({ position: ORIGIN, rotation: { x: 0, y: 1, z: 0, w: 0 } });
    const turn = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
    const directions = (worldRotation: boolean) => {
      const { vfx } = system([effect], { anchors });
      vfx.spawn('jet', { entity: 3, rotation: turn, worldRotation });
      run(vfx, 0.5);
      const { x, y } = particle(batch(vfx), 0) as { x: number; y: number };
      return { x: Math.sign(Math.round(x * 100)) + 0, y: Math.sign(Math.round(y * 100)) + 0 };
    };
    expect(directions(true)).toEqual({ x: -1, y: 0 });
    expect(directions(false)).toEqual({ x: 1, y: 0 });
  });

  it('spawns within the spawn radius and in every direction for a 180° cone', () => {
    const effect = def(
      'cloud',
      { duration: 0.1 },
      {
        bursts: [{ at: 0, count: 200 }],
        lifetime: { min: 5 },
        spawnRadius: 1,
        coneDeg: 180,
        speed: { min: 0.001 },
      },
    );
    const { vfx } = system([effect]);
    vfx.spawn('cloud', { position: ORIGIN });
    vfx.update(DT, ORIGIN);
    const b = batch(vfx);
    let below = 0;
    for (let i = 0; i < b.count; i++) {
      const { x, y, z } = particle(b, i) as { x: number; y: number; z: number };
      expect(Math.hypot(x, y, z)).toBeLessThanOrEqual(1.0001);
      if (y < 0) below++;
    }
    expect(below).toBeGreaterThan(50);
  });

  it('flipbook frames play by fps or once over the particle’s life', () => {
    expect(flipbookFrame({ frames: 1, fps: 0 }, 0.5, 0.5, 0.3)).toBe(0);
    expect(flipbookFrame({ frames: 16, fps: 0 }, 0.5, 0.5, 0.3)).toBe(8);
    expect(flipbookFrame({ frames: 16, fps: 0 }, 1, 1, 0.3)).toBe(15);
    expect(flipbookFrame({ frames: 16, fps: 12 }, 1, 0.2, 0)).toBe(12);
    expect(flipbookFrame({ frames: 16, fps: 12 }, 2, 0.4, 0)).toBe(8);
  });

  it('uses its own presentation RNG: the same seed gives the same particles', () => {
    const effect = def(
      'cloud',
      { duration: 0.1 },
      {
        bursts: [{ at: 0, count: 20 }],
        lifetime: { min: 5 },
        coneDeg: 90,
        speed: { min: 1, max: 3 },
      },
    );
    const positions = (seed: number) => {
      const { vfx } = system([effect], { seed });
      vfx.spawn('cloud', { position: ORIGIN });
      run(vfx, 0.5);
      const b = batch(vfx);
      return [...b.data.slice(0, b.count * VFX_INSTANCE_FLOATS)];
    };
    expect(positions(7)).toEqual(positions(7));
    expect(positions(7)).not.toEqual(positions(8));
  });
});

describe('VfxSystem handles and sockets', () => {
  it('follows an entity socket, and finishes when the entity goes away', () => {
    let where: VfxAnchor | undefined = {
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    };
    const sockets: (string | undefined)[] = [];
    const anchors = (_: EntityId, socket: string | undefined) => {
      sockets.push(socket);
      return where;
    };
    const effect = def(
      'aura',
      { loop: true, socket: 'chest' },
      { rate: 30, lifetime: { min: 0.3 } },
    );
    const { vfx } = system([effect], { anchors });
    const handle = known(vfx.spawn('aura', { entity: 4 }));
    vfx.spawn('aura', { entity: 4, socket: 'hand-r' });
    expect(sockets).toEqual(['chest', 'hand-r']);
    run(vfx, 0.2);
    where = { position: { x: 5, y: 0, z: 0 } };
    run(vfx, 0.1);
    const b = batch(vfx);
    const last = particle(b, b.count - 1);
    expect(last.x).toBeCloseTo(5, 5);
    where = undefined;
    run(vfx, 0.5);
    expect(vfx.alive(handle)).toBe(false);
    expect(vfx.stats().effects).toBe(0);
  });

  it('stop lets particles finish, kill removes at once, stale handles are ignored', () => {
    const { vfx } = system([loop('torch', 30), loop('far', 30)]);
    const a = known(vfx.spawn('torch', { position: ORIGIN }));
    const b = known(vfx.spawn('torch', { position: ORIGIN }));
    const far = known(vfx.spawn('far', { position: { x: 100, y: 0, z: 0 } }));
    run(vfx, 0.5);
    vfx.stop(a);
    vfx.update(DT, ORIGIN);
    expect(vfx.alive(a)).toBe(true); // particles still alive
    run(vfx, 1.1);
    expect(vfx.alive(a)).toBe(false);
    vfx.kill(b);
    expect(vfx.alive(b)).toBe(false);
    vfx.stop(far); // dormant: ends at once
    expect(vfx.alive(far)).toBe(false);
    vfx.stop(a);
    vfx.kill(a);
    vfx.update(DT, ORIGIN);
    expect(vfx.stats()).toMatchObject({ effects: 0, dormant: 0, particles: 0, reserved: 0 });
  });

  it('a dormant loop whose entity is gone ends', () => {
    let where: VfxAnchor | undefined = { position: { x: 100, y: 0, z: 0 } };
    const { vfx } = system([loop('torch', 10)], { anchors: () => where });
    const handle = known(vfx.spawn('torch', { entity: 1 }));
    vfx.update(DT, ORIGIN);
    expect(vfx.stats().dormant).toBe(1);
    where = undefined;
    vfx.update(DT, ORIGIN);
    expect(vfx.alive(handle)).toBe(false);
  });
});

describe('vfx-effect content', () => {
  it('every effect spawns, emits within its reservation and ends when stopped', ({ task }) => {
    const effects = loadGameContent().all('vfx-effect');
    const { vfx, warn } = system(effects);
    for (const effect of effects) {
      markExercised(task, 'vfx-effect', effect.id);
      const handle = vfx.spawn(effect.id, { position: ORIGIN });
      expect(handle, effect.id).not.toBeNull();
      // Until the first particles show (short-lived impact sparks are gone within half a second).
      for (let t = 0; t < 0.5 && vfx.stats().particles === 0; t += DT) vfx.update(DT, ORIGIN);
      expect(vfx.stats().particles, effect.id).toBeGreaterThan(0);
      expect(vfx.stats().particles).toBeLessThanOrEqual(vfx.stats().reserved);
      vfx.stop(known(handle));
      run(vfx, 5);
      expect(vfx.alive(known(handle)), effect.id).toBe(false);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});
