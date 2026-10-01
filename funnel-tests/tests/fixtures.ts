import { test as base } from '@playwright/test';
import { AnalyticsRecorder } from '../lib/analytics';
import { HealthRecorder } from '../lib/health';

export const test = base.extend<{ analytics: AnalyticsRecorder; health: HealthRecorder }>({
  analytics: async ({ page }, use, testInfo) => {
    const recorder = new AnalyticsRecorder();
    await recorder.attach(page);
    await use(recorder);
    await testInfo.attach('analytics-events.json', {
      body: JSON.stringify(recorder.events, null, 2),
      contentType: 'application/json',
    });
  },
  health: async ({ page }, use) => {
    const recorder = new HealthRecorder();
    recorder.attach(page);
    await use(recorder);
  },
});

export { expect } from '@playwright/test';
