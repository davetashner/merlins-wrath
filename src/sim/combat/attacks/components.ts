// Attack state (mw-e12.5): what a creature's attack executor remembers between ticks — the attack in
// progress (how many of its ticks have run, the aim it committed to, whom it has already hit) and
// when each attack comes off cooldown — plus the in-flight projectile. Plain frozen data, replaced
// never mutated, so snapshots, saves and replays carry attacks mid-swing. An attacker keeps its
// component while idle (`current: null`) so starting an attack is a value change, never a structural
// one, and takes effect in the tick it is made.

import { defineComponent, type EntityId } from '../../core/component';
import type { World } from '../../core/world';
import type { Vec3 } from '../../stimulus/shapes';

/** The attack an attacker is performing. */
export interface ActiveAttack {
  /** Attack id (its RuntimeAttack in the executor's table). */
  readonly attack: string;
  /**
   * Attack ticks run so far: 0 until the executor's first run after `startAttack`; attack tick k
   * (1-based) runs the move's tick k − 1.
   */
  readonly elapsed: number;
  /** The world tick `startAttack` was called on. */
  readonly startedAt: number;
  /** Unit horizontal facing the attack committed to (world space). */
  readonly aim: Vec3;
  /** Entities this attack has hit (each is hit at most once per attack), ascending. */
  readonly hit: readonly EntityId[];
}

/** An entity that can perform creature attacks. */
export interface Attacker {
  /** The attack in progress, or null when idle. */
  readonly current: ActiveAttack | null;
  /** Attack id → first world tick it may start again (absent = ready). */
  readonly readyAt: Readonly<Record<string, number>>;
}

/** A projectile in flight (spawned by a projectile attack's first active tick). */
export interface Projectile {
  readonly attacker: EntityId;
  readonly attack: string;
  /** Current centre, metres (world space). */
  readonly position: Vec3;
  /** Unit direction of flight. */
  readonly direction: Vec3;
  /** Metres flown so far. */
  readonly travelled: number;
  /**
   * Targets it flew through during their i-frames (each got one DodgedHit), ascending; absent until
   * the first (mw-e04.28).
   */
  readonly dodged?: readonly EntityId[];
}

/** The attacker component (`combat.attacker`; a snapshot and save key, never renamed). */
export const AttackerComponent = defineComponent<Attacker>('combat.attacker');

/** The projectile component (`combat.projectile`; a snapshot and save key, never renamed). */
export const ProjectileComponent = defineComponent<Projectile>('combat.projectile');

/** Every attack component, for `world.register(...ATTACK_COMPONENTS)`. */
export const ATTACK_COMPONENTS = Object.freeze([AttackerComponent, ProjectileComponent] as const);

const IDLE: Attacker = Object.freeze({ current: null, readyAt: Object.freeze({}) });

/**
 * Makes `entity` an idle attacker with every attack ready. Adding the component is structural, so
 * during a step it exists from the end of the tick.
 */
export function giveAttacker(world: World<never>, entity: EntityId): void {
  world.add(entity, AttackerComponent, IDLE);
}

/** `entity`'s attack in progress, or undefined when it is idle or no attacker. */
export function currentAttack(world: World<never>, entity: EntityId): ActiveAttack | undefined {
  return world.get(entity, AttackerComponent)?.current ?? undefined;
}
