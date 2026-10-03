// The perception system (mw-e11.5): every creature with a sense profile evaluates its senses at the
// tuning's rate and raises one `perceived` event with what it picked up. It is the only place that
// reads targets' true state (their bodies, the light on them, sight lines to them); agents get only
// the percepts (percept.ts), which is the no-omniscience guarantee.
//
// Schedule. An agent is due on ticks where (tick + entity) mod period is 0, period =
// round(hz / rateHz), so agents are staggered by entity id like AI thinks. Due agents join a queue in
// ascending id order and are evaluated from its head while the tick's work budget lasts; the rest wait
// for the next tick, ahead of agents that fall due then. The budget is counted in work units, not
// milliseconds, so which agent is evaluated on which tick is replay-stable on any machine (as the nav
// request queue, mw-e11.4): one unit per agent evaluated, per sight line traced and per light sample
// read. An evaluation that has started finishes, so a tick may overrun its budget by at most one
// agent, and at least one agent is evaluated every tick that has any due. PERCEPTION_UNITS_PER_MS
// converts a time budget into units; tests/bench/perception.bench.ts holds the conversion.
//
// One evaluation, in this order:
// - Sight (the profile's `sight`): for each target (by default every character-controlled entity, the
//   player) the cone test on its chest (sight.ts); only a target in view costs sight lines, the
//   line-of-sight fraction over its sample points (mw-e09.1). Its visibility score is the e09 model
//   (mw-e09.2) with the agent's dark vision, that fraction, the distance and the light behind it (for
//   the silhouette rule). A seen target is a `seen-target` percept at its feet. Anomalies (supplied by
//   a port: mw-e09.9 defines them) are tested the same way with one sight line and the light at them,
//   as `seen-anomaly` percepts.
// - Hearing (the profile's `hearing`): every `noiseHeard` for the agent since its last evaluation, as a
//   `heard-noise` percept at the perceived position (hearing.ts). The system keeps each agent's
//   `noise.listener` in step with its hearing, so noise propagation (mw-e09.3) knows who listens.
// - Special senses: each channel of the profile with a registered handler (channels.ts).
//
// The agent's eye is its placement raised by the tuning's eye height × its nav agent height; its
// facing is its combat facing (+z without one). The queue, the per-agent hearing buffers and the
// evaluation times live in this system, not in components: they are rebuilt within one period.

import type { ControllerTuning, Frozen, SenseProfile, VisibilityTuning } from '@content/index';
import { CharacterController } from '../character/system';
import { movementProfileOf } from '../character/profile';
import { CombatFacingComponent, FORWARD_FACING } from '../combat/melee/components';
import type { EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { CreatureNavComponent, CreatureSensesComponent } from '../creatures/components';
import type { LightField } from '../light/field';
import { NoiseListenerComponent, noiseHeard, type NoiseHeard } from '../noise/system';
import {
  DEFAULT_SIGHT_SAMPLES,
  type LineOfSight,
  type OcclusionVolume,
} from '../sight/line-of-sight';
import { bodyLightSamples, VisibilityProfileComponent } from '../stealth/self-visibility';
import {
  DEFAULT_VISIBILITY_TUNING,
  lightTerm,
  visibilityTerms,
  type VisibilityProfile,
  type VisibilityTerms,
} from '../stealth/visibility';
import { PlacementComponent, type Placement } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { defaultSenseChannels, type SenseChannelRegistry, type SenseTarget } from './channels';
import { hearingPercept } from './hearing';
import { anomalySource, entitySource, perceived, type Percept } from './percept';
import { coneHit, sightPercept, type ConeHit, type SightProfile } from './sight';
import { DEFAULT_PERCEPTION_TUNING, type PerceptionTuning } from './tuning';

/**
 * Work units perception gets through per millisecond on the reference machine (M1 Pro), with a
 * safety margin: tests/bench/perception.bench.ts measures about 700 on the greybox testbed (Rapier
 * sight lines, shadowed light), so a full 0.5 ms budget runs in about 0.22 ms.
 */
export const PERCEPTION_UNITS_PER_MS = 300;

/** The default per-tick budget, milliseconds. */
export const PERCEPTION_DEFAULT_BUDGET_MS = 0.5;

/** Work units a tick may spend for a budget of `ms` milliseconds (at least one). */
export function perceptionBudgetUnits(ms: number): number {
  return Math.max(1, Math.floor(ms * PERCEPTION_UNITS_PER_MS));
}

/** Something out of place an agent may notice (mw-e09.9 decides what counts). */
export interface AnomalySighting {
  /** Stable id; the percept's source is `anomalySource(id)`. */
  readonly id: string;
  readonly position: Vec3;
  /** How much it stands out, 0–1 (scales its visibility). */
  readonly salience: number;
}

/** A target that passed the cone test, for debug views and the scenario timeline. */
export interface TargetSighting {
  readonly target: EntityId;
  readonly cone: ConeHit;
  /** Every term of its visibility to this agent (`los` 0 when it is behind cover). */
  readonly terms: VisibilityTerms;
  /** The percept it gave, or undefined when it was not seen. */
  readonly percept: Percept | undefined;
}

/** Optional hooks into an evaluation (debug overlays, test timelines). They must not change state. */
export interface PerceptionTrace {
  /** A target was in an agent's view (seen or not). */
  readonly sighted?: (agent: EntityId, sighting: TargetSighting) => void;
  /** An agent heard a noise. */
  readonly heard?: (agent: EntityId, heard: NoiseHeard, percept: Percept) => void;
}

/** How perception is set up. */
export interface PerceptionOptions {
  /** Sight lines (the level's colliders and occlusion). */
  readonly lineOfSight: LineOfSight;
  /** The level's light. */
  readonly light: Pick<LightField, 'levelAt'>;
  readonly tuning?: PerceptionTuning;
  /** Visibility weights (content `stealth`); defaults to the shipped ones. */
  readonly visibility?: VisibilityTuning;
  /** Special-sense handlers; defaults to `defaultSenseChannels()`. */
  readonly channels?: SenseChannelRegistry;
  /** Work units per tick; defaults to `perceptionBudgetUnits(PERCEPTION_DEFAULT_BUDGET_MS)`. */
  readonly unitsPerTick?: number;
  /** Who can be perceived, in a fixed order; defaults to every character-controlled entity. */
  readonly targets?: (world: World<never>) => readonly EntityId[];
  /** Anomalies in the level right now; none by default. */
  readonly anomalies?: (world: World<never>) => readonly AnomalySighting[];
  /** Occlusion volumes in the level right now (smoke, foliage); none by default. */
  readonly volumes?: (world: World<never>) => readonly OcclusionVolume[];
  /** Controller tuning for targets without their own (`movementProfileOf`'s fallback). */
  readonly controller?: Frozen<ControllerTuning>;
  readonly trace?: PerceptionTrace;
}

/** The perception system and its budget bookkeeping. */
export interface PerceptionSystem<TInput> extends System<TInput> {
  /** Work units each tick may spend. */
  readonly unitsPerTick: number;
  /** Work units the last tick spent. */
  readonly lastUnits: number;
  /** Agents due and not yet evaluated. */
  readonly pending: number;
  /** Stops listening for noises; the system does nothing from then on. */
  uninstall(): void;
}

/** A target's body this tick (sampled once per tick, on first use). */
interface TargetBody extends SenseTarget {
  readonly entity: EntityId;
  readonly height: number;
  readonly stance: 'standing' | 'crouched';
  readonly profile: VisibilityProfile | undefined;
}

type Hearing = NonNullable<Frozen<SenseProfile>['hearing']>;

const EMPTY: readonly never[] = Object.freeze([]);

/**
 * The perception system for `world` (see the file header); add it after the systems that move
 * targets and update the light field, and before AI. Needs the creature components registered.
 * @throws RangeError when `unitsPerTick` is below 1 or the tuning's rate is not positive.
 */
export function perceptionSystem<TInput>(
  world: World<TInput>,
  options: PerceptionOptions,
): PerceptionSystem<TInput> {
  const w = world as unknown as World<never>;
  const tuning = options.tuning ?? DEFAULT_PERCEPTION_TUNING;
  const visibilityTuning = options.visibility ?? DEFAULT_VISIBILITY_TUNING;
  const channels = options.channels ?? defaultSenseChannels();
  const unitsPerTick = options.unitsPerTick ?? perceptionBudgetUnits(PERCEPTION_DEFAULT_BUDGET_MS);
  if (!(unitsPerTick >= 1)) throw new RangeError('unitsPerTick must be at least 1');
  if (!(tuning.rateHz > 0)) throw new RangeError('perception rateHz must be positive');
  const { lineOfSight, light, trace } = options;
  const agents = w.query(CreatureSensesComponent, PlacementComponent);

  const heardBy = new Map<EntityId, NoiseHeard[]>();
  const queue: EntityId[] = [];
  const queued = new Set<EntityId>();
  const lastEvaluated = new Map<EntityId, number>();
  let installed = true;
  let lastUnits = 0;

  const unsubscribe = w.events.on(noiseHeard, (heard) => {
    const senses = w.get(heard.listener, CreatureSensesComponent);
    if (senses?.hearing === undefined) return;
    const list = heardBy.get(heard.listener);
    if (list === undefined) heardBy.set(heard.listener, [heard]);
    else list.push(heard);
  });

  const syncListener = (agent: EntityId, hearing: Hearing | undefined): void => {
    const current = w.get(agent, NoiseListenerComponent);
    if (hearing === undefined) {
      if (current !== undefined) w.remove(agent, NoiseListenerComponent);
      return;
    }
    const wanted = Object.freeze({ thresholdDb: hearing.thresholdDb, range: hearing.range });
    if (current === undefined) w.add(agent, NoiseListenerComponent, wanted);
    else if (current.thresholdDb !== wanted.thresholdDb || current.range !== wanted.range) {
      w.set(agent, NoiseListenerComponent, wanted);
    }
  };

  const defaultTargets = (): readonly EntityId[] => {
    return w.isRegistered(CharacterController) ? w.query(CharacterController).ids() : EMPTY;
  };

  return {
    name: 'perception',
    unitsPerTick,
    get lastUnits() {
      return lastUnits;
    },
    get pending() {
      return queue.length;
    },
    uninstall() {
      installed = false;
      unsubscribe();
      queue.length = 0;
      queued.clear();
      heardBy.clear();
    },
    run(ctx) {
      if (!installed) return;
      const { tick } = ctx;
      const hz = ctx.clock.hz;
      const period = Math.max(1, Math.round(hz / tuning.rateHz));
      const listening = w.isRegistered(NoiseListenerComponent);
      agents.forEach((agent, senses) => {
        if (listening) syncListener(agent, senses.hearing);
        if ((tick + agent) % period === 0 && !queued.has(agent)) {
          queue.push(agent);
          queued.add(agent);
        }
      });

      // Everything below is sampled at most once per tick, on first use.
      let units = 0;
      let targets: readonly EntityId[] | undefined;
      let volumes: { volumes: readonly OcclusionVolume[] } | undefined;
      const bodies = new Map<EntityId, TargetBody | undefined>();
      const lightSamples = new Map<EntityId, number[]>();
      const targetIds = (): readonly EntityId[] =>
        (targets ??= options.targets?.(w) ?? defaultTargets());
      const sightOptions = () => (volumes ??= { volumes: options.volumes?.(w) ?? EMPTY });
      const bodyOf = (entity: EntityId): TargetBody | undefined => {
        if (bodies.has(entity)) return bodies.get(entity);
        const body = sampleBody(entity);
        bodies.set(entity, body);
        return body;
      };
      const sampleBody = (entity: EntityId): TargetBody | undefined => {
        const state = w.get(entity, CharacterController);
        const movement = movementProfileOf(w, entity, options.controller);
        if (state === undefined || movement === undefined) return undefined;
        const feet = state.position;
        const height = movement.silhouetteHeight;
        const { x, z } = state.velocity;
        return {
          entity,
          source: entitySource(entity),
          feet,
          height,
          centre: { x: feet.x, y: feet.y + tuning.sight.aimHeight * height, z: feet.z },
          speed: Math.sqrt(x * x + z * z),
          stance: movement.stance,
          profile: w.isRegistered(VisibilityProfileComponent)
            ? w.get(entity, VisibilityProfileComponent)
            : undefined,
        };
      };
      const lightOn = (body: TargetBody): number[] => {
        let samples = lightSamples.get(body.entity);
        if (samples === undefined) {
          samples = bodyLightSamples(light, body.feet, body.height);
          units += samples.length;
          lightSamples.set(body.entity, samples);
        }
        return samples;
      };
      const levelAt = (point: Vec3): number => {
        units += 1;
        return light.levelAt(point);
      };
      const ray = (from: Vec3, to: Vec3): number => {
        units += 1;
        return lineOfSight.ray(from, to, sightOptions());
      };

      const seeTarget = (
        agent: EntityId,
        sight: SightProfile,
        eye: Vec3,
        facing: Vec3,
        body: TargetBody,
      ): Percept | undefined => {
        const cone = coneHit(sight, eye, facing, body.centre);
        if (cone === undefined) return undefined;
        units += DEFAULT_SIGHT_SAMPLES.length;
        const inSight = lineOfSight.visibleFraction(
          eye,
          { feet: body.feet, height: body.height },
          sightOptions(),
        );
        // The light behind the target, along the sight line (an eye inside the target looks nowhere).
        const reach = cone.distance === 0 ? 0 : tuning.sight.backgroundDistance / cone.distance;
        const behind = {
          x: body.centre.x + (body.centre.x - eye.x) * reach,
          y: body.centre.y + (body.centre.y - eye.y) * reach,
          z: body.centre.z + (body.centre.z - eye.z) * reach,
        };
        const terms = visibilityTerms(
          {
            lightSamples: lightOn(body),
            stance: body.stance,
            speed: body.speed,
            ...(body.profile === undefined ? {} : { profile: body.profile }),
            darkVision: sight.darkVision,
            losFraction: inSight,
            distance: cone.distance,
            backgroundLight: levelAt(behind),
          },
          visibilityTuning,
        );
        const seen = sightPercept(
          sight,
          'seen-target',
          { source: body.source, position: body.feet, cone, visibility: terms.value, inSight },
          tuning,
        );
        trace?.sighted?.(agent, { target: body.entity, cone, terms, percept: seen });
        return seen;
      };

      const seeAnomaly = (
        sight: SightProfile,
        eye: Vec3,
        facing: Vec3,
        anomaly: AnomalySighting,
      ): Percept | undefined => {
        const cone = coneHit(sight, eye, facing, anomaly.position);
        if (cone === undefined) return undefined;
        const inSight = ray(eye, anomaly.position);
        if (inSight === 0) return undefined;
        const lit = lightTerm(levelAt(anomaly.position), sight.darkVision, visibilityTuning);
        return sightPercept(
          sight,
          'seen-anomaly',
          {
            source: anomalySource(anomaly.id),
            position: anomaly.position,
            cone,
            visibility: anomaly.salience * inSight * lit,
            inSight,
          },
          tuning,
        );
      };

      const evaluate = (agent: EntityId, senses: Frozen<SenseProfile>, at: Placement): void => {
        units += 1;
        const percepts: Percept[] = [];
        const nav = w.isRegistered(CreatureNavComponent)
          ? w.get(agent, CreatureNavComponent)
          : undefined;
        const raise =
          nav === undefined ? tuning.sight.defaultEyeHeight : tuning.sight.eyeHeight * nav.height;
        const eye = { x: at.x, y: at.y + raise, z: at.z };
        const facing =
          (w.isRegistered(CombatFacingComponent)
            ? w.get(agent, CombatFacingComponent)?.facing
            : undefined) ?? FORWARD_FACING;

        const { sight, hearing, special } = senses;
        if (sight !== undefined) {
          for (const target of targetIds()) {
            if (target === agent) continue;
            const body = bodyOf(target);
            if (body === undefined) continue;
            const seen = seeTarget(agent, sight, eye, facing, body);
            if (seen !== undefined) percepts.push(seen);
          }
          for (const anomaly of options.anomalies?.(w) ?? EMPTY) {
            const seen = seeAnomaly(sight, eye, facing, anomaly);
            if (seen !== undefined) percepts.push(seen);
          }
        }

        const heard = heardBy.get(agent) ?? EMPTY;
        heardBy.delete(agent);
        if (hearing !== undefined) {
          for (const noise of heard) {
            const sound = hearingPercept(hearing, noise, tuning);
            trace?.heard?.(agent, noise, sound);
            percepts.push(sound);
          }
        }

        if (special !== undefined) {
          let senseTargets: SenseTarget[] | undefined;
          for (const [channel, sense] of Object.entries(special)) {
            const handler = channels.handler(channel);
            if (handler === undefined) continue;
            senseTargets ??= targetIds().flatMap((target) => {
              const body = target === agent ? undefined : bodyOf(target);
              return body === undefined ? [] : [body];
            });
            percepts.push(
              ...handler({ channel, sense, eye, targets: senseTargets, lineOfSight: ray, tuning }),
            );
          }
        }

        const last = lastEvaluated.get(agent);
        lastEvaluated.set(agent, tick);
        w.events.emit(perceived, {
          tick,
          agent,
          seconds: (last === undefined ? period : tick - last) / hz,
          percepts: Object.freeze(percepts),
        });
      };

      while (units < unitsPerTick) {
        const agent = queue.shift();
        if (agent === undefined) break;
        queued.delete(agent);
        const senses = w.get(agent, CreatureSensesComponent);
        const at = w.get(agent, PlacementComponent);
        if (senses === undefined || at === undefined) {
          heardBy.delete(agent);
          lastEvaluated.delete(agent);
          continue;
        }
        evaluate(agent, senses, at);
      }
      lastUnits = units;
    },
  };
}
