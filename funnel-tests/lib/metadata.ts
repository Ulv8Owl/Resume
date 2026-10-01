import type { Page } from '@playwright/test';
import type { FunnelConfig } from '../funnels/types';
import { funnelUrl } from './url';

export interface VariantInfo {
  name: string;
  experiment: string;
  percent: number | null;
  href: string;
}

export interface Metadata {
  rawText: string;
  experiments: string[];
  variants: VariantInfo[];
}

/** Процент ближе всего к названию рукава: сначала после названия, потом до него. */
function percentNear(ctx: string, name: string): number | null {
  const at = ctx.indexOf(name);
  const after = (at >= 0 ? ctx.slice(at + name.length, at + name.length + 80) : ctx).match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (after) return parseFloat(after[1].replace(',', '.'));
  const before = at > 0 ? [...ctx.slice(Math.max(0, at - 80), at).matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].pop() : null;
  return before ? parseFloat(before[1].replace(',', '.')) : null;
}

export async function readMetadata(page: Page, funnel: FunnelConfig): Promise<Metadata> {
  await page.goto(funnelUrl(funnel, { metadata: null }));
  await page.waitForLoadState('load');
  await page.waitForTimeout(1000);
  const rawText = await page.locator('body').innerText();

  // Рукава берём из ссылок вида ?experiment=...&variant=..., процент — из ближайшего контейнера.
  const links = await page.$$eval('a[href*="variant="]', (els) =>
    els.map((a) => {
      let el: HTMLElement = a as HTMLElement;
      let ctx = a.textContent ?? '';
      for (let i = 0; i < 5 && el.parentElement; i++) {
        el = el.parentElement;
        const t = el.innerText ?? '';
        if (/\d\s*%/.test(t)) {
          ctx = t;
          break;
        }
        if (t.length > 500) break;
      }
      return { href: (a as HTMLAnchorElement).href, ctx };
    }),
  );

  const variants: VariantInfo[] = [];
  for (const { href, ctx } of links) {
    const u = new URL(href);
    const name = u.searchParams.get('variant');
    const experiment = u.searchParams.get('experiment') ?? '';
    if (!name || variants.some((v) => v.name === name && v.experiment === experiment)) continue;
    variants.push({ name, experiment, percent: percentNear(ctx, name), href });
  }
  return { rawText, experiments: [...new Set(variants.map((v) => v.experiment))], variants };
}

/** Текст метадаты без времени и дат — для снапшота «ничего не поменялось». */
export function normalizeMetadata(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim().replace(/\d{4}-\d{2}-\d{2}[T ]?[\d:.Z]*/g, '<date>').replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '<time>'))
    .filter(Boolean)
    .join('\n');
}

/** Отпечаток первого экрана: по нему отличаем рукава друг от друга. */
export async function firstScreenFingerprint(page: Page): Promise<string> {
  await page.waitForLoadState('load');
  await page.waitForTimeout(800);
  const text = await page.locator('body').innerText();
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}
