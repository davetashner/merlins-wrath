// Stand-in senses for AI scenarios (mw-e11.3). Perception (mw-e11.5) and awareness (mw-e11.6) are
// not built yet, but a scenario has to turn "the player walks through the guard's view in light" into
// what the AI runtime reads: awareness, a stimulus and a target on the blackboard. This is the
// smallest honest model of that, read from each creature's own sense profile, and it is a port: a
// scenario can pass its own senses, and the real perception replaces this one behind the same type.
//
// Sight, per agent with a brain, every tick, from the player's movement profile (mw-e02.10): the
// player's centre (two thirds of its silhouette height, so lower when crouched) is seen when it is
// within far range, inside the peripheral cone horizontally and the vertical half-angle, and no
// layout wall is in the way. Awareness then builds at
//   detectionSpeed × zone (1 primary, ½ peripheral) × range (1 to near, falling to 0 at far)
//   × max(light at the player, darkVision) × the profile's visibility (stance × gait)
// per second; at full awareness the target counts as visible. Unseen, awareness decays 0.1 per second
// and the target is no longer visible. While seen, the stimulus is where the player is.
//
// Hearing: every `noiseEmitted` reaches agents within hearing range at its loudness less 20·log10 of
// the distance (no walls or doors yet: that is sound propagation, mw-e09). Above the threshold it
// raises awareness to at least 0.3 plus 1/40 per dB over, and the stimulus becomes the noise.

import type { EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { BrainComponent } from '../ai/components';
import { writeBlackboard } from '../ai/runtime';
import { movementProfileOf } from '../character/profile';
import { CharacterController } from '../character/system';
import { CombatFacingComponent } from '../combat/melee/components';
import { CreatureNavComponent, CreatureSensesComponent } from '../creatures/components';
import type { LightField } from '../light/field';
import { cos, log, sin } from '../math';
import { noiseEmitted, type NoiseEvent } from '../noise/events';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';

/** Something an agent's senses picked up (or lost), for a scenario's timeline. */
export type SensedStimulus =
  | {
      readonly kind: 'sight';
      readonly agent: EntityId;
      /** It started (true) or stopped (false) seeing the player. */
      readonly seen: boolean;
      /** Light level at the player, 0–1. */
      readonly light: number;
      /** Metres to the player. */
      readonly distance: number;
    }
  | {
      readonly kind: 'hearing';
      readonly agent: EntityId;
      /** Loudness at the agent, dB. */
      readonly db: number;
      readonly at: Vec3;
    };

/** What a scenario's senses get. */
export interface SensesContext {
  /** The player's entity. */
  readonly player: EntityId;
  /** The layout's light (walls are its static occluders). */
  readonly light: LightField;
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
/** Awareness a heard noise gives at the threshold. */
export const STAND_IN_HEARD_BASE = 0.3;
/** dB over the threshold per unit of awareness. */
export const STAND_IN_DB_PER_AWARENESS = 40;

const DEG = Math.PI / 180;
const LN10 = log(10);
/** Eye height as a fraction of the agent's height. */
const EYE = 0.9;
/** The player's centre above its feet as a fraction of its silhouette height. */
const CENTRE = 2 / 3;

/** The stand-in senses (see the file header). */
export const standInSenses: ScenarioSenses = (world, { player, light, note }) => {
  const heard: NoiseEvent[] = [];
  world.events.on(noiseEmitted, (noise) => {
    heard.push(noise);
  });
  const seeing = new Set<EntityId>();
  return {
    name: 'scenario-senses',
    run: ({ clock }) => {
      const dt = 1 / clock.hz;
      const body = world.get(player, CharacterController);
      const profile = movementProfileOf(world, player);
      const noises = heard.splice(0);
      world
        .query(
          BrainComponent,
          CreatureSensesComponent,
          PlacementComponent,
          CreatureNavComponent,
          CombatFacingComponent,
        )
        .forEach((agent, brain, senses, at, nav, { facing }) => {
          const eye = { x: at.x, y: at.y + EYE * nav.height, z: at.z };
          const board = brain.blackboard;
          for (const noise of noises) {
            const hearing = senses.hearing;
            if (hearing === undefined) break;
            const d = distance(eye, noise.position);
            const db = noise.loudness - (20 * log(Math.max(d, 1))) / LN10;
            if (d > hearing.range || db < hearing.thresholdDb) continue;
            const awareness = Math.min(
              1,
              STAND_IN_HEARD_BASE + (db - hearing.thresholdDb) / STAND_IN_DB_PER_AWARENESS,
            );
            writeBlackboard(world, agent, {
              awareness: Math.max(board.awareness, awareness),
              stimulus: noise.position,
            });
            note({ kind: 'hearing', agent, db, at: noise.position });
          }

          const sight = senses.sight;
          if (sight === undefined || body === undefined || profile === undefined) return;
          const feet = body.position;
          const target = { x: feet.x, y: feet.y + CENTRE * profile.silhouetteHeight, z: feet.z };
          const d = distance(eye, target);
          const level = light.levelAt(target);
          const rate =
            sight.detectionSpeed *
            zone(facing, eye, target, d, sight) *
            (d <= sight.nearRange ? 1 : (sight.farRange - d) / (sight.farRange - sight.nearRange)) *
            Math.max(level, sight.darkVision) *
            profile.visibility;
          const seen =
            rate > 0 &&
            light.statics.along(eye.x, eye.y, eye.z, target.x, target.y, target.z, 0).length === 0;
          if (seen !== seeing.has(agent)) {
            if (seen) seeing.add(agent);
            else seeing.delete(agent);
            note({ kind: 'sight', agent, seen, light: level, distance: d });
          }
          if (seen) {
            const awareness = Math.min(1, board.awareness + rate * dt);
            writeBlackboard(world, agent, {
              awareness,
              stimulus: feet,
              target: player,
              targetVisible: awareness >= 1,
            });
          } else if (board.awareness > 0 || board.targetVisible) {
            writeBlackboard(world, agent, {
              awareness: Math.max(0, board.awareness - STAND_IN_DECAY_PER_S * dt),
              targetVisible: false,
            });
          }
        });
    },
  };
};

function distance(a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

interface Sight {
  readonly farRange: number;
  readonly primaryHalfAngle: number;
  readonly peripheralHalfAngle: number;
  readonly verticalHalfAngle: number;
}

/**
 * 1 when `target` is in the primary cone of an agent facing `facing`, ½ in its periphery, 0 outside
 * its view (beyond far range, behind it, or above or below its vertical half-angle).
 */
function zone(facing: Vec3, eye: Vec3, target: Vec3, d: number, sight: Sight): number {
  if (d > sight.farRange) return 0;
  if (Math.abs(target.y - eye.y) > d * sin(sight.verticalHalfAngle * DEG)) return 0;
  const dx = target.x - eye.x;
  const dz = target.z - eye.z;
  const across = Math.sqrt(dx * dx + dz * dz);
  // Straight above or below the eye (across 0) gives NaN: unseen, like everything outside the cone.
  const ahead = (facing.x * dx + facing.z * dz) / across;
  if (ahead >= cos(sight.primaryHalfAngle * DEG)) return 1;
  return ahead >= cos(sight.peripheralHalfAngle * DEG) ? 0.5 : 0;
}
