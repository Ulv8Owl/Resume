import { defineConfig, devices } from '@playwright/test';
import { HOST_KEY } from './lib/url';

const mobileChromium = (name: keyof typeof devices) => ({ ...devices[name], browserName: 'chromium' as const });

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  // Эталон метадаты свой для каждого окружения (прод / мок).
  snapshotPathTemplate: `{testDir}/__snapshots__/${HOST_KEY}/{arg}{ext}`,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'en-US',
  },
  projects: [
    { name: 'discover', testMatch: /discover\.spec/, use: mobileChromium('Pixel 7') },
    { name: 'metadata', testMatch: /metadata\.spec/, use: mobileChromium('Pixel 7') },
    { name: 'iphone', testMatch: /(flow|steps)\.spec/, use: mobileChromium('iPhone 13') },
    { name: 'android', testMatch: /(flow|steps)\.spec/, use: mobileChromium('Pixel 7') },
  ],
  webServer: process.env.MOCK
    ? {
        command: 'node mock/server.mjs',
        url: 'http://localhost:4173/claude-tour',
        reuseExistingServer: false,
        env: { MOCK_BUG: process.env.MOCK_BUG ?? '' },
      }
    : undefined,
});
