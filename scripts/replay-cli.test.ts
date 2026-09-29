import { afterEach, describe, expect, it, vi } from 'vitest';

describe('replay CLI entry point', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  // Starts Vite to load the CLI: ~2.5 s alone, more under a loaded coverage run.
  it(
    'loads the replay tools through Vite and sets the exit code from main',
    { timeout: 30_000 },
    async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      process.argv = ['node', 'replay-cli.ts', '--help'];
      await import('./replay-cli.ts');
      expect(process.exitCode).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('pnpm replay:record'));
    },
  );
});
