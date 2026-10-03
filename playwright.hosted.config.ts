import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/live',
  testMatch: 'hosted.spec.ts',
  timeout: 180_000,
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL: 'https://foolscap-web-poc.vercel.app',
    viewport: { width: 1440, height: 1100 },
    screenshot: 'only-on-failure',
    trace: 'off',
  },
})
