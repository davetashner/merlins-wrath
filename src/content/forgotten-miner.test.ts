// mw-e13.1 AC-1: the Forgotten miner's data (src/content/data/creature/forgotten-miner.json), the
// game's first creature. It is a valid CreatureDef: a walker with sight and hearing and no smell (or
// life-sense), blunt 1.5 / pierce 0.5 / poison 0, and exactly the e04 grey-box skeleton set
// (mw-e04.20), every move of which passes the creature readability rule. The fight itself (parry,
// resistances in the damage model, perception) is tests/integration/forgotten-miner.test.ts.

import { describe, expect, it } from 'vitest';
import { CREATURE_MIN_WINDUP_TICKS, CREATURE_UNBLOCKABLE_WINDUP_TICKS } from './attack-checks.ts';
import raw from './data/creature/forgotten-miner.json';
import { loadGameContent } from './game-content.ts';
import { markExercised } from './testing.ts';
import { compileAttack } from './types/attack.ts';
import { compileCreature, creatureSchema } from './types/creature.ts';
import { compileMoves } from './types/move.ts';

const ID = 'forgotten-miner';
const content = loadGameContent();

describe('the Forgotten miner’s data (mw-e13.1)', () => {
  it('AC-1: forgotten-miner.json passes CreatureDef as a Forgotten walker with sight and hearing, no smell', ({
    task,
  }) => {
    markExercised(task, 'creature', ID);
    // The file as written, less the editor's `$schema` hint (the loader drops it too).
    const parsed = creatureSchema.safeParse(
      Object.fromEntries(Object.entries(raw).filter(([key]) => key !== '$schema')),
    );
    expect(parsed.error).toBeUndefined();
    const def = content.get('creature', ID);
    expect(def).toMatchObject({ id: ID, family: 'forgotten' });
    expect(def.presentation).toEqual({ mesh: 'placeholder-capsule-bones', sfx: 'placeholder' });
    expect(def.behaviour.profile).toBe('forgotten');
    expect(content.has('behaviour', 'forgotten')).toBe(true);

    const creature = compileCreature(def, content);
    expect(creature.senses.sight).toBeDefined();
    expect(creature.senses.hearing).toBeDefined();
    expect(creature.senses.smell).toBeUndefined();
    expect(creature.senses.special).toEqual({}); // no life-sense: it notices what it sees and hears
    // A walker: walking is its only way of moving (the Forgotten shamble profile).
    expect(def.locomotion).toMatchObject({ type: 'locomotion', id: 'forgotten' });
    expect(Object.keys(content.get('locomotion', 'forgotten').modes)).toEqual(['walk']);
    expect(creature.gaits.walk).toBeGreaterThan(0);
  });

  it('AC-1: its resistance table is blunt 1.5, pierce 0.5, poison 0 (immune), everything else 1', ({
    task,
  }) => {
    markExercised(task, 'creature', ID);
    expect(content.get('creature', ID).resistances).toEqual({ blunt: 1.5, pierce: 0.5, poison: 0 });
  });

  it('AC-1: it adopts the e04 skeleton set exactly, and every move passes the readability rule', ({
    task,
  }) => {
    markExercised(task, 'creature', ID);
    const def = content.get('creature', ID);
    expect(def.attacks.map((a) => a.id)).toEqual([
      'forgotten-overhead-chop',
      'forgotten-two-hit-slash',
      'forgotten-lunging-thrust',
    ]);
    const moves = compileMoves(content.all('move'));
    const sets = def.attacks.map((ref) => {
      const attack = compileAttack(content.get('attack', ref.id), moves);
      const chain = attack.chain ?? [attack.move];
      for (const move of chain) {
        // Readable: at least 18 ticks between its telegraph and its first active tick.
        expect(move.startup - move.telegraphTick).toBeGreaterThanOrEqual(CREATURE_MIN_WINDUP_TICKS);
      }
      return [ref.id, chain.map((m) => [m.id, m.parryable, m.blockable])];
    });
    expect(sets).toEqual([
      ['forgotten-overhead-chop', [['forgotten-overhead-chop', true, true]]],
      [
        'forgotten-two-hit-slash',
        [
          ['forgotten-slash-1', true, true],
          ['forgotten-slash-2', true, true],
        ],
      ],
      // The thrust is flagged unparryable (blockable), so it gets the longer windup.
      ['forgotten-lunging-thrust', [['forgotten-lunging-thrust', false, true]]],
    ]);
    const thrust = compileAttack(content.get('attack', 'forgotten-lunging-thrust'), moves).move;
    expect(thrust.startup - thrust.telegraphTick).toBeGreaterThanOrEqual(
      CREATURE_UNBLOCKABLE_WINDUP_TICKS,
    );
  });
});
