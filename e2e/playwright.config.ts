import { defineConfig } from '@playwright/test';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const BACKEND_PORT = 4100;
const FRONTEND_PORT = 4173; // `vite preview` of the PRODUCTION build, so the service worker is real

export default defineConfig({
  testDir: './tests',
  // Each test creates its own users and documents, but one worker keeps the run deterministic.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  outputDir: '../test-results',
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    // Drives the Google Chrome already installed on this machine: no browser download needed.
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      // A throwaway PostgreSQL + the real backend (see backend/scripts/e2e-server.ts).
      command: 'npm run e2e:server -w backend',
      cwd: root,
      url: `http://127.0.0.1:${BACKEND_PORT}/api/health`,
      env: { E2E_BACKEND_PORT: String(BACKEND_PORT), E2E_ORIGIN: `http://localhost:${FRONTEND_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run build -w frontend && npm run preview -w frontend',
      cwd: root,
      url: `http://localhost:${FRONTEND_PORT}`,
      env: { BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}` },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
