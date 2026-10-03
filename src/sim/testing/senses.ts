// How agents perceive in an AI scenario (mw-e11.3): the real perception system (mw-e11.5) and the
// real awareness (mw-e11.6), which turns its percepts into what the AI runtime reads: awareness, a
// stimulus and a target on the blackboard. It is a port: a scenario can pass its own senses through
// `deps.senses`.
//
// Perception sees the player only (its sole target) through the layout's walls and by the layout's
// light, and hears noises propagated in the open (the layout has no rooms, so walls do not muffle
// sound). Awareness keeps a record per perceived source with the default tuning; the player's source
// is the one target it may resolve, and sources whose entity is gone are forgotten.
// The timeline gets a sight line each time an agent starts or stops seeing the player (with the light
// level on the player's body and the distance) and a hearing line per heard noise.

import type { EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { installAwareness } from '../ai/awareness';
import { got } from '../ai/util';
import type { LightField } from '../light/field';
import { entitySource, perceived } from '../perception/percept';
import { perceptionSystem, perceptSourcePresent, type TargetSighting } from '../perception/system';
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

/** Real perception and awareness (see the file header). */
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
  installAwareness(world, {
    present: (source) => perceptSourcePresent(world, source),
    target: (source) => (source === playerSource ? player : undefined),
  });
  world.events.on(perceived, ({ agent, percepts }) => {
    const seen = percepts.find((p) => p.kind === 'seen-target' && p.source === playerSource);
    if ((seen !== undefined) === seeing.has(agent)) return;
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
  });
  return system;
};
