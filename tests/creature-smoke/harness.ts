// mw-e12.15: the creature smoke harness. It turns every CreatureDef in content into the same named
// battery of headless-sim checks, so the bestiary stays cheap to extend: a new creature file is
// tested the moment it exists, and a failure names the creature and the step
// (`creature:<id> smoke — <step>`) so it points at data, not at a test someone forgot to write.
//
// The battery (BATTERY, in this order), each step on a fresh creature of its own so one failing
// step never hides another:
//   spawn        spawns through the game's own wiring with the stats, resistances and attacks of its data
//   tick 10 s    ticks 10 s of sim with its AI and perception running; stays healthy and finite
//   perceive     a scripted stimulus (the player steps into its view); its alert state leaves Unaware.
//                Skipped when its behaviour profile has no behaviour content (it spawns with no brain).
//   attacks      every declared attack once against a dummy: refs resolve (a missing hitbox names the
//                ref), the telegraph fires and the attack ends. Skipped when it has no attacks.
//   lethal damage  lethal damage kills it — or, when it is immune to every damage type, it survives
//   despawn      removing it leaves nothing of it in the sim
//
// The world is `createGameWorld` (Rapier physics, perception, awareness, AI, the attack executor), as
// src/main.ts wires it, in the debug creature pen, so nothing is mocked. Extra scenarios: a creature
// file opts in by being listed in `SCENARIOS` of the registering test file (see registerCreatureSmoke);
// that is a plain `{ creature id → extra named steps }` map, deliberately not a data-file feature
// (no schema change); a data-level opt-in is follow-up work.

import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { markExercised } from '@content/testing';
import type { GameContent, GameEntry } from '@content/registry';
import { DAMAGE_TYPES } from '@content/index';
import {
  AlertStateChanged,
  AttackEnded,
  brainOf,
  CreatureComponent,
  creatureEntities,
  DamageApplied,
  despawnCreaturesCommand,
  facingOf,
  Died,
  giveCombatant,
  giveFacing,
  giveHurtboxes,
  HealthComponent,
  PlacementComponent,
  placeEntity,
  spawnCommand,
  startAttack,
  teleportCommand,
  TelegraphStarted,
  BrainComponent,
  type EntityId,
  type World,
} from '@sim/index';
import { createGameWorld, type HeadlessGame } from '@tools/replay/testbed-player-scenario';
import { it, type TestContext } from 'vitest';

/** The ticks in the 10 s the "tick" step runs (the sim runs at 60 Hz). */
export const TICK_STEP_TICKS = 600;
/** The battery's step names, in order; the test name is `creature:<id> smoke — <step>`. */
export const BATTERY = [
  'spawn',
  'tick 10 s',
  'perceive',
  'attacks',
  'lethal damage',
  'despawn',
] as const;
/** A battery step name. */
export type SmokeStep = (typeof BATTERY)[number];

export type CreatureEntry = GameEntry<'creature'>;

/** What a step did: it passed, or it was skipped for `reason` (a failure throws). */
export type StepResult =
  { readonly status: 'passed' } | { readonly status: 'skipped'; reason: string };

const PASSED: StepResult = { status: 'passed' };
const skipped = (reason: string): StepResult => ({ status: 'skipped', reason });

/** One creature to smoke-test. `refs` is what the attack step resolves attack, move and hitbox refs in. */
export interface SmokeSubject {
  readonly creature: CreatureEntry;
  /** The content the world is built from (it has the creature and its attacks). */
  readonly content: GameContent;
  /** What attack refs resolve in; defaults to `content`. Meta tests hide entries to break a ref. */
  readonly refs?: Pick<GameContent, 'has' | 'get'>;
}

/** Extra scenario steps a creature opts into: step name → test body over its rig. */
export type CreatureScenarios = Readonly<Record<string, readonly ScenarioStep[]>>;
export interface ScenarioStep {
  readonly name: string;
  run(rig: Rig): void;
}

const ORIGIN = { x: 0, y: 0, z: 3 };
const DUMMY_HEALTH = 1_000_000;

/** A headless world for one creature: the game wiring in the creature pen, emptied of its creatures. */
export class Rig {
  readonly game: HeadlessGame<unknown>;
  readonly world: World;
  readonly sim: World<never>;

  constructor(readonly subject: SmokeSubject) {
    this.game = createGameWorld<unknown>(RAPIER, {
      seed: 1,
      hz: 60,
      scene: 'creature-pen',
      content: subject.content,
    });
    this.world = this.game.world;
    this.sim = this.world;
    this.world.step([despawnCreaturesCommand()]);
  }

  get id(): string {
    return this.subject.creature.id;
  }

  step(ticks = 1): void {
    for (let i = 0; i < ticks; i++) this.world.step();
  }

  /** Despawns every creature, spawns this one at its own feet, steps once so it exists. */
  spawn(): EntityId {
    this.world.step([despawnCreaturesCommand()]);
    this.world.step([spawnCommand(this.id, 1, ORIGIN)]);
    const [entity, ...rest] = creatureEntities(this.sim);
    if (entity === undefined || rest.length > 0)
      throw new Error(
        `spawning "${this.id}" made ${String(rest.length + (entity ? 1 : 0))} creatures, not 1`,
      );
    return entity;
  }

  /** Puts the player `metres` ahead of `entity`, along the way it faces (negative: behind it). */
  placePlayer(entity: EntityId, metres: number): void {
    const f = facingOf(this.sim, entity);
    this.world.step([
      teleportCommand(this.game.player, {
        x: ORIGIN.x + f.x * metres,
        y: 0,
        z: ORIGIN.z + f.z * metres,
      }),
    ]);
  }

  /** A target dummy at `at` with a body hurtbox and a great deal of health. */
  dummy(at: { x: number; y: number; z: number }): EntityId {
    const w = this.sim;
    const dummy = w.spawn();
    placeEntity(w, dummy, at, 0.35);
    giveFacing(w, dummy, { x: 0, y: 0, z: 1 });
    giveHurtboxes(w, dummy, {
      facing: { x: 0, y: 0, z: 1 },
      boxes: [
        {
          id: 'body',
          socket: 'root',
          region: 'torso',
          armored: false,
          multiplier: 1,
          shape: {
            kind: 'capsule',
            from: { x: 0, y: 0.4, z: 0 },
            to: { x: 0, y: 1.4, z: 0 },
            radius: 0.35,
          },
        },
      ],
    });
    giveCombatant(w, dummy, { health: DUMMY_HEALTH, poise: DUMMY_HEALTH });
    this.world.step();
    return dummy;
  }
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

function fail(message: string): never {
  throw new Error(message);
}

/** The damage multiplier of `type` in `creature`'s data (unlisted types take 1). */
function multiplier(creature: CreatureEntry, type: string): number {
  const table: Readonly<Record<string, number | undefined>> = creature.resistances;
  return table[type] ?? 1;
}

// --- the steps ---------------------------------------------------------------------------------

function spawnStep(rig: Rig): StepResult {
  const { creature } = rig.subject;
  const entity = rig.spawn();
  const health = must(rig.sim.get(entity, HealthComponent), 'health');
  if (health.max !== creature.stats.health || health.current !== creature.stats.health)
    fail(
      `health ${String(health.current)}/${String(health.max)}, data says ${String(creature.stats.health)}`,
    );
  const origin = must(rig.sim.get(entity, CreatureComponent), 'creature state').origin.creature;
  if (origin !== creature.id) fail(`spawned "${origin}", not "${creature.id}"`);
  if (rig.sim.get(entity, PlacementComponent) === undefined) fail('it has no placement');
  return PASSED;
}

function tickStep(rig: Rig): StepResult {
  const { creature } = rig.subject;
  const entity = rig.spawn();
  rig.placePlayer(entity, -40);
  rig.step(TICK_STEP_TICKS);
  if (!rig.sim.isAlive(entity)) fail('it left the world during 10 s of ticking');
  const place = must(rig.sim.get(entity, PlacementComponent), 'placement');
  if (![place.x, place.y, place.z].every(Number.isFinite)) fail('its position is not finite');
  const health = must(rig.sim.get(entity, HealthComponent), 'health');
  if (health.current !== creature.stats.health)
    fail(`it lost health on its own: ${String(health.current)}`);
  return PASSED;
}

function perceiveStep(rig: Rig): StepResult {
  const profile = rig.subject.creature.behaviour.profile;
  const entity = rig.spawn();
  // A creature whose behaviour profile has no behaviour content (every fixture but the guard, and any
  // creature still on the "default" profile) spawns without a brain: nothing perceives for it.
  if (brainOf(rig.sim, entity) === undefined)
    return skipped(
      `behaviour profile "${profile}" has no behaviour content, so it spawns with no brain`,
    );
  const changes: string[] = [];
  rig.sim.events.on(AlertStateChanged, (c) => {
    if (c.entity === entity) changes.push(`${c.from}>${c.to}`);
  });
  // The scripted stimulus: the player walks into its view, 4 m in front of it, in the lit pen.
  rig.placePlayer(entity, 4);
  rig.step();
  for (let i = 0; i < 600; i++) {
    if (brainOf(rig.sim, entity)?.state !== 'unaware') return PASSED;
    rig.step();
  }
  return fail(
    `its alert state stayed unaware for 10 s with the player 4 m in front of it (${changes.join(', ') || 'no changes'})`,
  );
}

/** Resolves attack `id` through hitbox, so a missing ref fails with its name. */
function checkAttackRefs(subject: SmokeSubject, id: string): void {
  const refs = subject.refs ?? subject.content;
  if (!refs.has('attack', id)) fail(`attack "${id}" is missing from content`);
  const attack = refs.get('attack', id);
  const moveId = attack.move.id;
  if (!refs.has('move', moveId)) fail(`attack "${id}": move "${moveId}" is missing`);
  const move = refs.get('move', moveId);
  const track = move.hitbox?.track;
  if (track === undefined) fail(`attack "${id}": move "${moveId}" has no hitbox`);
  if (!refs.has('socket-track', track))
    fail(`attack "${id}": move "${moveId}" hitbox "${track}" (socket-track) is missing`);
}

function attacksStep(rig: Rig): StepResult {
  const { creature } = rig.subject;
  if (creature.attacks.length === 0) return skipped('no attacks declared');
  for (const ref of creature.attacks) checkAttackRefs(rig.subject, ref.id);
  const attacks = rig.game.creatures.attacks;
  for (const ref of creature.attacks) {
    const entity = rig.spawn();
    // The attack executor, not its AI, drives this: the brain would start attacks of its own.
    rig.sim.remove(entity, BrainComponent);
    const attack = must(attacks.get(ref.id), `compiled attack "${ref.id}"`);
    const reach = (attack.rangeMin + attack.rangeMax) / 2;
    const dummy = rig.dummy({ x: ORIGIN.x, y: 0, z: ORIGIN.z - Math.max(reach, 0.8) });
    const telegraphs: string[] = [];
    const ends: string[] = [];
    rig.sim.events.on(TelegraphStarted, (e) => {
      if (e.attacker === entity) telegraphs.push(e.move);
    });
    const struck: number[] = [];
    rig.sim.events.on(DamageApplied, (e) => {
      if (e.target === dummy) struck.push(e.total);
    });
    rig.sim.events.on(AttackEnded, (e) => {
      if (e.attacker === entity && e.attack === ref.id) ends.push(e.reason);
    });
    startAttack(rig.sim, entity, attack, { x: 0, y: 0, z: -1 });
    const limit = attack.move.totalTicks * 3 + 60;
    for (let i = 0; i < limit && ends.length === 0; i++) rig.step();
    if (ends.length === 0) fail(`attack "${ref.id}" never ended in ${String(limit)} ticks`);
    if (telegraphs.length === 0) fail(`attack "${ref.id}" never telegraphed`);
    if (ends[0] !== 'completed') fail(`attack "${ref.id}" ended "${ends[0] ?? ''}", not completed`);
    if (attack.kind === 'melee' && struck.length === 0)
      fail(`attack "${ref.id}" (melee) never hit a dummy ${String(reach)} m away`);
    rig.sim.destroy(dummy);
  }
  return PASSED;
}

function lethalStep(rig: Rig): StepResult {
  const { creature } = rig.subject;
  const entity = rig.spawn();
  const deaths: EntityId[] = [];
  rig.sim.events.on(Died, (e) => deaths.push(e.target));
  const immuneToAll = DAMAGE_TYPES.every((type) => multiplier(creature, type) === 0);
  const model = rig.game.combat.damage;
  if (immuneToAll) {
    // Every type, far beyond its health: none of it may land.
    for (const type of DAMAGE_TYPES)
      model.apply(rig.sim, entity, {
        amounts: { [type]: creature.stats.health * 10 },
        instigator: null,
      });
    rig.step(2);
    const health = must(rig.sim.get(entity, HealthComponent), 'health');
    if (health.current !== creature.stats.health || deaths.includes(entity))
      fail(`immune to every damage type, yet health is ${String(health.current)}`);
    return PASSED;
  }
  const type = must(
    DAMAGE_TYPES.filter((t) => multiplier(creature, t) > 0).sort(
      (a, b) => multiplier(creature, b) - multiplier(creature, a),
    )[0],
    'a damage type it is not immune to',
  );
  const amount = Math.ceil((creature.stats.health * 2) / multiplier(creature, type));
  model.apply(rig.sim, entity, { amounts: { [type]: amount }, instigator: null });
  rig.step(2);
  const health = must(rig.sim.get(entity, HealthComponent), 'health');
  if (health.current !== 0 || !deaths.includes(entity))
    fail(`${String(amount)} ${type} damage left it at ${String(health.current)} health, not dead`);
  return PASSED;
}

function despawnStep(rig: Rig): StepResult {
  const entity = rig.spawn();
  rig.world.step([despawnCreaturesCommand()]);
  if (rig.sim.isAlive(entity)) fail('it is still in the world after despawn');
  if (creatureEntities(rig.sim).length !== 0) fail('creatures remain after despawn');
  return PASSED;
}

const STEPS: Readonly<Record<SmokeStep, (rig: Rig) => StepResult>> = {
  spawn: spawnStep,
  'tick 10 s': tickStep,
  perceive: perceiveStep,
  attacks: attacksStep,
  'lethal damage': lethalStep,
  despawn: despawnStep,
};

// --- discovery and registration ----------------------------------------------------------------

/** The test name of `step` for creature `id`. */
export const smokeName = (id: string, step: string): string => `creature:${id} smoke — ${step}`;

/** One planned test: its name, and how to run it. */
export interface PlannedTest {
  readonly creature: string;
  readonly step: string;
  readonly name: string;
  run(): StepResult;
}

/** Every subject of `content`: one per creature, in id order. */
export function subjectsOf(content: GameContent): SmokeSubject[] {
  return content.all('creature').map((creature) => ({ creature, content }));
}

/**
 * The planned battery for `subjects`: BATTERY.length tests each (plus the scenario steps a creature
 * opted into). A creature's world is built once, on its first step.
 */
export function planSmoke(
  subjects: readonly SmokeSubject[],
  scenarios: CreatureScenarios = {},
): PlannedTest[] {
  return subjects.flatMap((subject) => {
    const id = subject.creature.id;
    let rig: Rig | undefined;
    const rigOf = (): Rig => (rig ??= new Rig(subject));
    const battery = BATTERY.map((step): PlannedTest => ({
      creature: id,
      step,
      name: smokeName(id, step),
      run: () => STEPS[step](rigOf()),
    }));
    const extra = (scenarios[id] ?? []).map((scenario): PlannedTest => ({
      creature: id,
      step: scenario.name,
      name: smokeName(id, scenario.name),
      run: () => {
        scenario.run(rigOf());
        return PASSED;
      },
    }));
    return [...battery, ...extra];
  });
}

/** Runs every planned test, returning each name with how it went (a failure's message included). */
export function runSmoke(
  tests: readonly PlannedTest[],
): { name: string; status: 'passed' | 'failed' | 'skipped'; message: string }[] {
  return tests.map((test) => {
    try {
      const result = test.run();
      return {
        name: test.name,
        status: result.status,
        message: result.status === 'skipped' ? result.reason : '',
      };
    } catch (error) {
      return { name: test.name, status: 'failed', message: (error as Error).message };
    }
  });
}

/** Registers the planned tests with Vitest: one `it` each, skipped steps reported as skipped. */
export function registerSmoke(tests: readonly PlannedTest[]): void {
  for (const test of tests) {
    it(test.name, (context: TestContext) => {
      markExercised(context.task, 'creature', test.creature);
      const result = test.run();
      if (result.status === 'skipped') context.skip(result.reason);
    });
  }
}
