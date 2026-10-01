import { getFunnels } from '../funnels';
import { loadStepMap } from '../lib/discovered';
import { findVisible, price, waitVisible } from '../lib/locate';
import { BASE_URL, funnelUrl } from '../lib/url';
import { runAction } from '../lib/walker';
import { expect, test } from './fixtures';

// Экраны после оплаты открываются через ?step=n. Покупки не совершаются.
for (const funnel of getFunnels()) {
  const pp = funnel.postPayment;
  const map = loadStepMap(funnel);

  test.describe(`${funnel.id}: экраны после оплаты (?step=n)`, () => {
    test.skip(!map, `Нет карты шагов для ${BASE_URL}. Сначала: npm run discover`);
    const m = map!;
    const open = (page: import('@playwright/test').Page, step: number) => page.goto(funnelUrl(funnel, { step: String(step) }));

    test('пейвол: цены основного продукта и платёжная форма Solidgate', async ({ page, health }) => {
      const solidgate: string[] = [];
      page.on('request', (r) => /solidgate/i.test(r.url()) && solidgate.push(r.url()));
      await open(page, m.paywallStep);
      await runAction(page, { expectText: pp.paywallTexts });
      if (pp.expectPaymentForm) {
        await expect.poll(() => solidgate.length, { message: 'Платёжная форма Solidgate не загрузилась', timeout: 15_000 }).toBeGreaterThan(0);
      }
      health.verify(funnel.ignoreErrors);
    });

    for (const [i, up] of pp.upsells.entries()) {
      const info = () => m.upsells[i];
      const next = pp.upsells[i + 1];

      test(`${up.name}: вводные экраны ведут к предложению ${up.offerPrice}`, async ({ page, health }) => {
        await open(page, info().introSteps[0] ?? info().offerStep);
        await runAction(page, {
          clickUntil: funnel.buttons.continue,
          until: price(up.offerPrice),
          max: info().introSteps.length + 1,
        });
        await waitVisible(page, funnel.buttons.noThanks);
        health.verify(funnel.ignoreErrors);
      });

      test(`${up.name}: «Пропустить» на каждом вводном экране открывает предложение этого же продукта`, async ({ page }) => {
        test.skip(!info().introSteps.length, 'У аппсела нет вводных экранов');
        for (const step of info().introSteps) {
          await test.step(`step=${step}`, async () => {
            await open(page, step);
            await (await waitVisible(page, funnel.buttons.skip)).click();
            await waitVisible(page, price(up.offerPrice));
            if (next) expect.soft(await findVisible(page, price(next.offerPrice)), `step=${step}: «Пропустить» увёл на следующий аппсел`).toBeNull();
          });
        }
      });

      test(`${up.name}: «Нет, спасибо» ведёт ${next ? `к ${next.name}` : 'к выдаче доступа'}`, async ({ page, health }) => {
        await open(page, info().offerStep);
        await (await waitVisible(page, funnel.buttons.noThanks)).click();
        if (next) {
          await runAction(page, {
            clickUntil: funnel.buttons.continue,
            until: price(next.offerPrice),
            max: (m.upsells[i + 1]?.introSteps.length ?? 0) + 1,
          });
        } else {
          await waitVisible(page, pp.accessText);
        }
        health.verify(funnel.ignoreErrors);
      });
    }

    test('экран доступа: без повторных предложений купить', async ({ page, health }) => {
      await open(page, m.accessStep);
      await waitVisible(page, pp.accessText);
      // Основной продукт и аппселлы повторно не предлагаются.
      await runAction(page, { expectNoText: [price(pp.paywallPrice), ...pp.upsells.map((u) => price(u.offerPrice))] });
      health.verify(funnel.ignoreErrors);
    });
  });
}
