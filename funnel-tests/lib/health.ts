import { expect, type Page } from '@playwright/test';

const DEFAULT_IGNORE = [
  /favicon/,
  /google-analytics|googletagmanager|doubleclick|facebook|fbcdn|tiktok|snapchat|hotjar|clarity\.ms|sentry/,
];

/** Собирает JS-ошибки, ошибки консоли и упавшие запросы. */
export class HealthRecorder {
  readonly pageErrors: string[] = [];
  readonly consoleErrors: string[] = [];
  readonly badResponses: string[] = [];

  private ignored(s: string) {
    return DEFAULT_IGNORE.some((re) => re.test(s));
  }

  attach(page: Page) {
    page.on('pageerror', (e) => this.pageErrors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !this.ignored(`${m.text()} ${m.location().url}`)) this.consoleErrors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && !this.ignored(r.url())) this.badResponses.push(`${r.status()} ${r.url()}`);
    });
    page.on('requestfailed', (r) => {
      const err = r.failure()?.errorText ?? '';
      if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(err) && !this.ignored(r.url())) {
        this.badResponses.push(`FAILED ${err} ${r.url()}`);
      }
    });
  }

  verify(extraIgnore: RegExp[] = []) {
    const keep = (list: string[]) => list.filter((s) => !extraIgnore.some((re) => re.test(s)));
    expect.soft(keep(this.pageErrors), 'JS-ошибки на странице').toEqual([]);
    expect.soft(keep(this.consoleErrors), 'Ошибки в консоли').toEqual([]);
    expect.soft(keep(this.badResponses), 'Запросы с ошибкой (4xx/5xx/сетевые)').toEqual([]);
  }
}
