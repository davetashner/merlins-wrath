// Save fixtures on disk (mw-e30.3): the lock file, the per-revision fixture folders, and the two
// operations over them — checking the gate and generating a new revision. Shared by the CI test in
// tests/save-fixtures and the pnpm save:* CLI, which are the only places fixtures touch the disk.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SaveRegistry } from '@game/save/format';
import {
  createFixture,
  FIXTURE_WORLDS,
  loadFixture,
  parseFixture,
  serializeFixture,
  type FixtureWorld,
  type LoadedFixture,
  type ScenarioRegistry,
} from './fixtures';
import { FIXTURE_SCENARIOS } from './scenarios';
import {
  checkSchemaLock,
  matchesLatest,
  parseLock,
  SAVE_FIXTURE_DIR,
  schemaStateOf,
  serializeLock,
  type LockProblem,
  type SchemaLock,
} from './schema-lock';

/** The lock file, relative to the repo root. */
export const LOCK_PATH = `${SAVE_FIXTURE_DIR}/save-schema.lock.json`;

const REVISION_DIR = /^\d+$/;

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: cannot read JSON (${(error as Error).message})`, { cause: error });
  }
}

/** The committed lock, or an empty one when the file does not exist yet. */
export function readLock(root: string): SchemaLock {
  const path = join(root, LOCK_PATH);
  return existsSync(path) ? parseLock(readJson(path)) : { revisions: [] };
}

/** Revision directory name → its fixture files (`*.json`, sorted), relative to the repo root. */
export function listFixtures(root: string): Record<string, string[]> {
  const dir = join(root, SAVE_FIXTURE_DIR);
  if (!existsSync(dir)) return {};
  const result: Record<string, string[]> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !REVISION_DIR.test(entry.name)) continue;
    result[entry.name] = readdirSync(join(dir, entry.name))
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => `${SAVE_FIXTURE_DIR}/${entry.name}/${file}`);
  }
  return result;
}

/** Runs the lock check against the fixtures on disk. */
export function checkSaveFixtures(root: string, registry: SaveRegistry): LockProblem[] {
  const counts = Object.fromEntries(
    Object.entries(listFixtures(root)).map(([dir, files]) => [dir, files.length]),
  );
  return checkSchemaLock(schemaStateOf(registry), readLock(root), counts);
}

/** Reads, parses and loads one fixture file (path relative to `root`). */
export function loadFixtureFile(
  root: string,
  path: string,
  registry: SaveRegistry,
  scenarios: ScenarioRegistry = FIXTURE_SCENARIOS,
): LoadedFixture {
  let fixture;
  try {
    fixture = parseFixture(readJson(join(root, path)));
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`, { cause: error });
  }
  return loadFixture(path, fixture, registry, scenarios);
}

/** What `generateSaveFixtures` did. */
export type GenerateOutcome =
  | { readonly status: 'refused'; readonly problems: readonly LockProblem[] }
  | { readonly status: 'up-to-date'; readonly revision: number }
  | { readonly status: 'written'; readonly revision: number; readonly files: readonly string[] };

/** Problems `pnpm save:fixture` cannot fix by writing a revision: the developer must act first. */
const REFUSE: ReadonlySet<LockProblem['kind']> = new Set([
  'unversioned-change',
  'version-regressed',
  'revision-order',
]);

/**
 * Writes fixtures for the current schema: a new revision (and lock entry) when versions changed, or
 * the newest revision's fixtures when its folder is empty. Refuses — writing nothing — when a
 * schema changed without a version bump or the lock is inconsistent.
 */
export function generateSaveFixtures(
  root: string,
  registry: SaveRegistry,
  worlds: readonly FixtureWorld[] = FIXTURE_WORLDS,
  scenarios: ScenarioRegistry = FIXTURE_SCENARIOS,
): GenerateOutcome {
  const problems = checkSaveFixtures(root, registry);
  const blocking = problems.filter((problem) => REFUSE.has(problem.kind));
  if (blocking.length > 0) return { status: 'refused', problems: blocking };

  const lock = readLock(root);
  const current = matchesLatest(schemaStateOf(registry), lock);
  const revision = current ? lock.revisions.length : lock.revisions.length + 1;
  const existing = listFixtures(root)[String(revision)] ?? [];
  if (current && existing.length > 0) return { status: 'up-to-date', revision };

  const dir = join(root, SAVE_FIXTURE_DIR, String(revision));
  mkdirSync(dir, { recursive: true });
  const files = worlds.map((spec) => {
    const path = `${SAVE_FIXTURE_DIR}/${String(revision)}/${spec.name}.json`;
    writeFileSync(
      join(root, path),
      serializeFixture(createFixture(spec, revision, registry, scenarios)),
    );
    return path;
  });
  if (!current) {
    const next: SchemaLock = {
      revisions: [...lock.revisions, { revision, ...schemaStateOf(registry) }],
    };
    writeFileSync(join(root, LOCK_PATH), serializeLock(next));
  }
  return { status: 'written', revision, files };
}
