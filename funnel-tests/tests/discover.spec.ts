import { getFunnels } from '../funnels';
import { classify, saveStepMap, stepMapPath, type Screen } from '../lib/discovered';
import { BASE_URL, funnelUrl } from '../lib/url';
import { expect, test } from './fixtures';

// Проходит ?step=1..N, снимает каждый экран и находит номера пейвола, аппселлов и экрана доступа.
for (const funnel of getFunnels()) {
  test(`discover: ${funnel.id}`, async ({ page }, testInfo) => {
    const max = Number(process.env.MAX_STEPS ?? 40);
    test.setTimeout(30_000 + max * 6_000);
    const screens: Screen[] = [];
    let prev = '';
    let repeats = 0;

    for (let step = 1; step <= max; step++) {
      await page.goto(funnelUrl(funnel, { step: String(step) }));
      await page.waitForLoadState('load');
      await page.waitForTimeout(1200);
      const text = (await page.locator('body').innerText()).trim();
      const buttons = (await page.locator('button, a, [role="button"]').filter({ visible: true }).allInnerTexts())
        .map((b) => b.trim())
        .filter(Boolean);
      screens.push({
        step,
        title: text.split('\n')[0]?.slice(0, 80) ?? '',
        prices: [...new Set(text.match(/\$\d+(?:[.,]\d{1,2})?/g) ?? [])],
        buttons,
        text: text.slice(0, 2000),
      });
      await testInfo.attach(`step-${String(step).padStart(2, '0')}.png`, { body: await page.screenshot(), contentType: 'image/png' });

      // Номера за концом воронки обычно показывают один и тот же экран — останавливаемся.
      repeats = text === prev ? repeats + 1 : 0;
      prev = text;
      if (repeats >= 2) break;
    }

    const map = classify(funnel, screens, BASE_URL);
    saveStepMap(funnel, map, screens);
    await testInfo.attach('step-map.json', { body: JSON.stringify(map, null, 2), contentType: 'application/json' });
    console.log(`Карта шагов сохранена: ${stepMapPath(funnel)}\n${JSON.stringify(map, null, 2)}`);
    expect(map.upsells).toHaveLength(funnel.postPayment.upsells.length);
  });
}
