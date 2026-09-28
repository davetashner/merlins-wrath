// Events the creature attack executor emits (mw-e12.5). Render and audio play telegraph cues and
// debug-draw hit volumes from these, AI (e11) learns when its swing landed or was broken off, and the
// HUD never polls attack state. Per attack the order is AttackTelegraph, then AttackActive on each
// active tick (with AttackHit per target struck, after its DamageApplied events), then AttackEnded.

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

/** Payload of AttackTelegraph. */
export interface AttackTelegraphInfo extends AttackEventBase {
  /** The attack's telegraph cue id (render and audio pick placeholder or final assets by it). */
  readonly cue: string;
}

/** The windup is readable: fired once per attack, on the move's telegraphTick. */
export const AttackTelegraph = defineEvent<AttackTelegraphInfo>('AttackTelegraph');

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

/** Why an attack ended. */
export type AttackEndReason = 'completed' | 'staggered' | 'died' | 'cancelled';

/** Payload of AttackEnded. */
export interface AttackEndInfo extends AttackEventBase {
  readonly reason: AttackEndReason;
  /** Attack ticks that had run. */
  readonly elapsed: number;
}

/** An attack finished its recovery, or was broken off (stagger, death, `cancelAttack`). */
export const AttackEnded = defineEvent<AttackEndInfo>('AttackEnded');
