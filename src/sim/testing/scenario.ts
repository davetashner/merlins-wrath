// AI scenarios (mw-e11.3): readable, deterministic tests of creature behaviour over time. A scenario
// loads a grey-box layout (JSON, ./layout.ts), spawns its fixtures (creatures with patrol routes)
// through the creature spawner with AI running, and drives the player along a script with the same
// ActionFrames a real player's input produces (walk, crouch or sprint to a point, wait), plus two
// scripted actions the player has no verb for yet (throw: a noise where it lands; extinguish: a light
// goes out). Expectations are written against time:
//
//   const s = aiScenario(spec, deps);
//   s.at(12).expect('guard1').state('Investigating');
//   s.during(0, 5).expect('guard1').notState('Combat');
//   s.during(0, 3).expect('guard1').enters('Suspicious', 'Unaware');
//   s.check(); // runs headless; throws ScenarioFailedError with the timeline when any fails
//
// A time t is the moment after round(t × hz) ticks have run (t = 0 is before the first). The run goes
// through the replay recorder (mw-e00.17), so it records the state hash every `hashEvery` ticks; two
// runs of one scenario give the same sequence, and a `golden` sequence turns a scenario into a
// regression test. A failed run's report lists every expectation and a timeline of every alert state
// change, what each agent saw and heard, and each step of the player's script, with times.
//
// Until perception (mw-e11.5) and awareness (mw-e11.6) exist, agents perceive through the stand-in
// senses (./senses.ts); `deps.senses` swaps them.

import type { AlertState, ControllerTuning, CreatureTable, Frozen } from '@content/index';
import type { BehaviourTable } from '../ai/behaviour';
import { AlertStateChanged, type Brain } from '../ai/components';
import { brainOf, installAi } from '../ai/runtime';
import { at, got } from '../ai/util';
import { box } from '../character/greybox';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { CharacterController } from '../character/system';
import type { ComponentType, EntityId } from '../core/component';
import { World, type System } from '../core/world';
import {
  registerCreatureComponents,
  spawnCreature,
  spawnErrorMessage,
  facingFromYaw,
} from '../creatures/spawn';
import type { FactionTable } from '../factions/table';
import { installFactions } from '../factions/runtime';
import {
  actionButton,
  actionFrame,
  stickVector,
  type ActionFrame,
  type ActionVector,
} from '../input/action-frame';
import { LightField } from '../light/field';
import { installLightField, lightFieldSystem } from '../light/install';
import { cos, sin } from '../math';
import { noiseEmitted } from '../noise/events';
import { installPlayer, PLAYER_START_TAG, PlayerLook } from '../player/player';
import { addProperties, registerWorldProperties, removeProperty } from '../properties/components';
import type { Replay } from '../replay/format';
import { ReplayRecorder } from '../replay/recorder';
import { yawRotation } from '../scene/layout';
import { PlacementComponent, placeEntity, type Placement } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import {
  parsePlayerScript,
  parseScenarioLayout,
  ScenarioLoadError,
  vec3,
  type PlayerStep,
  type ScenarioLayout,
  type PlayerStance,
} from './layout';
import { standInSenses, type ScenarioSenses, type SensedStimulus } from './senses';

/** What a scenario runs on: content compiled by the caller (the sim does not load content). */
export interface ScenarioDeps {
  /** Creatures fixtures may name (`compileCreatures`). */
  readonly creatures: CreatureTable;
  readonly factions: FactionTable;
  /** Behaviours AI runs (`compileBehaviours`). */
  readonly behaviours: BehaviourTable;
  /** The player's controller tuning. */
  readonly controller: Frozen<ControllerTuning>;
  /** How agents perceive; defaults to `standInSenses`. */
  readonly senses?: ScenarioSenses;
}

/** A scenario: its layout and player script as parsed JSON, and how long it runs. */
export interface ScenarioSpec {
  /** Names the scenario in errors and reports. */
  readonly name: string;
  /** The grey-box layout (see ./layout.ts). */
  readonly layout: unknown;
  /** The player's script (see ./layout.ts); none = the player stands still. */
  readonly player?: unknown;
  /** Seconds to run. */
  readonly duration: number;
  /** World seed; default 1. */
  readonly seed?: number;
  /** Tick rate; default 60. */
  readonly hz?: number;
  /** Ticks between recorded state hashes; default 60. */
  readonly hashEvery?: number;
  /** A recorded hash sequence the run must reproduce (regression). */
  readonly golden?: readonly string[];
}

/** An alert state as written in a scenario (either case). */
export type StateName = AlertState | Capitalize<AlertState>;

/** One line of a scenario's timeline. `time` is `tick / hz`, the moment the tick was run. */
export type TimelineEntry = { readonly tick: number; readonly time: number } & (
  | {
      readonly kind: 'state';
      readonly agent: string;
      readonly from: AlertState;
      readonly to: AlertState;
      readonly cause: string;
    }
  | {
      readonly kind: 'sight';
      readonly agent: string;
      readonly seen: boolean;
      readonly light: number;
      readonly distance: number;
    }
  | { readonly kind: 'hearing'; readonly agent: string; readonly db: number; readonly at: Vec3 }
  | { readonly kind: 'player'; readonly action: string }
);

/** How one expectation came out. */
export interface ExpectationResult {
  /** e.g. `at 3.00 s: guard1 is suspicious`. */
  readonly label: string;
  readonly passed: boolean;
  /** Why it failed (empty when it passed). */
  readonly detail: string;
}

/** A finished run. */
export interface ScenarioResult {
  readonly name: string;
  /** Every expectation (and the golden hashes, when given) passed. */
  readonly passed: boolean;
  readonly expectations: readonly ExpectationResult[];
  readonly timeline: readonly TimelineEntry[];
  /** The recorded state hashes: tick 0, then every `hashEvery` ticks, then the last tick. */
  readonly hashes: readonly string[];
  /** The run as a replay (its commands and checkpoints). */
  readonly replay: Replay;
  /** The expectations and the timeline, readable. */
  readonly report: string;
}

/** Thrown by `check()` when a scenario fails; its message is the report. */
export class ScenarioFailedError extends Error {
  override readonly name = 'ScenarioFailedError';

  constructor(readonly result: ScenarioResult) {
    super(result.report);
  }
}

/** Expectations about one agent at one moment. */
export interface MomentExpectation {
  /** Its alert state is `state`. */
  state(state: StateName): void;
  /** Its alert state is not `state`. */
  notState(state: StateName): void;
  /** It runs activity `activity` (null: none). */
  doing(activity: string | null): void;
  /** It stands within `metres` of `point` (horizontally). */
  near(point: readonly [number, number, number], metres: number): void;
}

/** Expectations about one agent over a window. */
export interface WindowExpectation extends MomentExpectation {
  /** It changes into `state` (from `from`, when given) at some moment in the window. */
  enters(state: StateName, from?: StateName): void;
}

interface Expectation {
  readonly label: string;
  readonly agent: string;
  /** First and last tick, inclusive. */
  readonly first: number;
  readonly last: number;
  /**
   * Checked on every tick of the window: what was wrong with the agent's brain, or undefined. Absent
   * for `enters`, which is checked against the timeline after the run.
   */
  readonly check?: (brain: Readonly<Brain>, at: Placement) => string | undefined;
  /** For `enters`: whether a timeline entry is the change it expects. */
  readonly entered?: (entry: TimelineEntry) => boolean;
}

/** A command the scenario's own system carries out (scripted actions without a player verb). */
type ScenarioCommand =
  | {
      readonly kind: 'scenario.throw';
      readonly at: readonly [number, number, number];
      readonly db: number;
    }
  | { readonly kind: 'scenario.extinguish'; readonly light: string };

interface Built {
  readonly world: World;
  readonly drive: (tick: number) => readonly unknown[];
  readonly agents: ReadonlyMap<string, EntityId>;
  readonly timeline: TimelineEntry[];
}

const lower = (state: StateName): AlertState => state.toLowerCase() as AlertState;
const seconds = (t: number): string => `${t.toFixed(2)} s`;
const metres = (v: number): string => v.toFixed(2);

/** Builds an AI scenario; throws a ScenarioLoadError (before anything runs) for a bad spec. */
export function aiScenario(spec: ScenarioSpec, deps: ScenarioDeps): AiScenario {
  return new AiScenario(spec, deps);
}

/** An AI scenario: expectations are added with `at` and `during`, then it is run. */
export class AiScenario {
  readonly name: string;
  readonly layout: ScenarioLayout;
  readonly script: readonly PlayerStep[];
  readonly hz: number;
  /** Ticks the run lasts. */
  readonly ticks: number;
  private readonly expectations: Expectation[] = [];

  constructor(
    private readonly spec: ScenarioSpec,
    private readonly deps: ScenarioDeps,
  ) {
    this.name = spec.name;
    this.hz = spec.hz ?? 60;
    if (!(spec.duration > 0)) {
      throw new ScenarioLoadError(spec.name, [
        `duration must be > 0 s, got ${String(spec.duration)}`,
      ]);
    }
    this.ticks = Math.round(spec.duration * this.hz);
    this.layout = parseScenarioLayout(spec.name, spec.layout);
    this.script = parsePlayerScript(
      spec.name,
      spec.player ?? [],
      this.layout.light.lights.map((light) => light.id),
    );
    this.build(); // fails here, before any tick, when a fixture cannot spawn
  }

  /** Expectations at the moment `t` seconds. */
  at(t: number): { expect(agent: string): MomentExpectation } {
    const tick = this.tickOf(t);
    return {
      expect: (agent) => this.moment(`at ${seconds(t)}`, agent, tick, tick),
    };
  }

  /** Expectations at every moment from `from` to `to` seconds, inclusive. */
  during(from: number, to: number): { expect(agent: string): WindowExpectation } {
    const first = this.tickOf(from);
    const last = this.tickOf(to);
    if (first > last)
      throw new RangeError(`during(${String(from)}, ${String(to)}): from is after to`);
    const when = `during ${seconds(from)}–${seconds(to)}`;
    return {
      expect: (agent) => ({
        ...this.moment(when, agent, first, last),
        enters: (state, from) => {
          const to = lower(state);
          const was = from === undefined ? undefined : lower(from);
          this.expectations.push({
            label: `${when}: ${agent} enters ${to}${was === undefined ? '' : ` from ${was}`}`,
            agent,
            first,
            last,
            entered: (entry) =>
              entry.kind === 'state' &&
              entry.agent === agent &&
              entry.to === to &&
              (was === undefined || entry.from === was),
          });
        },
      }),
    };
  }

  /** Runs the scenario headless and evaluates every expectation. */
  run(): ScenarioResult {
    const { world, drive, agents, timeline } = this.build();
    const recorder = new ReplayRecorder(world, {
      scenario: this.name,
      buildSha: 'scenario',
      contentHash: null,
      checkpointInterval: this.spec.hashEvery,
      keepStates: false,
    });
    const failures = new Map<Expectation, string>();
    const observe = (tick: number): void => {
      for (const e of this.expectations) {
        const { check } = e;
        if (check === undefined || tick < e.first || tick > e.last || failures.has(e)) continue;
        const entity = got(agents, e.agent);
        const brain = brainOf(world, entity);
        const wrong =
          brain === undefined
            ? 'it has no brain'
            : check(brain, component(world, entity, PlacementComponent));
        if (wrong !== undefined) failures.set(e, `${wrong} at ${seconds(tick / this.hz)}`);
      }
    };
    observe(0);
    for (let tick = 0; tick < this.ticks; tick++) {
      recorder.step(drive(tick));
      observe(world.tick);
    }
    for (const e of this.expectations) {
      const { entered, first, last } = e;
      if (entered === undefined) continue;
      if (!timeline.some((entry) => entry.tick >= first && entry.tick <= last && entered(entry))) {
        failures.set(e, 'it did not');
      }
    }
    const replay = recorder.finish();
    const hashes = replay.checkpoints.map((checkpoint) => checkpoint.hash);
    const expectations: ExpectationResult[] = this.expectations.map((e) => ({
      label: e.label,
      passed: !failures.has(e),
      detail: failures.get(e) ?? '',
    }));
    const golden = this.spec.golden;
    if (golden !== undefined) {
      expectations.push({
        label: 'state hashes match the recording',
        ...this.compareHashes(golden, hashes, replay),
      });
    }
    const passed = expectations.every((e) => e.passed);
    const partial = { name: this.name, passed, expectations, timeline, hashes, replay };
    return { ...partial, report: formatReport(partial) };
  }

  /** Runs the scenario; throws a ScenarioFailedError carrying the report when it fails. */
  check(): ScenarioResult {
    const result = this.run();
    if (!result.passed) throw new ScenarioFailedError(result);
    return result;
  }

  private tickOf(t: number): number {
    if (!(t >= 0 && t <= this.spec.duration)) {
      throw new RangeError(
        `scenario "${this.name}": time ${String(t)} s is outside 0–${String(this.spec.duration)} s`,
      );
    }
    return Math.round(t * this.hz);
  }

  private moment(when: string, agent: string, first: number, last: number): MomentExpectation {
    if (!this.layout.fixtures.some((fixture) => fixture.id === agent)) {
      const known = this.layout.fixtures.map((fixture) => fixture.id).join(', ');
      throw new RangeError(`scenario "${this.name}" has no fixture "${agent}" (it has: ${known})`);
    }
    const add = (label: string, check: NonNullable<Expectation['check']>): void => {
      this.expectations.push({ label: `${when}: ${agent} ${label}`, agent, first, last, check });
    };
    return {
      state: (name) => {
        const state = lower(name);
        add(`is ${state}`, (brain) => (brain.state === state ? undefined : `was ${brain.state}`));
      },
      notState: (name) => {
        const state = lower(name);
        add(`is not ${state}`, (brain) => (brain.state === state ? `was ${state}` : undefined));
      },
      doing: (activity) => {
        add(`is doing ${String(activity)}`, (brain) =>
          brain.activity === activity ? undefined : `was doing ${String(brain.activity)}`,
        );
      },
      near: ([x, , z], metres) => {
        add(`is within ${String(metres)} m of (${String(x)}, ${String(z)})`, (_, here) => {
          const dx = here.x - x;
          const dz = here.z - z;
          const off = Math.sqrt(dx * dx + dz * dz);
          return off <= metres ? undefined : `was ${off.toFixed(2)} m away`;
        });
      },
    };
  }

  private compareHashes(
    golden: readonly string[],
    hashes: readonly string[],
    replay: Replay,
  ): { passed: boolean; detail: string } {
    const index = hashes.findIndex((hash, i) => hash !== golden[i]);
    if (index >= 0) {
      const { tick } = at(replay.checkpoints, index);
      const expected = golden[index] ?? 'nothing';
      return {
        passed: false,
        detail: `at ${seconds(tick / this.hz)} the state hash is ${at(hashes, index)}, the recording has ${expected}`,
      };
    }
    if (golden.length !== hashes.length) {
      return {
        passed: false,
        detail: `the recording has ${String(golden.length)} hashes, the run ${String(hashes.length)}`,
      };
    }
    return { passed: true, detail: '' };
  }

  /** A fresh world at tick 0 with everything spawned, and the player's driver. */
  private build(): Built {
    const { layout, deps, hz } = this;
    const world = new World<unknown>({ seed: this.spec.seed ?? 1, hz });
    const w = world as World<never>;
    installFactions(registerWorldProperties(registerCreatureComponents(w)));
    const timeline: TimelineEntry[] = [];
    const log = (entry: TimelineEntry): void => {
      timeline.push(entry);
    };
    /** Entries are stamped with the tick that is running: visible once it has run. */
    const now = (): { tick: number; time: number } => ({
      tick: world.tick + 1,
      time: (world.tick + 1) / hz,
    });

    // Walls block the player (on a ground slab at y 0) and light and sight.
    const collision = new FakeCollisionWorld([
      box({ x: -1000, y: -1, z: -1000 }, { x: 1000, y: 0, z: 1000 }),
    ]);
    const light = new LightField();
    light.setEnvironment({
      ambient: layout.light.ambient,
      ambientZones: layout.light.zones.map((zone) => ({
        id: zone.id,
        min: vec3(zone.min),
        max: vec3(zone.max),
        level: zone.level,
      })),
    });
    for (const wall of layout.walls) {
      const shape = box(vec3(wall.min), vec3(wall.max));
      collision.add(shape);
      light.statics.add(shape);
    }
    installLightField(w, light);
    const lights = new Map<string, EntityId>();
    for (const lamp of layout.light.lights) {
      const entity = world.spawn();
      placeEntity(w, entity, vec3(lamp.at));
      addProperties(w, entity, {
        lightEmitter: { intensity: lamp.intensity, radius: lamp.radius },
      });
      lights.set(lamp.id, entity);
    }

    world.addSystem(actionSystem(lights));
    const start = layout.player;
    const player = installPlayer(world, {
      spawns: [
        {
          id: 'player-start',
          position: vec3(start.at),
          yaw: start.yaw,
          rotation: yawRotation(start.yaw),
          prop: undefined,
          tags: [PLAYER_START_TAG],
        },
      ],
      collision,
      tuning: deps.controller,
    });
    world.addSystem(lightFieldSystem(light));

    const names = new Map<EntityId, string>();
    const senses = deps.senses ?? standInSenses;
    world.addSystem(
      senses(w, {
        player,
        light,
        note: (stimulus: SensedStimulus) => {
          const { agent: entity, ...rest } = stimulus;
          log({ ...now(), ...rest, agent: got(names, entity) });
        },
      }),
    );
    installAi(w, { behaviours: deps.behaviours });

    const agents = new Map<string, EntityId>();
    const issues: string[] = [];
    layout.fixtures.forEach((fixture, i) => {
      const result = spawnCreature(
        w,
        { creatures: deps.creatures, factions: deps.factions },
        {
          creature: fixture.creature,
          at: vec3(fixture.at),
          facing: facingFromYaw(fixture.yaw),
          point: fixture.id,
          ...(fixture.faction !== undefined && { faction: fixture.faction }),
          ...(fixture.patrol !== undefined && { patrol: fixture.patrol.map(vec3) }),
        },
      );
      if (result.ok) {
        agents.set(fixture.id, result.entity);
        names.set(result.entity, fixture.id);
      } else {
        issues.push(
          `layout.fixtures[${String(i)}] "${fixture.id}": ${spawnErrorMessage(result.error)}`,
        );
      }
    });
    if (issues.length > 0) throw new ScenarioLoadError(this.name, issues);

    world.events.on(AlertStateChanged, ({ tick, entity, from, to, cause }) => {
      log({
        tick: tick + 1,
        time: (tick + 1) / hz,
        kind: 'state',
        agent: got(names, entity),
        from,
        to,
        cause,
      });
    });
    const drive = playerDriver(world, player, this.script, hz, (action) => {
      log({ ...now(), kind: 'player', action });
    });
    return { world, drive, agents, timeline };
  }
}

/** Carries out the scripted actions among a tick's commands. */
function actionSystem(lights: ReadonlyMap<string, EntityId>): System<unknown> {
  return {
    name: 'scenario-actions',
    run: ({ world, inputs, tick }) => {
      const w = world as World<never>;
      for (const input of inputs as readonly (ScenarioCommand | ActionFrame)[]) {
        if (input.kind === 'scenario.throw') {
          w.events.emit(noiseEmitted, {
            tick,
            position: vec3(input.at),
            loudness: input.db,
            kind: 'throw',
            entity: null,
            source: null,
          });
        } else if (input.kind === 'scenario.extinguish') {
          removeProperty(w, got(lights, input.light), 'lightEmitter');
        }
      }
    },
  };
}

const ZERO: ActionVector = stickVector(0, 0);

/** `entity`'s `type`, which it has by construction (the player's controller and look). */
function component<T>(world: World, entity: EntityId, type: ComponentType<T>): T {
  return world.get(entity, type) as T;
}

/** A frame moving the stick to `move`, holding crouch or sprint for `stance`. */
function frame(move: ActionVector, stance: PlayerStance): ActionFrame {
  return actionFrame({
    move,
    look: ZERO,
    buttons: (action) => actionButton(false, action === stance, false),
  });
}

function describeStep(step: PlayerStep): string {
  if ('to' in step) {
    const [x, , z] = step.to.length === 2 ? [step.to[0], 0, step.to[1]] : step.to;
    return `${step.stance} to (${metres(x)}, ${metres(z)})`;
  }
  if ('wait' in step) return `wait ${seconds(step.wait)}`;
  if ('throw' in step) {
    return `throw to (${step.throw.map(metres).join(', ')}), ${String(step.db)} dB`;
  }
  return `extinguish ${step.extinguish}`;
}

/**
 * The player's input, tick by tick: an ActionFrame steering toward the current point (the stick
 * relative to the player's look yaw, as a real player steers), plus scenario commands for throws
 * and extinguishes. Steps that finish at once (an arrival, a throw) chain within the tick.
 */
function playerDriver(
  world: World,
  player: EntityId,
  script: readonly PlayerStep[],
  hz: number,
  note: (action: string) => void,
): (tick: number) => readonly unknown[] {
  let index = 0;
  let started = -1;
  return (tick) => {
    const commands: unknown[] = [];
    const next = (): void => {
      index++;
      started = -1;
    };
    for (;;) {
      const step = script[index];
      if (step === undefined) return [...commands, frame(ZERO, 'walk')];
      if (started < 0) {
        started = tick;
        note(describeStep(step));
      }
      if ('throw' in step) {
        commands.push({ kind: 'scenario.throw', at: step.throw, db: step.db });
        next();
      } else if ('extinguish' in step) {
        commands.push({ kind: 'scenario.extinguish', light: step.extinguish });
        next();
      } else if ('wait' in step) {
        if (tick - started < Math.round(step.wait * hz)) {
          return [...commands, frame(ZERO, step.stance)];
        }
        next();
      } else {
        const here = component(world, player, CharacterController).position;
        const goal =
          step.to.length === 2
            ? { x: step.to[0], z: step.to[1] }
            : { x: step.to[0], z: step.to[2] };
        const dx = goal.x - here.x;
        const dz = goal.z - here.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (distance > step.within) {
          // The controller moves along right × stick.x + forward × stick.y, with
          // right = (cos ψ, 0, −sin ψ) and forward = (−sin ψ, 0, −cos ψ) for look yaw ψ.
          const { yaw } = component(world, player, PlayerLook);
          const s = sin(yaw);
          const c = cos(yaw);
          const k = step.speed / distance;
          return [
            ...commands,
            frame(stickVector((dx * c - dz * s) * k, (-dx * s - dz * c) * k), step.stance),
          ];
        }
        next();
      }
    }
  };
}

function describeEntry(entry: TimelineEntry): [string, string] {
  switch (entry.kind) {
    case 'state':
      return [entry.agent, `${entry.from} → ${entry.to} (${entry.cause})`];
    case 'sight':
      return [
        entry.agent,
        `${entry.seen ? 'sees' : 'loses sight of'} the player (light ${entry.light.toFixed(2)}, ${entry.distance.toFixed(1)} m)`,
      ];
    case 'hearing':
      return [
        entry.agent,
        `hears a noise at (${metres(entry.at.x)}, ${metres(entry.at.y)}, ${metres(entry.at.z)}), ${entry.db.toFixed(1)} dB`,
      ];
    case 'player':
      return ['player', entry.action];
  }
}

/** The readable report of a run: expectations, then the timeline. */
export function formatReport(result: Omit<ScenarioResult, 'report'>): string {
  const failed = result.expectations.filter((e) => !e.passed).length;
  const lines = [
    `scenario "${result.name}": ${failed === 0 ? 'passed' : `${String(failed)} of ${String(result.expectations.length)} expectations failed`}`,
    ...result.expectations.map((e) =>
      e.passed ? `  pass  ${e.label}` : `  FAIL  ${e.label}: ${e.detail}`,
    ),
    'timeline:',
  ];
  const width = Math.max(6, ...result.timeline.map((e) => describeEntry(e)[0].length));
  for (const entry of result.timeline) {
    const [who, what] = describeEntry(entry);
    lines.push(`  ${entry.time.toFixed(3).padStart(8)} s  ${who.padEnd(width)}  ${what}`);
  }
  return lines.join('\n');
}
