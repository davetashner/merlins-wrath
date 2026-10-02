// The action timeline (mw-e04.4): a deterministic per-entity state machine that executes moves
// (RuntimeMove, src/content/types/move.ts). Souls-like weight comes from committed startup, active
// and recovery phases; a fair input buffer keeps that weight from feeling unresponsive.
//
// Timing. Every number is a sim tick (60 Hz). A move started on world tick T plays its tick k on world
// tick T + k at normal speed: a 12/4/18 move started on tick 0 turns active on 12, recovers on 16 and
// ends on 34 (the tick after its last). Stamina is spent on the first startup tick and is never
// refunded, whether the move completes, is cancelled or is interrupted.
//
// Local time. Each entity has its own time scale (hit-stop freezes attacker and victim, e04.11). Each
// tick adds `timeScale` to a carry kept in 1/TIME_SCALE_STEPS of a tick; every whole local tick in it
// runs one timeline step. At scale 0 nothing advances, so a frozen move resumes at the same offset and
// ends exactly as many world ticks later as it was frozen. `setTimeScale(…, forTicks)` counts timeline
// runs, so it lasts exactly that many ticks whichever system sets it.
//
// One timeline step: advance the move (emit phase changes; end it after its last tick) or count down
// an interrupt lock, then try the buffered request, then age it. A request is legal when the entity
// is idle and unlocked, or when the move's current tick is inside a cancel window whose `into` is the
// requested move's verb; a window that names a `move` starts that move instead (a roll's attack
// window turns the light attack into the roll attack, e04.8). The buffer holds one request, the most recent (a newer one replaces it). It
// is tried on the step it is made (age 0) and on each of the next ACTION_BUFFER_TICKS local ticks (9
// ticks, 150 ms), then dropped with ActionRejected{reason:"busy"}. So a request made 8 ticks before
// recovery ends starts on the tick it ends, and one made 12 ticks before is dropped.
//
// Chains. A request names a chain root (the knight's light attack binds `sword-light-1`). If the move
// being cancelled, or the chain hit that completed within the last `chainResetTicks` idle local ticks
// (CHAIN_RESET_TICKS, 30, by default), belongs to that root's chain, the request continues the chain
// (its `chainNext`); past the chain's last hit it restarts at the root. A hit that completed on world
// tick E is continued by a request that starts on E … E + 29; from E + 30 the chain has reset and the
// root starts again. An interrupt or any other move forgets the chain. Any other move — a heavy after
// a light, a light after a roll — starts fresh.
//
// Redirects. A timeline may be given a MoveRedirect, asked once as a legal request starts: it may
// start another move in its place (the knight's riposte replaces the light attack while a Parried
// target stands in reach, e04.12). A redirected move neither continues a chain nor takes a cancel
// window's `move`, and pays its own stamina.
//
// Input. Entities with an ActionInput are driven by the tick's ActionFrame: a press (not a hold) of a
// bound button requests its move, in BUTTON_ACTIONS order, so of two presses on one tick the later
// in that order wins. Anything else (AI, scripts, tests) calls `requestMove`.
//
// Interrupts. `interruptAction` ends the move now (ActionEnded{reason:"interrupted"}), so it reaches
// no later phase and never opens its hitbox; it clears the buffer and may lock the entity for a hit
// reaction's length (e04.7 chooses it). Hitbox rules (e04.2) read `activeHitbox` or listen for
// ActionPhaseChanged; the timeline itself spawns nothing.

import type {
  CancelTarget,
  MoveTable,
  MoveVerb,
  RuntimeCancelWindow,
  RuntimeMove,
} from '@content/index';
import type { EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import { actionFrameOf, BUTTON_ACTIONS } from '../../input/action-frame';
import { ActionRejected } from '../actions';
import { spendStamina, StaminaComponent } from '../stamina';
import {
  ActionInputComponent,
  ActionTimelineComponent,
  type ActionTimeline,
  type RunningAction,
} from './components';
import {
  ActionEnded,
  ActionPhaseChanged,
  ActionStarted,
  type ActionEndReason,
  type ActionPhase,
} from './events';

/** Local ticks a request waits for its move to become legal: 9 ticks, 150 ms at 60 Hz. */
export const ACTION_BUFFER_TICKS = 9;

/** Idle local ticks after a chain hit completes before the chain resets to its root (mw-e04.6). */
export const CHAIN_RESET_TICKS = 30;

/** Resolution of local time scales: a scale is rounded to a multiple of 1 / TIME_SCALE_STEPS. */
export const TIME_SCALE_STEPS = 1000;

/** The phase move tick `tick` (0 ≤ tick < totalTicks) of `move` is in. */
export function phaseAt(move: RuntimeMove, tick: number): ActionPhase {
  if (tick < move.activeFrom) return 'startup';
  return tick < move.recoveryFrom ? 'active' : 'recovery';
}

function timelineOf(world: World<never>, entity: EntityId): ActionTimeline {
  const timeline = world.get(entity, ActionTimelineComponent);
  if (timeline === undefined) throw new Error(`entity ${String(entity)} has no action timeline`);
  return timeline;
}

function store(world: World<never>, entity: EntityId, timeline: ActionTimeline): void {
  world.set(entity, ActionTimelineComponent, Object.freeze(timeline));
}

function lookup(moves: MoveTable, id: string): RuntimeMove {
  const move = moves.get(id);
  if (move === undefined) throw new Error(`move "${id}" is not in the timeline's move table`);
  return move;
}

/** `entity`'s move in progress, or undefined when it is idle or has no timeline. */
export function actionOf(world: World<never>, entity: EntityId): RunningAction | undefined {
  return world.get(entity, ActionTimelineComponent)?.current ?? undefined;
}

/** The live hit volume of `entity`'s move: present only on active ticks of a move with a hitbox. */
export interface ActiveHitbox {
  readonly move: RuntimeMove;
  readonly moveTick: number;
  readonly hitbox: NonNullable<RuntimeMove['hitbox']>;
}

/** Whether `entity`'s move has its hitbox live this tick (e04.2 sweeps it), and which. */
export function activeHitbox(
  world: World<never>,
  entity: EntityId,
  moves: MoveTable,
): ActiveHitbox | undefined {
  const current = actionOf(world, entity);
  if (current === undefined) return undefined;
  const move = lookup(moves, current.move);
  const { hitbox } = move;
  if (hitbox === null || phaseAt(move, current.tick) !== 'active') return undefined;
  return { move, moveTick: current.tick, hitbox };
}

/** The cancel window of `move` open on `tick` into `into`, if any (the first, in data order). */
function windowAt(
  move: RuntimeMove,
  tick: number,
  into: MoveVerb | CancelTarget,
): RuntimeCancelWindow | undefined {
  return move.cancelWindows.find((w) => w.into === into && tick >= w.from && tick <= w.to);
}

function inWindow(move: RuntimeMove, tick: number, into: MoveVerb | CancelTarget): boolean {
  return windowAt(move, tick, into) !== undefined;
}

/**
 * Whether an action of kind `into` could start for `entity` now: it is idle and not locked, or its
 * move's current tick is in a cancel window into `into`. The block rule (e04.6) asks this for the
 * shield, which is a stance rather than a move. Throws when `entity` has no timeline.
 */
export function canActNow(
  world: World<never>,
  entity: EntityId,
  moves: MoveTable,
  into: CancelTarget,
): boolean {
  const { current, lockTicks } = timelineOf(world, entity);
  if (current === null) return lockTicks === 0;
  return inWindow(lookup(moves, current.move), current.tick, into);
}

/**
 * Buffers a request for `move` (a move id, or a chain root) for `entity`, replacing any request
 * already buffered: the most recent input wins. The timeline tries it on its next run and for
 * ACTION_BUFFER_TICKS local ticks after. Throws when `entity` has no timeline.
 */
export function requestMove(world: World<never>, entity: EntityId, move: string): void {
  const timeline = timelineOf(world, entity);
  store(world, entity, { ...timeline, buffer: Object.freeze({ move, age: 0 }) });
}

/**
 * Sets `entity`'s local time scale (≥ 0, rounded to 1/TIME_SCALE_STEPS): 0 freezes its move, lock
 * and buffer (hit-stop), 0.5 halves their speed. With `forTicks`, the scale holds for that many
 * timeline runs and then returns to 1; without, until changed. Throws a RangeError for a negative or
 * non-finite scale or a `forTicks` that is not a positive integer, and an Error without a timeline.
 */
export function setTimeScale(
  world: World<never>,
  entity: EntityId,
  scale: number,
  forTicks?: number,
): void {
  if (!Number.isFinite(scale) || scale < 0) {
    throw new RangeError(`time scale must be a finite number ≥ 0, got ${String(scale)}`);
  }
  if (forTicks !== undefined && !(Number.isSafeInteger(forTicks) && forTicks > 0)) {
    throw new RangeError(`time scale duration must be a positive integer, got ${String(forTicks)}`);
  }
  const timeline = timelineOf(world, entity);
  store(world, entity, {
    ...timeline,
    timeScale: Math.round(scale * TIME_SCALE_STEPS) / TIME_SCALE_STEPS,
    scaleTicks: forTicks ?? null,
  });
}

function emitEnded(
  world: World<never>,
  entity: EntityId,
  current: RunningAction,
  moveTick: number,
  reason: ActionEndReason,
): void {
  world.events.emit(ActionEnded, {
    tick: world.tick,
    entity,
    move: current.move,
    reason,
    moveTick,
  });
}

/**
 * Interrupts `entity`'s move (a hit reaction took over): it ends now with ActionEnded{reason:
 * "interrupted"}, reaches no later phase (so its hitbox never opens) and keeps the stamina it cost.
 * The buffered request is dropped, and the entity may start nothing for `lockTicks` local ticks.
 * Returns whether a move was interrupted. Throws when `entity` has no timeline or `lockTicks` is not
 * a whole number ≥ 0.
 */
export function interruptAction(world: World<never>, entity: EntityId, lockTicks = 0): boolean {
  if (!(Number.isSafeInteger(lockTicks) && lockTicks >= 0)) {
    throw new RangeError(
      `interrupt lock must be a whole number of ticks ≥ 0, got ${String(lockTicks)}`,
    );
  }
  const timeline = timelineOf(world, entity);
  const { current } = timeline;
  if (current !== null) emitEnded(world, entity, current, current.tick, 'interrupted');
  store(world, entity, { ...timeline, current: null, buffer: null, lockTicks, chain: null });
  return current !== null;
}

/** Whether the chain starting at `root` contains `move` (bounded: chains may loop). */
function inChain(moves: MoveTable, root: RuntimeMove, move: RuntimeMove): boolean {
  const seen = new Set<string>();
  for (let id: string | null = root.id; id !== null && !seen.has(id);) {
    if (id === move.id) return true;
    seen.add(id);
    id = lookup(moves, id).chainNext;
  }
  return false;
}

/** The move a request for `requested` starts, given the move it follows (cancelled or remembered). */
function resolve(moves: MoveTable, requested: string, previous: RuntimeMove | null): RuntimeMove {
  const root = lookup(moves, requested);
  if (previous?.chainNext == null || !inChain(moves, root, previous)) return root;
  return lookup(moves, previous.chainNext);
}

/** Pays `move`'s stamina if the entity has a pool (refusal emits ActionRejected{reason:"stamina"}). */
function pay(world: World<never>, entity: EntityId, move: RuntimeMove): boolean {
  if (world.get(entity, StaminaComponent) === undefined) return true;
  return spendStamina(world, entity, move.verb, move.staminaCost);
}

type Attempt = RunningAction | 'refused' | 'wait';

/**
 * Asked as a legal request for `requested` (resolved through its chain to `resolved`) starts for
 * `entity`: the id of the move to start in its place, or undefined to start it as resolved.
 */
export type MoveRedirect = (
  world: World<never>,
  entity: EntityId,
  requested: string,
  resolved: RuntimeMove,
) => string | undefined;

interface StepRules {
  readonly moves: MoveTable;
  readonly chainResetTicks: number;
  readonly redirect: MoveRedirect | undefined;
}

function tryStart(
  world: World<never>,
  rules: StepRules,
  entity: EntityId,
  step: { current: RunningAction | null; locked: boolean; previous: RuntimeMove | null },
  requested: string,
): Attempt {
  const { moves } = rules;
  const { current, locked, previous } = step;
  const running = current === null ? null : { at: current.tick, move: lookup(moves, current.move) };
  const resolved = resolve(moves, requested, running?.move ?? previous);
  const window = running && windowAt(running.move, running.at, resolved.verb);
  const legal = running === null ? !locked : window !== undefined;
  if (!legal) return 'wait';
  const redirected = rules.redirect?.(world, entity, requested, resolved);
  // A window may name the move its kind of request starts instead (a roll's attack: the roll attack).
  const move =
    redirected !== undefined
      ? lookup(moves, redirected)
      : window?.move == null
        ? resolved
        : lookup(moves, window.move);
  if (!pay(world, entity, move)) return 'refused';
  if (current !== null) emitEnded(world, entity, current, current.tick, 'cancelled');
  const tick = world.tick;
  world.events.emit(ActionStarted, {
    tick,
    entity,
    move: move.id,
    cancelled: current?.move ?? null,
    chained: resolved.id !== requested && move === resolved,
  });
  world.events.emit(ActionPhaseChanged, {
    tick,
    entity,
    move: move.id,
    phase: phaseAt(move, 0),
    moveTick: 0,
  });
  return Object.freeze({ move: move.id, tick: 0, startedAt: tick });
}

/** One local tick of `timeline` (see the file header). */
function localStep(
  world: World<never>,
  rules: StepRules,
  entity: EntityId,
  timeline: ActionTimeline,
): ActionTimeline {
  const { moves, chainResetTicks } = rules;
  let { current, lockTicks, buffer } = timeline;
  // Saves and snapshots from before chain memory existed have no `chain`.
  let chain = timeline.chain ?? null;
  if (current === null && chain !== null) {
    const idle = chain.idle + 1;
    chain = idle >= chainResetTicks ? null : Object.freeze({ move: chain.move, idle });
  }
  if (current !== null) {
    const move = lookup(moves, current.move);
    const tick = current.tick + 1;
    if (tick >= move.totalTicks) {
      emitEnded(world, entity, current, tick, 'completed');
      current = null;
      // Only chain hits are remembered: nothing else can be continued.
      chain = move.chainNext === null ? null : Object.freeze({ move: move.id, idle: 0 });
    } else {
      const phase = phaseAt(move, tick);
      if (phase !== phaseAt(move, current.tick)) {
        world.events.emit(ActionPhaseChanged, {
          tick: world.tick,
          entity,
          move: move.id,
          phase,
          moveTick: tick,
        });
      }
      current = Object.freeze({ ...current, tick });
    }
  }
  const locked = current === null && lockTicks > 0;
  if (locked) lockTicks--;
  if (buffer !== null) {
    const previous = chain === null ? null : lookup(moves, chain.move);
    const attempt = tryStart(world, rules, entity, { current, locked, previous }, buffer.move);
    if (typeof attempt === 'object') {
      current = attempt;
      buffer = null;
      chain = null;
    } else if (attempt === 'refused') {
      buffer = null;
    } else if (buffer.age >= ACTION_BUFFER_TICKS) {
      world.events.emit(ActionRejected, {
        entity,
        action: lookup(moves, buffer.move).verb,
        reason: 'busy',
        tick: world.tick,
      });
      buffer = null;
    } else {
      buffer = Object.freeze({ move: buffer.move, age: buffer.age + 1 });
    }
  }
  return { ...timeline, current, lockTicks, buffer, chain };
}

/** What the timeline needs: every move an entity may perform, by id (`compileMoves`). */
export interface ActionTimelineOptions {
  readonly moves: MoveTable;
  /** Idle local ticks before a chain resets to its root; defaults to CHAIN_RESET_TICKS (30). */
  readonly chainResetTicks?: number;
  /** Replaces moves as they start (the knight's riposte, e04.12); none by default. */
  readonly redirect?: MoveRedirect;
}

/**
 * Runs every action timeline one tick: first the ActionFrame's bound presses become requests, then
 * each entity advances by its local time (see the file header). Register ACTION_TIMELINE_COMPONENTS
 * (and StaminaComponent, if entities pay for moves) first.
 */
export function actionTimelineSystem<TInput>(options: ActionTimelineOptions): System<TInput> {
  const { moves, chainResetTicks = CHAIN_RESET_TICKS, redirect } = options;
  if (!(Number.isSafeInteger(chainResetTicks) && chainResetTicks >= 0)) {
    throw new RangeError(
      `chain reset must be a whole number of ticks ≥ 0, got ${String(chainResetTicks)}`,
    );
  }
  const rules: StepRules = { moves, chainResetTicks, redirect };
  return {
    name: 'action-timeline',
    run: ({ world, inputs }) => {
      const w: World<never> = world;
      const frame = actionFrameOf(inputs);
      if (frame !== undefined) {
        w.query(ActionInputComponent, ActionTimelineComponent).forEach((entity, { bindings }) => {
          for (const action of BUTTON_ACTIONS) {
            const move = bindings[action];
            if (move !== undefined && frame[action].pressed) requestMove(w, entity, move);
          }
        });
      }
      w.query(ActionTimelineComponent).forEach((entity, start) => {
        const total = start.timeCarry + Math.round(start.timeScale * TIME_SCALE_STEPS);
        const steps = Math.floor(total / TIME_SCALE_STEPS);
        let timeline: ActionTimeline = { ...start, timeCarry: total - steps * TIME_SCALE_STEPS };
        if (timeline.scaleTicks !== null) {
          timeline =
            timeline.scaleTicks > 1
              ? { ...timeline, scaleTicks: timeline.scaleTicks - 1 }
              : { ...timeline, timeScale: 1, scaleTicks: null };
        }
        for (let i = 0; i < steps; i++) {
          timeline = localStep(w, rules, entity, timeline);
        }
        store(w, entity, timeline);
      });
    },
  };
}
