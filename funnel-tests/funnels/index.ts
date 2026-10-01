import { claudeTour } from './claude-tour';
import type { FunnelConfig } from './types';

const all: FunnelConfig[] = [claudeTour];

/** FUNNEL=claude-tour — прогнать одну воронку; без переменной — все. */
export function getFunnels(): FunnelConfig[] {
  const only = process.env.FUNNEL;
  if (!only) return all;
  const found = all.filter((f) => f.id === only);
  if (!found.length) throw new Error(`Нет воронки ${only}. Есть: ${all.map((f) => f.id).join(', ')}`);
  return found;
}
