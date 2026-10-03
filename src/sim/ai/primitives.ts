// Action primitives (mw-e11.2, ADR-0005 §4): the steps activities are made of. A primitive is
// compiled once per step into a runner; the runtime calls `start` when the step begins (with
// `stepTick` set and `stepData` cleared) and `update` every tick until it returns success or failure.
// Primitives keep their memory in `brain.stepData` (plain numbers), never in closures, so a save
// taken mid-step resumes identically. Timing is in sim ticks; randomness comes from the world's `ai`
// stream; nothing reads the wall clock.
//
// No omniscience (mw-e11.8): a primitive reads only its own agent's placement. `target` aims at the
// bounded prediction of the target's memory (memory.ts), never at the target entity, so a target
// that slips out of sight is hunted where it was last seen heading; `lkp` aims at the same
// prediction while there is a target memory, else at the blackboard's guess.
//
// Fighting (mw-e11.13, combat.ts): `strike` closes in and performs one attack, chosen among those
// usable at the distance, under the target's attack-token budget, and waits as close as it can get
// to a target it cannot reach; `circle` strafes around the target at a preferred range between
// attacks; `share-target` tells allies where it believes the target is (as an event: who hears it
// is the world's business, not the agent's).
//
// Leashes (mw-e01.17, leash.ts): out of Combat a leashed agent's `move-to` goal is pulled in to its
// leash edge; `post` is its leash post (its spawn without a leash), and arriving there turns it the
// way it was placed.
//
// The compiler table is typed against the content vocabulary (BEHAVIOUR_PRIMITIVES), so a primitive
// added to the schema without a runner here fails the typecheck.

import type {
  BehaviourPrimitive,
  BehaviourStepDef,
  BehaviourTarget,
  RuntimeAttack,
  Tunable,
} from '@content/index';
import { AttackerComponent } from '../combat/attacks/components';
import { currentAttack } from '../combat/attacks/components';
import { canStartAttack, startAttack } from '../combat/attacks/executor';
import { cos, sin } from '../math';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { emitNoise } from '../noise/system';
import type { Creature } from '../creatures/components';
import {
  attackWeights,
  believedTarget,
  combatOf,
  distance3,
  hasAttackToken,
  pickWeighted,
} from './combat';
import { AiCuePlayed, AiTargetShared, RouteBlocked, type Brain } from './components';
import { leashOf, withinLeash } from './leash';
import { recall } from './memory';
import { approach, face, type AiStatus } from './navigation';
import {
  activeRoute,
  faceYaw,
  nearestWaypoint,
  nextWaypoint,
  scanYaw,
  type ActiveRoute,
  type PatrolRoute,
} from './routes';
import { at, getIf } from './util';
import type { AgentView, Num } from './view';

/** A compiled step. */
export interface StepRunner {
  readonly primitive: BehaviourPrimitive;
  /** Runs once as the step begins. */
  readonly start?: (view: AgentView) => void;
  /** Runs every tick the step is current (including the tick it began). */
  readonly update: (view: AgentView) => AiStatus;
}

/** Turns a number-or-tuning-key into a reader. */
export type NumOf = (value: Tunable) => Num;

type StepOf<K extends BehaviourPrimitive> = Extract<BehaviourStepDef, { readonly do: K }>;

type Compilers = {
  readonly [K in BehaviourPrimitive]: (step: StepOf<K>, num: NumOf) => StepRunner;
};

/** The `kind` of the noises `emit-noise` raises on `noiseEmitted` (mw-e09.22). */
export const AI_NOISE_KIND = 'ai';

/** Metres within which `follow-route` counts a waypoint as reached. */
export const WAYPOINT_RADIUS = 0.25;

// `follow-route`'s step data: the tick its dwell ends (-1 walking), waypoints blocked in a row, the
// waypoint it stands at (-1 none), the tick it arrived there, and the routine entry it walks.
const REST = 0;
const BLOCKED = 1;
const AT = 2;
const SINCE = 3;
const ENTRY = 4;
/** A post's dwell: it holds its waypoint for good (a finite number, so saves keep it as JSON). */
const HOLD = Number.MAX_SAFE_INTEGER;

// `strike`'s step data: 1 once its attack has started; the attacks usable when it last rolled (a
// bit per attack it knows, -1 before the first roll); what that roll chose (the index of an attack
// it knows, or -1: close in for one out of reach).
const STRUCK = 0;
const ROLLED = 1;
const CHOICE = 2;
/** `strike` closes to this share of the reach of the attacks it closes in for. */
const CLOSE_IN = 0.9;
/** Metres past the closest an attack is used from that `strike` backs off to. */
const BACK_OFF = 0.25;

// `circle`'s step data: which way it strafes (1 or -1), then the spot it strafes to (x, y, z).
const WAY = 0;
const SPOT = 1;
/** How far around its target one `circle` step strafes: an eighth of a turn. */
const ARC = Math.PI / 4;
const ARC_COS = cos(ARC);
const ARC_SIN = sin(ARC);
/** Metres within which `circle` counts its spot as reached. */
const SPOT_RADIUS = 0.3;

const ticks = (seconds: number, hz: number): number => Math.round(seconds * hz);

/** The agent can reach its target after all: its out-of-reach clock stops. */
function reachable(brain: Brain): void {
  if (brain.combat === undefined) return;
  brain.combat.unreachableSince = -1;
  brain.combat.unreachableAt = null;
}

/** The attacks the agent knows, in data order (its attacker's list, else the whole table). */
function knownAttacks(v: AgentView): RuntimeAttack[] | undefined {
  const table = v.ports.attacks;
  const attacker = getIf(v.world, v.entity, AttackerComponent);
  if (table === undefined || attacker === undefined) return undefined;
  const known: RuntimeAttack[] = [];
  for (const id of attacker.attacks ?? [...table.keys()]) {
    const attack = table.get(id);
    if (attack !== undefined) known.push(attack);
  }
  return known;
}

/** A horizontal unit vector from `from` toward `to` (+x when they stand on one spot). */
function heading(from: Vec3, to: Vec3): { x: number; z: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  return length > 1e-9 ? { x: dx / length, z: dz / length } : { x: 1, z: 0 };
}

/** The agent's own placement (the only one a primitive may read). */
const selfAt = (v: AgentView) => getIf(v.world, v.entity, PlacementComponent);

/** Where the agent believes its target is (mw-e11.8), or undefined with no target memory. */
function believed(v: AgentView): Vec3 | undefined {
  const source = v.brain.blackboard.targetSource;
  if (source === null) return undefined;
  return recall(v.brain.memory, source, v.tick, v.hz, v.ports.memory)?.predicted;
}

/** Turns the agent toward `point` from where it stands (its placement, which the caller checked). */
function faceToward(v: AgentView, point: Vec3): void {
  const here = selfAt(v) as Vec3;
  face(v.world, v.entity, point.x - here.x, point.z - here.z);
}

/** Where `target` is for this agent now, or undefined when it has none or it is gone. */
function targetPoint(v: AgentView, target: BehaviourTarget): Vec3 | undefined {
  const bb = v.brain.blackboard;
  switch (target) {
    case 'stimulus':
      return bb.stimulus ?? undefined;
    case 'target':
      return bb.target === null ? undefined : believed(v);
    case 'lkp':
      return bb.targetSource === null ? (bb.lkp ?? undefined) : believed(v);
    case 'origin':
      return v.creature?.origin.at;
    case 'post':
      return leashOf(v)?.post ?? v.creature?.origin.at;
    case 'nearest-waypoint':
      return activeRoute(v)?.route.waypoints[at(v.brain.stepData, 0)]?.at;
  }
}

/**
 * A `start` hook that remembers the waypoint of the running route nearest by navigation distance
 * when the step targets it (mw-e11.9 AC-3), -1 when there is none.
 */
const startFor = (target: BehaviourTarget) =>
  target === 'nearest-waypoint'
    ? (v: AgentView) => {
        const active = activeRoute(v);
        v.brain.stepData[0] = active === undefined ? -1 : nearestWaypoint(v, active.route);
      }
    : undefined;

/** Ticks since the step began. */
const elapsed = (v: AgentView): number => v.tick - v.brain.stepTick;

const COMPILERS: Compilers = {
  'move-to': (step, num) => {
    const within = num(step.within);
    const start = startFor(step.target);
    return {
      primitive: 'move-to',
      ...(start !== undefined && { start }),
      update(v) {
        const point = targetPoint(v, step.target);
        if (point === undefined) return 'failure';
        const status = v.ports.navigation.travel(v.world, v.entity, {
          goal: withinLeash(v, point),
          within: within(v),
          speed: v.brain.gaits[step.gait],
          dt: 1 / v.hz,
        });
        if (status === 'success' && step.target === 'nearest-waypoint') {
          v.brain.blackboard.waypoint = at(v.brain.stepData, 0);
        }
        if (status === 'success' && step.target === 'post') {
          const { origin } = v.creature as Pick<Creature, 'origin'>; // a post is a creature's
          face(v.world, v.entity, origin.facing.x, origin.facing.z);
        }
        return status;
      },
    };
  },

  'follow-route': (step, num) => {
    const dwell = num(step.dwellS);
    /** Begins walking `active` from the waypoint nearest by navigation distance (resuming). */
    const resume = (v: AgentView, active: ActiveRoute) => {
      const data = v.brain.stepData;
      data[REST] = -1;
      data[BLOCKED] = 0;
      data[AT] = -1;
      data[SINCE] = 0;
      data[ENTRY] = active.entry;
      const nearest = nearestWaypoint(v, active.route);
      if (nearest >= 0) v.brain.blackboard.waypoint = nearest;
    };
    /** Stands at waypoint `index`: faces its look, plays its idle cue, dwells (a post holds). */
    const arrive = (v: AgentView, route: PatrolRoute, index: number) => {
      const wp = at(route.waypoints, index);
      const data = v.brain.stepData;
      if (wp.look !== undefined) faceYaw(v, wp.look);
      if (wp.idle !== undefined) {
        v.world.events.emit(AiCuePlayed, { tick: v.tick, entity: v.entity, cue: wp.idle });
      }
      data[AT] = index;
      data[SINCE] = v.tick;
      data[REST] = route.kind === 'post' ? HOLD : v.tick + ticks(wp.dwellS ?? dwell(v), v.hz);
      data[BLOCKED] = 0;
      v.brain.blackboard.waypoint = nextWaypoint(v, route, index);
    };
    return {
      primitive: 'follow-route',
      start(v) {
        const active = activeRoute(v);
        if (active !== undefined) resume(v, active);
      },
      update(v) {
        const active = activeRoute(v);
        if (active === undefined) return 'failure';
        const data = v.brain.stepData;
        if (data[ENTRY] !== active.entry) resume(v, active); // its schedule moved it to another route
        const { route } = active;
        const bb = v.brain.blackboard;
        const resting = at(data, REST);
        if (resting >= 0) {
          if (v.tick < resting) {
            const yaw = scanYaw(at(route.waypoints, at(data, AT)), v.tick - at(data, SINCE), v.hz);
            if (yaw !== undefined) faceYaw(v, yaw);
            return 'running';
          }
          data[REST] = -1;
          data[AT] = -1;
        }
        const n = route.waypoints.length;
        for (;;) {
          const index = bb.waypoint % n;
          const wp = at(route.waypoints, index);
          const status = v.ports.navigation.travel(v.world, v.entity, {
            goal: wp.at,
            within: WAYPOINT_RADIUS,
            speed: v.brain.gaits[step.gait],
            dt: 1 / v.hz,
          });
          if (status === 'running') return 'running';
          if (status === 'success') {
            arrive(v, route, index);
            return 'running';
          }
          // Unreachable (a locked door): report it and skip to the next waypoint (AC-4).
          v.world.events.emit(RouteBlocked, {
            tick: v.tick,
            entity: v.entity,
            route: route.id,
            waypoint: wp.id,
            at: wp.at,
          });
          bb.waypoint = nextWaypoint(v, route, index);
          data[BLOCKED] = at(data, BLOCKED) + 1;
          if (at(data, BLOCKED) >= n) return 'failure';
        }
      },
    };
  },

  'look-at': (step, num) => {
    const seconds = num(step.seconds);
    const start = startFor(step.target);
    return {
      primitive: 'look-at',
      ...(start !== undefined && { start }),
      update(v) {
        const point = targetPoint(v, step.target);
        const at = selfAt(v);
        if (point === undefined || at === undefined) return 'failure';
        face(v.world, v.entity, point.x - at.x, point.z - at.z);
        return elapsed(v) >= ticks(seconds(v), v.hz) ? 'success' : 'running';
      },
    };
  },

  'look-around': (step, num) => {
    const seconds = num(step.seconds);
    return {
      primitive: 'look-around',
      update(v) {
        const done = elapsed(v);
        if (done >= ticks(seconds(v), v.hz)) return 'success';
        if (done % v.hz === 0) {
          const yaw = v.world.random('ai').float() * 2 * Math.PI;
          face(v.world, v.entity, sin(yaw), cos(yaw));
        }
        return 'running';
      },
    };
  },

  wait: (step, num) => {
    const seconds = num(step.seconds);
    return {
      primitive: 'wait',
      update: (v) => (elapsed(v) >= ticks(seconds(v), v.hz) ? 'success' : 'running'),
    };
  },

  'play-cue': (step) => ({
    primitive: 'play-cue',
    update(v) {
      v.world.events.emit(AiCuePlayed, { tick: v.tick, entity: v.entity, cue: step.cue });
      return 'success';
    },
  }),

  'emit-noise': (step, num) => {
    const db = num(step.db);
    return {
      primitive: 'emit-noise',
      update(v) {
        const at = selfAt(v);
        if (at === undefined) return 'failure';
        // On the shared channel (mw-e09.22), so noise propagation carries it to every listener.
        emitNoise(v.world, {
          position: at,
          loudness: db(v),
          kind: AI_NOISE_KIND,
          entity: v.entity,
          source: v.entity,
        });
        return 'success';
      },
    };
  },

  attack: (step) => {
    const id = step.attack.id;
    return {
      primitive: 'attack',
      update(v) {
        const { world, entity } = v;
        if (v.brain.stepData[0] === 1) {
          return currentAttack(world, entity) === undefined ? 'success' : 'running';
        }
        const attack = v.ports.attacks?.get(id);
        const from = selfAt(v);
        const to = targetPoint(v, 'target');
        if (attack === undefined || from === undefined || to === undefined) return 'failure';
        if (getIf(world, entity, AttackerComponent) === undefined) return 'failure';
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (!canStartAttack(world, entity, attack, { distance }).ok) return 'failure';
        startAttack(
          world,
          entity,
          attack,
          dx === 0 && dz === 0 ? { x: 0, y: 0, z: 1 } : { x: dx, y: 0, z: dz },
        );
        v.brain.stepData[0] = 1;
        return 'running';
      },
    };
  },

  strike: (step, num) => {
    const giveUp = num(step.giveUpS);
    return {
      primitive: 'strike',
      start(v) {
        v.brain.stepData.push(0, -1, -1);
      },
      update(v) {
        const { world, entity, brain } = v;
        const data = brain.stepData;
        if (at(data, STRUCK) === 1) {
          if (currentAttack(world, entity) !== undefined) return 'running';
          combatOf(brain).token = -1;
          return 'success';
        }
        const target = brain.blackboard.target;
        const goal = believedTarget(v);
        const from = selfAt(v);
        const known = knownAttacks(v);
        if (target === null || goal === undefined || from === undefined || known === undefined) {
          return 'failure';
        }
        // Sort its attacks by what the distance allows: usable now, out of reach, too close.
        const distance = distance3(from, goal);
        const usable: number[] = [];
        const far: number[] = [];
        const near: number[] = [];
        let mask = 0;
        known.forEach((attack, i) => {
          const check = canStartAttack(world, entity, attack, { distance });
          if (check.ok) {
            usable.push(i);
            mask += 2 ** i;
          } else if (check.reason === 'too-far') far.push(i);
          else if (check.reason === 'too-close') near.push(i);
        });
        if (at(data, ROLLED) !== mask) {
          data[ROLLED] = mask;
          const pool = [...usable, ...far].map((i) => at(known, i));
          const weights = attackWeights(pool, brain.traits['aggression'] ?? 0.5);
          let closeIn = 0;
          for (let k = usable.length; k < weights.length; k++) closeIn += at(weights, k);
          const pick = pickWeighted(
            [...weights.slice(0, usable.length), closeIn],
            world.random('ai').float(),
          );
          data[CHOICE] = pick >= 0 && pick < usable.length ? at(usable, pick) : -1;
        }
        if (usable.length > 0) reachable(brain);
        const choice = at(data, CHOICE);
        if (choice >= 0) {
          if (!hasAttackToken(v)) return 'failure';
          const dx = goal.x - from.x;
          const dz = goal.z - from.z;
          const aim = dx === 0 && dz === 0 ? { x: 0, y: 0, z: 1 } : { x: dx, y: 0, z: dz };
          startAttack(world, entity, at(known, choice), aim);
          combatOf(brain).token = target;
          data[STRUCK] = 1;
          return 'running';
        }
        const move = { speed: brain.gaits[step.gait], dt: 1 / v.hz };
        if (far.length > 0) {
          let reach = Infinity;
          for (const i of far) reach = Math.min(reach, at(known, i).rangeMax);
          const status = approach(v.ports.navigation, world, entity, {
            goal,
            within: reach * CLOSE_IN,
            ...move,
          });
          if (status === 'failure') return 'failure';
          const here = selfAt(v) as Vec3; // travel moves it, never removes it
          if (status === 'running' || (status === 'success' && distance3(here, goal) <= reach)) {
            reachable(brain);
            return 'running';
          }
          // As close as it can get: it waits there, facing its target, until it gives up.
          faceToward(v, goal);
          const combat = combatOf(brain);
          if (combat.unreachableSince < 0) {
            combat.unreachableSince = v.tick;
            combat.unreachableAt = { x: goal.x, y: goal.y, z: goal.z };
          }
          return v.tick - combat.unreachableSince >= ticks(giveUp(v), v.hz) ? 'failure' : 'running';
        }
        if (near.length > 0) {
          let least = 0;
          for (const i of near) least = Math.max(least, at(known, i).rangeMin);
          const away = heading(goal, from);
          const back = least + BACK_OFF - distance;
          const status = v.ports.navigation.travel(world, entity, {
            goal: { x: from.x + away.x * back, y: from.y, z: from.z + away.z * back },
            within: BACK_OFF / 2,
            ...move,
          });
          faceToward(v, goal);
          return status === 'failure' ? 'failure' : 'running';
        }
        return 'failure'; // nothing ready: every attack cooling down, or barred by its health
      },
    };
  },

  circle: (step, num) => {
    const range = num(step.range);
    const seconds = num(step.seconds);
    return {
      primitive: 'circle',
      start(v) {
        const data = v.brain.stepData;
        const way = v.world.random('ai').float() < 0.5 ? -1 : 1;
        data[WAY] = way;
        const target = believedTarget(v);
        const from = selfAt(v);
        if (target === undefined || from === undefined) return;
        // An eighth of a turn around the target from where it stands, at its preferred range.
        const out = heading(target, from);
        const x = out.x * ARC_COS - way * out.z * ARC_SIN;
        const z = way * out.x * ARC_SIN + out.z * ARC_COS;
        const r = range(v);
        data.push(target.x + x * r, from.y, target.z + z * r);
      },
      update(v) {
        const data = v.brain.stepData;
        const target = believedTarget(v);
        if (target === undefined || data.length <= SPOT || selfAt(v) === undefined) {
          return 'failure';
        }
        if (elapsed(v) >= ticks(seconds(v), v.hz)) return 'success';
        const status = v.ports.navigation.travel(v.world, v.entity, {
          goal: { x: at(data, SPOT), y: at(data, SPOT + 1), z: at(data, SPOT + 2) },
          within: SPOT_RADIUS,
          speed: v.brain.gaits[step.gait],
          dt: 1 / v.hz,
        });
        faceToward(v, target);
        return status;
      },
    };
  },

  'share-target': () => ({
    primitive: 'share-target',
    update(v) {
      const source = v.brain.blackboard.targetSource;
      const memory =
        source === null ? undefined : recall(v.brain.memory, source, v.tick, v.hz, v.ports.memory);
      if (memory !== undefined) {
        v.world.events.emit(AiTargetShared, {
          tick: v.tick,
          entity: v.entity,
          source: memory.source,
          position: memory.predicted,
          confidence: memory.confidence,
        });
      }
      return 'success';
    },
  }),

  'forget-stimulus': () => ({
    primitive: 'forget-stimulus',
    update(v) {
      const bb = v.brain.blackboard;
      bb.stimulus = null;
      bb.awareness = 0;
      return 'success';
    },
  }),
};

/** Whether `name` is a primitive the runtime can run. */
export function isPrimitive(name: string): name is BehaviourPrimitive {
  return Object.hasOwn(COMPILERS, name);
}

/** Compiles one step (its primitive must be known: check with `isPrimitive`). */
export function compileStep(step: BehaviourStepDef, num: NumOf): StepRunner {
  const compile = COMPILERS[step.do] as (step: BehaviourStepDef, num: NumOf) => StepRunner;
  return compile(step, num);
}
