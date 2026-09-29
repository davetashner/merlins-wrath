import { createPose, maxBoneDeltaDeg, type MarkerEvent, type Pose } from '@render/animation/index';
import {
  actionOf,
  defineComponent,
  requestMove,
  setTimeScale,
  World,
  type EntityId,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { interpolateTransform, RenderSync, type Transform } from '../loop/render-sync';
import { AnimationDriver, interpolateAction, PROBE_HISTORY } from './driver';
import { simAnimReader, type SimAnimSample } from './sim-params';
import { testController, timelineWorld } from './testing';

const FRAME = 1 / 60;

describe('AnimationDriver: hit-stop', () => {
  it('AC-4: a pose holds while the sim time scale is 0 for 4 ticks and resumes with no pop (≤ 5°)', () => {
    const { world, entity, moves } = timelineWorld();
    const driver = new AnimationDriver(world);
    const poses: { tick: number; frozen: boolean; pose: Pose }[] = [];
    driver.add(entity, {
      name: 'swordsman',
      controller: testController(),
      read: simAnimReader({ moves }),
      apply: (pose) => {
        const timeline = actionOf(world, entity);
        poses.push({ tick: timeline?.tick ?? -1, frozen: false, pose: Float64Array.from(pose) });
      },
    });
    requestMove(world, entity, 'swing');
    // The display runs at 120 Hz: two frames per sim step, at alpha 0 and 0.5.
    for (let step = 0; step < 30; step++) {
      if (step === 14) setTimeScale(world, entity, 0, 4); // hit-stop from the 15th step
      world.step();
      driver.capture();
      driver.frame(0, FRAME / 2);
      driver.frame(0.5, FRAME / 2);
    }
    // Move tick per frame: the move holds one tick through the frozen runs (the step that set the
    // scale ran at normal speed, and the scale returns to 1 after the 4th frozen run).
    const ticks = poses.map((p) => p.tick);
    const frozenTick = 13;
    expect(ticks.filter((t) => t === frozenTick).length).toBeGreaterThanOrEqual((4 + 1) * 2);
    // Every frame drawn once both captured steps were frozen shows the same pose.
    const firstHeld = ticks.indexOf(frozenTick) + 2;
    const lastHeld = ticks.lastIndexOf(frozenTick);
    const held = poses.slice(firstHeld, lastHeld + 1);
    expect(held.length).toBeGreaterThanOrEqual(4 * 2);
    for (const p of held) expect(maxBoneDeltaDeg(p.pose, held[0]?.pose ?? p.pose)).toBe(0);
    // Resuming: no frame-to-frame jump bigger than 5° on any bone, before, during or after.
    for (let i = 1; i < poses.length; i++) {
      const a = poses[i - 1]?.pose;
      const b = poses[i]?.pose;
      if (a === undefined || b === undefined) continue;
      expect(maxBoneDeltaDeg(a, b)).toBeLessThanOrEqual(5);
    }
    expect(poses[lastHeld + 1]?.tick).toBe(frozenTick + 1);
    // The first frame that moves again (interpolating 13 → 14) moves by at most 5°.
    const resume = maxBoneDeltaDeg(
      poses[lastHeld]?.pose ?? createPose(3),
      poses[lastHeld + 2]?.pose ?? createPose(3),
    );
    expect(resume).toBeGreaterThan(0);
    expect(resume).toBeLessThanOrEqual(5);
  });
});

describe('AnimationDriver: frames', () => {
  it('AC-3: through the driver, the hit marker plays on the move’s first active tick (12) ± 1', () => {
    const { world, entity, moves } = timelineWorld();
    const driver = new AnimationDriver(world);
    const controller = testController();
    const hits: number[] = [];
    controller.onMarker = (e: MarkerEvent) => {
      if (e.kind === 'hit') hits.push(actionOf(world, entity)?.tick ?? -1);
    };
    driver.add(entity, {
      name: 'swordsman',
      controller,
      read: simAnimReader({ moves }),
      apply: () => undefined,
    });
    requestMove(world, entity, 'swing');
    for (let step = 0; step < 40; step++) {
      world.step();
      driver.capture();
      driver.frame(0.5, FRAME);
    }
    expect(hits).toHaveLength(1);
    expect(Math.abs((hits[0] ?? 0) - 12)).toBeLessThanOrEqual(1);
  });

  it('AC-5: a clip with root translation never moves the entity: its transform is the interpolated sim position', () => {
    const Body = defineComponent<number>('test.body');
    const world = new World({ seed: 1 }).register(Body);
    const entity = world.spawn();
    world.add(entity, Body, 0);
    world.addSystem({
      name: 'walk',
      run: ({ world: w }) => {
        w.set(entity, Body, (w.get(entity, Body) ?? 0) - 4 / 60); // 4 m/s towards −z
      },
    });
    const read = (view: Pick<World, 'get'>, e: EntityId): Transform => ({
      position: { x: 0, y: 0, z: view.get(e, Body) ?? 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    const object = { position: { x: 0, y: 0, z: 0 }, bones: createPose(3) };
    const sync = new RenderSync(world);
    sync.bind(entity, {
      object,
      read,
      apply: (o, t) => {
        o.position = { ...t.position };
      },
      dispose: () => undefined,
    });
    const driver = new AnimationDriver(world);
    const controller = testController();
    driver.add(entity, {
      name: 'runner',
      controller,
      // speed 4 plays anim-run, whose source clip moves its root 4 m/s.
      read: () => ({ values: { speed: 4 }, timeScale: 1, action: null }),
      apply: (pose) => {
        object.bones.set(pose);
      },
    });
    let previous = read(world, entity);
    let current = previous;
    // 2 s at 60 Hz, drawn at alpha 0.25 and 0.75.
    for (let step = 0; step < 120; step++) {
      world.step();
      sync.capture();
      driver.capture();
      previous = current;
      current = read(world, entity);
      for (const alpha of [0.25, 0.75]) {
        sync.render(alpha);
        driver.frame(alpha, FRAME / 2);
        const expected = interpolateTransform(previous, current, alpha).position;
        expect(object.position.x).toBe(expected.x);
        expect(object.position.y).toBe(expected.y);
        expect(object.position.z).toBeCloseTo(expected.z, 12);
      }
    }
    expect(controller.probe().layers[0]?.state).toBe('run');
    expect(object.position.z).toBeCloseTo(-8 + (4 / 60) * 0.25, 9);
  });

  it('updates far characters at a reduced, staggered rate with the time they skipped', () => {
    const world = new World({ seed: 1 });
    const driver = new AnimationDriver(world, { near: 30, interval: 4 });
    const seen: Record<string, number[]> = { near: [], far: [], nowhere: [] };
    const add = (name: string, at: { x: number; y: number; z: number } | undefined) => {
      const entity = world.spawn();
      const controller = testController();
      const update = controller.update.bind(controller);
      controller.update = (seconds, params) => {
        seen[name]?.push(Math.round(seconds * 600));
        update(seconds, params);
      };
      driver.add(entity, {
        name,
        controller,
        read: () => ({ values: {}, timeScale: 1, action: null }),
        apply: () => undefined,
        locate: () => at,
      });
      return entity;
    };
    add('near', { x: 0, y: 0, z: 10 });
    add('far', { x: 0, y: 0, z: 31 });
    add('nowhere', undefined);
    for (let i = 0; i < 8; i++) driver.frame(0, 0.1, { x: 0, y: 0, z: 0 });
    expect(seen['near']).toEqual([60, 60, 60, 60, 60, 60, 60, 60]);
    expect(seen['nowhere']).toHaveLength(8);
    // The far one (slot 1) updates on frames 3 and 7 with the 0.4 s it skipped each time.
    expect(seen['far']).toEqual([240, 240]);
    expect(driver.lastFrame).toEqual({ updated: 3, deferred: 0 });
    driver.frame(0, 0.1, { x: 0, y: 0, z: 0 });
    expect(driver.lastFrame).toEqual({ updated: 2, deferred: 1 });
    // Without a focus nobody is far.
    driver.frame(0, 0.1);
    expect(driver.lastFrame).toEqual({ updated: 3, deferred: 0 });
  });

  it('drops characters whose entity is gone or removed, and skips those without parameters', () => {
    const world = new World({ seed: 1 });
    const driver = new AnimationDriver(world);
    const gone = world.spawn();
    const kept = world.spawn();
    const blank = world.spawn();
    const character = (read: () => SimAnimSample | undefined) => ({
      name: 'x',
      controller: testController(),
      read,
      apply: () => undefined,
    });
    const idle = () => ({ values: {}, timeScale: 1, action: null });
    driver.add(gone, character(idle));
    driver.add(kept, character(idle));
    driver.add(
      blank,
      character(() => undefined),
    );
    expect(driver.size).toBe(3);
    world.destroy(gone);
    driver.frame(0, FRAME);
    expect(driver.size).toBe(2);
    expect(driver.lastFrame).toEqual({ updated: 1, deferred: 0 });
    expect(driver.remove(kept)).toBe(true);
    expect(driver.remove(kept)).toBe(false);
  });

  it('probes each character’s layers and the states it entered, oldest first', () => {
    const { world, entity, moves } = timelineWorld();
    const driver = new AnimationDriver(world);
    let speed = 0;
    const read = simAnimReader({
      moves,
      locomotion: () => ({ speed, turnRate: 0, grounded: true }),
    });
    driver.add(entity, {
      name: 'swordsman',
      controller: testController(),
      read,
      apply: () => undefined,
    });
    const run = (steps: number) => {
      for (let i = 0; i < steps; i++) {
        world.step();
        driver.capture();
        driver.frame(1, FRAME);
      }
    };
    run(2);
    speed = 4;
    run(20);
    speed = 0;
    run(20);
    requestMove(world, entity, 'swing');
    run(40);
    const probe = driver.probe()['swordsman'];
    expect(probe?.history).toEqual(['idle', 'run', 'idle', 'attack']);
    expect(probe?.layers.map((l) => l.state)).toEqual(['idle', 'none', 'none']);
    expect(probe?.rig).toBe('test-rig');
    // The history keeps the most recent PROBE_HISTORY entries.
    for (let i = 0; i < PROBE_HISTORY; i++) {
      speed = speed === 0 ? 4 : 0;
      run(15);
    }
    expect(driver.probe()['swordsman']?.history).toHaveLength(PROBE_HISTORY);
  });
});

describe('interpolateAction', () => {
  const sample = (tick: number, key = 3): SimAnimSample => ({
    values: {},
    timeScale: 1,
    action: {
      move: 'swing',
      clip: 'anim-swing',
      key,
      tick,
      activeFrom: 12,
      totalTicks: 34,
      phase: 'startup',
      verb: 'attack',
    },
  });

  it('interpolates the move tick within one run, and starts a new run at its latest tick', () => {
    expect(interpolateAction(sample(4), sample(5), 0.25)?.moveTick).toBe(4.25);
    expect(interpolateAction(sample(20, 1), sample(0, 3), 0.5)?.moveTick).toBe(0);
    expect(interpolateAction(undefined, sample(2), 0.5)?.moveTick).toBe(2);
    expect(interpolateAction(sample(2), { ...sample(2), action: null }, 0.5)).toBeNull();
    expect(interpolateAction(sample(1), sample(2), 1)).toEqual({
      move: 'swing',
      clip: 'anim-swing',
      key: 3,
      moveTick: 2,
      activeFrom: 12,
      totalTicks: 34,
    });
  });
});
