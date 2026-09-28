import { defineConfig } from 'vitest/config';
import { DEFAULT_EXCLUDES, readExclusionGlobs } from './scripts/check-coverage-exclusions.ts';
import { ContentCoverageReporter } from './scripts/content-coverage-reporter.ts';
import { readLayers, vitestThresholds } from './scripts/coverage-layers.ts';

// One config for dev, build and tests: path aliases come from tsconfig.json `paths`,
// so @sim/*, @content/*, @game/* … resolve identically in Vite, Vitest and tsc.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    target: 'es2023',
    rolldownOptions: {
      // The game, plus dev testbed pages (mw-e28.1 audio) that e2e drives against the real build.
      input: { main: 'index.html', 'testbed-audio': 'testbed/audio.html' },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // The content reporter records which content entries passing tests exercised (mw-e00.18).
    reporters: ['default', new ContentCoverageReporter()],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/**/*.ts'],
      // Only what coverage-exclusions.md lists (checked by pnpm coverage:exclusions).
      exclude: [...DEFAULT_EXCLUDES, ...readExclusionGlobs()],
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      // Per-layer gates (contract §3) from coverage-layers.json; the ratchet reads the same file.
      thresholds: vitestThresholds(readLayers()),
    },
  },
});
