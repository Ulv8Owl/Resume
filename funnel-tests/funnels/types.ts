import type { Matcher, Target } from '../lib/locate';

export type Action =
  | { click: Target; timeout?: number }
  | { clickUntil: Target; until: Target; max?: number; timeout?: number }
  | { fill: string; value: string; timeout?: number }
  | { waitFor: Target; timeout?: number }
  | { expectText: Target[]; timeout?: number }
  | { expectNoText: Target[] };

export interface Step {
  name: string;
  actions: Action[];
}

export interface FunnelConfig {
  id: string;
  /** Путь воронки на домене, например /claude-tour */
  path: string;
  /** Нет A/B — не указываем. */
  experiment?: {
    name: string;
    variants: string[];
    /** Рукава должны показывать разный первый экран (по умолчанию true). */
    variantsDiffer?: boolean;
  };
  /** Названия продуктов Solidgate, которые должны быть в ?metadata. */
  products?: string[];
  buttons: { continue: RegExp; skip: RegExp; noThanks: RegExp };
  /** Сценарии до оплаты: проходятся кликами, без ?step. */
  paths: Record<string, Step[]>;
  /** Экраны после оплаты: открываются через ?step=n, номера находит `npm run discover`. */
  postPayment: {
    paywallPrice: string;
    paywallTexts: Matcher[];
    /** Ждать загрузку платёжной формы Solidgate на пейволе. */
    expectPaymentForm?: boolean;
    upsells: { name: string; offerPrice: string }[];
    accessText: RegExp;
  };
  analytics?: {
    /** Свойства событий должны содержать название рукава (по умолчанию true). */
    variantInEvents?: boolean;
    /** Какие события должны уйти к концу шага: { paywall: ['paywall_viewed'] } */
    requiredEvents?: Record<string, string[]>;
  };
  /** Доп. URL, ошибки которых не считаем багом. */
  ignoreErrors?: RegExp[];
}
