// mw-e00.31: golden replays check outcomes, not the content hash. A golden's contentHash records the
// content its outcomes were last blessed against; it is diagnostic only. A content change that moves
// no outcome passes every golden and `pnpm replay:rebless` leaves the files byte-for-byte alone, so
// two PRs adding unrelated content never conflict on tests/replays. A content change that moves an
// outcome still fails, reported as "content changed since recording" with the first differing field.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PLAYER_CONTROLLER_ID } from '@content/index';
import { markExercised } from '@content/testing';
import { basicGolden, characterScenario, playerTuning } from '@tools/replay/character-scenarios';
import { defaultIo, main } from '@tools/replay/cli';
import { expectReplay, ReplayAssertionError } from '@tools/replay/expect-replay';
import { currentContentHash, GOLDEN_REPLAY_DIR, readReplay } from '@tools/replay/files';

/** A content hash no golden was recorded against: "someone else's PR added unrelated content". */
const UNRELATED = 'f00dfacef00dface';

const goldens = readdirSync(GOLDEN_REPLAY_DIR)
  .filter((file) => file.endsWith('.json'))
  .sort();

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'replay-content-hash-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('replay goldens and the content hash (mw-e00.31)', () => {
  it('AC-1: an unrelated content change leaves every golden passing and rebless rewrites none', () => {
    expect(currentContentHash()).not.toBe(UNRELATED);
    cpSync(GOLDEN_REPLAY_DIR, join(dir, GOLDEN_REPLAY_DIR), { recursive: true });
    for (const file of goldens) {
      expect(expectReplay(join(GOLDEN_REPLAY_DIR, file), { contentHash: UNRELATED }).status).toBe(
        'passed',
      );
    }
    const lines: string[] = [];
    const errors: string[] = [];
    const io = {
      ...defaultIo(dir),
      log: (line: string) => lines.push(line),
      error: (line: string) => errors.push(line),
      buildSha: () => 'another-build',
      contentHash: () => UNRELATED,
    };
    expect(main(['rebless'], io)).toBe(0);
    expect(errors).toEqual([]);
    expect(lines).toEqual(goldens.map((file) => `unchanged ${GOLDEN_REPLAY_DIR}/${file}`));
    for (const file of goldens) {
      expect(readFileSync(join(dir, GOLDEN_REPLAY_DIR, file), 'utf8')).toBe(
        readFileSync(join(GOLDEN_REPLAY_DIR, file), 'utf8'),
      );
    }
  });

  it('AC-2: a content change that alters a replay outcome still fails the replay check', ({
    task,
  }) => {
    markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
    const path = join(GOLDEN_REPLAY_DIR, `${basicGolden.name}.json`);
    const tuning = playerTuning();
    const retuned = characterScenario(basicGolden, {
      ...tuning,
      speeds: { ...tuning.speeds, run: tuning.speeds.run * 1.01 },
    });
    let error: unknown;
    try {
      expectReplay(path, { scenarios: { [basicGolden.name]: retuned }, contentHash: UNRELATED });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(ReplayAssertionError);
    const { outcome, message } = error as ReplayAssertionError;
    expect(outcome).toMatchObject({
      status: 'content-changed',
      recordedContentHash: readReplay(path).contentHash,
      currentContentHash: UNRELATED,
    });
    expect(message).toContain('content changed since recording');
  });
});
