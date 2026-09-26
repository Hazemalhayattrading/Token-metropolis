import type { Anchor, GrowthParams } from '../growth';
import { growthParams } from '../estimate';
import type { Range, Tier } from '../types';

export const DAY0 = Date.UTC(2023, 0, 1) / 86_400_000;

export function anchor(t: number, rate: Range, tier: Tier = 'reported'): Anchor {
  return { t, rate, tier, label: 'test', formula: 'test', refs: ['test'] };
}

export const PARAMS: GrowthParams = growthParams();

/** Composite Simpson integration with n (even) intervals. */
export function simpson(f: (x: number) => number, a: number, b: number, n = 2000): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}
