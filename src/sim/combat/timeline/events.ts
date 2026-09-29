// Events the action timeline emits (mw-e04.4). Animation picks clips from ActionStarted, the hitbox
// rules (e04.2) open and close a move's hit volume on ActionPhaseChanged (or read `activeHitbox`),
// audio and VFX play the move's cues, and AI learns when a swing was broken off — none of them poll.
// Per move the order is ActionStarted, ActionPhaseChanged for its first phase, one ActionPhaseChanged
// per later phase, then ActionEnded. Refused requests are ActionRejected (combat/actions.ts).

import type { EntityId } from '../../core/component';
import { defineEvent } from '../../core/events';

/** A phase of a move: windup, live, follow-through. */
export type ActionPhase = 'startup' | 'active' | 'recovery';

/** Fields every timeline event carries. */
export interface ActionEventBase {
  /** World tick. */
  readonly tick: number;
  readonly entity: EntityId;
  /** Move id. */
  readonly move: string;
}

/** Payload of ActionStarted. */
export interface ActionStartInfo extends ActionEventBase {
  /** The move this one cancelled, or null when the entity was idle. */
  readonly cancelled: string | null;
  /** The request named a chain root and this is a later hit of that chain. */
  readonly chained: boolean;
}

/** A move started (its first startup tick; its stamina has been spent). */
export const ActionStarted = defineEvent<ActionStartInfo>('ActionStarted');

/** Payload of ActionPhaseChanged. */
export interface ActionPhaseInfo extends ActionEventBase {
  readonly phase: ActionPhase;
  /** The move tick the phase begins on. */
  readonly moveTick: number;
}

/** A move entered a phase (also fired for its first phase, on the tick it starts). */
export const ActionPhaseChanged = defineEvent<ActionPhaseInfo>('ActionPhaseChanged');

/** Why a move ended. */
export type ActionEndReason = 'completed' | 'cancelled' | 'interrupted';

/** Payload of ActionEnded. */
export interface ActionEndInfo extends ActionEventBase {
  readonly reason: ActionEndReason;
  /** The move tick it ended on (its length when completed). */
  readonly moveTick: number;
}

/** A move finished its recovery, was cancelled into another move, or was interrupted. */
export const ActionEnded = defineEvent<ActionEndInfo>('ActionEnded');
