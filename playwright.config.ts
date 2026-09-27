import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// Smoke tests run against the production build served by `vite preview`.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Call vite directly (not via `pnpm preview`): pnpm's wrapper doesn't forward SIGTERM,
    // so Playwright would hang waiting for the preview server to exit.
    command: `vite build && exec vite preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
    url: `http://127.0.0.1:${String(PORT)}`,
    reuseExistingServer: !process.env['CI'],
  },
});
