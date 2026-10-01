import { getFunnels } from '../funnels';
import { firstScreenFingerprint, normalizeMetadata, readMetadata } from '../lib/metadata';
import { funnelUrl } from '../lib/url';
import { expect, test } from './fixtures';

for (const funnel of getFunnels()) {
  test.describe(`${funnel.id}: ?metadata`, () => {
    test('эксперимент, рукава, проценты и продукты совпадают с конфигом', async ({ page, health }, testInfo) => {
      const meta = await readMetadata(page, funnel);
      await testInfo.attach('metadata.json', { body: JSON.stringify(meta, null, 2), contentType: 'application/json' });
      await testInfo.attach('metadata.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

      if (funnel.experiment) {
        expect(meta.experiments, 'Эксперимент из конфига есть в метадате').toContain(funnel.experiment.name);
        expect(meta.variants.map((v) => v.name).sort(), 'Рукава в метадате = рукава в конфиге').toEqual(
          [...funnel.experiment.variants].sort(),
        );
        const missing = meta.variants.filter((v) => v.percent === null).map((v) => v.name);
        expect.soft(missing, 'У каждого рукава указан процент трафика').toEqual([]);
        const total = meta.variants.reduce((sum, v) => sum + (v.percent ?? 0), 0);
        expect.soft(total, 'Сумма процентов по рукавам').toBeCloseTo(100, 0);
      } else {
        expect.soft(meta.variants, 'В конфиге нет A/B, а в метадате есть рукава').toEqual([]);
      }

      for (const product of funnel.products ?? []) {
        expect.soft(meta.rawText, `Продукт «${product}» есть в метадате`).toContain(product);
      }
      health.verify(funnel.ignoreErrors);
    });

    test('метадата не изменилась с последнего утверждённого снапшота', async ({ page }) => {
      // Ловит незаметные правки: сменили продукт, проценты, добавили рукав. Обновить эталон: npm run baseline
      const meta = await readMetadata(page, funnel);
      expect(normalizeMetadata(meta.rawText)).toMatchSnapshot(`${funnel.id}-metadata.txt`);
    });

    if (!funnel.experiment) return;
    const experiment = funnel.experiment;

    test('ссылки на рукава открываются, и рукава реально разные', async ({ page, health }, testInfo) => {
      const meta = await readMetadata(page, funnel);
      const prints: Record<string, string> = {};
      for (const v of meta.variants) {
        await page.goto(v.href);
        prints[v.name] = await firstScreenFingerprint(page);
        expect.soft(prints[v.name], `Рукав ${v.name} открылся пустым`).not.toBe('');
        await testInfo.attach(`variant-${v.name}.png`, { body: await page.screenshot(), contentType: 'image/png' });
      }
      await testInfo.attach('fingerprints.json', { body: JSON.stringify(prints, null, 2), contentType: 'application/json' });
      if (experiment.variantsDiffer !== false) {
        expect
          .soft(new Set(Object.values(prints)).size, 'Разные рукава показывают одинаковый первый экран — рукав не применяется?')
          .toBe(meta.variants.length);
      }
      health.verify(funnel.ignoreErrors);
    });

    test('реальное распределение трафика соответствует процентам', async ({ browser, page }, testInfo) => {
      const samples = Number(process.env.DIST_SAMPLES ?? 0);
      test.skip(!samples, 'Включается так: DIST_SAMPLES=60 npm test');
      test.setTimeout(30_000 + samples * 5_000);
      const tolerance = Number(process.env.DIST_TOLERANCE ?? 20);

      const meta = await readMetadata(page, funnel);
      const prints = new Map<string, string>();
      for (const v of meta.variants) {
        await page.goto(v.href);
        prints.set(await firstScreenFingerprint(page), v.name);
      }

      // Каждый заход — новый «пользователь» без cookies, как реальный трафик.
      const counts: Record<string, number> = { unknown: 0 };
      const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = testInfo.project.use;
      for (let i = 0; i < samples; i++) {
        const ctx = await browser.newContext({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor });
        const p = await ctx.newPage();
        await p.goto(funnelUrl(funnel));
        const name = prints.get(await firstScreenFingerprint(p)) ?? 'unknown';
        counts[name] = (counts[name] ?? 0) + 1;
        await ctx.close();
      }
      await testInfo.attach('distribution.json', { body: JSON.stringify(counts, null, 2), contentType: 'application/json' });

      expect.soft(counts.unknown, 'Заходы, которые не удалось отнести ни к одному рукаву').toBe(0);
      for (const v of meta.variants) {
        const actual = ((counts[v.name] ?? 0) / samples) * 100;
        expect
          .soft(Math.abs(actual - (v.percent ?? 0)), `${v.name}: ожидалось ${v.percent}%, получилось ${actual.toFixed(0)}%`)
          .toBeLessThanOrEqual(tolerance);
      }
    });
  });
}
