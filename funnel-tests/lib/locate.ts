import type { Locator, Page } from '@playwright/test';

export type Matcher = string | RegExp;
export type Target = Matcher | { selector: string };

/** Цена как отдельное значение: price('$1') не совпадёт с "$19.99". */
export function price(p: string): RegExp {
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}(?![\\d]|[.,]\\d)`);
}

export function describe(t: Target): string {
  return typeof t === 'object' && !(t instanceof RegExp) ? t.selector : String(t);
}

function candidates(page: Page, m: Matcher): Locator[] {
  return [
    page.getByRole('button', { name: m }),
    page.getByRole('link', { name: m }),
    page.locator('[role="button"], [onclick], label').filter({ hasText: m }),
    page.getByText(m),
  ];
}

/** Первый видимый элемент: сначала кнопки и ссылки, потом любой текст. */
export async function findVisible(page: Page, t: Target): Promise<Locator | null> {
  const list = typeof t === 'object' && !(t instanceof RegExp) ? [page.locator(t.selector)] : candidates(page, t);
  for (const c of list) {
    const l = c.filter({ visible: true }).first();
    if (await l.count()) return l;
  }
  return null;
}

/** Ждёт, пока появится любой из targets; возвращает индекс и элемент. */
export async function waitAny(page: Page, targets: Target[], timeout = 10_000): Promise<[number, Locator]> {
  const deadline = Date.now() + timeout;
  while (true) {
    for (const [i, t] of targets.entries()) {
      const l = await findVisible(page, t);
      if (l) return [i, l];
    }
    if (Date.now() > deadline) {
      throw new Error(`За ${timeout} мс на экране не появилось: ${targets.map(describe).join(' | ')}\nURL: ${page.url()}`);
    }
    await page.waitForTimeout(250);
  }
}

export async function waitVisible(page: Page, t: Target, timeout = 10_000): Promise<Locator> {
  return (await waitAny(page, [t], timeout))[1];
}
