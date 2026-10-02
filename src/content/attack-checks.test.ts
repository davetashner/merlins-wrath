// Tests for the creature attack readability rules (mw-e04.20).

import { describe, expect, it } from 'vitest';
import {
  checkCreatureAttacks,
  CREATURE_MIN_WINDUP_TICKS,
  CREATURE_UNBLOCKABLE_WINDUP_TICKS,
} from './attack-checks.ts';
import { loadGameContent } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { contentChecks, contentTypes } from './registry.ts';
import { describeContent } from './testing.ts';
import { compileAttack, type AttackDefInput } from './types/attack.ts';
import { compileMoves, type MoveDefInput } from './types/move.ts';

const swing = {
  id: 'chop',
  notes: 'Test move.',
  verb: 'attack',
  frames: { startup: 18, active: 4, recovery: 10 },
  damage: { amounts: { slash: 10 } },
  hitbox: {
    track: 'test-track',
    shape: { kind: 'sphere', center: { x: 0, y: 1.2, z: 0.8 }, radius: 0.25 },
    reach: 'short',
    swing: 'vertical',
  },
  presentation: { anim: 'anim-chop' },
} satisfies MoveDefInput;

const LUNGE_CUES = { audioCue: 'sfx-telegraph-lunge', vfxCue: 'vfx-telegraph-flare' };

const slam = {
  ...swing,
  id: 'slam',
  frames: { startup: 30, active: 4, recovery: 10 },
  flags: { unblockable: true, parryable: false },
  presentation: { anim: 'anim-slam', telegraph: LUNGE_CUES },
} satisfies MoveDefInput;

const attack = (id: string, move: string, extra: Partial<AttackDefInput> = {}): AttackDefInput => ({
  id,
  notes: 'Test attack.',
  kind: 'melee',
  move,
  telegraph: `${id}-windup`,
  range: { min: 0, max: 2 },
  ...extra,
});

const track = {
  id: 'test-track',
  notes: 'Test track.',
  keys: [{ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }],
};

const source = (type: string, json: { id: string }): ContentSource => ({
  path: `data/${type}/${json.id}.json`,
  text: JSON.stringify(json),
});

/** The load issues (file, pointer: message) of moves and attacks, or [] when they load. */
function issuesOf(moves: readonly MoveDefInput[], attacks: readonly AttackDefInput[]): string[] {
  try {
    loadContent(
      contentTypes,
      [
        source('socket-track', track),
        ...moves.map((m) => source('move', m)),
        ...attacks.map((a) => source('attack', a)),
      ],
      contentChecks,
    );
    return [];
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
}

describe('creature attack readability (mw-e04.20)', () => {
  it('AC-1: a creature move with startup 12 ticks fails the readability rule (minimum 18)', () => {
    expect(CREATURE_MIN_WINDUP_TICKS).toBe(18);
    const quick = { ...swing, frames: { startup: 12, active: 4, recovery: 10 } };
    expect(issuesOf([quick], [attack('jab', 'chop')])).toEqual([
      'data/attack/jab.json#/move: attack "jab": move "chop" winds up 12 ticks from its ' +
        'telegraph (tick 0) to its first active tick (12); a creature move needs at least 18 ' +
        '(300 ms)',
    ]);
    expect(issuesOf([swing], [attack('jab', 'chop')])).toEqual([]);
  });

  it('AC-1: the windup counts from the telegraph, so a late telegraph shortens it', () => {
    const late = { ...swing, frames: { startup: 24, active: 4, recovery: 10 }, telegraphTick: 8 };
    expect(issuesOf([late], [attack('jab', 'chop')])).toEqual([
      expect.stringContaining('winds up 16 ticks from its telegraph (tick 8)'),
    ]);
  });

  it('AC-1: every move of a chain is checked; moves no attack performs are not creature moves', () => {
    const second = { ...swing, id: 'chop-2', frames: { startup: 10, active: 4, recovery: 10 } };
    expect(
      issuesOf([{ ...swing, chainNext: 'chop-2' }, second], [attack('combo', 'chop')]),
    ).toEqual([expect.stringContaining('attack "combo": move "chop-2" winds up 10 ticks')]);
    // The knight's own 12-tick swing is no creature's: nothing to report.
    expect(issuesOf([{ ...swing, frames: { startup: 12, active: 4, recovery: 10 } }], [])).toEqual(
      [],
    );
  });

  it('AC-2: an unblockable creature move with startup < 30 ticks fails', () => {
    expect(CREATURE_UNBLOCKABLE_WINDUP_TICKS).toBe(30);
    const quick = { ...slam, frames: { startup: 29, active: 4, recovery: 10 } };
    expect(issuesOf([quick], [attack('crush', 'slam')])).toEqual([
      'data/attack/crush.json#/move: attack "crush": move "slam" winds up 29 ticks from its ' +
        'telegraph (tick 0) to its first active tick (29); unblockable move needs at least 30 ' +
        '(500 ms)',
    ]);
    expect(issuesOf([slam], [attack('crush', 'slam')])).toEqual([]);
  });

  it('AC-2: an unblockable creature move with no telegraph cue fails', () => {
    const silent = { ...slam, presentation: { anim: 'anim-slam' } };
    expect(issuesOf([silent], [attack('crush', 'slam')])).toEqual([
      'data/attack/crush.json#/move: attack "crush": move "slam" is unblockable and must declare ' +
        'its own telegraph cues (presentation.telegraph: audioCue and vfxCue)',
    ]);
  });

  it('AC-2: a grab is held to the unblockable rule even on a blockable move', () => {
    expect(issuesOf([swing], [attack('grab', 'chop', { kind: 'grab' })])).toEqual([
      expect.stringContaining('a grab move needs at least 30 (500 ms)'),
      expect.stringContaining('move "chop" is part of a grab and must declare its own telegraph'),
    ]);
  });

  it('AC-2: an unblockable telegraph must be distinct from every blockable attack’s', () => {
    const marked = { ...swing, presentation: { anim: 'anim-chop', telegraph: LUNGE_CUES } };
    expect(
      issuesOf(
        [marked, slam],
        [
          attack('chop', 'chop', { telegraph: 'shared' }),
          attack('crush', 'slam', { telegraph: 'shared' }),
        ],
      ),
    ).toEqual([
      expect.stringContaining(
        'move "slam" telegraph cue "sfx-telegraph-lunge" is also a blockable',
      ),
      expect.stringContaining(
        'move "slam" telegraph cue "vfx-telegraph-flare" is also a blockable',
      ),
      'data/attack/crush.json#/telegraph: attack "crush": telegraph "shared" is also a blockable ' +
        "attack's: an unblockable attack's telegraph must be distinct",
    ]);
    // Two unblockable attacks may share theirs.
    expect(
      issuesOf(
        [slam],
        [attack('a', 'slam', { telegraph: 's' }), attack('b', 'slam', { telegraph: 's' })],
      ),
    ).toEqual([]);
  });

  it('a missing move is the loader’s reference error, not a readability one', () => {
    expect(
      checkCreatureAttacks([
        {
          type: 'attack',
          file: 'a.json',
          value: { ...attack('a', 'x'), move: { id: 'x' } } as never,
        },
      ]),
    ).toEqual([]);
  });
});

describe('the e04.20 grey-box skeleton set', () => {
  const content = loadGameContent();
  const moves = compileMoves(content.all('move'));
  const compiled = (id: string) => compileAttack(content.get('attack', id), moves);

  it('overhead chop (parryable), two-hit slash (parryable, two hits), lunging thrust (unparryable, blockable)', () => {
    expect(
      compiled('forgotten-overhead-chop').chain?.map((m) => [m.id, m.parryable, m.blockable]),
    ).toEqual([['forgotten-overhead-chop', true, true]]);
    expect(
      compiled('forgotten-two-hit-slash').chain?.map((m) => [m.id, m.parryable, m.blockable]),
    ).toEqual([
      ['forgotten-slash-1', true, true],
      ['forgotten-slash-2', true, true],
    ]);
    const thrust = compiled('forgotten-lunging-thrust');
    expect(thrust.chain?.map((m) => [m.id, m.parryable, m.blockable])).toEqual([
      ['forgotten-lunging-thrust', false, true],
    ]);
    // The longer telegraph, with cues of its own the parryable swings never play.
    expect(thrust.move.startup).toBeGreaterThanOrEqual(CREATURE_UNBLOCKABLE_WINDUP_TICKS);
    expect(thrust.move.presentation.telegraph).toBeDefined();
    expect(thrust.telegraph).not.toBe(compiled('forgotten-overhead-chop').telegraph);
  });
});

describeContent(
  'attack',
  'mw-e04.20: every move it performs winds up at least 18 ticks',
  (entry, content) => {
    const attack = compileAttack(entry, compileMoves(content.all('move')));
    for (const move of attack.chain ?? [attack.move]) {
      expect(move.startup - move.telegraphTick).toBeGreaterThanOrEqual(CREATURE_MIN_WINDUP_TICKS);
    }
  },
);
