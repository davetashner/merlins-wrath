import { afterEach, describe, expect, it, vi } from 'vitest';

describe('navmesh bake CLI entry point', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  // Starts Vite to load the CLI: a few seconds, more under a loaded coverage run.
  it(
    'loads the navmesh tools through Vite and sets the exit code from main',
    { timeout: 30_000 },
    async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      process.argv = ['node', 'nav-bake-cli.ts', '--help'];
      await import('./nav-bake-cli.ts');
      expect(process.exitCode).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('pnpm nav:bake'));
    },
  );
});
