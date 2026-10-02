// Events the creature attack executor emits (mw-e12.5). Render and audio play telegraph cues and
// debug-draw hit volumes from these, AI (e11) learns when its swing landed or was broken off, and the
// HUD never polls attack state. Per move of an attack the order is TelegraphStarted (mw-e04.20), then
// AttackActive on each active tick (with AttackHit per target struck, after its DamageApplied
// events); then, once per attack, AttackEnded. An attack on the move system (melee and area attacks of
// a creature with an action timeline, executor.ts) has no AttackActive: its hit volume is the hit-volume
// system's, drawn by its own debug overlay.

import type { AttackKind } from '@content/index';
import type { EntityId } from '../../core/component';
import { defineEvent } from '../../core/events';
import type { Vec3 } from '../../stimulus/shapes';
import type { DamageResult } from '../damage/events';
import type { HitShape } from './frame';

/** Fields every attack event carries. */
export interface AttackEventBase {
  /** World tick. */
  readonly tick: number;
  readonly attacker: EntityId;
  /** Attack id. */
  readonly attack: string;
}

/** Payload of TelegraphStarted. */
export interface TelegraphInfo extends AttackEventBase {
  /** The move whose windup is telegraphed (an attack's chain telegraphs each of its moves). */
  readonly move: string;
  /** The attack's telegraph cue id (render and audio pick placeholder or final assets by it). */
  readonly cue: string;
  /** The move's own telegraph audio cue (`presentation.telegraph`), or null when it declares none. */
  readonly audioCue: string | null;
  /** The move's own telegraph VFX cue, or null when it declares none. */
  readonly vfxCue: string | null;
  /** The move can be parried. */
  readonly parryable: boolean;
  /** The move cannot be blocked: an unblockable move, or a grab (the stricter telegraph rule). */
  readonly unblockable: boolean;
}

/**
 * The windup is readable (mw-e04.20): fired exactly once per move of an attack, on the move's
 * telegraphTick, with the cue ids the telegraph plays.
 */
export const TelegraphStarted = defineEvent<TelegraphInfo>('TelegraphStarted');

/** Payload of AttackActive. */
export interface AttackActiveInfo extends AttackEventBase {
  /** Attack tick (1-based) that is active. */
  readonly attackTick: number;
  /** The hit volume this tick, in world space. */
  readonly shape: HitShape;
}

/** A melee or area attack's hit volume is live this tick (only when the attacker has a placement). */
export const AttackActive = defineEvent<AttackActiveInfo>('AttackActive');

/** Payload of AttackHit. */
export interface AttackHitInfo extends AttackEventBase {
  readonly target: EntityId;
  /** What delivered the hit: the attacker itself, or its projectile. */
  readonly source: EntityId;
  /** One damage-model result per packet that resolved, in packet order. */
  readonly results: readonly DamageResult[];
}

/** An attack struck a target: every packet definition went through the damage model. */
export const AttackHit = defineEvent<AttackHitInfo>('AttackHit');

/** Payload of AttackProjectileLaunched. */
export interface AttackProjectileInfo extends AttackEventBase {
  readonly projectile: EntityId;
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/** A projectile attack launched its projectile (on its first active tick). */
export const AttackProjectileLaunched = defineEvent<AttackProjectileInfo>(
  'AttackProjectileLaunched',
);

/** Payload of AttackStub. */
export interface AttackStubInfo extends AttackEventBase {
  readonly kind: Extract<AttackKind, 'grab' | 'special'>;
}

/**
 * A grab or special attack reached its first active tick. Their runtime is not built yet (bestiary
 * items own it); this stub is where it will hook in.
 */
export const AttackStub = defineEvent<AttackStubInfo>('AttackStub');

/**
 * Why an attack ended: it ran its course, was broken off by a poise break or a hit reaction
 * (`staggered`), its swing was parried (`parried`, mw-e04.20), it died, or it was cancelled.
 */
export type AttackEndReason = 'completed' | 'staggered' | 'parried' | 'died' | 'cancelled';

/** Payload of AttackEnded. */
export interface AttackEndInfo extends AttackEventBase {
  readonly reason: AttackEndReason;
  /** Attack ticks that had run. */
  readonly elapsed: number;
}

/** An attack finished its recovery, or was broken off (stagger, parry, death, `cancelAttack`). */
export const AttackEnded = defineEvent<AttackEndInfo>('AttackEnded');
