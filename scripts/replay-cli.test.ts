import { afterEach, describe, expect, it, vi } from 'vitest';

describe('replay CLI entry point', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('loads the replay tools through Vite and sets the exit code from main', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.argv = ['node', 'replay-cli.ts', '--help'];
    await import('./replay-cli.ts');
    expect(process.exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pnpm replay:record'));
  });
});
