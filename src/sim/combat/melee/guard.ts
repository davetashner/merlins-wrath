// Blocking (mw-e04.6): the shield is a stance, not a move. While the block input is held and the
// fighter is free to block (idle and unlocked, or in a move's cancel window into `block`: the action
// timeline's `canActNow`), the shield is up; it blocks once it has been up for the shield's
// `raiseTicks` (the wood shield: 6 ticks, 100 ms), and covers a frontal arc `arcDegrees` wide (120°)
// centred on the fighter's facing. Starting a move lowers it; so does a guard break.
//
// A blocked hit — a hit arriving from inside the arc (its travel direction against the facing) on a
// blocking shield, not tagged `unblockable`, with a known direction — resolves in the damage model's
// guard stage (`shieldGuard`):
//
//   need     = staminaDamage × (1 − stability / 100)   (20 × (1 − 60/100) = 8 for the wood shield)
//   paid     = the stamina actually drained (all of `need`, unless the pool runs dry)
//   absorbed = absorption% of each damage type × paid / need   (all of it when need is 0)
//
// so a 30-slash hit on the wood shield deals 30 × 15% = 4.5 and drains 8 (a hit a parry already
// deflected, tagged `parried`, never reaches the shield). Blocked hits deal no poise
// damage and are tagged `blocked`. If the block leaves the pool at 0 it is a **guard break**: the
// shield drops, the fighter's action timeline is interrupted and locked for GUARD_BREAK_STAGGER_TICKS
// (60), GuardBroken is emitted, the hit is also tagged `guard-break`, and its unabsorbed remainder
// lands — the share the stamina could not pay for is not absorbed. A fighter without a stamina pool
// never runs out. Which reaction plays (animation, audio) is the hit reactions' choice (e04.7).
//
// Shieldless guards (mw-e04.14). A guard whose shield is of kind `weapon` (a blade or forearm raised
// against a blow) blocks like a shield, but a hit tagged `guard-crush` (the shield bash) breaks it
// outright: no stamina is drained, nothing is absorbed, and the guard break above follows whatever
// stamina the blocker has left. A real shield meets a guard-crushing hit like any other.
//
// While the shield is up the fighter moves at the shield's `moveSpeedScale` (half speed) and its
// stamina regenerates at the pool's blocking rate; during an attack it walks slowly (`locomotionScale`).

import type { MoveTable } from '@content/index';
import type { EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import { actionFrameOf, type ButtonAction } from '../../input/action-frame';
import { cos } from '../../math';
import { DAMAGE_TAGS } from '../damage/packet';
import type { DamageModifier } from '../damage/model';
import { fromUnits, scaleUnits, toUnits, DAMAGE_TYPES, type DamageType } from '../damage/types';
import { drainStamina, setBlocking, StaminaComponent } from '../stamina';
import { ActionInputComponent, ActionTimelineComponent } from '../timeline/components';
import { actionOf, canActNow, interruptAction } from '../timeline/timeline';
import { facingOf, GuardComponent, isBlocking, lowerGuard, type Guard } from './components';
import { GuardBroken } from './events';

/** How long a guard break staggers the blocker (mw-e04.6): 60 ticks, 1 s. */
export const GUARD_BREAK_STAGGER_TICKS = 60;

/** The button that holds the shield up for entities driven by the ActionFrame (LT, right click). */
export const DEFAULT_BLOCK_BUTTON: ButtonAction = 'secondaryAttack';

/** What the block system needs. */
export interface BlockOptions {
  /** Every move the fighters may perform (for cancel windows into `block`). */
  readonly moves: MoveTable;
  /** The ActionFrame button that holds the shield up; defaults to DEFAULT_BLOCK_BUTTON. */
  readonly button?: ButtonAction;
}

/**
 * Raises and lowers every shield once per tick (see the file header). Entities with an ActionInput
 * hold the block with the frame's `button`; others with `setBlockHeld`. Run it just before the action
 * timeline: then the shield goes up on the same tick a move could start (a 60-tick stagger keeps
 * both down for exactly 60 ticks), and a move started this tick lowers it on the next. Register the
 * melee, timeline and stamina components first; every guarded entity needs an action timeline.
 */
export function blockSystem<TInput>(options: BlockOptions): System<TInput> {
  const { moves, button = DEFAULT_BLOCK_BUTTON } = options;
  return {
    name: 'block',
    run: ({ world, inputs, tick }) => {
      const w: World<never> = world;
      const frame = actionFrameOf(inputs);
      w.query(GuardComponent, ActionTimelineComponent).forEach((entity, guard) => {
        const driven = frame !== undefined && w.has(entity, ActionInputComponent);
        const held = driven ? frame[button].held : guard.held;
        const up = held && canActNow(w, entity, moves, 'block');
        const raisedAt = up ? (guard.raisedAt ?? tick) : null;
        if (held !== guard.held || raisedAt !== guard.raisedAt) {
          w.set(entity, GuardComponent, Object.freeze({ ...guard, held, raisedAt }));
        }
        if (w.has(entity, StaminaComponent)) setBlocking(w, entity, up);
      });
    },
  };
}

/** A horizontal direction (y is ignored). */
interface Flat {
  readonly x: number;
  readonly z: number;
}

/** Slack on the arc's edge, so a hit exactly on it (60° off centre for the wood shield) is inside. */
const ARC_EPSILON = 1e-9;

/** Whether a hit travelling along `direction` meets `guard`'s shield on a fighter facing `facing`. */
export function inGuardArc(guard: Guard, facing: Flat, direction: Flat): boolean {
  const len = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
  if (len === 0) return false;
  // The hit comes from where it travels from: against its direction.
  const dot = -(direction.x * facing.x + direction.z * facing.z) / len;
  return dot >= cos(((guard.shield.arcDegrees / 2) * Math.PI) / 180) - ARC_EPSILON;
}

/**
 * The shield rule for the damage model's guard stage (see the file header). Register it once on the
 * world's DamageModel: `damage.register(shieldGuard())`. Needs the melee, timeline and stamina
 * components registered.
 */
export function shieldGuard(): DamageModifier {
  return {
    name: 'shield-block',
    stage: 'guard',
    apply: (hit, { world, target, packet, tick }) => {
      const guard = world.get(target, GuardComponent);
      const { direction } = packet;
      if (guard === undefined || direction === undefined || !isBlocking(guard, tick)) return;
      if (packet.tags.includes(DAMAGE_TAGS.unblockable) || hit.tags.includes(DAMAGE_TAGS.parried)) {
        return;
      }
      if (!inGuardArc(guard, facingOf(world, target), direction)) return;
      const { shield } = guard;
      if (shield.kind === 'weapon' && packet.tags.includes(DAMAGE_TAGS.guardCrush)) {
        guardBreak(world, target, packet);
        const tags = [...hit.tags, DAMAGE_TAGS.blocked, DAMAGE_TAGS.guardBreak];
        return { ...hit, poiseDamage: 0, tags };
      }
      const needUnits = scaleUnits(toUnits(hit.staminaDamage), 1 - shield.stability / 100);
      const need = fromUnits(needUnits);
      const pool = world.get(target, StaminaComponent);
      const paid = pool === undefined ? need : drainStamina(world, target, need);
      const share = need === 0 ? 1 : paid / need;
      const amounts: Partial<Record<DamageType, number>> = {};
      for (const type of DAMAGE_TYPES) {
        const points = hit.amounts[type];
        if (points === undefined) continue;
        const absorbed = ((shield.absorption[type] ?? 0) / 100) * share;
        amounts[type] = fromUnits(scaleUnits(toUnits(points), 1 - absorbed));
      }
      const broken =
        pool !== undefined && need > 0 && world.get(target, StaminaComponent)?.current === 0;
      const tags = [...hit.tags, DAMAGE_TAGS.blocked];
      if (broken) {
        tags.push(DAMAGE_TAGS.guardBreak);
        guardBreak(world, target, packet);
      }
      return { ...hit, amounts, poiseDamage: 0, tags };
    },
  };
}

function guardBreak(
  world: World<never>,
  entity: EntityId,
  packet: { readonly instigator: EntityId | null; readonly source: EntityId | null },
): void {
  lowerGuard(world, entity);
  interruptAction(world, entity, GUARD_BREAK_STAGGER_TICKS);
  world.events.emit(GuardBroken, {
    tick: world.tick,
    entity,
    instigator: packet.instigator,
    source: packet.source,
    staggerTicks: GUARD_BREAK_STAGGER_TICKS,
  });
}

/** How fast a fighter may walk while it swings, as a fraction of normal speed: it can still step and strafe. */
export const ATTACK_MOVE_SCALE = 0.6;

/** Whether `entity` is mid-attack: committed to its swing, so it may walk but not jump or sprint. */
export function isAttacking(world: World<never>, entity: EntityId, moves: MoveTable): boolean {
  const action = actionOf(world, entity);
  return action !== undefined && moves.get(action.move)?.verb === 'attack';
}

/**
 * How fast `entity` may walk this tick, as a fraction of its normal speed: `ATTACK_MOVE_SCALE` while it
 * performs an attack (committed to its facing, not planted), its shield's `moveSpeedScale` while the shield is up, else 1. Needs the
 * melee and timeline components registered.
 */
export function locomotionScale(world: World<never>, entity: EntityId, moves: MoveTable): number {
  if (isAttacking(world, entity, moves)) return ATTACK_MOVE_SCALE;
  const guard = world.get(entity, GuardComponent);
  return guard?.raisedAt == null ? 1 : guard.shield.moveSpeedScale;
}
