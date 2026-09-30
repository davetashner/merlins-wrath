// mw-e02.12 AC-6: the greybox mantle course (MANTLE_COURSE, laid out from the game's kit pieces) and
// its input log are the character-mantle golden replay (src/tools/replay/character-scenarios.ts,
// tests/replays/character-mantle.json). It replays in CI to the recorded state hashes, and the run
// really exercises what the golden is for: an auto-mantle, a jump mantle, a grab and hang, a shimmy
// across a gap, a pull-up, lowering over an edge and a jump back off the wall.
//
// Re-record after an intended change to mantling, the controller or the tuning: pnpm replay:rebless
// (after changing the course or the log: pnpm replay:record character-mantle --force).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAYER_CONTROLLER_ID } from '@content/index';
import { markExercised } from '@content/testing';
import { CharacterController, type CharacterState } from '@sim/index';
import { createCharacterWorld, mantleGolden } from '@tools/replay/character-scenarios';
import { expectReplay } from '@tools/replay/expect-replay';
import { GOLDEN_REPLAY_DIR, readReplay } from '@tools/replay/files';

const GOLDEN = join(GOLDEN_REPLAY_DIR, `${mantleGolden.name}.json`);

/** Every character state along the log, run live. */
function trace(): CharacterState[] {
  const world = createCharacterWorld(mantleGolden, { seed: readReplay(GOLDEN).seed, hz: 60 });
  return mantleGolden.log.map((input) => {
    world.step([input]);
    const state = world.get(1, CharacterController);
    if (state === undefined) throw new Error('no character');
    return state;
  });
}

describe('mantle course golden (mw-e02.12)', () => {
  it('AC-6: the golden mantle replay runs over the greybox course with every state hash matching', ({
    task,
  }) => {
    markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
    for (const piece of ['floor', 'crate', 'platform']) markExercised(task, 'kit', piece);
    const replay = readReplay(GOLDEN);
    expect(replay.ticks).toBe(mantleGolden.ticks);
    expect(expectReplay(GOLDEN)).toMatchObject({
      status: 'passed',
      finalHash: replay.finalHash,
      checkpoints: replay.checkpoints.length,
    });
  });

  it('AC-6: the course takes the player through every mantle and hang move', () => {
    const states = trace();
    const modes: (string | null)[] = [];
    for (const s of states) if (modes.at(-1) !== s.traversal) modes.push(s.traversal);
    // Auto-mantle onto the crate, jump-mantle the block, grab and hang, pull up, lower, jump off.
    expect(modes).toEqual([
      null,
      'mantle',
      null,
      'mantle',
      null,
      'hang',
      'mantle',
      null,
      'hang',
      null,
    ]);
    // The shimmies crossed the gap between the high blocks, both ways.
    const held = states.flatMap((s) =>
      s.traversal === 'hang' && !s.ledge?.path ? [s.ledge?.ledge] : [],
    );
    expect(new Set(held).size).toBe(4);
    // The crate top (1 m), the block top (1.4 m) and the high blocks (2.1 m) were each stood on.
    const tops = new Set(
      states.filter((s) => s.grounded).map((s) => Math.round(s.position.y * 10)),
    );
    expect([...tops].sort((a, b) => a - b)).toEqual([0, 10, 14, 21]);
    expect(states.at(-1)).toMatchObject({ grounded: true, traversal: null });
  });
});
