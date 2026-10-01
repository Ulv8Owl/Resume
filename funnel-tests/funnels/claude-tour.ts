import { price } from '../lib/locate';
import type { FunnelConfig } from './types';

const buttons = {
  continue: /continue|продолжить|далее|next/i,
  skip: /skip|пропустить/i,
  noThanks: /no,?\s*thanks|нет,?\s*спасибо/i,
};

const usernameInput = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio])';

const intro = {
  name: 'intro',
  actions: [{ clickUntil: buttons.continue, until: { selector: usernameInput }, max: 8 }],
};

const paywall = {
  name: 'paywall',
  actions: [{ expectText: [/socialsensor/i, price('$1'), price('$49.99')] }],
};

export const claudeTour: FunnelConfig = {
  id: 'claude-tour',
  path: '/claude-tour',
  experiment: {
    name: 'EXP-106:tour_vs_classic',
    variants: ['01_default', '02_tour'],
  },
  // TODO: вписать названия продуктов из https://lp.sunly.ai/claude-tour?metadata
  products: [],
  buttons,
  paths: {
    'полный путь через анализ': [
      intro,
      {
        name: 'username',
        actions: [
          { fill: usernameInput, value: 'qa_autotest' },
          { click: /start analysis|analy[sz]e|начать анализ|анализ/i },
        ],
      },
      {
        name: 'analysis',
        // Демо-анимация ~8 секунд, затем предварительные результаты.
        actions: [{ waitFor: /full analysis|полный анализ/i, timeout: 20_000 }, { click: /full analysis|полный анализ/i }],
      },
      paywall,
    ],
    '«Пропустить» на имени профиля ведёт на оплату': [
      intro,
      { name: 'skip-username', actions: [{ click: buttons.skip }] },
      paywall,
    ],
  },
  postPayment: {
    paywallPrice: '$49.99',
    paywallTexts: [/socialsensor/i, price('$1'), price('$49.99')],
    expectPaymentForm: true,
    upsells: [
      { name: 'Virality Predictor', offerPrice: '$24.99' },
      { name: 'Fake Followers Checker', offerPrice: '$19.99' },
    ],
    accessText: /access|доступ/i,
  },
  analytics: {
    variantInEvents: true,
  },
};
