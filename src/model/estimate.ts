/**
 * From sourced metrics to per-platform token curves.
 *
 * A platform is one or more components (e.g. "consumer app" and "API").
 * Every metric that names a component becomes an anchor on that component's
 * curve, converted to tokens/day by one of four documented methods:
 *
 *   tokens    reported tokens per period            → ÷ days in period
 *   requests  requests per period                   × tokens per request
 *   users     DAU/WAU/MAU                           × DAU share × requests per DAU × tokens per request
 *   revenue   annualized revenue                    × metered share ÷ price per token
 *
 * The tier of each anchor is the weakest of its inputs (see tier.ts).
 */
import type { Component, Metric, Platform, Profile } from '../data/schema';
import { GROWTH, TRAFFIC, UNCERTAINTY, USAGE } from './constants';
import { dlog } from './detmath';
import {
  buildCurve,
  rateAt,
  rateTierAt,
  cumulativeTierAt,
  type Anchor,
  type Curve,
  type GrowthParams,
} from './growth';
import { buildShapedCurve, shapedCumulativeAt, type ShapedCurve } from './integrate';
import { divide, fromConstant, multiply, range, scale, spread, widen, Z90 } from './range';
import { compact, plain } from './format';
import { tierOfBasis, weakest } from './tier';
import { DAYS_PER_MONTH, DAYS_PER_YEAR, SECONDS_PER_DAY, isoToDays, utcDayStart } from './time';
import {
  evalShape,
  shapeTerms,
  type RegionMix,
  type ShapeTerm,
  type TrafficShape,
} from './traffic';
import type { Constant, Range, Tier } from './types';

// ---------------------------------------------------------------------------
// Constants lookup
// ---------------------------------------------------------------------------

export function usageConstant(key: string): Constant {
  const c = (USAGE as Record<string, Constant>)[key];
  if (!c) throw new Error(`Unknown usage constant "${key}" (add it to src/model/constants.ts)`);
  return c;
}

function usageKey(comp: Component, base: 'tokensPerRequest' | 'requestsPerDau'): string {
  return comp.overrides?.[base] ?? `${base}_${comp.profile}`;
}

export function trafficShape(profile: Profile): TrafficShape {
  const t = TRAFFIC[profile];
  return {
    a1: t.a1.value,
    p1: t.p1.value,
    a2: t.a2.value,
    p2: t.p2.value,
    w: t.w.value,
    pw: t.pw.value,
  };
}

export function growthParams(): GrowthParams {
  return {
    seedFraction: fromConstant(GROWTH.seedFraction),
    defaultLogGrowthPerYear: GROWTH.defaultLogGrowthPerYear.value,
    growthSigmaPerYear: GROWTH.growthSigmaPerYear.value,
    minLogGrowthPerYear: GROWTH.minLogGrowthPerYear.value,
    maxLogGrowthPerYear: GROWTH.maxLogGrowthPerYear.value,
    dampingDays: GROWTH.dampingDays.value,
    horizonDays: GROWTH.horizonDays.value,
  };
}

// ---------------------------------------------------------------------------
// Metric → range
// ---------------------------------------------------------------------------

export const PER_DAY: Record<NonNullable<Metric['period']>, number> = {
  second: SECONDS_PER_DAY,
  minute: 1440,
  hour: 24,
  day: 1,
  week: 1 / 7,
  month: 1 / DAYS_PER_MONTH,
  quarter: 4 / DAYS_PER_YEAR,
  year: 1 / DAYS_PER_YEAR,
};

/** The uncertainty band implied by how a figure was stated and who stated it. */
export function metricRange(m: Metric): Range {
  let r: Range;
  switch (m.qualifier) {
    case 'range':
      r = range(m.low!, m.value, m.high!);
      break;
    case 'about':
      r = spread(m.value, UNCERTAINTY.about.value);
      break;
    case 'over':
      r = { low: m.value, central: m.value, high: m.value * UNCERTAINTY.over.value };
      break;
    case 'under':
      r = { low: m.value / UNCERTAINTY.over.value, central: m.value, high: m.value };
      break;
    default:
      r = spread(m.value, UNCERTAINTY.exact.value);
  }
  if (m.qualifier !== 'range' && (m.low !== undefined || m.high !== undefined)) {
    r = range(m.low ?? r.low, m.value, m.high ?? r.high);
  }
  if (m.sourceKind === 'third-party') r = widen(r, dlog(UNCERTAINTY.thirdParty.value) / Z90);
  return r;
}

export function metricTier(m: Metric): Tier {
  return m.sourceKind === 'primary' ? 'reported' : 'derived';
}

const WINDOW_LABEL = { daily: 'DAU', weekly: 'WAU', monthly: 'MAU' } as const;

// ---------------------------------------------------------------------------
// Metric → anchor
// ---------------------------------------------------------------------------

export function anchorFromMetric(m: Metric, comp: Component): Anchor | null {
  if (!m.component || m.component !== comp.id || m.kind === 'other') return null;
  const t = isoToDays(m.asOf);
  const mr = metricRange(m);
  const baseTier = metricTier(m);
  const refs: string[] = [m.id];
  let rate: Range;
  let tier: Tier;
  let formula: string;

  switch (m.kind) {
    case 'tokens': {
      const perDay = PER_DAY[m.period!];
      rate = scale(mr, perDay);
      tier = baseTier;
      formula =
        m.period === 'day'
          ? `${compact(m.value)} tokens/day`
          : perDay >= 1
            ? `${compact(m.value)} tokens/${m.period} × ${plain(perDay)}`
            : `${compact(m.value)} tokens/${m.period} ÷ ${plain(1 / perDay)} days`;
      break;
    }
    case 'requests': {
      const tprKey = usageKey(comp, 'tokensPerRequest');
      const tpr = usageConstant(tprKey);
      refs.push(`USAGE.${tprKey}`);
      rate = multiply(scale(mr, PER_DAY[m.period!]), fromConstant(tpr));
      tier = weakest(baseTier, 'derived', tierOfBasis(tpr.basis));
      formula = `${compact(m.value)} requests/${m.period}${m.period === 'day' ? '' : ' (per-day equivalent)'} × ${compact(tpr.value)} tokens/request`;
      break;
    }
    case 'users': {
      const o = comp.overrides;
      const factors: Range[] = [mr];
      const parts: string[] = [`${compact(m.value)} ${WINDOW_LABEL[m.window!]}`];
      const tiers: Tier[] = [baseTier, 'derived'];
      const push = (key: string, label: (c: Constant) => string) => {
        const c = usageConstant(key);
        refs.push(`USAGE.${key}`);
        factors.push(fromConstant(c));
        parts.push(label(c));
        tiers.push(tierOfBasis(c.basis));
      };
      if (o?.tokensPerUserDay || o?.requestsPerUserDay) {
        if (o.userWindow !== m.window) {
          throw new Error(
            `${m.id}: ${comp.id} per-user constants are per ${o.userWindow} user, metric is ${m.window}`,
          );
        }
        const per = WINDOW_LABEL[m.window!];
        if (o.tokensPerUserDay)
          push(o.tokensPerUserDay, (c) => `${compact(c.value)} tokens per ${per} per day`);
        else {
          push(o.requestsPerUserDay!, (c) => `${compact(c.value)} requests per ${per} per day`);
          push(usageKey(comp, 'tokensPerRequest'), (c) => `${compact(c.value)} tokens/request`);
        }
      } else {
        if (m.window !== 'daily') {
          const sKey = `${m.window === 'weekly' ? 'dauPerWau' : 'dauPerMau'}_${comp.profile}`;
          push(sKey, (c) => `${c.value} DAU/${WINDOW_LABEL[m.window!]}`);
        }
        push(usageKey(comp, 'requestsPerDau'), (c) => `${compact(c.value)} requests/day`);
        push(usageKey(comp, 'tokensPerRequest'), (c) => `${compact(c.value)} tokens/request`);
      }
      rate = multiply(...factors);
      tier = weakest(...tiers);
      formula = parts.join(' × ');
      break;
    }
    case 'revenue': {
      const priceKey = comp.overrides?.pricePerMillionTokens ?? 'pricePerMillionTokens';
      const shareKey = comp.overrides?.tokenRevenueShare ?? 'tokenRevenueShare';
      const price = usageConstant(priceKey);
      const share = usageConstant(shareKey);
      refs.push(`USAGE.${shareKey}`, `USAGE.${priceKey}`);
      // USD/day × share ÷ (USD per token)
      rate = divide(
        multiply(scale(mr, 1 / DAYS_PER_YEAR), fromConstant(share)),
        scale(fromConstant(price), 1e-6),
      );
      tier = weakest(baseTier, 'derived', tierOfBasis(price.basis), tierOfBasis(share.basis));
      formula = `$${compact(m.value)}/yr ÷ 365 × ${share.value} metered share ÷ $${price.value} per million tokens`;
      break;
    }
    default:
      return null;
  }

  if (comp.overrides?.scope) {
    const s = usageConstant(comp.overrides.scope);
    refs.push(`USAGE.${comp.overrides.scope}`);
    rate = multiply(rate, fromConstant(s));
    tier = weakest(tier, tierOfBasis(s.basis));
    formula += ` × ${s.value} ${s.unit}`;
  }

  return { t, rate, tier, label: m.metric, formula, refs };
}

// ---------------------------------------------------------------------------
// Platform model
// ---------------------------------------------------------------------------

export interface ComponentModel {
  readonly component: Component;
  readonly start: number;
  readonly curve: Curve;
  readonly shaped: ShapedCurve;
  readonly terms: readonly ShapeTerm[];
  readonly routed: Range;
}

export interface PlatformModel {
  readonly platform: Platform;
  readonly launch: number;
  readonly mix: RegionMix;
  readonly components: readonly ComponentModel[];
  readonly metrics: readonly Metric[];
}

export function buildPlatformModel(
  platform: Platform,
  allMetrics: readonly Metric[],
): PlatformModel {
  const launch = isoToDays(platform.launch.date);
  const mix = platform.regionalMix.shares;
  const metrics = allMetrics.filter((m) => m.platform === platform.id);
  const params = growthParams();
  const components = platform.components.map((comp): ComponentModel => {
    const start = comp.start ? isoToDays(comp.start) : launch;
    const anchors = metrics
      .map((m) => anchorFromMetric(m, comp))
      .filter((a): a is Anchor => a !== null);
    if (anchors.length === 0) {
      throw new Error(`${platform.id}/${comp.id}: no anchoring metrics`);
    }
    const curve = buildCurve(start, anchors, params);
    const terms = shapeTerms(mix, trafficShape(comp.profile));
    return {
      component: comp,
      start,
      curve,
      shaped: buildShapedCurve(curve, terms),
      terms,
      routed: range(comp.routedShare.low, comp.routedShare.value, comp.routedShare.high),
    };
  });
  return { platform, launch, mix, components, metrics };
}

const ZERO: Range = { low: 0, central: 0, high: 0 };

function addTo(acc: Range, r: Range): Range {
  return { low: acc.low + r.low, central: acc.central + r.central, high: acc.high + r.high };
}

/** Smooth (daily-average) token rate, tokens/day. */
export function dailyRate(pm: PlatformModel, t: number): Range {
  let acc = ZERO;
  for (const c of pm.components) acc = addTo(acc, rateAt(c.curve, t));
  return acc;
}

/** Instantaneous tokens per second, following the traffic curve. */
export function tokensPerSecond(pm: PlatformModel, t: number): Range {
  let acc = ZERO;
  for (const c of pm.components) {
    acc = addTo(acc, scale(rateAt(c.curve, t), evalShape(c.terms, t) / SECONDS_PER_DAY));
  }
  return acc;
}

/** Traffic multiplier (1 = daily average) of the platform's largest component. */
export function trafficNow(pm: PlatformModel, t: number): number {
  let best: ComponentModel | undefined;
  let bestRate = -1;
  for (const c of pm.components) {
    const r = rateAt(c.curve, t).central;
    if (r > bestRate) {
      bestRate = r;
      best = c;
    }
  }
  return best ? evalShape(best.terms, t) : 1;
}

/** Tokens processed since launch. */
export function cumulative(pm: PlatformModel, t: number): Range {
  let acc = ZERO;
  for (const c of pm.components) acc = addTo(acc, shapedCumulativeAt(c.shaped, t));
  return acc;
}

/** Tokens processed since 00:00 UTC of the day containing t. */
export function tokensToday(pm: PlatformModel, t: number): Range {
  return between(pm, utcDayStart(t), t);
}

/** Tokens processed between t0 and t1 (each side of the band integrates its own curve). */
export function between(pm: PlatformModel, t0: number, t1: number): Range {
  const a = cumulative(pm, t0);
  const b = cumulative(pm, t1);
  return { low: b.low - a.low, central: b.central - a.central, high: b.high - a.high };
}

/** Components that carry at least `share` of the platform's current volume. */
function significant(pm: PlatformModel, t: number, share = 0.05): ComponentModel[] {
  const total = dailyRate(pm, t).central;
  return pm.components.filter((c) => total === 0 || rateAt(c.curve, t).central >= share * total);
}

export function rateTier(pm: PlatformModel, t: number): Tier {
  const fresh = GROWTH.reportedFreshnessDays.value;
  return weakest(...significant(pm, t).map((c) => rateTierAt(c.curve, t, fresh)));
}

export function cumulativeTier(pm: PlatformModel, t: number): Tier {
  return weakest(...significant(pm, t).map((c) => cumulativeTierAt(c.curve, t)));
}

/** The most recent anchor at or before t across components (for "last reported figure" UI). */
export function latestAnchor(
  pm: PlatformModel,
  t: number,
): (Anchor & { componentId: string }) | undefined {
  let best: (Anchor & { componentId: string }) | undefined;
  for (const c of pm.components) {
    for (const a of c.curve.anchors) {
      if (a.t <= t && (!best || a.t > best.t)) best = { ...a, componentId: c.component.id };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Global totals (de-duplicated)
// ---------------------------------------------------------------------------

/**
 * Some products route requests to another listed platform's models (e.g. a
 * coding tool calling a lab's API). Each component's `routedShare` is removed
 * from the global total so those tokens are counted once.
 */
export function globalTokensPerSecond(models: readonly PlatformModel[], t: number): Range {
  let acc = ZERO;
  for (const pm of models) {
    for (const c of pm.components) {
      const r = scale(rateAt(c.curve, t), evalShape(c.terms, t) / SECONDS_PER_DAY);
      acc = addTo(acc, dedupe(r, c.routed));
    }
  }
  return acc;
}

export function globalCumulative(models: readonly PlatformModel[], t: number): Range {
  let acc = ZERO;
  for (const pm of models) {
    for (const c of pm.components)
      acc = addTo(acc, dedupe(shapedCumulativeAt(c.shaped, t), c.routed));
  }
  return acc;
}

export function globalBetween(models: readonly PlatformModel[], t0: number, t1: number): Range {
  const a = globalCumulative(models, t0);
  const b = globalCumulative(models, t1);
  return { low: b.low - a.low, central: b.central - a.central, high: b.high - a.high };
}

export function globalDailyRate(models: readonly PlatformModel[], t: number): Range {
  let acc = ZERO;
  for (const pm of models)
    for (const c of pm.components) acc = addTo(acc, dedupe(rateAt(c.curve, t), c.routed));
  return acc;
}

/** Remove the routed share; the low side removes the most, the high side the least. */
function dedupe(r: Range, routed: Range): Range {
  return {
    low: r.low * (1 - routed.high),
    central: r.central * (1 - routed.central),
    high: r.high * (1 - routed.low),
  };
}
