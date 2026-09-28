// Typed save-load failures (mw-e30.1). Loading returns these rather than throwing, so the load UI,
// corruption recovery (mw-e30.8) and the fixture gate (mw-e30.3) can branch on `kind` and show the
// player something better than "your save is incompatible".

/** Every way a load can fail; discriminate on `kind`. */
export type SaveLoadError =
  | SaveCorruptError
  | SaveFromNewerBuildError
  | MissingMigrationError
  | SaveMigrationError
  | SaveSectionInvalidError
  | SaveApplyError;

/** The bytes are not an intact save: bad magic, truncated, checksum mismatch or malformed body. */
export class SaveCorruptError extends Error {
  override readonly name = 'SaveCorruptError';
  readonly kind = 'corrupt';

  constructor(readonly reason: string) {
    super(`save is corrupt: ${reason}`);
  }
}

/** What a newer build changed: the byte format, the envelope schema, or one section's data. */
export type NewerBuildPart = 'format' | 'schema' | 'section';

/** The save was written by a newer build than this one understands; nothing was parsed or changed. */
export class SaveFromNewerBuildError extends Error {
  override readonly name = 'SaveFromNewerBuildError';
  readonly kind = 'newer-build';

  constructor(
    readonly part: NewerBuildPart,
    /** Version found in the save. */
    readonly found: number,
    /** Newest version this build supports. */
    readonly supported: number,
    /** The section, when `part` is 'section'. */
    readonly section?: string,
  ) {
    const what = section === undefined ? `save ${part}` : `section "${section}"`;
    super(
      `${what} version ${String(found)} is newer than this build supports (${String(supported)})`,
    );
  }
}

/** No migration is registered for one step of a section's (or the envelope's) upgrade chain. */
export class MissingMigrationError extends Error {
  override readonly name = 'MissingMigrationError';
  readonly kind = 'missing-migration';

  constructor(
    readonly section: string,
    /** The step that is missing: `from` → `from + 1`. */
    readonly from: number,
    readonly to: number,
  ) {
    super(`section "${section}" has no migration from v${String(from)} to v${String(to)}`);
  }
}

/** A registered migration threw; names the exact step so fixture failures point at the culprit. */
export class SaveMigrationError extends Error {
  override readonly name = 'SaveMigrationError';
  readonly kind = 'migration-failed';

  constructor(
    readonly section: string,
    readonly from: number,
    readonly to: number,
    override readonly cause: unknown,
  ) {
    super(
      `section "${section}" migration v${String(from)} → v${String(to)} threw: ${String(cause)}`,
    );
  }
}

/** Section data (after migration, or as serialized for writing) does not match its schema. */
export class SaveSectionInvalidError extends Error {
  override readonly name = 'SaveSectionInvalidError';
  readonly kind = 'section-invalid';

  constructor(
    readonly section: string,
    readonly version: number,
    /** Human-readable schema issues, e.g. `hp: expected number`. */
    readonly issues: readonly string[],
  ) {
    super(`section "${section}" v${String(version)} is invalid: ${issues.join('; ')}`);
  }
}

/** Restoring into the world threw; the world was rolled back to its state before the load. */
export class SaveApplyError extends Error {
  override readonly name = 'SaveApplyError';
  readonly kind = 'apply-failed';

  constructor(
    readonly section: string,
    override readonly cause: unknown,
  ) {
    super(`applying section "${section}" failed: ${String(cause)}`);
  }
}
