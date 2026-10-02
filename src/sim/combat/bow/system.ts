// The bow (mw-e05.3): draw, aim and release. Bows are data (src/content/types/bow.ts); the arrow
// they loose flies by the arrow system (src/sim/combat/arrows). Every archer with a BowComponent is
// driven by the tick's ActionFrame, on three buttons (BowButtons; the testbed's defaults below):
//
// - toggle takes the bow out or puts it away (a temporary switch until equipment slots, mw-e17). Out,
//   it takes over the primary attack button: the melee move bound there is stowed (BowState.stowed)
//   and put back when the bow is put away. Putting it away mid-draw ends the draw `stowed`.
// - cycle selects the quiver's next arrow type (wrapping, empty ones included), except mid-draw.
// - fire, pressed with the bow out, starts a draw: refused with ActionRejected{reason:"busy"} while
//   the archer is in a move, a hit reaction or behind its shield; {reason:"ammo"} when the quiver has
//   none of the selected type; and by the stamina rule when the pool is empty. Otherwise the arrow
//   leaves the quiver, `drawStaminaCost` is spent and BowDrawStarted is emitted.
//
// A draw counts ticks: 0 on the press, +1 on every later tick. Letting go of fire on tick n releases:
// before `minDrawTicks` the shot is cancelled (`early`) and the arrow returns; otherwise the arrow is
// loosed along the archer's aim (BowAim, the player's look; see src/sim/player) at
// maxLaunchSpeed × lerp(minLaunchFraction, 1, min(n, fullDrawTicks) / fullDrawTicks) — the shortbow's
// 24-tick draw looses at 65% of 60 m/s. Held at full draw for more than `holdTicks`, the draw drains
// `holdDrainPerSecond` each tick and collapses (`collapsed`, arrow returned) when stamina reaches 0.
// A dodge, a block, any other move or a hit reaction (the action timeline is busy, or the shield up)
// interrupts a draw (`interrupted`, arrow returned) — the dodge itself still happens: this system runs
// after the timeline, so it sees the roll the dodge button started this tick. While drawn the archer
// walks at `walkScale` (`bowLocomotionScale`).
//
// Determinism: archers run in ascending entity id order; every number is sim state or bow data, and
// the aim is the player's look, so replays of ActionFrames reproduce every shot.

import type { RuntimeBow } from '@content/index';
import type { EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import { actionFrameOf, type ActionFrame, type ButtonAction } from '../../input/action-frame';
import type { Vec3 } from '../../stimulus/shapes';
import { ActionRejected } from '../actions';
import { fireArrow, type ArrowLookup } from '../arrows/system';
import { drainStamina, spendStamina, StaminaComponent, type Stamina } from '../stamina';
import { ActionTimelineComponent } from '../timeline/components';
import {
  BOW_COMPONENTS,
  BowComponent,
  QuiverComponent,
  quiverCount,
  returnArrow,
  takeArrow,
  toggledBow,
  type BowDraw,
  type BowState,
} from './components';
import {
  ArrowSelected,
  BowDrawEnded,
  BowDrawStarted,
  BowEquipped,
  type BowDrawEndReason,
} from './events';

/** Bow tuning by id (`bowLookup`). */
export type BowLookup = ReadonlyMap<string, RuntimeBow>;

/** The bow table for the system, from compiled bow content. */
export function bowLookup(bows: Iterable<RuntimeBow>): BowLookup {
  return new Map([...bows].map((bow) => [bow.id, bow]));
}

/** Where an archer's arrow leaves from and which way it points. */
export interface BowShot {
  /** Launch point, metres. */
  readonly origin: Vec3;
  /** Unit launch direction. */
  readonly direction: Vec3;
}

/**
 * Where `entity` aims a shot launched at `speed` m/s, or undefined when it cannot aim (then the draw
 * is interrupted and the arrow returned).
 */
export type BowAim = (world: World<never>, entity: EntityId, speed: number) => BowShot | undefined;

/** The ActionFrame buttons that drive a bow. */
export interface BowButtons {
  /** Hold to draw, let go to loose. */
  readonly fire: ButtonAction;
  /** Select the next arrow type. */
  readonly cycle: ButtonAction;
  /** Take the bow out or put it away. */
  readonly toggle: ButtonAction;
}

/**
 * The testbed's bow buttons: fire on the primary attack, cycle on ability 3, toggle on ability 4
 * (docs/design/controls.md; temporary until class kits bind them, mw-e02.3).
 */
export const DEFAULT_BOW_BUTTONS: BowButtons = Object.freeze({
  fire: 'primaryAttack',
  cycle: 'ability3',
  toggle: 'ability4',
});

/** What the bow system needs. */
export interface BowSystemOptions {
  readonly bows: BowLookup;
  /** The arrows it looses (the arrow system's table). */
  readonly arrows: ArrowLookup;
  readonly aim: BowAim;
  /** Defaults to DEFAULT_BOW_BUTTONS. */
  readonly buttons?: BowButtons;
}

function lookup(bows: BowLookup, id: string): RuntimeBow {
  const bow = bows.get(id);
  if (bow === undefined) throw new Error(`bow "${id}" is not in the bow table`);
  return bow;
}

/** Draw fraction after `ticks` of drawing `bow`, 0–1. */
export function drawFraction(bow: RuntimeBow, ticks: number): number {
  return Math.min(ticks, bow.fullDrawTicks) / bow.fullDrawTicks;
}

/** Launch speed of `bow` released after `ticks` of drawing, m/s (see the file header). */
export function launchSpeed(bow: RuntimeBow, ticks: number): number {
  const fraction = drawFraction(bow, ticks);
  return bow.maxLaunchSpeed * (bow.minLaunchFraction + (1 - bow.minLaunchFraction) * fraction);
}

/** Movement scale for `entity` while it draws (its bow's walkScale), else 1. */
export function bowLocomotionScale(world: World<never>, entity: EntityId, bows: BowLookup): number {
  const state = world.isRegistered(BowComponent) ? world.get(entity, BowComponent) : undefined;
  if (state?.draw == null) return 1;
  return lookup(bows, state.bow).walkScale;
}

/** Whether `entity` is drawing its bow (aim mode: the camera's over-shoulder view). */
export function isDrawing(world: World<never>, entity: EntityId): boolean {
  return world.get(entity, BowComponent)?.draw != null;
}

/** `entity`'s stamina pool, or undefined without one (or without stamina in the world). */
function poolOf(world: World<never>, entity: EntityId): Stamina | undefined {
  return world.isRegistered(StaminaComponent) ? world.get(entity, StaminaComponent) : undefined;
}

/** Whether a move, a hit reaction or a raised shield keeps `entity` from drawing. */
function busy(world: World<never>, entity: EntityId): boolean {
  const timeline = world.isRegistered(ActionTimelineComponent)
    ? world.get(entity, ActionTimelineComponent)
    : undefined;
  const pool = poolOf(world, entity);
  return timeline?.current != null || (timeline?.lockTicks ?? 0) > 0 || pool?.blocking === true;
}

/** The bow system (see the file header); `installBow` wires it. */
export function bowSystem<TInput>(options: BowSystemOptions): System<TInput> {
  const buttons = options.buttons ?? DEFAULT_BOW_BUTTONS;

  function end(
    world: World<never>,
    entity: EntityId,
    state: BowState,
    draw: BowDraw,
    reason: BowDrawEndReason,
    ticks: number,
    loosed?: { readonly projectile: EntityId; readonly speed: number },
  ): BowState {
    if (reason !== 'fired') returnArrow(world, entity, draw.arrow);
    world.events.emit(BowDrawEnded, {
      tick: world.tick,
      entity,
      arrow: draw.arrow,
      reason,
      ticks,
      fraction: drawFraction(lookup(options.bows, state.bow), ticks),
      ...loosed,
    });
    return Object.freeze({ ...state, draw: null });
  }

  /** Releases `draw` after `ticks`: loosed, or cancelled when too short or the archer cannot aim. */
  function release(
    world: World<never>,
    entity: EntityId,
    state: BowState,
    draw: BowDraw,
    ticks: number,
  ): BowState {
    const bow = lookup(options.bows, state.bow);
    if (ticks < bow.minDrawTicks) return end(world, entity, state, draw, 'early', ticks);
    const speed = launchSpeed(bow, ticks);
    const shot = options.aim(world, entity, speed);
    if (shot === undefined) return end(world, entity, state, draw, 'interrupted', ticks);
    const { x, y, z } = shot.direction;
    const projectile = fireArrow(world, options.arrows, {
      arrow: draw.arrow,
      shooter: entity,
      origin: shot.origin,
      velocity: { x: x * speed, y: y * speed, z: z * speed },
    });
    return end(world, entity, state, draw, 'fired', ticks, { projectile, speed });
  }

  /** One tick of a draw in progress. */
  function drawing(
    world: World<never>,
    entity: EntityId,
    state: BowState,
    draw: BowDraw,
    frame: ActionFrame | undefined,
    hz: number,
  ): BowState {
    const ticks = draw.ticks + 1;
    if (frame === undefined || busy(world, entity)) {
      return end(world, entity, state, draw, 'interrupted', ticks);
    }
    if (!frame[buttons.fire].held) return release(world, entity, state, draw, ticks);
    const bow = lookup(options.bows, state.bow);
    if (ticks > bow.fullDrawTicks + bow.holdTicks && poolOf(world, entity) !== undefined) {
      drainStamina(world, entity, bow.holdDrainPerSecond / hz);
      if (poolOf(world, entity)?.current === 0) {
        return end(world, entity, state, draw, 'collapsed', ticks);
      }
    }
    return Object.freeze({ ...state, draw: Object.freeze({ ...draw, ticks }) });
  }

  /** A press of fire with the bow out and nothing drawn. */
  function startDraw(world: World<never>, entity: EntityId, state: BowState): BowState {
    const tick = world.tick;
    if (busy(world, entity)) {
      world.events.emit(ActionRejected, { entity, action: 'bow', reason: 'busy', tick });
      return state;
    }
    const arrow = state.selected;
    if (quiverCount(world, entity, arrow) === 0) {
      world.events.emit(ActionRejected, { entity, action: 'bow', reason: 'ammo', tick });
      return state;
    }
    const cost = lookup(options.bows, state.bow).drawStaminaCost;
    if (poolOf(world, entity) !== undefined && !spendStamina(world, entity, 'bow', cost)) {
      return state;
    }
    takeArrow(world, entity, arrow);
    world.events.emit(BowDrawStarted, { tick, entity, arrow });
    return Object.freeze({ ...state, draw: Object.freeze({ arrow, ticks: 0, startedAt: tick }) });
  }

  /** The selected type's successor in the quiver (wrapping). */
  function cycled(world: World<never>, entity: EntityId, state: BowState): BowState {
    const slots = world.get(entity, QuiverComponent)?.slots ?? [];
    const at = slots.findIndex((slot) => slot.arrow === state.selected);
    const next = slots[(at + 1) % slots.length];
    if (next === undefined || next.arrow === state.selected) return state;
    world.events.emit(ArrowSelected, {
      tick: world.tick,
      entity,
      arrow: next.arrow,
      count: next.count,
    });
    return Object.freeze({ ...state, selected: next.arrow });
  }

  return {
    name: 'bow',
    run: ({ world, inputs, clock }) => {
      const w: World<never> = world;
      const frame = actionFrameOf(inputs);
      w.query(BowComponent).forEach((entity, before) => {
        let state = before;
        if (frame?.[buttons.toggle].pressed === true) {
          if (state.draw !== null)
            state = end(w, entity, state, state.draw, 'stowed', state.draw.ticks);
          state = toggledBow(w, entity, state);
          w.events.emit(BowEquipped, { tick: w.tick, entity, equipped: state.equipped });
        } else if (state.draw !== null) {
          state = drawing(w, entity, state, state.draw, frame, clock.hz);
        } else if (state.equipped && frame !== undefined) {
          if (frame[buttons.cycle].pressed) state = cycled(w, entity, state);
          if (frame[buttons.fire].pressed) state = startDraw(w, entity, state);
        }
        if (state !== before) w.set(entity, BowComponent, state);
      });
    },
  };
}

/**
 * Wires the bow into `world`: registers BOW_COMPONENTS and appends the bow system. Add it after the
 * action timeline (and the block rule), so a dodge or block pressed this tick interrupts a draw, and
 * before the character controller, which walks at `bowLocomotionScale`. Call at setup, outside a step.
 */
export function installBow<TInput>(world: World<TInput>, options: BowSystemOptions): void {
  world.register(...BOW_COMPONENTS);
  world.addSystem(bowSystem(options));
}
