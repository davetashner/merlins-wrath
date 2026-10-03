// Alert-machine fuzzing (mw-e11.7 AC-6): drives one agent running a behaviour through many random
// event sequences and checks that the machine never leaves its table. Each sequence starts the agent
// in a random state of the behaviour, then applies random events, one per think: awareness rising or
// falling with a stimulus, the target coming into or out of sight, a last-known position, a queued
// external event (unseen damage, an ally's alarm), the stimulus forgotten, time passing for its
// timers (up to two minutes), or a few seconds passing for everything (its activities run on). It reports every move taken (from AlertStateChanged) and every
// state the agent was in after a think, for the caller to check against the table (`alertMoves`) and
// the six states. Seeded, so a failure replays.
//
// The world runs at the behaviour's think rate, so every tick is one think.

import type { AlertState, BehaviourEvent } from '@content/index';
import type { AlertMove, BehaviourTable } from '../ai/behaviour';
import { AlertStateChanged, BrainComponent, type Brain } from '../ai/components';
import { giveBrain, installAi, queueAiEvent, writeBlackboard } from '../ai/runtime';
import { at, got } from '../ai/util';
import { CombatFacingComponent } from '../combat/melee/components';
import { World } from '../core/world';
import { Rng } from '../rng';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';

const EVENTS: readonly BehaviourEvent[] = ['damaged-by-unseen', 'ally-alarm'];

/** How to fuzz. */
export interface AlertFuzzOptions {
  /** Random event sequences to run. */
  readonly sequences: number;
  /** Events per sequence. */
  readonly steps: number;
  /** Seed of the event stream. */
  readonly seed: number;
}

/** What a fuzz run saw. */
export interface AlertFuzzReport {
  readonly sequences: number;
  /** Thinks run. */
  readonly thinks: number;
  /** How often each move was taken, by `from>to`. */
  readonly taken: ReadonlyMap<AlertMove, number>;
  /** Every state the agent was in after a think. */
  readonly states: ReadonlySet<AlertState>;
}

/** Fuzzes behaviour `id` of `behaviours` (see the file header). */
export function fuzzAlertMachine(
  behaviours: BehaviourTable,
  id: string,
  options: AlertFuzzOptions,
): AlertFuzzReport {
  const behaviour = got(behaviours, id);
  const states = [...behaviour.states.keys()];
  const steps = options.steps;
  const rng = Rng.create(options.seed);
  const world = new World<never>({ seed: 1, hz: behaviour.thinkHz });
  world.register(PlacementComponent, CombatFacingComponent);
  installAi(world, { behaviours });
  const agent = world.spawn();
  const foe = world.spawn();
  placeEntity(world, agent, { x: 0, y: 0, z: 0 });
  placeEntity(world, foe, { x: 0, y: 0, z: 4 });
  giveBrain(world, agent, { behaviour: id, gaits: { sneak: 1, walk: 2, run: 4 } });
  world.step();
  const brain = (): Brain => got({ get: (e: number) => world.get(e, BrainComponent) }, agent);

  const taken = new Map<AlertMove, number>();
  const visited = new Set<AlertState>();
  world.events.on(AlertStateChanged, ({ from, to }) => {
    const move: AlertMove = `${from}>${to}`;
    taken.set(move, (taken.get(move) ?? 0) + 1);
  });

  const point = (): Vec3 => ({ x: rng.float() * 20 - 10, y: 0, z: rng.float() * 20 - 10 });
  const events: (() => void)[] = [
    () => writeBlackboard(world, agent, { awareness: rng.float(), stimulus: point() }),
    () => writeBlackboard(world, agent, { awareness: rng.float() * 0.3 }),
    () => writeBlackboard(world, agent, { target: foe, targetVisible: true, lkp: point() }),
    () => writeBlackboard(world, agent, { targetVisible: false }),
    () => queueAiEvent(world, agent, at(EVENTS, rng.int(0, EVENTS.length - 1))),
    () => writeBlackboard(world, agent, { awareness: 0, stimulus: null }),
    () => {
      const b = brain();
      const skip = rng.int(0, 120 * world.clock.hz);
      b.enteredTick -= skip;
      b.blackboard.stimulusTick -= skip;
      b.blackboard.targetSeenTick -= skip;
    },
    () => {
      for (let n = rng.int(1, 6 * world.clock.hz); n > 1; n--) think();
    },
  ];

  let thinks = 0;
  const think = () => {
    world.step();
    thinks++;
    visited.add(brain().state);
  };
  for (let s = 0; s < options.sequences; s++) {
    const b = brain();
    b.state = at(states, rng.int(0, states.length - 1));
    b.enteredTick = world.tick;
    b.activity = null;
    b.ended = null;
    b.events = [];
    b.retry = [];
    for (let i = 0; i < steps; i++) {
      at(events, rng.int(0, events.length - 1))();
      think();
    }
  }
  return { sequences: options.sequences, thinks, taken, states: visited };
}
