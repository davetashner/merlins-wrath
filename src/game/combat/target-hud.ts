// The target readout and damage numbers' game glue (mw-e04.21). Reads the sim once per drawn frame
// and turns DamageApplied into HUD feedback; the widgets (src/ui/target-hud.ts) hold no rules.
//
// - Target bar: the player's lock-on target, else whoever the player hit last (for TARGET_HOLD_MS), shown
//   with its name and health. It hides when the target dies or there is none.
// - Damage numbers: a hit the player lands shows its applied total over the target ("No effect" when
//   the target is immune); a hit the player takes shows over the player. Off when `enabled()` is false.
//
// Events are queued as the sim emits them and handed to the widgets on the next drawn frame.

import {
  CreatureComponent,
  creaturesInstalled,
  DamageApplied,
  healthOf,
  PlacementComponent,
  type EntityId,
  type World,
} from '@sim/index';
import type { DamageNumbers, TargetBar, TargetModel } from '@ui/index';
import type { LockTarget } from '../player/testbed-player';

/** How long the bar stays on whoever the player last hit, when nothing is locked. */
export const TARGET_HOLD_MS = 5000;
/** Metres above a fighter's feet its damage numbers appear. */
export const NUMBER_HEIGHT = 1.8;

/** A world point projected to normalised device coordinates (x right, y up, −1…1). */
export type NdcOf = (point: { x: number; y: number; z: number }) => {
  x: number;
  y: number;
  z: number;
};

/** "forgotten-miner" → "Forgotten miner". */
export function displayName(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The target bar's model for `target`, or null when it has no health or is dead. */
export function targetModel(world: World<never>, target: EntityId): TargetModel | null {
  const health = healthOf(world, target);
  if (health === undefined || health.current <= 0) return null;
  const creature = creaturesInstalled(world) ? world.get(target, CreatureComponent) : undefined;
  return {
    name: creature === undefined ? 'Training dummy' : displayName(creature.origin.creature),
    health: { value: health.current, max: health.max },
  };
}

/** The text a hit shows: its whole-number total, "No effect" when immune, null for no damage. */
export function damageText(total: number, immune: boolean): string | null {
  if (immune) return 'No effect';
  const rounded = Math.round(total);
  return rounded > 0 ? String(rounded) : null;
}

export interface TargetHudGlueOptions {
  readonly world: World<never>;
  readonly player: EntityId;
  readonly bar: TargetBar;
  readonly numbers: DamageNumbers;
  /** The player's lock-on target now, if any. */
  readonly lock: () => LockTarget | undefined;
  /** Projects a world point through the drawn camera. */
  readonly project: NdcOf;
  /** The HUD layer's size, CSS pixels. */
  readonly size: () => { readonly width: number; readonly height: number };
  /** Whether damage numbers are on (the Gameplay setting). */
  readonly numbersEnabled: () => boolean;
}

export interface TargetHudGlue {
  /** Call once per drawn frame, after the sim stepped, with the frame's time. */
  frame(nowMs: number): void;
  /** Stops listening to the sim. */
  dispose(): void;
}

interface Pending {
  readonly entity: EntityId;
  readonly text: string;
  readonly kind: 'dealt' | 'taken';
}

/** Wires the target bar and damage numbers to the player's sim state and events. */
export function attachTargetHud(options: TargetHudGlueOptions): TargetHudGlue {
  const { world, player, bar, numbers, lock, project, size, numbersEnabled } = options;
  const pending: Pending[] = [];
  let lastHit: EntityId | undefined;
  let lastHitMs = -Infinity;
  let lastHitQueued = false;
  const off = world.events.on(DamageApplied, (hit) => {
    const dealt = hit.packet.instigator === player && hit.target !== player;
    const taken = hit.target === player;
    if (!dealt && !taken) return;
    if (dealt) lastHitQueued = true;
    if (dealt) lastHit = hit.target;
    const text = damageText(hit.total, hit.immune);
    if (text !== null) {
      pending.push({ entity: hit.target, text, kind: dealt ? 'dealt' : 'taken' });
    }
  });

  const anchor = (entity: EntityId): { x: number; y: number } | undefined => {
    const at = world.get(entity, PlacementComponent);
    if (at === undefined) return undefined;
    const ndc = project({ x: at.x, y: at.y + NUMBER_HEIGHT, z: at.z });
    if (!(Math.abs(ndc.z) <= 1)) return undefined;
    const { width, height } = size();
    return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
  };

  return {
    frame(nowMs) {
      if (lastHitQueued) {
        lastHitMs = nowMs;
        lastHitQueued = false;
      }
      const enabled = numbersEnabled();
      for (const n of pending.splice(0)) {
        const at = enabled ? anchor(n.entity) : undefined;
        if (at !== undefined) numbers.spawn(n.text, n.kind, at.x, at.y, nowMs);
      }
      const locked = lock()?.entity;
      const held = nowMs - lastHitMs < TARGET_HOLD_MS ? lastHit : undefined;
      const target = locked ?? held;
      bar.update(target === undefined ? null : targetModel(world, target), nowMs);
      numbers.update(nowMs);
    },
    dispose() {
      off();
    },
  };
}
