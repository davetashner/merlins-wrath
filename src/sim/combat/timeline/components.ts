// Action timeline state (mw-e04.4): what an entity's committed-action state machine remembers between
// ticks — the move it is performing and how far into it, an interrupt lock (a hit reaction), the one
// buffered request, and its local time scale. Plain frozen data, replaced never mutated, so snapshots,
// saves and replays carry an entity mid-swing, mid-buffer or mid-hit-stop. An entity keeps its
// component while idle so starting an action is a value change, never a structural one.

import { defineComponent, type EntityId } from '../../core/component';
import type { World } from '../../core/world';
import type { ButtonAction } from '../../input/action-frame';

/** A chargeable move's button held down (mw-e04.13, charge.ts). */
export interface ChargeHold {
  /** Local ticks the button has been down since the move started: 1 on its first tick. */
  readonly held: number;
  /** Still held; false once let go (`releaseCharge`), so the next timeline step releases. */
  readonly holding: boolean;
}

/** The move an entity is performing. */
export interface RunningAction {
  /** Move id (its RuntimeMove in the timeline's move table). */
  readonly move: string;
  /** The move tick the entity is on: 0 on its first startup tick, counted in local time. */
  readonly tick: number;
  /** The world tick it started on. */
  readonly startedAt: number;
  /** While a chargeable move is being held (its windup holds); absent otherwise. */
  readonly hold?: ChargeHold;
  /** Charge level 0–1 of a released charged move (its numbers lerp by it); absent otherwise. */
  readonly charge?: number;
}

/** A request waiting to become legal (the input buffer holds at most one: the most recent). */
export interface BufferedAction {
  /** The move asked for (a chain root such as a light attack resolves to its next hit on start). */
  readonly move: string;
  /** Local ticks it has waited: 0 on the tick it was made. */
  readonly age: number;
  /** The request's button is held, so a chargeable move starts charging (mw-e04.13). */
  readonly hold?: true;
}

/**
 * The chain hit an entity last finished, remembered while it stands idle: a request for that chain's
 * root continues the chain until `idle` reaches the timeline's chain reset (CHAIN_RESET_TICKS).
 */
export interface ChainMemory {
  /** Move id of the hit that completed. */
  readonly move: string;
  /** Idle local ticks since it completed: 0 on the tick it ended. */
  readonly idle: number;
}

/** One entity's action timeline. */
export interface ActionTimeline {
  /** The move in progress, or null when idle. */
  readonly current: RunningAction | null;
  /** Local ticks the entity may not start anything (an interrupt's hit reaction); 0 = free. */
  readonly lockTicks: number;
  /** The buffered request, or null. */
  readonly buffer: BufferedAction | null;
  /**
   * Local time per world tick, a multiple of 1/TIME_SCALE_STEPS: 1 normal, 0 frozen (hit-stop),
   * 0.5 half speed. Moves, locks and the buffer all age in local time.
   */
  readonly timeScale: number;
  /** Timeline ticks left before `timeScale` returns to 1, or null when it holds until changed. */
  readonly scaleTicks: number | null;
  /** Fractional local time carried to the next tick, in 1/TIME_SCALE_STEPS of a tick. */
  readonly timeCarry: number;
  /** The last completed chain hit, while the chain may still continue; null otherwise. */
  readonly chain: ChainMemory | null;
}

/**
 * A press that requests another move while a button is held (the knight's shield bash: attack while
 * blocking, mw-e04.14). It applies only while the pressed button is bound to a move of its own, so
 * a binding stowed away (the bow takes the attack button) takes its chords with it.
 */
export interface ActionChord {
  /** The button held down (block). */
  readonly held: ButtonAction;
  /** The button pressed while it is held (attack). */
  readonly press: ButtonAction;
  /** The move the press requests instead of its own binding's. */
  readonly move: string;
}

/** Which move each abstract button starts, for entities driven by the tick's ActionFrame. */
export interface ActionInput {
  readonly bindings: Readonly<Partial<Record<ButtonAction, string>>>;
  /** Chords, the first matching one winning (mw-e04.14); absent = none. */
  readonly chords?: readonly ActionChord[];
}

/** The action timeline component (`combat.timeline`; a snapshot and save key, never renamed). */
export const ActionTimelineComponent = defineComponent<ActionTimeline>('combat.timeline');

/** Button → move bindings (`combat.action-input`; a snapshot and save key, never renamed). */
export const ActionInputComponent = defineComponent<ActionInput>('combat.action-input');

/** Every action timeline component, for `world.register(...ACTION_TIMELINE_COMPONENTS)`. */
export const ACTION_TIMELINE_COMPONENTS = Object.freeze([
  ActionTimelineComponent,
  ActionInputComponent,
] as const);

const IDLE: ActionTimeline = Object.freeze({
  current: null,
  lockTicks: 0,
  buffer: null,
  timeScale: 1,
  scaleTicks: null,
  timeCarry: 0,
  chain: null,
});

/**
 * Gives `entity` an idle action timeline at normal speed. Adding the component is structural, so
 * during a step it exists from the end of the tick.
 */
export function giveActionTimeline(world: World<never>, entity: EntityId): void {
  world.add(entity, ActionTimelineComponent, IDLE);
}

/**
 * Lets the tick's ActionFrame drive `entity`'s timeline: a press of a bound button requests its move,
 * or a chord's move while the chord's other button is held. Bindings name abstract actions, never
 * keys (remapping happens before the sim, mw-e02.1).
 */
export function giveActionInput(
  world: World<never>,
  entity: EntityId,
  bindings: Readonly<Partial<Record<ButtonAction, string>>>,
  chords: readonly ActionChord[] = [],
): void {
  world.add(
    entity,
    ActionInputComponent,
    Object.freeze({
      bindings: Object.freeze({ ...bindings }),
      ...(chords.length > 0 && {
        chords: Object.freeze(chords.map((chord) => Object.freeze({ ...chord }))),
      }),
    }),
  );
}
