import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  testIgnore: ['**/live/**', '**/desktop/**'],
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5197',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'pnpm dev', url: 'http://127.0.0.1:5197', reuseExistingServer: !process.env.CI },
    {
      command: 'pnpm exec tsx tests/fixture-companion.ts',
      url: 'http://127.0.0.1:43123',
      reuseExistingServer: !process.env.CI,
    },
  ],
})
