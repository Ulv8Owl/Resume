import type { FunnelConfig } from '../funnels/types';

export const BASE_URL = (process.env.BASE_URL ?? 'https://lp.sunly.ai').replace(/\/$/, '');

// Ключ окружения: снапшоты и карты шагов хранятся отдельно для прода и мока.
export const HOST_KEY = new URL(BASE_URL).host.replace(/:/g, '_');

/** null — флаг без значения: { metadata: null } → `?metadata` */
export function funnelUrl(funnel: FunnelConfig, params: Record<string, string | null> = {}): string {
  const qs = Object.entries(params)
    .map(([k, v]) => (v === null ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`))
    .join('&');
  return `${BASE_URL}${funnel.path}${qs ? `?${qs}` : ''}`;
}

export function variantParams(funnel: FunnelConfig, variant: string | null): Record<string, string> {
  return variant && funnel.experiment ? { experiment: funnel.experiment.name, variant } : {};
}
