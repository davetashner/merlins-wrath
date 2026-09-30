// Combat sandbox state (mw-e04.9): what makes an entity one of the sandbox's dummies. A training
// dummy remembers whether its health is infinite and when it was last hit (an infinite dummy refills
// once it has not been hit for `resetAfterTicks`); an attacker dummy also carries its metronome — the
// move it performs, every how many ticks, and whether that swing can be parried or blocked. Plain
// frozen data, replaced never mutated, so snapshots, saves and replays carry them.

import { defineComponent } from '../../core/component';
import { UndyingComponent } from '../damage/components';

/** A sandbox training dummy. */
export interface SandboxDummy {
  /** It never dies (it is undying) and refills after `resetAfterTicks` without a hit. */
  readonly infiniteHealth: boolean;
  /** Ticks without a hit after which an infinite dummy's health refills. */
  readonly resetAfterTicks: number;
  /** World tick of the latest hit on it, or null before the first. */
  readonly lastHitAt: number | null;
}

/** An attacker dummy's metronome. */
export interface AttackerDummy {
  /** The move it performs (a move id of the action timeline's table, before variants). */
  readonly move: string;
  /** Ticks between swings: each starts on a world tick that is a multiple of it. */
  readonly periodTicks: number;
  /** Its swings can be parried (e04.12). */
  readonly parryable: boolean;
  /** Its swings go through shields. */
  readonly unblockable: boolean;
  /** The metronome runs (off: it stands still). */
  readonly enabled: boolean;
}

/** The training dummy component (`sandbox.dummy`; a snapshot and save key, never renamed). */
export const SandboxDummyComponent = defineComponent<SandboxDummy>('sandbox.dummy');

/** The attacker dummy component (`sandbox.attacker`; a snapshot and save key, never renamed). */
export const AttackerDummyComponent = defineComponent<AttackerDummy>('sandbox.attacker');

/** Every component the sandbox adds, for `world.register(...SANDBOX_COMPONENTS)`. */
export const SANDBOX_COMPONENTS = Object.freeze([
  SandboxDummyComponent,
  AttackerDummyComponent,
  UndyingComponent,
] as const);
