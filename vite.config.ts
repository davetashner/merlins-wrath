import { defineConfig } from 'vitest/config';
import { readLayers, vitestThresholds } from './scripts/coverage-layers.ts';

// One config for dev, build and tests: path aliases come from tsconfig.json `paths`,
// so @sim/*, @content/*, @game/* … resolve identically in Vite, Vitest and tsc.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    target: 'es2023',
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/**/*.ts'],
      // Bootstrap is covered by the Playwright smoke test instead (contract §3).
      exclude: ['**/*.test.ts', 'src/main.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      // Per-layer gates (contract §3) from coverage-layers.json; the ratchet reads the same file.
      thresholds: vitestThresholds(readLayers()),
    },
  },
});
