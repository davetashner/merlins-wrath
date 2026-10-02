// Load-time readability rules for creature attacks (mw-e04.20). Enemies play by the player's rules
// (parry, block, poise), so their attacks must also be readable the way Zelda's are: every creature
// attack winds up long enough to be seen and answered. After every file has parsed, each attack is
// checked against the moves it performs (its move, then that move's `chainNext` and so on):
//
// - every move winds up at least CREATURE_MIN_WINDUP_TICKS (18 ticks, 300 ms) from its telegraph to
//   its first active tick (`frames.startup − telegraphTick`);
// - an unblockable move, or any move of a grab, winds up at least CREATURE_UNBLOCKABLE_WINDUP_TICKS
//   (30 ticks, 500 ms) and declares its own telegraph cues (`presentation.telegraph`: audio + VFX);
// - those cues, and the attack's `telegraph` id, are distinct: no blockable, non-grab creature attack
//   uses them, so a player learns "that sound means I cannot block this".
//
// Only moves an attack performs are checked: the knight's own moves are not creature attacks. A
// missing move is the loader's reference error, not reported again here. Issues name the attack file.

import type { ContentCheck, ContentIssue, LoadedEntry } from './loader.ts';
import type { AttackDef } from './types/attack.ts';
import type { MoveDef } from './types/move.ts';

/** Fewest ticks a creature move winds up from its telegraph to its first active tick (300 ms). */
export const CREATURE_MIN_WINDUP_TICKS = 18;

/** Fewest windup ticks of a creature's unblockable or grab move (500 ms). */
export const CREATURE_UNBLOCKABLE_WINDUP_TICKS = 30;

/** One attack with the moves it performs, in order. */
interface Performed {
  readonly file: string;
  readonly attack: AttackDef;
  readonly moves: readonly MoveDef[];
}

/** Whether `move`, performed by `attack`, needs the stricter rule: unblockable, or part of a grab. */
const strict = (attack: AttackDef, move: MoveDef): boolean =>
  attack.kind === 'grab' || move.flags.unblockable;

function performed(entries: readonly LoadedEntry[]): Performed[] {
  const moves = new Map<string, MoveDef>();
  for (const { type, value } of entries) if (type === 'move') moves.set(value.id, value as MoveDef);
  const out: Performed[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'attack') continue;
    const attack = value as AttackDef;
    const chain: MoveDef[] = [];
    for (let move = moves.get(attack.move.id); move !== undefined && !chain.includes(move);) {
      chain.push(move);
      move = move.chainNext === undefined ? undefined : moves.get(move.chainNext.id);
    }
    out.push({ file, attack, moves: chain });
  }
  return out;
}

/** The check: windups, unblockable telegraph cues and their distinctness (see the file header). */
export const checkCreatureAttacks: ContentCheck = (entries) => {
  const all = performed(entries);
  const blockable = { telegraphs: new Set<string>(), cues: new Set<string>() };
  for (const { attack, moves } of all) {
    for (const move of moves) {
      if (strict(attack, move)) continue;
      blockable.telegraphs.add(attack.telegraph);
      const cues = move.presentation.telegraph;
      if (cues !== undefined)
        for (const cue of [cues.audioCue, cues.vfxCue]) blockable.cues.add(cue);
    }
  }
  const issues: ContentIssue[] = [];
  for (const { file, attack, moves } of all) {
    const report = (pointer: string, message: string) =>
      issues.push({ file, pointer, message: `attack "${attack.id}": ${message}` });
    let telegraphShared = false;
    for (const move of moves) {
      const windup = move.frames.startup - move.telegraphTick;
      const unblockable = strict(attack, move);
      const minimum = unblockable ? CREATURE_UNBLOCKABLE_WINDUP_TICKS : CREATURE_MIN_WINDUP_TICKS;
      const what = attack.kind === 'grab' ? 'a grab' : unblockable ? 'unblockable' : 'a creature';
      if (windup < minimum) {
        report(
          '/move',
          `move "${move.id}" winds up ${String(windup)} ticks from its telegraph (tick ` +
            `${String(move.telegraphTick)}) to its first active tick (${String(move.frames.startup)}); ` +
            `${what} move needs at least ${String(minimum)} (${String((minimum * 1000) / 60)} ms)`,
        );
      }
      if (!unblockable) continue;
      const cues = move.presentation.telegraph;
      if (cues === undefined) {
        report(
          '/move',
          `move "${move.id}" is ${what === 'a grab' ? 'part of a grab' : 'unblockable'} and ` +
            'must declare its own telegraph cues (presentation.telegraph: audioCue and vfxCue)',
        );
      } else {
        for (const cue of [cues.audioCue, cues.vfxCue]) {
          if (blockable.cues.has(cue)) {
            report(
              '/move',
              `move "${move.id}" telegraph cue "${cue}" is also a blockable attack's: an ` +
                'unblockable telegraph must be distinct',
            );
          }
        }
      }
      telegraphShared ||= blockable.telegraphs.has(attack.telegraph);
    }
    if (telegraphShared) {
      report(
        '/telegraph',
        `telegraph "${attack.telegraph}" is also a blockable attack's: an unblockable attack's ` +
          'telegraph must be distinct',
      );
    }
  }
  return issues;
};
