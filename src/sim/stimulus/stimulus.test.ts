import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  addProperties,
  getProperty,
  propertyChanged,
  registerWorldProperties,
  type PropertyChange,
  type WorldPropertyInit,
} from '../properties/components';
import { hashWorld } from '../snapshot';
import { recordStimulusLog } from './log';
import { placeEntity, setPlacementCentre } from './placement';
import { ORIGIN, STIMULUS_EDGE_FALLOFF, type Vec3 } from './shapes';
import {
  applyStimulus,
  ImpactResisted,
  impulseApplied,
  installStimuli,
  normalizeStimulus,
  pendingStimuli,
  resolveStimuli,
  STIMULUS_ELEMENTS,
  stimulusSystem,
  type ImpactResistance,
  type ImpulseApplied,
  type StimulusInput,
} from './stimulus';

const v = (x: number, y = 0, z = 0): Vec3 => ({ x, y, z });

function world(hz?: number) {
  const options = hz === undefined ? { seed: 1 } : { seed: 1, hz };
  return installStimuli(registerWorldProperties(new World<string>(options)));
}

/** Spawns an entity with properties, placed at `at` unless it is null. */
function thing(w: World<string>, init: WorldPropertyInit, at: Vec3 | null = ORIGIN, radius = 0) {
  const id = w.spawn();
  addProperties(w, id, init);
  if (at !== null) placeEntity(w, id, at, radius);
  return id;
}

function changes(w: World<string>): PropertyChange[] {
  const seen: PropertyChange[] = [];
  w.events.on(propertyChanged, (change) => seen.push(change));
  return seen;
}

function impulses(w: World<string>): ImpulseApplied[] {
  const seen: ImpulseApplied[] = [];
  w.events.on(impulseApplied, (impulse) => seen.push(impulse));
  return seen;
}

/** Applies each stimulus, resolves them and delivers the events. */
function run(w: World<string>, ...stimuli: StimulusInput[]): void {
  for (const stimulus of stimuli) applyStimulus(w, stimulus);
  resolveStimuli(w);
  w.events.flush();
}

const heatBall = (radius: number, intensity = 100): StimulusInput => ({
  shape: { kind: 'sphere', center: ORIGIN, radius },
  element: 'heat',
  intensity,
});

describe('applyStimulus / resolveStimuli', () => {
  it('AC-1: a 2 m heat sphere heats every entity with temperature within 2 m by the documented falloff, none outside', () => {
    const w = world();
    const centre = thing(w, { temperature: 20 }, ORIGIN);
    const mid = thing(w, { temperature: 20 }, v(1));
    const rim = thing(w, { temperature: 20 }, v(0, 2));
    const big = thing(w, { temperature: 20 }, v(0, 0, 2.8), 1); // surface 1.8 m away
    const outside = thing(w, { temperature: 20 }, v(2.5));
    const noTemperature = thing(w, { wetness: 0 }, v(0.5));
    const unplaced = thing(w, { temperature: 20 }, null);
    const seen = changes(w);
    run(w, heatBall(2));
    const linear = (d: number) => 1 - (1 - STIMULUS_EDGE_FALLOFF) * (d / 2);
    expect(getProperty(w, centre, 'temperature')).toBe(120);
    expect(getProperty(w, mid, 'temperature')).toBe(20 + 100 * linear(1));
    expect(getProperty(w, rim, 'temperature')).toBe(20 + 100 * STIMULUS_EDGE_FALLOFF);
    expect(getProperty(w, big, 'temperature')).toBeCloseTo(20 + 100 * linear(1.8), 10);
    expect(getProperty(w, outside, 'temperature')).toBe(20);
    expect(getProperty(w, unplaced, 'temperature')).toBe(20);
    expect(getProperty(w, noTemperature, 'temperature')).toBeUndefined();
    expect(seen.map((c) => c.entity)).toEqual([centre, mid, rim, big]);
  });

  it('AC-2: stimuli applied in the same tick in either order resolve to identical state', () => {
    const scene = (order: 'ab' | 'ba') => {
      const w = world();
      const a = thing(w, { temperature: 9_950, wetness: 0.8, charge: 0 }, ORIGIN);
      const b = thing(w, { temperature: 20, wetness: 0 }, v(1));
      const log = recordStimulusLog(w);
      const seen = changes(w);
      // Clamping makes the result depend on resolution order (heat then cold ≠ cold then heat),
      // so equality here proves the order is canonical rather than issue order.
      const heat = { ...heatBall(3, 200), source: a };
      const cold: StimulusInput = {
        shape: { kind: 'capsule', from: v(-1), to: v(2), radius: 1 },
        element: 'cold',
        intensity: 100,
        source: b,
      };
      const soak: StimulusInput = {
        shape: { kind: 'box', center: ORIGIN, halfExtents: v(2, 2, 2) },
        element: 'water',
        intensity: 0.5,
        duration: 0.05, // carried over in the queue for two more ticks
      };
      const stimuli = order === 'ab' ? [heat, soak, cold] : [cold, soak, heat];
      run(w, ...stimuli);
      return { hash: hashWorld(w), log: log.entries, seen };
    };
    const ab = scene('ab');
    const ba = scene('ba');
    expect(ba.hash).toBe(ab.hash);
    expect(ba.log).toEqual(ab.log);
    expect(ba.seen).toEqual(ab.seen);
  });

  it('AC-3: a force stimulus delivers an impulse proportional to intensity / weight to a pushable object', () => {
    const w = world();
    const crate = thing(w, { pushable: true, weight: 10 }, v(1));
    const barrel = thing(w, { liftable: true, weight: 20 }, v(-1));
    thing(w, { pushable: false, weight: 10 }, v(0, 1)); // anchored
    thing(w, { pushable: true, weight: 0 }, v(0, -1)); // massless: nothing to push
    thing(w, { pushable: true, weight: 10 }, ORIGIN); // at the centre: no direction
    const seen = impulses(w);
    const log = recordStimulusLog(w);
    run(w, {
      shape: { kind: 'sphere', center: ORIGIN, radius: 2 },
      element: 'force',
      intensity: 50,
      falloff: 'none',
      source: crate,
    });
    expect(seen).toEqual([
      { entity: crate, impulse: v(50), velocityChange: v(5), source: crate },
      { entity: barrel, impulse: v(-50), velocityChange: v(-2.5), source: crate },
    ]);
    expect(log.entries[0]?.hits.map((hit) => hit.entity)).toEqual([crate, barrel]);
  });

  it('mw-e04.14: a bashable thing is pushed too; a force with a maxWeight moves nothing heavier', () => {
    const w = world();
    const barrel = thing(w, { bashable: true, weight: 30 }, v(1));
    const limit = thing(w, { pushable: true, weight: 60 }, v(-1));
    const crate = thing(w, { pushable: true, weight: 100 }, v(0, 0, 1));
    const seen = impulses(w);
    const resisted: ImpactResistance[] = [];
    w.events.on(ImpactResisted, (e) => resisted.push(e));
    const log = recordStimulusLog(w);
    run(w, {
      shape: { kind: 'sphere', center: ORIGIN, radius: 2 },
      element: 'force',
      intensity: 150,
      falloff: 'none',
      direction: v(0, 0, 1),
      maxWeight: 60,
    });
    expect(seen).toEqual([
      { entity: barrel, impulse: v(0, 0, 150), velocityChange: v(0, 0, 5), source: null },
      { entity: limit, impulse: v(0, 0, 150), velocityChange: v(0, 0, 2.5), source: null },
    ]);
    expect(resisted).toEqual([
      { tick: 0, entity: crate, weight: 100, maxWeight: 60, impulse: v(0, 0, 150), source: null },
    ]);
    // The crate is not among the hits: nothing pushed it.
    expect(log.entries[0]?.hits.map((hit) => hit.entity)).toEqual([barrel, limit]);
  });

  it('mw-e04.14: a stimulus that spares its source never reaches it, by shape or by contact', () => {
    const w = world();
    const knight = thing(w, { pushable: true, weight: 90 }, v(0.5));
    const barrel = thing(w, { pushable: true, weight: 30 }, v(1));
    const seen = impulses(w);
    const shove = (shape: StimulusInput['shape']): StimulusInput => ({
      shape,
      element: 'force',
      intensity: 30,
      falloff: 'none',
      direction: v(1),
      source: knight,
      sparesSource: true,
    });
    run(
      w,
      shove({ kind: 'sphere', center: ORIGIN, radius: 2 }),
      shove({ kind: 'contact', target: knight }),
    );
    expect(seen.map((i) => i.entity)).toEqual([barrel]);
  });

  it('mw-e04.34: a placement centre is what a force reaches and pushes, not the frame origin', () => {
    const w = world();
    const seen = impulses(w);
    // A character: placed at its feet, its capsule's bounding sphere 0.9 m up.
    const knight = thing(w, { pushable: true, weight: 90 }, v(2), 0.35);
    setPlacementCentre(w, knight, v(0, 0.9), 0.9);
    // A crate with the same placement and no centre.
    const crate = thing(w, { pushable: true, weight: 90 }, v(-2), 0.35);
    w.step();
    // A blast on the ground between them, reaching 1.6 m: the crate's sphere is 1.65 m away (out of
    // reach), the knight's body about 1.29 m.
    run(w, {
      shape: { kind: 'sphere', center: ORIGIN, radius: 1.6 },
      element: 'force',
      intensity: 900,
    });
    expect(seen.map((i) => i.entity)).toEqual([knight]);
    const push = seen[0]?.impulse ?? v(0);
    const reach = Math.sqrt(2 * 2 + 0.9 * 0.9) - 0.9;
    const share = 1 - (1 - STIMULUS_EDGE_FALLOFF) * (reach / 1.6);
    expect(Math.sqrt(push.x * push.x + push.y * push.y + push.z * push.z)).toBeCloseTo(
      900 * share,
      6,
    );
    // Pushed up and away from the blast, along the line to the body's centre.
    expect(push.y / push.x).toBeCloseTo(0.9 / 2, 9);
    expect(crate).toBeGreaterThan(0);
  });

  it('AC-3: an explicit direction overrides the shape push, and contacts need one', () => {
    const w = world();
    const placed = thing(w, { pushable: true, weight: 4 }, v(1));
    const unplaced = thing(w, { pushable: true, weight: 2 }, null);
    const seen = impulses(w);
    const push = (target: EntityId, direction?: Vec3): StimulusInput => ({
      shape: { kind: 'contact', target },
      element: 'force',
      intensity: 8,
      ...(direction === undefined ? {} : { direction }),
    });
    run(w, push(placed), push(unplaced));
    expect(seen).toEqual([]);
    run(w, push(placed, v(0, 0, 3)), push(unplaced, v(0, -1)));
    expect(seen).toEqual([
      { entity: placed, impulse: v(0, 0, 8), velocityChange: v(0, 0, 2), source: null },
      { entity: unplaced, impulse: v(0, -8), velocityChange: v(0, -4), source: null },
    ]);
  });

  it('AC-4: property changes carry the stimulus source; unsourced stimuli carry null', () => {
    const w = world();
    const caster = w.spawn();
    const rope = thing(w, { temperature: 20 }, ORIGIN);
    const seen = changes(w);
    run(w, { ...heatBall(1), source: caster });
    run(w, heatBall(1));
    expect(seen.map((c) => [c.entity, c.key, c.source])).toEqual([
      [rope, 'temperature', caster],
      [rope, 'temperature', null],
    ]);
  });

  it('AC-5: zero intensity or a zero-size shape is a no-op that does not throw', () => {
    const w = world();
    const target = thing(w, { temperature: 20 }, ORIGIN);
    const log = recordStimulusLog(w);
    const noOps: StimulusInput[] = [
      heatBall(2, 0),
      heatBall(0),
      {
        shape: { kind: 'capsule', from: ORIGIN, to: v(1), radius: 0 },
        element: 'heat',
        intensity: 5,
      },
      {
        shape: { kind: 'cone', apex: ORIGIN, direction: v(1), length: 0, halfAngle: 1 },
        element: 'heat',
        intensity: 5,
      },
      {
        shape: { kind: 'box', center: ORIGIN, halfExtents: v(1, 0, 1) },
        element: 'heat',
        intensity: 5,
      },
    ];
    for (const stimulus of noOps) expect(applyStimulus(w, stimulus)).toBe(false);
    expect(pendingStimuli(w)).toEqual([]);
    resolveStimuli(w);
    w.events.flush();
    expect(log.entries).toEqual([]);
    expect(getProperty(w, target, 'temperature')).toBe(20);
  });

  it('cold, water and charge change their properties, clamped to each range', () => {
    const w = world();
    const ice = thing(w, { temperature: -270, wetness: 0.9, charge: 999_999 }, ORIGIN);
    const all = (element: 'cold' | 'water' | 'charge', intensity: number): StimulusInput => ({
      shape: { kind: 'point', at: ORIGIN },
      element,
      intensity,
    });
    run(w, all('cold', 10), all('water', 0.5), all('charge', 5));
    expect(getProperty(w, ice, 'temperature')).toBe(-273.15);
    expect(getProperty(w, ice, 'wetness')).toBe(1);
    expect(getProperty(w, ice, 'charge')).toBe(1_000_000);
  });

  it('blunt, slash and pierce hit breakables (hp or fragile) and change no property', () => {
    const w = world();
    const door = thing(w, { hp: 50 }, ORIGIN);
    const vase = thing(w, { fragile: 5 }, v(0.5));
    thing(w, { temperature: 20 }, v(0.2)); // not breakable
    const log = recordStimulusLog(w);
    const seen = changes(w);
    run(w, {
      shape: { kind: 'sphere', center: ORIGIN, radius: 1 },
      element: 'blunt',
      intensity: 40,
      falloff: 'none',
    });
    expect(log.entries[0]?.hits).toEqual([
      { entity: door, falloff: 1, amount: 40 },
      { entity: vase, falloff: 1, amount: 40 },
    ]);
    expect(seen).toEqual([]);
  });

  it('gas and light reach no entities: they are for the element and light fields', () => {
    const w = world();
    thing(w, { temperature: 20, hp: 10 }, ORIGIN);
    const log = recordStimulusLog(w);
    const ball = { kind: 'sphere', center: ORIGIN, radius: 5 } as const;
    run(w, { shape: ball, element: 'gas', gas: 'marsh-gas', intensity: 3 });
    run(w, { shape: ball, element: 'light', intensity: 3 });
    expect(
      log.entries.map((entry) => [entry.stimulus.element, entry.stimulus.gas, entry.hits]),
    ).toEqual([
      ['gas', 'marsh-gas', []],
      ['light', undefined, []],
    ]);
  });

  it('contact stimuli hit their live target directly, and nothing else', () => {
    const w = world();
    const arrowTarget = thing(w, { temperature: 20 }, null);
    const bystander = thing(w, { temperature: 20 }, ORIGIN);
    const stone = thing(w, { hp: 10 }, ORIGIN);
    const gone = thing(w, { temperature: 20 }, ORIGIN);
    w.destroy(gone);
    const contact = (target: EntityId): StimulusInput => ({
      shape: { kind: 'contact', target },
      element: 'heat',
      intensity: 30,
    });
    run(w, contact(arrowTarget), contact(stone), contact(gone));
    expect(getProperty(w, arrowTarget, 'temperature')).toBe(50);
    expect(getProperty(w, bystander, 'temperature')).toBe(20);
  });

  it('spreads a duration over round(duration × hz) resolutions, one per tick of stimulusSystem', () => {
    const w = world(10);
    w.addSystem(stimulusSystem());
    const pan = thing(w, { temperature: 0 }, ORIGIN);
    applyStimulus(w, { ...heatBall(1, 90), falloff: 'none', duration: 0.26 });
    expect(pendingStimuli(w).map((p) => [p.ticks, p.ticksLeft])).toEqual([[3, 3]]);
    w.step();
    expect(getProperty(w, pan, 'temperature')).toBe(30);
    expect(pendingStimuli(w).map((p) => p.ticksLeft)).toEqual([2]);
    w.step();
    w.step();
    expect(getProperty(w, pan, 'temperature')).toBe(90);
    expect(pendingStimuli(w)).toEqual([]);
    w.step(); // an empty queue resolves nothing
    expect(getProperty(w, pan, 'temperature')).toBe(90);
  });

  it('resolves earlier ticks first, then by content; identical stimuli are interchangeable', () => {
    const w = world();
    w.addSystem(stimulusSystem());
    const log = recordStimulusLog(w);
    applyStimulus(w, { ...heatBall(1, 90), duration: 2 / 60 }); // applied at tick 0, 2 ticks
    w.step();
    applyStimulus(w, heatBall(1, 1)); // tick 1: sorts after the tick-0 carry-over
    applyStimulus(w, heatBall(1, 1));
    w.step();
    expect(log.entries.map((entry) => [entry.tick, entry.amount])).toEqual([
      [0, 45],
      [1, 45],
      [1, 1],
      [1, 1],
    ]);
  });

  it('resolves stimuli applied by an earlier system in the same tick', () => {
    const w = world();
    const pot = thing(w, { temperature: 20 }, ORIGIN);
    w.addSystem({ name: 'torch', run: ({ world: sim }) => applyStimulus(sim, heatBall(1, 5)) });
    w.addSystem(stimulusSystem());
    expect(stimulusSystem().name).toBe('stimuli');
    w.step();
    expect(getProperty(w, pot, 'temperature')).toBe(25);
  });

  it('snapshots the queue and restores it, validating saved entries', () => {
    const w = world();
    applyStimulus(w, { ...heatBall(1, 10), duration: 1, source: w.spawn() });
    const copy = registerWorldProperties(new World<string>({ seed: 1 }));
    installStimuli(copy);
    copy.restore(w.snapshot());
    expect(hashWorld(copy)).toBe(hashWorld(w));
    expect(pendingStimuli(copy)).toEqual(pendingStimuli(w));

    const snapshot = w.snapshot();
    const withQueue = (value: unknown) => ({
      ...snapshot,
      components: { ...snapshot.components, 'stimulus.queue': [[1, value]] },
    });
    const entry = pendingStimuli(w)[0];
    const bad: [unknown, RegExp][] = [
      [null, /entries array/],
      [{ entries: 3 }, /entries array/],
      [{ entries: [{ ...entry, tick: -1 }] }, /tick counts/],
      [{ entries: [{ ...entry, ticks: '60' }] }, /tick counts/],
      [{ entries: [{ ...entry, ticksLeft: 1.5 }] }, /tick counts/],
      [{ entries: [{ ...entry, ticksLeft: 0 }] }, /tick counts/],
      [{ entries: [{ ...entry, ticksLeft: 61 }] }, /tick counts/],
      [{ entries: [{ ...entry, stimulus: { ...entry?.stimulus, intensity: -1 } }] }, /intensity/],
    ];
    for (const [value, error] of bad) {
      expect(() => {
        copy.restore(withQueue(value) as never);
      }).toThrow(error);
    }
  });

  it('throws when stimuli are not installed', () => {
    const w = registerWorldProperties(new World<string>({ seed: 1 }));
    expect(() => applyStimulus(w, heatBall(1))).toThrow(/not registered/);
    const installed = world();
    const [queue] = installed.snapshot().entities;
    installed.destroy(queue ?? 0);
    expect(() => applyStimulus(installed, heatBall(1))).toThrow(/not installed/);
    expect(() => {
      resolveStimuli(installed);
    }).toThrow(/not installed/);
  });
});

describe('normalizeStimulus', () => {
  const base = heatBall(1);

  it('fills defaults and normalises the direction', () => {
    expect(normalizeStimulus({ ...base, element: 'force', direction: v(0, 3) })).toEqual({
      ...base,
      element: 'force',
      duration: 0,
      source: null,
      falloff: 'linear',
      direction: v(0, 1),
    });
    expect(STIMULUS_ELEMENTS).toHaveLength(10);
    const shove = { ...base, element: 'force' as const, maxWeight: 60, sparesSource: true };
    expect(normalizeStimulus(shove)).toMatchObject({ maxWeight: 60, sparesSource: true });
    expect(normalizeStimulus({ ...shove, sparesSource: false })).not.toHaveProperty('sparesSource');
  });

  it('rejects invalid stimuli', () => {
    const bad: [StimulusInput, RegExp][] = [
      [{ ...base, element: 'plasma' as never }, /unknown stimulus element/],
      [{ ...base, shape: { kind: 'torus' } as never }, /unknown stimulus shape/],
      [{ ...base, falloff: 'cubic' as never }, /unknown falloff/],
      [{ ...base, intensity: -1 }, /intensity/],
      [{ ...base, intensity: Number.NaN }, /intensity/],
      [{ ...base, duration: -1 }, /duration/],
      [{ ...base, duration: Infinity }, /duration/],
      [{ ...base, source: 0 }, /source/],
      [{ ...base, source: 2.5 }, /source/],
      [{ ...base, direction: ORIGIN }, /direction/],
      [{ ...base, direction: v(Number.NaN) }, /direction/],
      [{ ...base, element: 'gas' }, /gas id/],
      [{ ...base, element: 'gas', gas: 'Marsh Gas' }, /gas id/],
      [{ ...base, gas: 'smoke' }, /only gas stimuli/],
      [{ ...base, maxWeight: 60 }, /only force stimuli take a maxWeight/],
      [{ ...base, element: 'force', maxWeight: 0 }, /maxWeight/],
      [{ ...base, element: 'force', maxWeight: Infinity }, /maxWeight/],
    ];
    for (const [stimulus, error] of bad) expect(() => normalizeStimulus(stimulus)).toThrow(error);
  });
});
