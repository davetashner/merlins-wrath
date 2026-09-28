// Contract between layers (mw-e12.8): factions are validated as content (src/content/types/faction.ts)
// and run by the sim (src/sim/factions). Content may import the sim only as types, so this runtime
// check lives outside src/: both sides share the stance vocabulary and reserved ids, the shipped
// faction table builds, and creatures join their faction with the stances their definitions give.

import { describe, expect, it } from 'vitest';
import * as content from '@content/index';
import { FIXTURE_CREATURE_IDS, loadFixtureContent } from '@content/test-fixtures';
import {
  buildFactionTable,
  factionSpecFromDef,
  installFactions,
  joinFaction,
  membershipFromCreature,
  PLAYER_FACTION,
  relation,
  STANCES,
  UNALIGNED_FACTION,
  World,
} from '@sim/index';

const game = content.loadGameContent();

describe('faction contract', () => {
  it('content and sim share the stance list and the reserved faction ids', () => {
    expect(content.STANCES).toEqual(STANCES);
    expect(content.PLAYER_FACTION_ID).toBe(PLAYER_FACTION);
    expect(content.UNALIGNED_FACTION).toBe(UNALIGNED_FACTION);
  });

  it('the shipped factions build a valid sim table containing the default faction', () => {
    const table = buildFactionTable(game.all('faction').map(factionSpecFromDef));
    expect(table.ids).toEqual(game.all('faction').map((f) => f.id));
    expect(table.has(UNALIGNED_FACTION)).toBe(true);
  });

  it.each(FIXTURE_CREATURE_IDS)(
    '%s joins its faction and keeps the pre-faction default: hostile to the player',
    (id) => {
      const fixtures = loadFixtureContent();
      const table = buildFactionTable(fixtures.all('faction').map(factionSpecFromDef));
      const world = installFactions(new World<never>({ seed: 1 }));
      const player = world.spawn();
      joinFaction(world, table, player, PLAYER_FACTION);
      const creature = world.spawn();
      const { faction, toward } = membershipFromCreature(fixtures.get('creature', id));
      joinFaction(world, table, creature, faction, toward);
      expect(relation(world, table, creature, player)).toBe('hostile');
    },
  );
});
