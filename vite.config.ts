import { defineConfig } from 'vitest/config';

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
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Bootstrap is covered by the Playwright smoke test instead (contract §3).
      exclude: ['src/**/*.test.ts', 'src/main.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
