// How agents perceive in an AI scenario (mw-e11.3): the real perception system (mw-e11.5) and, until
// awareness exists (mw-e11.6), a stand-in that turns its percepts into what the AI runtime reads:
// awareness, a stimulus and a target on the blackboard. It is a port: a scenario can pass its own
// senses through `deps.senses`.
//
// Perception sees the player only (its sole target) through the layout's walls and by the layout's
// light, and hears noises propagated in the open (the layout has no rooms, so walls do not muffle
// sound). Each agent's percepts arrive at the perception rate, and the stand-in awareness applies them:
// - heard-noise: awareness rises to at least STAND_IN_HEARD_BASE + (1 − base) × strength, and the
//   stimulus becomes the noise's perceived position;
// - seen-target: awareness builds at detectionSpeed × strength per second; at full awareness the
//   target counts as visible, and the stimulus is where the player was seen;
// - otherwise awareness decays STAND_IN_DECAY_PER_S per second and the target is no longer visible.
// The timeline gets a sight line each time an agent starts or stops seeing the player (with the light
// level on the player's body and the distance) and a hearing line per heard noise.

import type { EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { brainOf, writeBlackboard } from '../ai/runtime';
import { got } from '../ai/util';
import { CreatureSensesComponent } from '../creatures/components';
import type { LightField } from '../light/field';
import { entitySource, perceived } from '../perception/percept';
import { perceptionSystem, type TargetSighting } from '../perception/system';
import type { LineOfSight } from '../sight/line-of-sight';
import type { Vec3 } from '../stimulus/shapes';

/** Something an agent's senses picked up (or lost), for a scenario's timeline. */
export type SensedStimulus =
  | {
      readonly kind: 'sight';
      readonly agent: EntityId;
      /** It started (true) or stopped (false) seeing the player. */
      readonly seen: boolean;
      /** Light level on the player's body, 0–1. */
      readonly light: number;
      /** Metres to the player. */
      readonly distance: number;
    }
  | {
      readonly kind: 'hearing';
      readonly agent: EntityId;
      /** Loudness at the agent, dB. */
      readonly db: number;
      /** Where it seemed to come from. */
      readonly at: Vec3;
    };

/** What a scenario's senses get. */
export interface SensesContext {
  /** The player's entity. */
  readonly player: EntityId;
  /** The layout's light (walls are its static occluders). */
  readonly light: LightField;
  /** Sight lines against the layout's walls. */
  readonly lineOfSight: LineOfSight;
  /** Reports a stimulus to the scenario's timeline. */
  readonly note: (stimulus: SensedStimulus) => void;
}

/**
 * Builds the system that writes what agents perceive to their blackboards; the scenario runs it after
 * the player and the light field and before the AI.
 */
export type ScenarioSenses = (world: World<never>, context: SensesContext) => System<unknown>;

/** Awareness lost per second while the player is unseen. */
export const STAND_IN_DECAY_PER_S = 0.1;
/** Awareness a heard noise gives at strength 0. */
export const STAND_IN_HEARD_BASE = 0.3;

/** `value`, present by construction. */
const present = <T>(value: T | undefined): T => value as T;

/** Real perception with the stand-in awareness (see the file header). */
export const perceptionSenses: ScenarioSenses = (world, { player, light, lineOfSight, note }) => {
  const sightings = new Map<EntityId, TargetSighting>();
  const seeing = new Set<EntityId>();
  const playerSource = entitySource(player);
  const system = perceptionSystem(world, {
    lineOfSight,
    light,
    targets: () => [player],
    trace: {
      sighted: (agent, sighting) => sightings.set(agent, sighting),
      heard: (agent, heard) => {
        note({ kind: 'hearing', agent, db: heard.level, at: heard.perceived });
      },
    },
  });
  world.events.on(perceived, ({ agent, seconds, percepts }) => {
    const brain = brainOf(world, agent);
    if (brain === undefined) return;
    const board = brain.blackboard;
    for (const p of percepts) {
      if (p.kind !== 'heard-noise') continue;
      writeBlackboard(world, agent, {
        awareness: Math.max(
          board.awareness,
          STAND_IN_HEARD_BASE + (1 - STAND_IN_HEARD_BASE) * p.strength,
        ),
        stimulus: p.position,
      });
    }
    const seen = percepts.find((p) => p.kind === 'seen-target' && p.source === playerSource);
    if ((seen !== undefined) !== seeing.has(agent)) {
      if (seen === undefined) seeing.delete(agent);
      else seeing.add(agent);
      // A sighting comes before every seen-target percept, so the agent has one by now.
      const { terms, cone } = got(sightings, agent);
      note({
        kind: 'sight',
        agent,
        seen: seen !== undefined,
        light: terms.level,
        distance: cone.distance,
      });
    }
    if (seen !== undefined) {
      // Only an agent with sight sees anything.
      const speed = present(
        present(world.get(agent, CreatureSensesComponent)).sight,
      ).detectionSpeed;
      const awareness = Math.min(1, board.awareness + speed * seen.strength * seconds);
      writeBlackboard(world, agent, {
        awareness,
        stimulus: seen.position,
        target: player,
        targetVisible: awareness >= 1,
      });
    } else if (board.awareness > 0 || board.targetVisible) {
      writeBlackboard(world, agent, {
        awareness: Math.max(0, board.awareness - STAND_IN_DECAY_PER_S * seconds),
        targetVisible: false,
      });
    }
  });
  return system;
};
