// Save fixtures (mw-e30.3): real save bytes written by a past build from representative worlds, kept
// forever in tests/save-fixtures/<revision>/. Every CI run loads each one through the current
// migration chain into a fresh world and checks the result, so a save a player made on any released
// schema keeps loading. Fixtures are deterministic — fixed seeds, tick counts, build info and wall
// clock — so regenerating one on any machine gives the same bytes.

import { loadGameContent } from '@content/index';
import {
  addEquipment,
  addInventory,
  EquipmentRules,
  hashWorld,
  InventoryRules,
  levelDeltasOf,
  QuickSlotsComponent,
  Rng,
  type DifficultyOverrides,
  type FactValue,
  type ReplayScenario,
  type World,
} from '@sim/index';
import type { SaveLoadError, SaveRegistry } from '@game/save/format';
import { z } from 'zod';
import { FIXTURE_SCENARIOS, knockOutSleeper } from './scenarios';

/** A representative world to save as a fixture. */
export interface FixtureWorld {
  /** File name (without `.json`); unique within a revision. */
  readonly name: string;
  readonly description: string;
  /** Registered replay scenario that builds the world (components, systems, starting entities). */
  readonly scenario: string;
  readonly seed: number;
  /** Ticks to run the scenario's own input script before saving. */
  readonly ticks: number;
  /** Difficulty overrides applied before saving, to cover the optional field. */
  readonly difficulty?: DifficultyOverrides;
  /** World facts set before saving, to cover the optional `facts` field. */
  readonly facts?: Readonly<Record<string, FactValue>>;
  /**
   * Adds saved state the scenario does not reach (an actor's inventory…), after the facts. Loading
   * needs only the scenario: the save restores what this added.
   */
  readonly prepare?: (world: World) => void;
}

/**
 * Gives a new actor a knight's pack (mw-e17.8): split and stolen stacks, gold, a key, equipped sword,
 * shield, hauberk and arrows, and a quick slot on the draughts. Uses the game's item content.
 */
export function packAnActor(world: World): void {
  const content = loadGameContent();
  const items = content.all('item');
  const inventory = new InventoryRules(items);
  const equipment = new EquipmentRules(items, content.all('class'));
  const actor = world.spawn();
  addInventory(world, actor, 125);
  addEquipment(world, actor, 'knight');
  const equipAll = (defId: string): void => {
    for (const { instanceId } of inventory.query(world, actor, { defId })) {
      equipment.equip(world, actor, instanceId);
    }
  };
  for (const defId of ['arming-sword', 'wooden-shield', 'mail-hauberk']) {
    inventory.add(world, actor, defId, 1);
    equipAll(defId);
  }
  inventory.add(world, actor, 'standard-arrow', 30);
  equipAll('standard-arrow');
  // Instances 5 and 6: 13 draughts split at maxStack 10.
  inventory.add(world, actor, 'healing-draught', 13);
  inventory.add(world, actor, 'healing-draught', 2, { stolen: true, ownerId: 'miller' });
  inventory.add(world, actor, 'testbed-closet-key', 1);
  world.register(QuickSlotsComponent);
  world.add(actor, QuickSlotsComponent, {
    slots: [{ defId: 'healing-draught', instanceId: 5 }, null, null, null],
    busyUntil: 0,
  });
}

/**
 * Records the changes of two levels the player has left (mw-e27.4): an opened, unlocked door, a
 * looted chest, a smashed wall and a dropped draught in one; a moved crate in the other.
 */
export function visitLevels(world: World): void {
  levelDeltasOf(world).restore([
    {
      level: 'mechanism-room',
      entities: [
        {
          id: 'spawn:north-gate',
          aspects: { door: { openness: 1, target: 1, jammed: false, broken: false } },
        },
        { id: 'spawn:south-door', aspects: { lock: { locked: false } } },
      ],
      spawned: [],
    },
    {
      level: 'testbed',
      entities: [
        { id: 'piece:6', destroyed: true },
        {
          id: 'spawn:closet-door',
          aspects: { door: { openness: 1, target: 1, jammed: false, broken: false } },
        },
        { id: 'spawn:testbed-draught', destroyed: true },
        {
          id: 'spawn:loose-crate',
          aspects: {
            transform: {
              position: { x: -1.5, y: 0.5, z: -2 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
            },
          },
        },
      ],
      spawned: [
        {
          id: 'spawned:412',
          kind: 'item',
          data: {
            defId: 'healing-draught',
            count: 1,
            flags: {},
            position: { x: 2, y: 0.1, z: 3 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
      ],
    },
  ]);
}

/**
 * The worlds each new fixture revision saves. Add one when a system gains saved state that these do
 * not reach (for example a scenario for a new section); existing revisions keep what they had.
 */
export const FIXTURE_WORLDS: readonly FixtureWorld[] = [
  {
    name: 'core-start',
    description: 'core scenario at tick 0: starting bodies, untouched RNG streams',
    scenario: 'core',
    seed: 1,
    ticks: 0,
  },
  {
    name: 'core-busy',
    description: 'core scenario after 10 s: spawns, deaths, pushes and advanced RNG streams',
    scenario: 'core',
    seed: 7,
    ticks: 600,
  },
  {
    name: 'core-tuned',
    description: 'core scenario after 4 s with non-neutral difficulty multipliers',
    scenario: 'core',
    seed: 11,
    ticks: 240,
    difficulty: { detectionSpeed: 0.5, damageTaken: 1.5 },
  },
  {
    name: 'core-facts',
    description: 'core scenario after 2 s with world facts of every value kind set',
    scenario: 'core',
    seed: 13,
    ticks: 120,
    facts: {
      'chapel-of-echoes.portcullis-dropped': true,
      'quest.missing-miller.stage': 3,
      'entity:mine/chest-3.looted-by': 'player',
    },
  },
  {
    name: 'core-inventory',
    description: 'core scenario after 1 s plus an actor with a pack, equipment and quick slots',
    scenario: 'core',
    seed: 17,
    ticks: 60,
    prepare: packAnActor,
  },
  {
    name: 'core-world-state',
    description: 'core scenario after 1 s with world facts and the changes of two visited levels',
    scenario: 'core',
    seed: 19,
    ticks: 60,
    facts: {
      'entity:testbed/closet-door.opened': true,
      'entity:testbed/testbed-draught.looted': true,
    },
    prepare: visitLevels,
  },
  {
    name: 'creature-guards',
    description:
      'guard hall after 15 s (mw-e12.14): a guard searching the spot an alarm named, aware of a thrown stone, and a guard knocked out for 2 min',
    scenario: 'creature-guards',
    seed: 23,
    ticks: 900,
    prepare: knockOutSleeper,
  },
];

/** Build info stamped on every fixture, so fixture bytes never depend on the commit. */
export const FIXTURE_BUILD = {
  gameVersion: '0.0.0-fixture',
  buildSha: 'fixture',
  contentHash: 'fixture',
} as const;

/** Wall clock stamped on every fixture (2026-01-01T00:00:00Z). */
export const FIXTURE_SAVED_AT = 1_767_225_600_000;

/** Tick rate fixture worlds are built at. */
export const FIXTURE_HZ = 60;

/** The replay recorder's driver stream name, so fixtures see the same inputs as golden replays. */
const DRIVER_STREAM = 'replay-driver';

/** A fixture file as stored. */
export interface SaveFixture {
  readonly name: string;
  readonly description: string;
  /** The schema lock revision it was generated for (its directory name). */
  readonly revision: number;
  readonly scenario: string;
  readonly seed: number;
  readonly ticks: number;
  /** Section id → version the save holds, for reviewers; the bytes are authoritative. */
  readonly sections: Readonly<Record<string, number>>;
  /** The save file bytes, base64. */
  readonly save: string;
}

const fixtureSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string(),
  revision: z.int().positive(),
  scenario: z.string(),
  seed: z.int().nonnegative(),
  ticks: z.int().nonnegative(),
  sections: z.record(z.string(), z.int().positive()),
  save: z.base64(),
});

/** Scenario lookups, injectable for tests. */
export type ScenarioRegistry = Readonly<Record<string, ReplayScenario<unknown>>>;

function scenarioNamed(name: string, scenarios: ScenarioRegistry): ReplayScenario<unknown> {
  const scenario = scenarios[name];
  if (scenario === undefined) {
    const known = Object.keys(scenarios).join(', ');
    throw new Error(`unknown scenario "${name}" (registered: ${known})`);
  }
  return scenario;
}

/** Runs a fixture world's scenario and returns the world to save. */
export function buildFixtureWorld(
  spec: FixtureWorld,
  scenarios: ScenarioRegistry = FIXTURE_SCENARIOS,
): World {
  const scenario = scenarioNamed(spec.scenario, scenarios);
  const world = scenario.create({ seed: spec.seed, hz: FIXTURE_HZ });
  const rng = Rng.create(spec.seed).stream(DRIVER_STREAM);
  for (let tick = 0; tick < spec.ticks; tick++) {
    world.step(scenario.drive({ tick, world, rng }));
  }
  for (const [key, value] of Object.entries(spec.facts ?? {})) world.facts.set(key, value);
  spec.prepare?.(world);
  if (spec.difficulty !== undefined) {
    world.restore({ ...world.snapshot(), difficulty: spec.difficulty });
  }
  return world;
}

/** Saves a fixture world with the current registry. */
export function createFixture(
  spec: FixtureWorld,
  revision: number,
  registry: SaveRegistry,
  scenarios: ScenarioRegistry = FIXTURE_SCENARIOS,
): SaveFixture {
  const world = buildFixtureWorld(spec, scenarios);
  const bytes = registry.write(world, {
    build: FIXTURE_BUILD,
    wallClockSavedAt: FIXTURE_SAVED_AT,
    metadata: { fixture: spec.name },
  });
  return {
    name: spec.name,
    description: spec.description,
    revision,
    scenario: spec.scenario,
    seed: spec.seed,
    ticks: spec.ticks,
    sections: Object.fromEntries(registry.sections.map(({ id, version }) => [id, version])),
    save: Buffer.from(bytes).toString('base64'),
  };
}

/** Fixture file text: two-space indent, trailing newline. */
export function serializeFixture(fixture: SaveFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

/**
 * Parses fixture file JSON.
 * @throws Error listing the schema issues.
 */
export function parseFixture(data: unknown): SaveFixture {
  const parsed = fixtureSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`malformed save fixture: ${issues.join('; ')}`);
  }
  return parsed.data;
}

/** The migration step that failed, when a load failed inside the migration chain. */
export interface FailedStep {
  readonly section: string;
  readonly from: number;
  readonly to: number;
}

/** A fixture that did not load, or loaded into a world that fails its invariants (AC-4). */
export class FixtureLoadError extends Error {
  override readonly name = 'FixtureLoadError';

  constructor(
    /** The fixture file, relative to the repo root. */
    readonly path: string,
    message: string,
    /** Set when a migration step threw or is missing. */
    readonly step?: FailedStep,
    override readonly cause?: unknown,
  ) {
    super(`${path}: ${message}`);
  }
}

function describeLoadError(path: string, error: SaveLoadError): FixtureLoadError {
  if (error.kind === 'migration-failed' || error.kind === 'missing-migration') {
    const { section, from, to } = error;
    return new FixtureLoadError(
      path,
      `migration step "${section}" v${String(from)} → v${String(to)} failed: ${error.message}`,
      { section, from, to },
      error,
    );
  }
  return new FixtureLoadError(
    path,
    `failed to load (${error.kind}): ${error.message}`,
    undefined,
    error,
  );
}

/** A successfully loaded and checked fixture. */
export interface LoadedFixture {
  readonly world: World;
  /** State hash of the loaded world, before the invariant step. */
  readonly hash: string;
}

/**
 * Loads a fixture's bytes through the current registry (decode → migrate → validate → apply) into a
 * fresh world of its scenario, then checks the world's invariants:
 * - the world's tick equals the save's `createdAtTick`;
 * - it saves again with the current registry (every section re-validates) and that save loads into
 *   another fresh world with the identical state hash;
 * - it simulates one more tick without throwing.
 * @throws FixtureLoadError naming the fixture path, and the migration step when one failed.
 */
export function loadFixture(
  path: string,
  fixture: SaveFixture,
  registry: SaveRegistry,
  scenarios: ScenarioRegistry = FIXTURE_SCENARIOS,
): LoadedFixture {
  const fail = (message: string, cause?: unknown): FixtureLoadError =>
    new FixtureLoadError(path, message, undefined, cause);
  let scenario: ReplayScenario<unknown>;
  try {
    scenario = scenarioNamed(fixture.scenario, scenarios);
  } catch (error) {
    throw fail((error as Error).message, error);
  }
  const fresh = (): World => scenario.create({ seed: fixture.seed, hz: FIXTURE_HZ });
  const world = fresh();
  const loaded = registry.read(world, Buffer.from(fixture.save, 'base64'));
  if (!loaded.ok) throw describeLoadError(path, loaded.error);
  if (world.tick !== loaded.envelope.createdAtTick) {
    throw fail(
      `loaded world is at tick ${String(world.tick)} but the save was made at tick ${String(loaded.envelope.createdAtTick)}`,
    );
  }
  const hash = hashWorld(world);
  let resaved: Uint8Array;
  try {
    resaved = registry.write(world, {
      build: FIXTURE_BUILD,
      wallClockSavedAt: FIXTURE_SAVED_AT,
      preserve: loaded.unknownSections,
    });
  } catch (error) {
    throw fail(`loaded world cannot be saved again: ${(error as Error).message}`, error);
  }
  const again = fresh();
  const reloaded = registry.read(again, resaved);
  if (!reloaded.ok) {
    throw fail(`re-saved world does not load: ${reloaded.error.message}`, reloaded.error);
  }
  if (hashWorld(again) !== hash) {
    throw fail('re-saved world loads into a different state (hash mismatch)');
  }
  try {
    world.step([]);
  } catch (error) {
    throw fail(`loaded world cannot simulate a tick: ${(error as Error).message}`, error);
  }
  return { world, hash };
}
