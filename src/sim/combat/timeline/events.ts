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

/** Payload of ChargeReady. */
export interface ChargeReadyInfo extends ActionEventBase {
  /** The charged move a release would swing at full charge. */
  readonly charged: string;
  /** Ticks held (the charged move's fullHoldTicks). */
  readonly held: number;
}

/**
 * A held charge reached full charge (mw-e04.13): emitted once per charge, on the tick the hold reaches
 * the charged move's fullHoldTicks. `move` is the move being held (the uncharged heavy).
 */
export const ChargeReady = defineEvent<ChargeReadyInfo>('ChargeReady');

/** Payload of ChargeReleased. */
export interface ChargeReleaseInfo extends ActionEventBase {
  /** The move the swing plays on as: the charged move, or the uncharged one for a short hold. */
  readonly released: string;
  /** Ticks held. */
  readonly held: number;
  /** Charge level 0–1, or null when the hold was too short to charge (a normal heavy). */
  readonly charge: number | null;
  /** Released by itself at autoReleaseTicks rather than let go. */
  readonly auto: boolean;
}

/**
 * A held charge was let go, or released itself (mw-e04.13): the windup plays on from this tick as
 * `released`. `move` is the move that was held.
 */
export const ChargeReleased = defineEvent<ChargeReleaseInfo>('ChargeReleased');
