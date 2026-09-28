import { afterEach, describe, expect, it, vi } from 'vitest';

describe('save fixture CLI entry point', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('loads the save fixture tools through Vite and sets the exit code from main', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.argv = ['node', 'save-fixture-cli.ts', '--help'];
    await import('./save-fixture-cli.ts');
    expect(process.exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pnpm save:fixture'));
  });
});
