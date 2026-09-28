// Golden replays (mw-e00.17, backlog contract §3 determinism policy): every tests/replays/*.json is
// replayed against the current build and content on every CI run. A failure names the first
// diverging checkpoint and field; if the change was intended, `pnpm replay:rebless` and review.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectReplay } from '@tools/replay/expect-replay';
import { GOLDEN_REPLAY_DIR } from '@tools/replay/files';

const goldens = readdirSync(GOLDEN_REPLAY_DIR)
  .filter((file) => file.endsWith('.json'))
  .sort();

describe('golden replays', () => {
  it('AC-5: finds the golden replays, including the core sim one', () => {
    expect(goldens).toContain('core.json');
  });

  it.each(goldens)('AC-5: %s replays to its recorded state hashes', (file) => {
    const outcome = expectReplay(join(GOLDEN_REPLAY_DIR, file));
    expect(outcome.checkpoints).toBeGreaterThan(1);
  });
});
