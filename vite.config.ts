import { execFileSync } from 'node:child_process';
import wasm from 'vite-plugin-wasm';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { DEFAULT_EXCLUDES, readExclusionGlobs } from './scripts/check-coverage-exclusions.ts';
import { ContentCoverageReporter } from './scripts/content-coverage-reporter.ts';
import { readLayers, vitestThresholds } from './scripts/coverage-layers.ts';

/**
 * Short commit SHA shown on screen with the scene name (mw-e00.21): CI's GITHUB_SHA, else the local
 * checkout's HEAD, else "unknown" (e.g. a source tarball without git).
 */
function buildSha(): string {
  const ci = process.env['GITHUB_SHA'];
  if (ci !== undefined && ci !== '') return ci.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// One config for dev, build and tests: path aliases come from tsconfig.json `paths`,
// so @sim/*, @content/*, @game/* … resolve identically in Vite, Vitest and tsc.
export default defineConfig({
  // Rapier's deterministic build (ADR-0001) imports its .wasm as an ES module; the plugin emits it
  // as a separate asset fetched by the lazily imported physics chunk (mw-e00.19).
  // Its typings declare `any`, hence the cast.
  plugins: [wasm() as Plugin],
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
  },
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    target: 'es2023',
    // three.js alone is ~530 kB minified (~130 kB gz) in one chunk; warn only above that (mw-e00.19).
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      // The game, plus dev testbed pages (mw-e28.1 audio, mw-e00.19 render) that e2e drives against
      // the real build.
      input: {
        main: 'index.html',
        'testbed-audio': 'testbed/audio.html',
        'testbed-render': 'testbed/render.html',
      },
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
