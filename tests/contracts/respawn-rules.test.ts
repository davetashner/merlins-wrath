// Contract between layers (mw-e01.8): respawn rules are written and validated as content
// (src/content/types/respawn-rules.ts) and resolved by the sim (src/sim/respawn/rules.ts). Content
// may import the sim only as types, so this check lives outside src/: both sides name the same
// modes, and the shipped rule table compiles in the sim and resolves the slice to a reload.

import { describe, expect, it } from 'vitest';
import { loadGameContent, RESPAWN_RULE_MODES, RESPAWN_RULES_ID } from '@content/index';
import { respawnRulesFrom } from '@game/player/death-beat';
import { RESPAWN_MODES, RespawnRules, World } from '@sim/index';

describe('respawn rules contract (mw-e01.8)', () => {
  it('content and the sim name the same respawn modes', () => {
    expect([...RESPAWN_RULE_MODES]).toEqual([...RESPAWN_MODES]);
  });

  it('the shipped rules compile in the sim; a death in the slice reloads the last save', () => {
    const entry = loadGameContent().get('respawn-rules', RESPAWN_RULES_ID);
    const rules = new RespawnRules(respawnRulesFrom(entry));
    const resolved = rules.resolve({ region: 'slice', facts: new World({ seed: 1 }).facts });
    expect(resolved).toEqual({
      rule: 'slice-reload',
      mode: 'reload',
      destination: { scene: 'slice', spawn: 'player-start' },
      factsToSet: [],
    });
  });
});
