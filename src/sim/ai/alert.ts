// The alert machine's outside triggers (mw-e11.7). The machine itself is the behaviour runtime
// (runtime.ts: timeouts, transitions from the behaviour's table, AlertStateChanged on every move);
// this file turns world events into what it reads:
//
// - Damage from an unseen source. A creature with a brain that takes a hit from anyone but the
//   target it sees right now gets a `damaged-by-unseen` event (behaviours send it to Alerted, never
//   Combat: content validation forbids that, since the attacker is unknown). It does not learn who
//   shot it or from where: its last-known position becomes a guess `unseenAttackerM` metres back
//   along the direction the blow travelled (on the level, at its own height), from where it stands.
//   A hit without a horizontal direction leaves the last-known position alone.
// - The heightened baseline (`isPostAlert`): whether an agent that stood down from a `postAlert`
//   state is still on edge; awareness builds faster meanwhile (awareness.ts).
//
// The estimate distance is PLACEHOLDER, to tune in play (mw-e11.16).

import { DamageApplied } from '../combat/damage/events';
import type { World } from '../core/world';
import { PlacementComponent } from '../stimulus/placement';
import { BrainComponent, type Brain } from './components';
import { queueAiEvent, writeBlackboard } from './runtime';
import { getIf } from './util';

/** Metres back along an unseen blow's direction the attacker is guessed to be (PLACEHOLDER). */
export const DEFAULT_UNSEEN_ATTACKER_M = 8;

/** Whether `brain` is on edge at `tick` (stood down from a `postAlert` state within its window). */
export function isPostAlert(brain: Readonly<Brain>, tick: number): boolean {
  return tick < brain.postAlertUntil;
}

/** How alert triggers are wired to a world. */
export interface AlertTriggerOptions {
  /** Metres back along an unseen blow's direction its attacker is guessed to be. */
  readonly unseenAttackerM?: number;
}

/**
 * Turns hits on creatures with a brain into alert events (see the file header). Install it with AI;
 * the damage model's DamageApplied drives it. Returns a function that uninstalls it.
 */
export function installAlertTriggers(
  world: World<never>,
  options: AlertTriggerOptions = {},
): () => void {
  const back = options.unseenAttackerM ?? DEFAULT_UNSEEN_ATTACKER_M;
  return world.events.on(DamageApplied, ({ target, packet, died }) => {
    const brain = getIf(world, target, BrainComponent);
    if (brain === undefined || died) return;
    const board = brain.blackboard;
    const seen =
      board.targetVisible && packet.instigator !== null && packet.instigator === board.target;
    if (seen) return;
    queueAiEvent(world, target, 'damaged-by-unseen');
    const here = getIf(world, target, PlacementComponent);
    const d = packet.direction;
    const flat = d === undefined ? 0 : Math.sqrt(d.x * d.x + d.z * d.z);
    if (here === undefined || d === undefined || flat === 0) return;
    const k = back / flat;
    writeBlackboard(world, target, {
      lkp: { x: here.x - d.x * k, y: here.y, z: here.z - d.z * k },
    });
  });
}
