import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readManifest } from './gen-placeholders.ts';
import { main, placeholderReport } from './placeholder-report.ts';

describe('placeholder report (mw-e28.2)', () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('AC-4: lists every id with placeholder: true and a total count', () => {
    const lines = placeholderReport([
      { id: 'sfx-a', variants: ['sfx-a-01'], bus: 'ui', placeholder: true },
      { id: 'sfx-b', variants: ['sfx-b-01', 'sfx-b-02'], bus: 'sfx', placeholder: true },
      { id: 'sfx-final', variants: ['sfx-final-01'], bus: 'sfx', placeholder: false },
      { id: 'sfx-default', variants: ['sfx-default-01'], bus: 'sfx' },
    ]);
    expect(lines).toEqual([
      'sfx-a  (ui, 1 variant)',
      'sfx-b  (sfx, 2 variants)',
      'Total: 2 placeholder sounds (3 files) of 4 manifest entries.',
    ]);
  });

  it('AC-4: the command prints the committed manifest’s placeholders', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main()).toBe(0);
    const placeholders = readManifest(process.cwd()).filter((e) => e.placeholder === true);
    expect(log).toHaveBeenCalledTimes(placeholders.length + 1);
    expect(log).toHaveBeenCalledWith('sfx-impact-wood  (sfx, 4 variants)');
    expect(log).toHaveBeenLastCalledWith(
      expect.stringMatching(
        new RegExp(`^Total: ${String(placeholders.length)} placeholder sounds`),
      ),
    );
  });

  it('the CLI runs main (an empty checkout reports zero)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'placeholder-report-'));
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
    expect(log).toHaveBeenCalledWith(
      'Total: 0 placeholder sounds (0 files) of 0 manifest entries.',
    );
  });
});
