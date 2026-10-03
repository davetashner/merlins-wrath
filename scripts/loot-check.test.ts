import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './loot-check.ts';

describe('loot-check main (mw-e18.2)', () => {
  const cwd = process.cwd();
  const argv = process.argv;
  let dir: string;
  const run = () => main(['--content', 'data'], dir);
  const writeTable = (id: string, body: object) => {
    writeFileSync(
      join(dir, `data/loot-table/${id}.json`),
      JSON.stringify({ id, notes: 'A test table.', ...body }),
    );
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loot-check-'));
    cpSync(join(cwd, 'src/content/data'), join(dir, 'data'), { recursive: true });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(cwd);
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true });
  });

  it('AC-5: the repository loot content passes, printing unreferenced tables as warnings', () => {
    // The testbed's supply chest rolls testbed-supply-crate (mw-e18.3), so only the extra is unused.
    writeTable('zz-spare', { guaranteed: [{ item: 'healing-draught' }] });
    expect(run()).toBe(0);
    expect(console.log).toHaveBeenCalledWith(
      '::warning title=Loot tables::data/loot-table/zz-spare.json#: loot-table:zz-spare is not referenced by any creature, container or loot table',
    );
    expect(console.log).toHaveBeenCalledWith('Loot tables valid (3 table(s), 1 warning(s)).');
  });

  it('AC-2: fails naming a cycle of nested tables', () => {
    writeTable('zz-a', { rolls: { min: 1, max: 1 }, entries: [{ table: 'zz-a', weight: 1 }] });
    expect(run()).toBe(1);
    expect(console.log).toHaveBeenCalledWith(
      '::error title=Loot tables::data/loot-table/zz-a.json#/entries/0/table: loot-table:zz-a entries[0] closes a cycle of nested tables: zz-a > zz-a',
    );
  });

  it('rethrows unexpected errors', () => {
    mkdirSync(join(dir, 'data/loot-table/folder.json'));
    expect(run).toThrow(/EISDIR/);
  });

  it('the CLI sets the process exit code from main, reading the default content folder', async () => {
    expect(main(['--content'], cwd)).toBe(0); // a flag with no value falls back to the default
    process.argv = ['node', 'loot-check-cli.ts'];
    await import('./loot-check-cli.ts');
    expect(process.exitCode).toBe(0);
  });
});
