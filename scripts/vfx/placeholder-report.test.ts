import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readManifest } from './gen-placeholders.ts';
import { main, placeholderReport } from './placeholder-report.ts';

describe('VFX placeholder report (mw-e29.2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('AC-4: lists every texture with placeholder: true and a count', () => {
    const entry = { width: 64, height: 64, cols: 1, rows: 1 };
    expect(
      placeholderReport([
        { id: 'vfx-base-ring-01', ...entry, placeholder: true },
        {
          id: 'vfx-base-flame-8x8-01',
          width: 256,
          height: 256,
          cols: 8,
          rows: 8,
          placeholder: true,
        },
        { id: 'vfx-base-shard-01', ...entry, placeholder: false },
      ]),
    ).toEqual([
      'vfx-base-ring-01  (64×64)',
      'vfx-base-flame-8x8-01  (256×256, 8×8 frames)',
      'Total: 2 placeholder VFX textures of 3 manifest entries.',
    ]);
  });

  it('AC-4: the command prints the committed manifest’s placeholders', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main()).toBe(0);
    const placeholders = readManifest(process.cwd()).filter((e) => e.placeholder);
    expect(placeholders.length).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledTimes(placeholders.length + 1);
    expect(log).toHaveBeenCalledWith('vfx-base-soft-circle-01  (64×64)');
    expect(log).toHaveBeenLastCalledWith(
      `Total: ${String(placeholders.length)} placeholder VFX textures of ${String(placeholders.length)} manifest entries.`,
    );
  });

  it('the CLI runs main (an empty checkout reports zero)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vfx-placeholder-report-'));
    const cwd = process.cwd();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.chdir(dir);
    try {
      await import('./placeholder-report-cli.ts');
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true });
    }
    expect(process.exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith('Total: 0 placeholder VFX textures of 0 manifest entries.');
  });
});
