// Contract between layers (mw-e19.3): unlock definitions are written and checked as content
// (src/content/types/unlock.ts) and run by the sim's learn API (src/sim/progression/unlocks.ts).
// Content may import the sim only as types, so this check lives outside src/: both sides name the
// same channels, and every shipped unlock builds into the sim's unlock book.

import { describe, expect, it } from 'vitest';
import * as content from '@content/index';
import { createCapabilityRegistry, createUnlockBook, unlockDefs } from '@game/capabilities';
import { UNLOCK_CHANNELS } from '@sim/index';

const game = content.loadGameContent();

describe('unlock contract (mw-e19.3)', () => {
  it('content and sim name the same teaching channels', () => {
    expect(content.UNLOCK_CHANNELS).toEqual(UNLOCK_CHANNELS);
  });

  it('every shipped unlock builds into the sim unlock book', () => {
    const book = createUnlockBook(game, createCapabilityRegistry(game));
    for (const { capability } of unlockDefs(game)) {
      expect(book.unlockFor(capability), capability).toBeDefined();
    }
  });
});
