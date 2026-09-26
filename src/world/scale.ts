/**
 * How load becomes architecture. Heights use a log scale by default so small
 * platforms stay visible; "true scale" makes height proportional to tokens.
 */

export type ScaleMode = 'log' | 'true';

export const HEIGHT_MIN = 3;
export const HEIGHT_MAX = 44;
const LOG_FLOOR = 10; // 10 billion tokens/day
const LOG_CEIL = 15; // 1 quadrillion tokens/day

/** Normalized load in [0, 1] on the log scale. */
export function logLoad(tokensPerDay: number): number {
  if (tokensPerDay <= 0) return 0;
  const x = (Math.log10(tokensPerDay) - LOG_FLOOR) / (LOG_CEIL - LOG_FLOOR);
  return Math.min(1, Math.max(0, x));
}

/** Tokens/day at a given normalized load (inverse of `logLoad`). */
export function tokensAtLoad(load: number): number {
  return 10 ** (LOG_FLOOR + load * (LOG_CEIL - LOG_FLOOR));
}

/** Desk-hardware band thresholds on the log load (offices interior). */
export const DESK_BANDS = [0.45, 0.75] as const;

/** 0 = boxy monitors, 1 = flat screens, 2 = holographic panels. */
export function deskTier(load: number): 0 | 1 | 2 {
  return load < DESK_BANDS[0] ? 0 : load < DESK_BANDS[1] ? 1 : 2;
}

/** Tower height in world units. `maxTokens` is the largest platform's value (for true scale). */
export function towerHeight(tokensPerDay: number, mode: ScaleMode, maxTokens: number): number {
  if (tokensPerDay <= 0) return 0;
  if (mode === 'true') return Math.max(0.35, (HEIGHT_MAX * tokensPerDay) / Math.max(maxTokens, 1));
  return HEIGHT_MIN + (HEIGHT_MAX - HEIGHT_MIN) * logLoad(tokensPerDay);
}

/** Discrete facility counts that grow with load (server halls, cooling towers, trucks). */
export function facilityCounts(tokensPerDay: number): {
  halls: number;
  cooling: number;
  trucks: number;
} {
  const l = logLoad(tokensPerDay);
  if (tokensPerDay <= 0) return { halls: 0, cooling: 0, trucks: 0 };
  return {
    halls: 1 + Math.round(l * 5),
    cooling: 1 + Math.round(l * 3),
    trucks: Math.round(1 + l * 7),
  };
}
