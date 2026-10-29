import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: [['list']],
  use: { locale: 'uz-UZ', baseURL: 'http://127.0.0.1:8799', channel: 'chrome', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  webServer: { command: 'node e2e/serve.ts', url: 'http://127.0.0.1:8799/?token=e2e-token', reuseExistingServer: false, timeout: 60_000, stdout: 'pipe' },
});
