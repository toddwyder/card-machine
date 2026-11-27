import { defineConfig, devices } from '@playwright/test';

// The suite runs beside the deployed mission control rather than on top of it: the service that
// serves Todd holds 4314, so the browser tests take the next port.
const PORT = Number(process.env.PORT ?? 4315);

export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.mjs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['line']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/control/`,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `next start` serves the built app, so build first: a stale build once let a spec pass
    // against CSS that no longer existed.
    command: `npm run build && PORT=${PORT} node tests/start-server.mjs`,
    url: `http://127.0.0.1:${PORT}/control`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
