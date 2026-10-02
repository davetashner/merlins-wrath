// Runs this spike's tests (and, with AI_SPIKE_BENCH=1, its benchmark) outside the game's suites:
//   pnpm exec vitest run --config spikes/ai-architecture/vitest.config.ts
// The root vitest config only includes src/, tests/ and scripts/, so the 100% sim coverage gate and
// the ratchet never see spike code (see README.md).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: { tsconfigPaths: true },
  test: {
    include: [
      process.env['AI_SPIKE_BENCH'] === '1'
        ? 'spikes/ai-architecture/**/*.bench-run.ts'
        : 'spikes/ai-architecture/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 600_000,
  },
});
