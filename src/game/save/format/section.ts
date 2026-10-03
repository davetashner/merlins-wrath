// Save sections and their migration chains (mw-e30.1). Each system that owns persistent state
// (inventory, world facts, quests, progression…) declares one section with its own schema version,
// so no central god-schema has to change when one system's data does. Stored data at version N is
// upgraded one step at a time (N → N+1 → … → current) by the section's migrations, and only then
// validated against the current zod schema, so a schema only ever describes the current shape.

import type { ComponentType, FactSnapshot, World } from '@sim/index';
import type { z } from 'zod';
import {
  MissingMigrationError,
  SaveFromNewerBuildError,
  SaveMigrationError,
  SaveSectionInvalidError,
} from './errors';

/** Upgrades section data from version `n` to `n + 1`. Must be pure: same input, same output. */
export type SectionMigration = (data: unknown) => unknown;

/** A section as stored in a save: its data version and plain data. */
export interface SectionRecord {
  readonly version: number;
  readonly data: unknown;
}

/** What a section's `deserialize` and `missing` hooks can use besides the world (mw-e27.4). */
export interface SectionLoadContext {
  /**
   * Reports something the section recovered from (a damaged part it dropped, loading the rest); it
   * becomes a `recovered` warning of the load result.
   */
  warn(message: string): void;
  /**
   * The facts the world section held: saves from before a section owned facts (`ownsFacts`) keep
   * them there. Undefined when it held none.
   */
  readonly worldFacts: FactSnapshot | undefined;
}

/**
 * One system's slice of a save.
 * @typeParam TData the current-version data shape (the schema's output).
 */
export interface SaveSection<TData = unknown> {
  /** Stable, never-renamed id: lowercase words joined by `.` or `-`, e.g. `inventory`, `world-facts`. */
  readonly id: string;
  /** Current data version (positive integer). Bump it, and add a migration, on every shape change. */
  readonly version: number;
  /**
   * Validates current-version data; its output is what `deserialize` receives. Note that zod's
   * `z.number()` rejects NaN and ±Infinity, which saves otherwise carry exactly; use a custom check
   * where a field may legitimately hold them.
   */
  readonly schema: z.ZodType<TData>;
  /**
   * Component types whose rows this section saves itself. They are left out of the core world
   * section, so their shape is versioned and migrated here. Components not claimed by any section
   * are saved with the world snapshot.
   */
  readonly components?: readonly ComponentType<unknown>[];
  /**
   * This section saves the world's facts itself (mw-e27.4): they are left out of the world section
   * and not restored by it (the section restores them, reading older saves' facts from
   * `context.worldFacts`). At most one section of a registry owns facts.
   */
  readonly ownsFacts?: boolean;
  /**
   * `migrations[n]` upgrades data from version n to n + 1; keys must lie in [1, version − 1]. A gap
   * in the chain is reported as MissingMigrationError when a save needs it.
   */
  readonly migrations?: Readonly<Record<number, SectionMigration>>;
  /** Reads this section's state out of the world as plain, canonically encodable data. */
  serialize(world: World): TData;
  /**
   * Writes validated data into the world. Runs after the world snapshot is restored (entities exist,
   * owned components are empty) and after sections registered before it.
   */
  deserialize(world: World, data: TData, context: SectionLoadContext): void;
  /**
   * Runs in place of `deserialize` when the save has no record of this section (one written before
   * the section existed), at the same point of the load. When it is defined the load raises no
   * `missing-section` warning: the section has handled the absence.
   */
  missing?(world: World, context: SectionLoadContext): void;
}

const SECTION_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

const isVersion = (n: number): boolean => Number.isSafeInteger(n) && n >= 1;

/**
 * Checks a section definition and returns it frozen. Registries call this too, so defining a section
 * with it is optional; it exists to catch mistakes at module load and to infer `TData`.
 * @throws RangeError for a malformed id, version or migration key.
 */
export function defineSaveSection<TData>(section: SaveSection<TData>): SaveSection<TData> {
  if (!SECTION_ID.test(section.id)) {
    throw new RangeError(`save section id "${section.id}" must match ${SECTION_ID.source}`);
  }
  if (!isVersion(section.version)) {
    throw new RangeError(
      `save section "${section.id}" version must be a positive integer, got ${String(section.version)}`,
    );
  }
  for (const key of Object.keys(section.migrations ?? {})) {
    const from = Number(key);
    if (!isVersion(from) || from >= section.version) {
      throw new RangeError(
        `save section "${section.id}" migration key ${key} must be an integer in [1, ${String(section.version - 1)}]`,
      );
    }
  }
  return Object.freeze({ ...section });
}

/** Outcome of migrating or validating section data. */
export type SectionResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error:
        | MissingMigrationError
        | SaveFromNewerBuildError
        | SaveMigrationError
        | SaveSectionInvalidError;
    };

/**
 * Upgrades stored data to `section.version` by running each migration step in order. The whole chain
 * is checked before any step runs, so a gap is reported without doing partial work.
 */
export function migrateSection(
  section: Pick<SaveSection, 'id' | 'version' | 'migrations'>,
  record: SectionRecord,
): SectionResult<unknown> {
  const { id, version, migrations = {} } = section;
  if (record.version > version) {
    return {
      ok: false,
      error: new SaveFromNewerBuildError('section', record.version, version, id),
    };
  }
  const steps: SectionMigration[] = [];
  for (let from = record.version; from < version; from++) {
    const step = migrations[from];
    if (step === undefined)
      return { ok: false, error: new MissingMigrationError(id, from, from + 1) };
    steps.push(step);
  }
  let data = record.data;
  for (const [i, step] of steps.entries()) {
    const from = record.version + i;
    try {
      data = step(data);
    } catch (cause) {
      return { ok: false, error: new SaveMigrationError(id, from, from + 1, cause) };
    }
  }
  return { ok: true, data };
}

/** Validates current-version data against the section schema, returning the schema's output. */
export function validateSection<TData>(
  section: Pick<SaveSection<TData>, 'id' | 'version' | 'schema'>,
  data: unknown,
): SectionResult<TData> {
  const parsed = section.schema.safeParse(data);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues.map(
    (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
  );
  return { ok: false, error: new SaveSectionInvalidError(section.id, section.version, issues) };
}
