import { getFunnels } from '../funnels';
import { funnelUrl, variantParams } from '../lib/url';
import { runSteps } from '../lib/walker';
import { test } from './fixtures';

// Путь до оплаты проходится кликами, как у реального пользователя, — в каждом рукаве A/B.
for (const funnel of getFunnels()) {
  const variants: (string | null)[] = funnel.experiment?.variants ?? [null];
  for (const variant of variants) {
    test.describe(`${funnel.id} [${variant ?? 'без A/B'}]`, () => {
      for (const [name, steps] of Object.entries(funnel.paths)) {
        test(name, async ({ page, analytics, health }, testInfo) => {
          await page.goto(funnelUrl(funnel, variantParams(funnel, variant)));
          await runSteps(page, steps, testInfo, (step) => analytics.stepFinished(step));
          await page.waitForTimeout(1500); // даём аналитике дослать события
          analytics.verify(funnel, variant);
          health.verify(funnel.ignoreErrors);
        });
      }
    });
  }
}
