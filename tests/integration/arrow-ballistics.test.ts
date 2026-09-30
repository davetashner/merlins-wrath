// mw-e05.2 with the shipped arrows (src/content/data/arrow): AC-2 checks the standard arrow's drag
// against an independent RK4 reference, and AC-6 replays a scripted volley of 20 arrows at moving
// dummies 100 times and requires the same state hash on every tick of every run.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import {
  addProperties,
  arrowImpact,
  arrowLookup,
  box,
  DAMAGE_COMPONENTS,
  DamageApplied,
  DamageModel,
  FakeCollisionWorld,
  fireArrow,
  giveCombatant,
  giveHurtboxes,
  hashWorld,
  HIT_VOLUME_COMPONENTS,
  installArrows,
  installStimuli,
  PhysicsColliderComponent,
  PlacementComponent,
  placeEntity,
  registerWorldProperties,
  simMath,
  stimulusSystem,
  World,
  type ArrowImpactInfo,
  type EntityId,
  type Vec3,
} from '@sim/index';

const content = loadGameContent();
const ARROWS = arrowLookup(content.all('arrow'));
const G = 9.81;
const HZ = 60;

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * The reference: classical RK4 at 0.1 ms of the same model (gravity plus quadratic drag), in the
 * vertical plane, stepped until it reaches `range` metres downrange; the height there, metres.
 */
function rk4HeightAt(range: number, speed: number, degrees: number, y0: number, kOverM: number) {
  type S = readonly [number, number, number, number];
  const f = ([, , vx, vy]: S): S => {
    const drag = kOverM * Math.sqrt(vx * vx + vy * vy);
    return [vx, vy, -drag * vx, -G - drag * vy];
  };
  const add = (s: S, k: S, h: number): S => [
    s[0] + k[0] * h,
    s[1] + k[1] * h,
    s[2] + k[2] * h,
    s[3] + k[3] * h,
  ];
  const dt = 1e-4;
  let s: S = [0, y0, speed * simMath.cos(radians(degrees)), speed * simMath.sin(radians(degrees))];
  for (;;) {
    const k1 = f(s);
    const k2 = f(add(s, k1, dt / 2));
    const k3 = f(add(s, k2, dt / 2));
    const k4 = f(add(s, k3, dt));
    const n: S = [0, 1, 2, 3].map(
      (i) =>
        (s[i] ?? 0) +
        (dt / 6) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0)),
    ) as unknown as S;
    if (n[0] >= range) return s[1] + ((range - s[0]) / (n[0] - s[0])) * (n[1] - s[1]);
    s = n;
  }
}

describe('arrow ballistics with the shipped arrows (mw-e05.2)', () => {
  it('AC-2: the standard arrow lands within ±0.5 m of the RK4 reference on a target at 50 m', ({
    task,
  }) => {
    markExercised(task, 'arrow', 'standard');
    const standard = content.get('arrow', 'standard');
    const kOverM = standard.dragK / (standard.massGrams / 1000);
    // Reference table (launch 1.5 m up): height where the path crosses 50 m downrange, from RK4.
    const TABLE = [
      { speed: 60, degrees: 0, height: -2.145 },
      { speed: 60, degrees: 2, height: -0.404 },
      { speed: 60, degrees: 5, height: 2.201 },
      { speed: 60, degrees: 10, height: 6.555 },
      { speed: 40, degrees: 15, height: 6.096 },
    ];
    for (const row of TABLE) {
      const reference = rk4HeightAt(50, row.speed, row.degrees, 1.5, kOverM);
      expect(reference, 'table matches its RK4').toBeCloseTo(row.height, 2);
      // A tall target wall whose face is 50 m downrange.
      const world = registerWorldProperties(new World<never>({ seed: 1, hz: HZ }));
      world.register(PlacementComponent, ...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS);
      const collision = new FakeCollisionWorld([box(v3(50, -20, -5), v3(51, 30, 5))]);
      installArrows(world, { arrows: ARROWS, damage: new DamageModel(), collision });
      const impacts: ArrowImpactInfo[] = [];
      world.events.on(arrowImpact, (e) => impacts.push(e));
      const a = radians(row.degrees);
      fireArrow(world, ARROWS, {
        arrow: 'standard',
        origin: v3(0, 1.5, 0),
        velocity: v3(row.speed * simMath.cos(a), row.speed * simMath.sin(a), 0),
      });
      for (let i = 0; i < 180 && impacts.length === 0; i++) world.step();
      const [hit] = impacts;
      expect(hit?.position.x, `${String(row.speed)} m/s at ${String(row.degrees)}°`).toBeCloseTo(
        50,
        6,
      );
      expect(Math.abs((hit?.position.y ?? Infinity) - reference)).toBeLessThanOrEqual(0.5);
    }
  });

  /** A fire command in the replay's input log. */
  interface Loose {
    readonly arrow: string;
    readonly velocity: Vec3;
  }

  /** The dummies' rest positions (they strafe ±3 m in x about these). */
  const DUMMY_BASES = [0, 1, 2, 3, 4].map((i) => v3(-8 + i * 4, 1, 15 + i * 5));
  /** How fast dummy `i` strafes (radians of its sway per tick). */
  const dummyRate = (i: number) => 0.03 + i * 0.01;

  /**
   * The scripted volley: 20 arrows, one every 6 ticks, cycling the shipped arrows, each aimed at a
   * dummy's rest position (lofted for the drop, give or take): some hit, some miss the strafing
   * dummy and fly on into the post, the floor or the stone wall.
   */
  function volleyLog(): Map<number, Loose> {
    const ids = [...ARROWS.keys()];
    const log = new Map<number, Loose>();
    for (let i = 0; i < 20; i++) {
      const k = i % DUMMY_BASES.length;
      const target = DUMMY_BASES[k] ?? v3(0, 1, 20);
      const speed = 50 + (i % 3) * 5;
      // Lead the strafing dummy: where it will be when the arrow gets there (drag makes it late).
      const arrives = i * 6 + Math.round(((target.z - 0.6) / speed) * HZ * 1.1);
      const dx = target.x + 3 * simMath.sin(arrives * dummyRate(k));
      const dz = target.z - 0.6;
      const flat = Math.sqrt(dx * dx + dz * dz);
      const loft = (G * flat) / (2 * speed * speed) + (target.y - 1.5) / flat;
      log.set(i * 6, {
        arrow: ids[i % ids.length] ?? 'standard',
        velocity: v3((speed * dx) / flat, speed * loft, (speed * dz) / flat),
      });
    }
    return log;
  }

  /** One live run of the volley: the state hash after every tick, and what happened. */
  function runVolley(ticks: number) {
    const world = installStimuli(registerWorldProperties(new World<Loose>({ seed: 7, hz: HZ })));
    world.register(...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS, PhysicsColliderComponent);
    // A floor, a stone wall behind the dummies and a wooden post among them.
    const collision = new FakeCollisionWorld([
      box(v3(-30, -1, -10), v3(30, 0, 80)),
      box(v3(-30, 0, 40), v3(30, 6, 41)),
      box(v3(-0.2, 0, 19.8), v3(0.2, 3, 20.2)),
    ]);
    const stone = world.spawn();
    addProperties(world, stone, { material: 'stone', surfaceHardness: 'hard' });
    world.add(stone, PhysicsColliderComponent, { colliders: [2] });
    const archer = world.spawn();
    placeEntity(world, archer, v3(0, 1, 0), 0.5);
    giveCombatant(world, archer, { health: 100 });
    giveHurtboxes(world, archer, {
      boxes: [
        {
          id: 'body',
          socket: 'root',
          region: 'torso',
          armored: false,
          multiplier: 1,
          shape: { kind: 'sphere', center: v3(0, 0, 0), radius: 0.5 },
        },
      ],
    });
    // Five dummies strafing side to side at different speeds, 15–35 m out.
    const dummies: { entity: EntityId; base: Vec3; rate: number }[] = [];
    for (const [i, base] of DUMMY_BASES.entries()) {
      const entity = world.spawn();
      placeEntity(world, entity, base, 0.6);
      giveCombatant(world, entity, { health: 1000, poise: 50 });
      giveHurtboxes(world, entity, {
        boxes: [
          {
            id: 'torso',
            socket: 'root',
            region: 'torso',
            armored: false,
            multiplier: 1,
            shape: { kind: 'capsule', from: v3(0, -0.5, 0), to: v3(0, 0.3, 0), radius: 0.35 },
          },
          {
            id: 'head',
            socket: 'root',
            region: 'head',
            armored: false,
            multiplier: 2,
            shape: { kind: 'sphere', center: v3(0, 0.6, 0), radius: 0.2 },
          },
        ],
      });
      dummies.push({ entity, base, rate: dummyRate(i) });
    }
    world.addSystem({
      name: 'dummies',
      run: ({ tick }) => {
        for (const { entity, base, rate } of dummies) {
          const x = base.x + 3 * simMath.sin(tick * rate);
          world.set(entity, PlacementComponent, { x, y: base.y, z: base.z, radius: 0.6 });
        }
      },
    });
    world.addSystem({
      name: 'archer',
      run: ({ inputs }) => {
        for (const loose of inputs) {
          fireArrow(world, ARROWS, { ...loose, origin: v3(0, 1.5, 0.6), shooter: archer });
        }
      },
    });
    installArrows(world, { arrows: ARROWS, damage: new DamageModel(), collision });
    world.addSystem(stimulusSystem());
    const impacts: ArrowImpactInfo[] = [];
    let damaged = 0;
    world.events.on(arrowImpact, (e) => impacts.push(e));
    world.events.on(DamageApplied, () => damaged++);
    const log = volleyLog();
    const hashes: string[] = [];
    for (let tick = 0; tick < ticks; tick++) {
      const loose = log.get(tick);
      world.step(loose === undefined ? [] : [loose]);
      hashes.push(hashWorld(world));
    }
    return { hashes, impacts, damaged };
  }

  it('AC-6: a volley of 20 arrows at moving dummies replays to identical hashes 100 times', ({
    task,
  }) => {
    for (const id of ARROWS.keys()) markExercised(task, 'arrow', id);
    const TICKS = 300;
    const first = runVolley(TICKS);
    // The volley does something worth replaying: hits, sticks and ricochets, with damage.
    expect(first.impacts.length).toBeGreaterThanOrEqual(20);
    expect(new Set(first.impacts.map((i) => i.outcome)).size).toBeGreaterThanOrEqual(3);
    expect(first.impacts.filter((i) => i.hurtbox !== undefined).length).toBeGreaterThanOrEqual(15);
    expect(first.damaged).toBeGreaterThan(0);
    for (let run = 1; run < 100; run++) {
      const again = runVolley(TICKS);
      expect(again.hashes).toEqual(first.hashes);
    }
  }, 120_000);
});
