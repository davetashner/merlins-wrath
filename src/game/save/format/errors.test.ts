// Every load error is typed, discriminated by `kind`, and says what went wrong in plain words.
import { describe, expect, it } from 'vitest';
import {
  MissingMigrationError,
  SaveApplyError,
  SaveCorruptError,
  SaveFromNewerBuildError,
  SaveMigrationError,
  SaveSectionInvalidError,
  type SaveLoadError,
} from './errors';

describe('save load errors', () => {
  const cause = new Error('bad');
  const cases: [SaveLoadError, string, string, RegExp][] = [
    [new SaveCorruptError('checksum'), 'SaveCorruptError', 'corrupt', /save is corrupt: checksum/],
    [
      new SaveFromNewerBuildError('schema', 3, 1),
      'SaveFromNewerBuildError',
      'newer-build',
      /save schema version 3 is newer than this build supports \(1\)/,
    ],
    [
      new SaveFromNewerBuildError('section', 5, 2, 'inventory'),
      'SaveFromNewerBuildError',
      'newer-build',
      /section "inventory" version 5/,
    ],
    [
      new MissingMigrationError('inventory', 1, 2),
      'MissingMigrationError',
      'missing-migration',
      /"inventory" has no migration from v1 to v2/,
    ],
    [
      new SaveMigrationError('inventory', 2, 3, cause),
      'SaveMigrationError',
      'migration-failed',
      /"inventory" migration v2 → v3 threw: Error: bad/,
    ],
    [
      new SaveSectionInvalidError('inventory', 3, ['a: x', 'b: y']),
      'SaveSectionInvalidError',
      'section-invalid',
      /"inventory" v3 is invalid: a: x; b: y/,
    ],
    [
      new SaveApplyError('inventory', cause),
      'SaveApplyError',
      'apply-failed',
      /applying section "inventory" failed: Error: bad/,
    ],
  ];

  it.each(cases)('%o has name, kind and message', (error, name, kind, message) => {
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.kind).toBe(kind);
    expect(error.message).toMatch(message);
  });

  it('keeps the underlying cause', () => {
    expect(new SaveApplyError('x', cause).cause).toBe(cause);
    expect(new SaveMigrationError('x', 1, 2, cause).cause).toBe(cause);
  });
});
