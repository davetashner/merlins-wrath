// Sim → animation parameters (mw-e02.20): reads, never writes, an entity's sim state into the
// parameters animation graphs name (ANIM_PARAMETERS, src/content/types/anim-graph.ts). The action
// timeline (mw-e04.4) supplies the move in progress, its phase and verb, the hit-reaction lock and
// the entity's local time scale; a locomotion reader supplies speed, turn rate and grounded (the
// player's controller, a creature's mover, or the testbed's demo rigs).

import type { AnimParameterName, MoveTable, MoveVerb } from '@content/index';
import { ActionTimelineComponent, phaseAt, type ActionPhase, type EntityId } from '@sim/index';
import type { AnimParamValue } from '@render/animation/index';
import type { SimView } from '../loop/render-sync';

/** What a locomotion reader reports for one entity. */
export interface LocomotionSample {
  /** Horizontal speed, m/s. */
  readonly speed: number;
  /** Yaw rate, rad/s. */
  readonly turnRate: number;
  readonly grounded: boolean;
}

/** Reads an entity's locomotion from the sim (undefined when it has none). */
export type LocomotionReader = (view: SimView, entity: EntityId) => LocomotionSample | undefined;

/** The move in progress at one sim step. */
export interface ActionStep {
  readonly move: string;
  /** The move's clip id (presentation.anim). */
  readonly clip: string;
  /** The world tick it started on: identifies this run of the move. */
  readonly key: number;
  /** Its move tick at this step. */
  readonly tick: number;
  readonly activeFrom: number;
  readonly totalTicks: number;
  readonly phase: ActionPhase;
  readonly verb: MoveVerb;
}

/** An entity's animation parameters at one sim step. */
export interface SimAnimSample {
  readonly values: Readonly<Partial<Record<AnimParameterName, AnimParamValue>>>;
  readonly timeScale: number;
  readonly action: ActionStep | null;
}

/** Reads an entity's animation parameters at the current sim step. */
export type SimAnimReader = (view: SimView, entity: EntityId) => SimAnimSample | undefined;

export interface SimAnimSource {
  /** The move table the action timeline runs (compileMoves of the content's moves). */
  readonly moves: MoveTable;
  /** Speed, turn rate and grounded; without one the entity stands still. */
  readonly locomotion?: LocomotionReader;
}

/**
 * A reader of the sim-published parameters (the world must register the action timeline
 * components): speed/turnRate/grounded from `locomotion`, and
 * acting/actionPhase/actionVerb/hitReact plus the time scale and running move from the entity's
 * action timeline (idle and time scale 1 without one). Undefined when the entity is gone.
 */
export function simAnimReader(source: SimAnimSource): SimAnimReader {
  return (view, entity) => {
    if (!view.isAlive(entity)) return undefined;
    const motion = source.locomotion?.(view, entity);
    const timeline = view.get(entity, ActionTimelineComponent);
    const current = timeline?.current ?? null;
    const move = current === null ? undefined : source.moves.get(current.move);
    const action: ActionStep | null =
      current === null || move === undefined
        ? null
        : {
            move: move.id,
            clip: move.presentation.anim,
            key: current.startedAt,
            tick: current.tick,
            activeFrom: move.activeFrom,
            totalTicks: move.totalTicks,
            phase: phaseAt(move, current.tick),
            verb: move.verb,
          };
    const values: Partial<Record<AnimParameterName, AnimParamValue>> = {
      speed: motion?.speed ?? 0,
      turnRate: motion?.turnRate ?? 0,
      grounded: motion?.grounded ?? true,
      acting: action !== null,
      actionPhase: action?.phase ?? 'none',
      actionVerb: action?.verb ?? 'none',
      hitReact: current === null && (timeline?.lockTicks ?? 0) > 0,
    };
    return { values, timeScale: timeline?.timeScale ?? 1, action };
  };
}
