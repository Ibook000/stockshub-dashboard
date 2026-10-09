import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  retries: 0,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    channel: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python tests/ui_server.py',
    url: 'http://127.0.0.1:8767/health',
    reuseExistingServer: false,
    timeout: 20000,
  },
  projects: [
    { name: 'pages', use: { baseURL: 'http://127.0.0.1:8766/stockshub-dashboard/' } },
    { name: 'sqlite', use: { baseURL: 'http://127.0.0.1:8767/' } },
  ],
});
