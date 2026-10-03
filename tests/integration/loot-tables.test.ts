// mw-e18.1: the shipped example loot tables, loaded and validated like game content, rolled by the
// sim's roller in a world (its loot stream, facts and class context).
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { LootTables, World } from '@sim/index';
import { describe, expect, it } from 'vitest';

const content = loadGameContent();
const tables = new LootTables(content.all('loot-table'), content.all('item'));

/** Every item id dropped over `rolls` rolls of `tableId` for `classId` in one world. */
function dropsOver(tableId: string, classId: string, rolls: number): Set<string> {
  const world = new World({ seed: 2026 });
  const seen = new Set<string>();
  for (let i = 0; i < rolls; i++) {
    for (const { item } of tables.rollInWorld(world, tableId, { classId }).stacks) seen.add(item);
  }
  return seen;
}

describe('example loot tables (mw-e18.1)', () => {
  it('AC-1/AC-5: the testbed supply crate always holds a draught; lockpicks only for a thief', ({
    task,
  }) => {
    markExercised(task, 'loot-table', 'testbed-supply-crate');
    markExercised(task, 'loot-table', 'testbed-sundries');
    const knight = dropsOver('testbed-supply-crate', 'knight', 2_000);
    const thief = dropsOver('testbed-supply-crate', 'thief', 2_000);
    expect([...knight].sort()).toEqual([
      'healing-draught',
      'mana-draught',
      'oil-flask',
      'standard-arrow',
    ]);
    expect([...thief].sort()).toEqual([...knight, 'lockpicks'].sort());
    const world = new World({ seed: 1 });
    for (let i = 0; i < 200; i++) {
      const { stacks, error } = tables.rollInWorld(world, 'testbed-supply-crate');
      expect(error).toBeUndefined();
      expect(stacks[0]).toEqual({ item: 'healing-draught', count: 1 });
    }
  });

  it('AC-2: two worlds with the same seed roll the same crates', () => {
    const run = () => {
      const world = new World({ seed: 77 });
      return Array.from(
        { length: 1_000 },
        () => tables.rollInWorld(world, 'testbed-supply-crate', { classId: 'thief' }).stacks,
      );
    };
    expect(run()).toEqual(run());
  });
});
