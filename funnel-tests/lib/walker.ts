import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { Action, Step } from '../funnels/types';
import { describe, findVisible, waitAny, waitVisible } from './locate';

async function runAction(page: Page, a: Action): Promise<void> {
  if ('click' in a) {
    await (await waitVisible(page, a.click, a.timeout)).click();
  } else if ('clickUntil' in a) {
    // Жмём «Продолжить», пока не появится целевой экран: число вводных экранов может отличаться между рукавами.
    const max = a.max ?? 10;
    for (let i = 0; i <= max; i++) {
      const [hit, el] = await waitAny(page, [a.until, a.clickUntil], a.timeout);
      if (hit === 0) return;
      if (i === max) break;
      await el.click();
    }
    throw new Error(`После ${max} нажатий «${describe(a.clickUntil)}» не появилось «${describe(a.until)}»`);
  } else if ('fill' in a) {
    await (await waitVisible(page, { selector: a.fill }, a.timeout)).fill(a.value);
  } else if ('waitFor' in a) {
    await waitVisible(page, a.waitFor, a.timeout ?? 20_000);
  } else if ('expectText' in a) {
    for (const m of a.expectText) await waitVisible(page, m, a.timeout);
  } else if ('expectNoText' in a) {
    for (const m of a.expectNoText) {
      expect.soft(await findVisible(page, m), `На экране не должно быть «${describe(m)}»`).toBeNull();
    }
  }
}

export async function runSteps(page: Page, steps: Step[], testInfo: TestInfo, onStepEnd?: (name: string) => void) {
  for (const [i, step] of steps.entries()) {
    await test.step(step.name, async () => {
      for (const a of step.actions) await runAction(page, a);
      await testInfo.attach(`${String(i + 1).padStart(2, '0')}-${step.name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    });
    onStepEnd?.(step.name);
  }
}

export { runAction };
