// The creature attack executor (mw-e12.5). Given compiled attack data (RuntimeAttack: a move plus the
// attack's own numbers, src/content/types/attack.ts), it answers "may this attacker start this attack
// now?" deterministically, runs a started attack through its windup, active and recovery ticks, fires
// the telegraph, and turns overlaps of the live hit volume into damage packets for the damage model —
// one packet per packet definition per target, so every creature hit composes through the same
// resistances, guards and modifiers as the knight's. Choosing which attack to use is AI's job (e11);
// the parry and block rules act on those packets in the damage model's guard stage (e04.6, e04.12).
//
// Timing: attack tick k (1-based) is the executor's k-th run after `startAttack` and plays the move's
// tick k − 1, so a 12/4/10 attack is active on attack ticks 13–16 and completes on tick 26. Hits:
// the move's hit volume (at its rest pose — socket tracks, e04.2, will animate it) is placed at the
// attacker's placement facing the committed aim, and tested against every living entity with a
// placement and health (its bounding sphere is the hurtbox until e04.2 adds regions). Each target is
// hit at most once per attack. Projectiles fly straight at their speed, sweep a capsule each tick and
// hit the first target along the path (level geometry does not stop them yet).
//
// A poise break (PoiseBroken) or death of the attacker breaks its attack off; hyperarmor is the poise
// rules' business, so a hit that did not break poise never reaches here.

import type { RuntimeAttack, TargetStance } from '@content/index';
import type { EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import { PlacementComponent } from '../../stimulus/placement';
import { shapeFalloff, type Vec3 } from '../../stimulus/shapes';
import { HealthComponent } from '../damage/components';
import { Died, PoiseBroken, type DamageResult } from '../damage/events';
import type { DamageModel } from '../damage/model';
import {
  AttackerComponent,
  ProjectileComponent,
  type ActiveAttack,
  type Attacker,
} from './components';
import {
  AttackActive,
  AttackEnded,
  AttackHit,
  AttackProjectileLaunched,
  AttackStub,
  AttackTelegraph,
  type AttackEndReason,
} from './events';
import { horizontalAim, pointToWorld, rotateToWorld, shapeToWorld, type HitShape } from './frame';

/** Compiled attacks by id (`compileAttacks`); the executor looks started attacks up here. */
export type AttackLookup = ReadonlyMap<string, RuntimeAttack>;

/** What the executor needs: the attack table and the damage model hits resolve through. */
export interface AttackExecutorOptions {
  readonly attacks: AttackLookup;
  readonly damage: DamageModel;
}

/** A phase of an attack. */
export type AttackPhase = 'windup' | 'active' | 'recovery';

/** The phase attack tick `attackTick` (1-based) of `attack` is in, or null past its last tick. */
export function attackPhase(attack: RuntimeAttack, attackTick: number): AttackPhase | null {
  const { startup, active, totalTicks } = attack.move;
  if (attackTick <= startup) return 'windup';
  if (attackTick <= startup + active) return 'active';
  return attackTick <= totalTicks ? 'recovery' : null;
}

/** What a precondition check knows about the target (reported by the caller, e.g. AI). */
export interface AttackContext {
  /** Distance from attacker to target, centre to centre, metres. */
  readonly distance: number;
  /** What the target is doing; undefined when unknown (fails any stance precondition). */
  readonly targetStance?: TargetStance;
}

/** Why an attack may not start now. */
export type AttackRefusal =
  'busy' | 'cooldown' | 'too-close' | 'too-far' | 'target-stance' | 'health';

/** The answer of `canStartAttack`. */
export type AttackCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: AttackRefusal };

const OK: AttackCheck = Object.freeze({ ok: true });

function attackerOf(world: World<never>, entity: EntityId): Attacker {
  const attacker = world.get(entity, AttackerComponent);
  if (attacker === undefined) throw new Error(`entity ${String(entity)} is not an attacker`);
  return attacker;
}

/**
 * Whether `entity` may start `attack` now, checked in a fixed order: busy, cooldown, range
 * (too-close/too-far), target stance, own health band (current / max health; an entity without
 * health counts as full). Pure: the same world state and context always give the same answer.
 * Throws when `entity` is not an attacker.
 */
export function canStartAttack(
  world: World<never>,
  entity: EntityId,
  attack: RuntimeAttack,
  context: AttackContext,
): AttackCheck {
  const attacker = attackerOf(world, entity);
  const refuse = (reason: AttackRefusal): AttackCheck => ({ ok: false, reason });
  if (attacker.current !== null) return refuse('busy');
  if (world.tick < (attacker.readyAt[attack.id] ?? 0)) return refuse('cooldown');
  if (context.distance < attack.rangeMin) return refuse('too-close');
  if (context.distance > attack.rangeMax) return refuse('too-far');
  const stances = attack.targetStances;
  if (stances !== null && !stances.some((stance) => stance === context.targetStance)) {
    return refuse('target-stance');
  }
  const health = world.get(entity, HealthComponent);
  const fraction = health === undefined ? 1 : health.current / health.max;
  if (fraction < attack.healthMin || fraction > attack.healthMax) return refuse('health');
  return OK;
}

/**
 * Starts `attack` for `entity`, facing `aim` (its horizontal direction is used), and puts the attack
 * on cooldown from this tick. Preconditions are the caller's to check (`canStartAttack`); this only
 * throws — when `entity` is not an attacker or is busy, or `aim` has no horizontal direction.
 */
export function startAttack(
  world: World<never>,
  entity: EntityId,
  attack: RuntimeAttack,
  aim: Vec3,
): void {
  const attacker = attackerOf(world, entity);
  if (attacker.current !== null) {
    throw new Error(`entity ${String(entity)} is already attacking (${attacker.current.attack})`);
  }
  const tick = world.tick;
  const current: ActiveAttack = Object.freeze({
    attack: attack.id,
    elapsed: 0,
    startedAt: tick,
    aim: horizontalAim(aim),
    hit: Object.freeze([]),
  });
  const readyAt = Object.freeze({
    ...attacker.readyAt,
    [attack.id]: tick + world.clock.ticksFor(attack.cooldownMs),
  });
  world.set(entity, AttackerComponent, Object.freeze({ current, readyAt }));
}

function end(
  world: World<never>,
  entity: EntityId,
  attacker: Attacker,
  current: ActiveAttack,
  reason: AttackEndReason,
): void {
  world.set(entity, AttackerComponent, Object.freeze({ ...attacker, current: null }));
  world.events.emit(AttackEnded, {
    tick: world.tick,
    attacker: entity,
    attack: current.attack,
    reason,
    elapsed: current.elapsed,
  });
}

/**
 * Breaks off `entity`'s attack in progress (no further telegraph, hit volume or damage) and emits
 * AttackEnded with `reason`. Returns whether there was one; an idle entity or a non-attacker is a
 * no-op. The cooldown stays spent.
 */
export function cancelAttack(
  world: World<never>,
  entity: EntityId,
  reason: Exclude<AttackEndReason, 'completed'> = 'cancelled',
): boolean {
  const attacker = world.get(entity, AttackerComponent);
  if (attacker === undefined) return false;
  const { current } = attacker;
  if (current === null) return false;
  end(world, entity, attacker, current, reason);
  return true;
}

function lookup(attacks: AttackLookup, id: string): RuntimeAttack {
  const attack = attacks.get(id);
  if (attack === undefined) throw new Error(`attack "${id}" is not in the executor's table`);
  return attack;
}

/** Applies every packet of `attack` to `target`; emits AttackHit. */
function strike(
  world: World<never>,
  options: AttackExecutorOptions,
  hit: { attacker: EntityId; source: EntityId; attack: RuntimeAttack; target: EntityId; aim: Vec3 },
): void {
  const { attacker, source, attack, target, aim } = hit;
  const results: DamageResult[] = [];
  for (const packet of attack.packets) {
    const result = options.damage.apply(world, target, {
      instigator: attacker,
      source,
      amounts: packet.amounts,
      poiseDamage: packet.poiseDamage,
      staminaDamage: packet.staminaDamage,
      impulse: rotateToWorld(packet.impulse, aim),
      impactForce: packet.impactForce,
      direction: aim,
      tags: packet.tags,
    });
    if (result !== undefined) results.push(result);
  }
  world.events.emit(AttackHit, {
    tick: world.tick,
    attacker,
    attack: attack.id,
    target,
    source,
    results: Object.freeze(results),
  });
}

/** Living hurtboxes (placement + health > 0) other than `exclude`, in ascending id order. */
function hurtboxes(
  world: World<never>,
  exclude: EntityId,
): { readonly entity: EntityId; readonly at: Vec3 & { readonly radius: number } }[] {
  const out: { entity: EntityId; at: Vec3 & { radius: number } }[] = [];
  world.query(PlacementComponent, HealthComponent).forEach((entity, at, health) => {
    if (entity !== exclude && health.current > 0) out.push({ entity, at });
  });
  return out;
}

function runActive(
  world: World<never>,
  options: AttackExecutorOptions,
  entity: EntityId,
  attack: RuntimeAttack,
  current: ActiveAttack,
  attackTick: number,
): ActiveAttack {
  const base = { tick: world.tick, attacker: entity, attack: attack.id };
  const first = attackTick === attack.move.startup + 1;
  const placement = world.get(entity, PlacementComponent);
  if (attack.kind === 'grab' || attack.kind === 'special') {
    if (first) world.events.emit(AttackStub, { ...base, kind: attack.kind });
    return current;
  }
  if (placement === undefined) return current;
  if (attack.projectile !== null) {
    if (!first) return current;
    const origin = pointToWorld(attack.projectile.origin, placement, current.aim);
    const projectile = world.spawn();
    world.add(projectile, ProjectileComponent, {
      attacker: entity,
      attack: attack.id,
      position: origin,
      direction: current.aim,
      travelled: 0,
    });
    world.events.emit(AttackProjectileLaunched, {
      ...base,
      projectile,
      origin,
      direction: current.aim,
    });
    return current;
  }
  const shape = shapeToWorld(attack.hitbox.shape, placement, current.aim);
  world.events.emit(AttackActive, { ...base, attackTick, shape });
  const targets = hurtboxes(world, entity).filter(
    ({ entity: target, at }) =>
      !current.hit.includes(target) && shapeFalloff(shape, 'none', at, at.radius) !== undefined,
  );
  for (const { entity: target } of targets) {
    strike(world, options, { attacker: entity, source: entity, attack, target, aim: current.aim });
  }
  if (targets.length === 0) return current;
  const hit = [...current.hit, ...targets.map((t) => t.entity)].sort((a, b) => a - b);
  return { ...current, hit: Object.freeze(hit) };
}

/**
 * Runs every attack in progress one tick: telegraph on the move's telegraphTick, the hit volume (or
 * projectile launch, or grab/special stub) on active ticks, and AttackEnded once recovery is over.
 */
export function attackSystem<TInput>(options: AttackExecutorOptions): System<TInput> {
  return {
    name: 'attacks',
    run: ({ world }) => {
      const w: World<never> = world;
      w.query(AttackerComponent).forEach((entity, attacker) => {
        const { current } = attacker;
        if (current === null) return;
        const attack = lookup(options.attacks, current.attack);
        const attackTick = current.elapsed + 1;
        if (attackTick - 1 === attack.move.telegraphTick) {
          w.events.emit(AttackTelegraph, {
            tick: w.tick,
            attacker: entity,
            attack: attack.id,
            cue: attack.telegraph,
          });
        }
        let next: ActiveAttack = { ...current, elapsed: attackTick };
        if (attackPhase(attack, attackTick) === 'active') {
          next = runActive(w, options, entity, attack, next, attackTick);
        }
        const frozen = Object.freeze(next);
        const updated: Attacker = Object.freeze({ ...attacker, current: frozen });
        w.set(entity, AttackerComponent, updated);
        if (attackTick >= attack.move.totalTicks) end(w, entity, updated, frozen, 'completed');
      });
    },
  };
}

/** The first living hurtbox the swept capsule `from`→`to` touches, nearest along the path. */
function firstAlong(
  world: World<never>,
  exclude: EntityId,
  path: { from: Vec3; to: Vec3; direction: Vec3; radius: number },
): EntityId | undefined {
  const sweep: HitShape = { kind: 'capsule', from: path.from, to: path.to, radius: path.radius };
  let best: { entity: EntityId; along: number } | undefined;
  for (const { entity, at } of hurtboxes(world, exclude)) {
    if (shapeFalloff(sweep, 'none', at, at.radius) === undefined) continue;
    const d = path.direction;
    const along =
      (at.x - path.from.x) * d.x + (at.y - path.from.y) * d.y + (at.z - path.from.z) * d.z;
    if (best === undefined || along < best.along) best = { entity, along };
  }
  return best?.entity;
}

/**
 * Moves every projectile one tick (speed / hz metres, never past its max range), hits the first
 * living hurtbox along the way with the attack's packets, and removes projectiles that hit or reached
 * their range.
 */
export function projectileSystem<TInput>(options: AttackExecutorOptions): System<TInput> {
  return {
    name: 'attack-projectiles',
    run: ({ world, clock }) => {
      const w: World<never> = world;
      w.query(ProjectileComponent).forEach((entity, projectile) => {
        const attack = lookup(options.attacks, projectile.attack);
        const flight = attack.projectile;
        if (flight === null) throw new Error(`attack "${attack.id}" is not a projectile attack`);
        const step = Math.min(flight.speed / clock.hz, flight.maxRange - projectile.travelled);
        const { position: from, direction } = projectile;
        const to = {
          x: from.x + direction.x * step,
          y: from.y + direction.y * step,
          z: from.z + direction.z * step,
        };
        const target = firstAlong(w, projectile.attacker, {
          from,
          to,
          direction,
          radius: flight.radius,
        });
        if (target !== undefined) {
          strike(w, options, {
            attacker: projectile.attacker,
            source: entity,
            attack,
            target,
            aim: direction,
          });
          w.destroy(entity);
          return;
        }
        const travelled = projectile.travelled + step;
        if (travelled >= flight.maxRange) {
          w.destroy(entity);
          return;
        }
        w.set(
          entity,
          ProjectileComponent,
          Object.freeze({ ...projectile, position: to, travelled }),
        );
      });
    },
  };
}

/**
 * Wires the executor into `world`: the attack and projectile systems (appended in that order) and
 * the interrupts — a PoiseBroken on an attacker cancels its attack as `staggered`, a Died as `died`.
 * Register ATTACK_COMPONENTS and the damage components first. Returns a function that removes the
 * interrupt subscriptions (the systems stay, as systems always do).
 */
export function installAttacks<TInput>(
  world: World<TInput>,
  options: AttackExecutorOptions,
): () => void {
  world.addSystem(attackSystem(options)).addSystem(projectileSystem(options));
  const w: World<never> = world;
  const offs = [
    world.events.on(PoiseBroken, ({ target }) => cancelAttack(w, target, 'staggered')),
    world.events.on(Died, ({ target }) => cancelAttack(w, target, 'died')),
  ];
  return () => {
    for (const off of offs) off();
  };
}
