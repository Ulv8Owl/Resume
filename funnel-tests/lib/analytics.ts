import zlib from 'node:zlib';
import { expect, type Page, type Request } from '@playwright/test';
import type { FunnelConfig } from '../funnels/types';

export interface CapturedEvent {
  event: string;
  distinctId?: string;
  properties: Record<string, unknown>;
  step: string;
  ts: number;
}

// Эндпоинты приёма событий PostHog (облако и self-hosted/прокси). /decide и /flags — это не события.
const DEFAULT_PATTERN = /posthog|\/i\/v0\/e\/?|\/e\/?(\?|$)|\/batch\/?|\/capture\/?|\/ingest\//;

function decodeBody(req: Request): unknown {
  const buf = req.postDataBuffer();
  if (!buf?.length) return null;
  const compression = new URL(req.url()).searchParams.get('compression');
  let text: string;
  if (compression === 'gzip-js' || (buf[0] === 0x1f && buf[1] === 0x8b)) {
    text = zlib.gunzipSync(buf).toString('utf8');
  } else {
    text = buf.toString('utf8');
    if (compression === 'base64' || text.startsWith('data=')) {
      const data = new URLSearchParams(text).get('data') ?? text;
      text = Buffer.from(data, 'base64').toString('utf8');
    }
  }
  return JSON.parse(text);
}

export class AnalyticsRecorder {
  readonly events: CapturedEvent[] = [];
  readonly parseErrors: string[] = [];
  /** Сколько событий было отправлено к концу каждого шага. */
  readonly stepEnd: Record<string, number> = {};
  private step = 'open';

  constructor(private readonly pattern: RegExp = DEFAULT_PATTERN) {}

  async attach(page: Page) {
    // Playwright не видит тело запроса, если это Blob или keepalive/sendBeacon (так шлёт PostHog).
    // Перед отправкой превращаем тело в байты и шлём обычным запросом — для сервера ничего не меняется.
    await page.addInitScript(() => {
      const toBytes = async (body: unknown) => (body instanceof Blob ? await body.arrayBuffer() : body);
      const origFetch = window.fetch.bind(window);
      window.fetch = async (input, init) =>
        init?.body instanceof Blob || init?.keepalive
          ? origFetch(input, { ...init, keepalive: false, body: (await toBytes(init.body)) as BodyInit })
          : origFetch(input, init);
      navigator.sendBeacon = (url, data) => {
        void window.fetch(String(url), { method: 'POST', body: data ?? null });
        return true;
      };
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function (body) {
        if (body instanceof Blob) void body.arrayBuffer().then((buf) => origSend.call(this, buf));
        else origSend.call(this, body);
      };
    });
    page.on('request', (req) => {
      const url = req.url();
      if (req.method() !== 'POST' || !this.pattern.test(url) || /\/(decide|flags)\b/.test(url)) return;
      try {
        const json = decodeBody(req) as any;
        const list: any[] = Array.isArray(json) ? json : Array.isArray(json?.batch) ? json.batch : [json];
        for (const e of list) {
          if (!e || typeof e.event !== 'string') continue;
          this.events.push({
            event: e.event,
            distinctId: e.distinct_id ?? e.properties?.distinct_id,
            properties: e.properties ?? {},
            step: this.step,
            ts: Date.now(),
          });
        }
      } catch (err) {
        this.parseErrors.push(`${url}: ${err}`);
      }
    });
  }

  stepFinished(name: string) {
    this.stepEnd[name] = this.events.length;
    this.step = `after:${name}`;
  }

  /** Одинаковые пользовательские события (без $-свойств) чаще, чем раз в windowMs. */
  duplicates(windowMs = 1000): string[] {
    const seen = new Map<string, number>();
    const dups: string[] = [];
    for (const e of this.events) {
      if (e.event.startsWith('$')) continue;
      const props = Object.fromEntries(Object.entries(e.properties).filter(([k]) => !k.startsWith('$')));
      const key = `${e.event} ${JSON.stringify(props)}`;
      const prev = seen.get(key);
      if (prev !== undefined && e.ts - prev < windowMs) dups.push(key);
      seen.set(key, e.ts);
    }
    return dups;
  }

  /** Проверки аналитики после прохождения воронки. */
  verify(funnel: FunnelConfig, variant: string | null) {
    const cfg = funnel.analytics ?? {};
    expect.soft(this.parseErrors, 'Не удалось разобрать запросы аналитики').toEqual([]);
    expect.soft(this.events.length, 'Аналитика не отправила ни одного события').toBeGreaterThan(0);

    const ids = [...new Set(this.events.map((e) => e.distinctId).filter(Boolean))];
    expect.soft(ids, 'distinct_id должен быть один на всю воронку').toHaveLength(Math.min(ids.length, 1));

    expect.soft(this.duplicates(), 'Дубли событий').toEqual([]);

    if (variant && cfg.variantInEvents !== false && this.events.length) {
      // URL страницы содержит ?variant=..., поэтому ссылки не считаем пометкой рукава.
      const tags = (e: CapturedEvent) =>
        JSON.stringify(Object.values(e.properties).filter((v) => !(typeof v === 'string' && /^https?:\/\/|[?&]variant=/.test(v))));
      const tagged = this.events.filter((e) => tags(e).includes(variant));
      expect.soft(tagged.length, `Ни одно событие не помечено рукавом ${variant}`).toBeGreaterThan(0);
      const otherVariants = (funnel.experiment?.variants ?? []).filter((v) => v !== variant);
      const leaked = this.events.filter((e) => otherVariants.some((v) => tags(e).includes(v)));
      expect.soft(leaked.map((e) => e.event), `События помечены чужим рукавом (ожидался ${variant})`).toEqual([]);
    }

    for (const [step, names] of Object.entries(cfg.requiredEvents ?? {})) {
      const end = this.stepEnd[step];
      if (end === undefined) continue; // шага нет в этом пути
      const sent = new Set(this.events.slice(0, end).map((e) => e.event));
      for (const name of names) {
        expect.soft(sent.has(name), `К концу шага «${step}» не отправлено событие ${name}`).toBe(true);
      }
    }
  }
}
