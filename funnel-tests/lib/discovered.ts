import fs from 'node:fs';
import path from 'node:path';
import type { FunnelConfig } from '../funnels/types';
import { HOST_KEY } from './url';

export interface Screen {
  step: number;
  title: string;
  prices: string[];
  buttons: string[];
  text: string;
}

export interface StepMap {
  baseUrl: string;
  generatedAt: string;
  paywallStep: number;
  upsells: { name: string; introSteps: number[]; offerStep: number }[];
  accessStep: number;
}

const dir = () => path.join(__dirname, '..', '.discovered', HOST_KEY);

export function stepMapPath(funnel: FunnelConfig) {
  return path.join(dir(), `${funnel.id}.json`);
}

export function loadStepMap(funnel: FunnelConfig): StepMap | null {
  const p = stepMapPath(funnel);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

export function saveStepMap(funnel: FunnelConfig, map: StepMap, screens: Screen[]) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(stepMapPath(funnel), JSON.stringify(map, null, 2) + '\n');
  const rows = screens.map((s) => `| ${s.step} | ${s.title.replace(/\|/g, '/')} | ${s.prices.join(', ')} | ${s.buttons.join(' · ').replace(/\|/g, '/')} |`);
  const md = [`# ${funnel.id}: карта шагов (${map.baseUrl})`, '', '| step | Заголовок | Цены | Кнопки |', '|---|---|---|---|', ...rows, ''].join('\n');
  fs.writeFileSync(path.join(dir(), `${funnel.id}.md`), md);
}

/** Находит пейвол, аппселлы и экран доступа по ценам и кнопкам из конфига. */
export function classify(funnel: FunnelConfig, screens: Screen[], baseUrl: string): StepMap {
  const pp = funnel.postPayment;
  const paywall = screens.find((s) => s.prices.includes(pp.paywallPrice));
  if (!paywall) throw new Error(`Не найден пейвол с ценой ${pp.paywallPrice}`);
  const hasButton = (s: Screen, re: RegExp) => s.buttons.some((b) => re.test(b));

  let cursor = paywall.step;
  const upsells: StepMap['upsells'] = [];
  for (const up of pp.upsells) {
    const offer = screens.find((s) => s.step > cursor && s.prices.includes(up.offerPrice) && hasButton(s, funnel.buttons.noThanks));
    if (!offer) throw new Error(`Не найден экран аппсела «${up.name}» с ценой ${up.offerPrice} и кнопкой отказа`);
    // Вводные экраны — непрерывная серия экранов без цен прямо перед предложением.
    const introSteps: number[] = [];
    for (let n = offer.step - 1; n > cursor; n--) {
      const s = screens.find((x) => x.step === n);
      if (!s || s.prices.length) break;
      introSteps.unshift(n);
    }
    upsells.push({ name: up.name, introSteps, offerStep: offer.step });
    cursor = offer.step;
  }
  const access =
    screens.find((s) => s.step > cursor && pp.accessText.test(s.text)) ?? screens.find((s) => s.step === cursor + 1);
  if (!access) throw new Error('Не найден экран выдачи доступа');
  return { baseUrl, generatedAt: new Date().toISOString(), paywallStep: paywall.step, upsells, accessStep: access.step };
}
