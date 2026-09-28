import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectedSchemas, main } from './content-schemas.ts';

describe('content-schemas', () => {
  const cwd = process.cwd();
  const argv = process.argv;
  let dir: string;
  const schemaPath = 'src/content/data/testprop.schema.json';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'content-schemas-'));
    mkdirSync(join(dir, 'src/content/data'), { recursive: true });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(cwd);
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true });
  });

  it('the committed JSON Schemas are up to date (run pnpm content:schemas if this fails)', () => {
    expect(main(['--check'], cwd)).toBe(0);
  });

  it('writes one schema per content type, then --check passes', () => {
    expect(main([], dir)).toBe(0);
    expect(console.log).toHaveBeenCalledWith(`wrote ${schemaPath}`);
    expect(readFileSync(join(dir, schemaPath), 'utf8')).toBe(expectedSchemas().get(schemaPath));
    expect(main(['--check'], dir)).toBe(0);
  });

  it('--check fails listing missing or stale schemas without writing them', () => {
    expect(main(['--check'], dir)).toBe(1);
    writeFileSync(join(dir, schemaPath), '{}\n');
    expect(main(['--check'], dir)).toBe(1);
    expect(console.log).toHaveBeenCalledWith(
      `::error title=Content schemas::${schemaPath} is stale; run pnpm content:schemas.`,
    );
    expect(readFileSync(join(dir, schemaPath), 'utf8')).toBe('{}\n');
  });

  it('the CLI sets the process exit code from main', async () => {
    process.chdir(dir);
    process.argv = ['node', 'content-schemas-cli.ts', '--check'];
    await import('./content-schemas-cli.ts');
    expect(process.exitCode).toBe(1);
  });
});
