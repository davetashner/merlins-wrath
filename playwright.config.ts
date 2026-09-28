import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// Smoke tests run against the production build served by `vite preview`.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    // Kept only for failures; CI uploads them as artifacts.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Web Audio differs per engine (autoplay policy, AudioListener params, codecs), so the audio
    // testbed also runs in Firefox and WebKit (mw-e28.1 AC-6).
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: 'audio.spec.ts' },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: 'audio.spec.ts' },
  ],
  webServer: {
    // Call vite directly (not via `pnpm preview`): pnpm's wrapper doesn't forward SIGTERM,
    // so Playwright would hang waiting for the preview server to exit.
    command: `vite build && exec vite preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
    url: `http://127.0.0.1:${String(PORT)}`,
    reuseExistingServer: !process.env['CI'],
  },
});
