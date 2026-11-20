import { defineConfig, devices } from '@playwright/test';
// Expects the API (pnpm dev:api), solvers (pnpm solvers) and web (pnpm --filter @fuse/web start) running.
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: process.env.FUSE_WEB ?? 'http://127.0.0.1:3000', channel: 'chrome', screenshot: 'only-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 960 } } }, { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' } }],
});
