// World state round trip (mw-e27.4 AC-1): randomly generated facts and level deltas (fast-check), a
// thousand of each per world, survive a save and load through the game's registry deep-equal, with
// matching state hashes.
import {
  hashLevelDeltas,
  hashWorld,
  levelDeltasOf,
  World,
  type EntityDelta,
  type FactValue,
  type LevelDeltas,
  type SpawnedRecord,
} from '@sim/index';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGameSaveRegistry } from './sections';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const options = { build, wallClockSavedAt: 1_790_000_000_000 };

/** How many facts, and how many entity deltas plus spawned records, each world holds. */
const COUNT = 1000;

const segment = fc.stringMatching(/^[a-z0-9]{1,6}(?:-[a-z0-9]{1,6})?$/);
const factKey = fc.oneof(
  fc.array(segment, { minLength: 1, maxLength: 3 }).map((parts) => parts.join('.')),
  fc
    .tuple(segment, segment, segment)
    .map(([level, entity, fact]) => `entity:${level}/${entity}.${fact}`),
);
const factValue: fc.Arbitrary<FactValue> = fc.oneof(
  fc.boolean(),
  fc.maxSafeInteger().map((n) => (n === 0 ? 0 : n)),
  fc.string({ minLength: 1, maxLength: 12 }),
);
const facts = fc.uniqueArray(fc.tuple(factKey, factValue), {
  minLength: COUNT,
  maxLength: COUNT,
  selector: ([key]) => key,
});

// Plain JSON data, as declarations and spawners record it (no -0: JSON has none).
const data = fc
  .jsonValue({ maxDepth: 2 })
  .map((value) => JSON.parse(JSON.stringify(value)) as unknown);
const stableId = fc.stringMatching(/^(?:spawn|piece|creature):[a-z0-9-]{1,10}$/);
const entityDelta: fc.Arbitrary<EntityDelta> = fc.oneof(
  stableId.map((id) => ({ id, destroyed: true as const })),
  fc
    .tuple(
      stableId,
      fc.dictionary(fc.constantFrom('door', 'lock', 'container', 'transform'), data, {
        minKeys: 1,
      }),
    )
    .map(([id, aspects]) => ({ id, aspects })),
);
const spawned: fc.Arbitrary<SpawnedRecord> = fc.record({
  id: fc.nat().map((n) => `spawned:${String(n)}`),
  kind: fc.constantFrom('item', 'corpse'),
  data,
});
const part = fc.oneof(
  { weight: 3, arbitrary: entityDelta.map((delta) => ({ delta })) },
  { weight: 1, arbitrary: spawned.map((record) => ({ record })) },
);
const levels = fc
  .tuple(
    fc.uniqueArray(segment, { minLength: 1, maxLength: 6 }),
    fc.array(fc.tuple(fc.nat(), part), { minLength: COUNT, maxLength: COUNT }),
  )
  .map(([ids, parts]): LevelDeltas[] =>
    ids.map((level, index) => {
      const mine = parts.filter(([n]) => n % ids.length === index).map(([, p]) => p);
      return {
        level,
        entities: mine.flatMap((p) => ('delta' in p ? [p.delta] : [])),
        spawned: mine.flatMap((p) => ('record' in p ? [p.record] : [])),
      };
    }),
  );

describe('world state in saves', () => {
  it(`AC-1: ${String(COUNT)} random facts and ${String(COUNT)} random deltas round-trip deep-equal with matching state hashes`, () => {
    const registry = createGameSaveRegistry();
    fc.assert(
      fc.property(facts, levels, fc.nat({ max: 1000 }), (factList, levelList, ticks) => {
        const world = new World<never>({ seed: 7 });
        for (let tick = 0; tick < ticks % 5; tick++) world.step();
        for (const [key, value] of factList) world.facts.set(key, value);
        levelDeltasOf(world).restore(levelList);
        const bytes = registry.write(world, options);

        const loaded = new World<never>({ seed: 99 });
        const result = registry.read(loaded, bytes);
        expect(result.ok && result.warnings).toEqual([]);
        expect(loaded.facts.snapshot()).toEqual(world.facts.snapshot());
        expect(hashWorld(loaded)).toBe(hashWorld(world));
        const restored = levelDeltasOf(loaded).capture(loaded);
        expect(restored).toEqual(levelDeltasOf(world).capture(world));
        expect(hashLevelDeltas(restored)).toBe(hashLevelDeltas(levelList));
      }),
      { numRuns: 20, seed: 274 },
    );
  }, 60_000);
});
