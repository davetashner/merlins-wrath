// Sandbox dummy options (mw-e04.9): what `spawn dummy --poise 60 --resist slash=0.5` and the
// console's `attacker` and `dummies` commands may say, parsed from the typed text into the numbers a
// dummy is made of. Every parser starts from the sandbox tuning (content) and changes only what the
// options name; anything it does not understand is a RangeError with a message fit for the console.
// Pure and deterministic: the sim parses the same text the replay recorded.

import type {
  MoveTable,
  RuntimeMove,
  RuntimeSandboxAttacker,
  RuntimeSandboxDummy,
} from '@content/index';
import type { SpawnParams } from '../../debug/commands';
import { MAX_RESISTANCE_MULTIPLIER } from '../damage/components';
import { DAMAGE_TYPES, isDamageType, type DamageAmounts, type DamageType } from '../damage/types';
import { HIT_REGIONS, type HitRegion } from '../hits/components';

/** What a training dummy is made of (a sandbox dummy's numbers, after options). */
export interface DummySpec {
  readonly health: number;
  readonly poise: number;
  readonly infiniteHealth: boolean;
  /** Damage multiplier per type in [0, 3]; unlisted = 1. */
  readonly resistances: DamageAmounts;
  /** Its hurtbox regions, in HIT_REGIONS order. */
  readonly regions: readonly HitRegion[];
}

/** An attacker dummy's metronome (after options). */
export interface AttackerSpec {
  readonly move: string;
  readonly periodTicks: number;
  readonly parryable: boolean;
  readonly unblockable: boolean;
  readonly enabled: boolean;
}

/** Options `spawn dummy` takes, with their syntax (the console's help). */
export const DUMMY_OPTIONS: Readonly<Record<string, string>> = Object.freeze({
  health: '<points>',
  poise: '<points>',
  resist: '<type=multiplier,…>',
  regions: '<head,torso,limb,weakpoint>',
  infinite: '<on|off>',
});

/** Options an attacker dummy takes on top of DUMMY_OPTIONS. */
export const ATTACKER_OPTIONS: Readonly<Record<string, string>> = Object.freeze({
  move: '<moveId>',
  every: '<seconds>',
  parryable: '<on|off>',
  unblockable: '<on|off>',
  enabled: '<on|off>',
});

function checkKnown(params: SpawnParams, known: readonly string[]): void {
  for (const name of Object.keys(params)) {
    if (!known.includes(name)) {
      throw new RangeError(`unknown option --${name}; expected one of --${known.join(', --')}`);
    }
  }
}

function number(name: string, text: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const value = text.trim() === '' ? Number.NaN : Number(text);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`--${name} must be a number ${String(min)}–${String(max)}, got "${text}"`);
  }
  return value;
}

function onOff(name: string, text: string): boolean {
  if (text === 'on') return true;
  if (text === 'off') return false;
  throw new RangeError(`--${name} must be on or off, got "${text}"`);
}

function list(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** `slash=0.5,fire=2` → multipliers; each type once, each in [0, 3]. */
function resistances(text: string): DamageAmounts {
  const out: Partial<Record<DamageType, number>> = {};
  const parts = list(text);
  if (parts.length === 0) throw new RangeError('--resist needs type=multiplier pairs');
  for (const part of parts) {
    const [type = '', value = '', ...rest] = part.split('=');
    if (!isDamageType(type) || rest.length > 0) {
      throw new RangeError(
        `--resist: "${part}" is not type=multiplier with a type of ${DAMAGE_TYPES.join(', ')}`,
      );
    }
    out[type] = number(`resist ${type}`, value, 0, MAX_RESISTANCE_MULTIPLIER);
  }
  return Object.freeze(out);
}

function regions(text: string): readonly HitRegion[] {
  const named = list(text);
  for (const region of named) {
    if (!(HIT_REGIONS as readonly string[]).includes(region)) {
      throw new RangeError(`--regions: unknown region "${region}"; use ${HIT_REGIONS.join(', ')}`);
    }
  }
  if (named.length === 0) throw new RangeError('--regions needs at least one region');
  return Object.freeze(HIT_REGIONS.filter((region) => named.includes(region)));
}

/** The dummy the sandbox tuning describes, changed by `params` (DUMMY_OPTIONS). */
export function dummySpecFrom(
  tuning: RuntimeSandboxDummy,
  params: SpawnParams,
  extra: readonly string[] = [],
): DummySpec {
  checkKnown(params, [...Object.keys(DUMMY_OPTIONS), ...extra]);
  const { health, poise, resist, regions: named, infinite } = params;
  return Object.freeze({
    health: health === undefined ? tuning.health : number('health', health, 1),
    poise: poise === undefined ? tuning.poise : number('poise', poise, 0),
    infiniteHealth: infinite === undefined ? tuning.infiniteHealth : onOff('infinite', infinite),
    resistances:
      resist === undefined ? Object.freeze({ ...tuning.resistances }) : resistances(resist),
    regions: regions(named ?? tuning.regions.join(',')),
  });
}

/** A move an attacker dummy can perform: one from content (not a variant) with a hitbox and damage. */
const performable = (move: RuntimeMove | undefined): move is RuntimeMove =>
  move?.hitbox != null && move.damage !== null && !move.id.includes(':');

/** `id`, when it names a move an attacker dummy can perform. */
function checkMove(moves: MoveTable, id: string): string {
  if (!performable(moves.get(id))) {
    const choices = [...moves.values()]
      .filter(performable)
      .map((m) => m.id)
      .sort();
    throw new RangeError(`--move: "${id}" is not a move with a hitbox; try ${choices.join(', ')}`);
  }
  return id;
}

/**
 * `current`'s metronome changed by `params` (ATTACKER_OPTIONS; `every` is seconds at `hz`, rounded
 * to whole ticks, at least one). With `others`, the dummy options are allowed too (and ignored).
 */
export function attackerSpecFrom(
  current: AttackerSpec,
  moves: MoveTable,
  params: SpawnParams,
  hz: number,
  others: readonly string[] = [],
): AttackerSpec {
  checkKnown(params, [...Object.keys(ATTACKER_OPTIONS), ...others]);
  const { move, every, parryable, unblockable, enabled } = params;
  const seconds = every === undefined ? undefined : number('every', every, 1 / hz, 3600);
  return Object.freeze({
    move: move === undefined ? current.move : checkMove(moves, move),
    periodTicks:
      seconds === undefined ? current.periodTicks : Math.max(1, Math.round(seconds * hz)),
    parryable: parryable === undefined ? current.parryable : onOff('parryable', parryable),
    unblockable:
      unblockable === undefined ? current.unblockable : onOff('unblockable', unblockable),
    enabled: enabled === undefined ? current.enabled : onOff('enabled', enabled),
  });
}

/** The metronome the sandbox tuning describes (enabled). */
export function attackerFromTuning(tuning: RuntimeSandboxAttacker): AttackerSpec {
  return Object.freeze({ ...tuning, enabled: true });
}
