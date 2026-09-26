/**
 * The 24-hour (and 7-day) traffic curve.
 *
 * Each region follows the same local-time usage shape for a platform's usage
 * profile; a platform's global curve is the user-weighted sum over regions.
 * That is how you can watch Asia wake up: an HQ whose users are mostly in
 * UTC+8 peaks while North America sleeps.
 *
 * The shape is a short Fourier series with zero-mean terms, so it averages
 * exactly to 1 over a week (daily totals are preserved), and the product of
 * the shape with an exponential growth curve has a closed-form integral
 * (see integrate.ts) — the live counter is exact, not approximated.
 */
import { cosTurns } from './detmath';

export const REGION_IDS = [
  'northAmerica',
  'latinAmerica',
  'europeAfrica',
  'southAsiaMiddleEast',
  'eastAsiaPacific',
] as const;
export type RegionId = (typeof REGION_IDS)[number];

/** Representative fixed UTC offsets (hours). Daylight saving is ignored — a documented simplification. */
export const REGION_UTC_OFFSET: Record<RegionId, number> = {
  northAmerica: -6,
  latinAmerica: -4,
  europeAfrica: 1,
  southAsiaMiddleEast: 5,
  eastAsiaPacific: 8,
};

export const REGION_LABEL: Record<RegionId, string> = {
  northAmerica: 'North America',
  latinAmerica: 'Latin America',
  europeAfrica: 'Europe & Africa',
  southAsiaMiddleEast: 'South Asia & Middle East',
  eastAsiaPacific: 'East Asia & Pacific',
};

/** Share of a platform's usage per region; values sum to 1. */
export type RegionMix = Readonly<Record<RegionId, number>>;

/**
 * Local-time usage shape: 1 + a1·cos(daily) + a2·cos(half-daily) + w·cos(weekly).
 * Peaks are in local hours (p1, p2) and in days since Monday 00:00 (pw).
 */
export interface TrafficShape {
  readonly a1: number;
  readonly p1: number;
  readonly a2: number;
  readonly p2: number;
  readonly w: number;
  readonly pw: number;
}

/** One cosine term: amp · cos(2π(f·t + phi)), t in days since epoch (UTC). */
export interface ShapeTerm {
  readonly amp: number;
  /** Cycles per day. */
  readonly f: number;
  /** Phase in turns. */
  readonly phi: number;
}

/** 1970-01-01 was a Thursday; with Monday = 0, epoch day 0 is weekday 3. */
const EPOCH_WEEKDAY = 3;

/** Expand a regional mix and a local-time shape into global cosine terms. */
export function shapeTerms(mix: RegionMix, s: TrafficShape): ShapeTerm[] {
  const terms: ShapeTerm[] = [];
  for (const r of REGION_IDS) {
    const m = mix[r];
    if (m === 0) continue;
    const off = REGION_UTC_OFFSET[r] / 24; // days
    // daily: cos(2π(local − p1/24)), local = t + off
    if (s.a1 !== 0) terms.push({ amp: m * s.a1, f: 1, phi: off - s.p1 / 24 });
    // half-daily: cos(2π(2·local − p2/12))
    if (s.a2 !== 0) terms.push({ amp: m * s.a2, f: 2, phi: 2 * off - s.p2 / 12 });
    // weekly: cos(2π(local + 3 − pw)/7)
    if (s.w !== 0) terms.push({ amp: m * s.w, f: 1 / 7, phi: (off + EPOCH_WEEKDAY - s.pw) / 7 });
  }
  return terms;
}

/** Traffic multiplier at time t from precomputed terms. Mean over a week = 1. */
export function evalShape(terms: readonly ShapeTerm[], t: number): number {
  let v = 1;
  for (const term of terms) v += term.amp * cosTurns(term.f * t + term.phi);
  return v;
}

/** Convenience: traffic multiplier at time t for a mix and a shape. */
export function shapeAt(t: number, mix: RegionMix, s: TrafficShape): number {
  return evalShape(shapeTerms(mix, s), t);
}

/** Lower bound of the shape (worst case, all regions aligned). Must stay well above 0. */
export function shapeLowerBound(s: TrafficShape): number {
  return 1 - s.a1 - s.a2 - s.w;
}

export function validateMix(mix: RegionMix): void {
  let total = 0;
  for (const r of REGION_IDS) {
    const m = mix[r];
    if (!(m >= 0)) throw new RangeError(`Region share for ${r} must be >= 0`);
    total += m;
  }
  if (Math.abs(total - 1) > 1e-6) throw new RangeError(`Region mix must sum to 1 (got ${total})`);
}
