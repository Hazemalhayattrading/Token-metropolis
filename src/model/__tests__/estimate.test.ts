import { describe, expect, it } from 'vitest';
import { UNCERTAINTY, USAGE } from '../constants';
import {
  anchorFromMetric,
  between,
  buildPlatformModel,
  cumulative,
  cumulativeTier,
  dailyRate,
  globalCumulative,
  globalDailyRate,
  latestAnchor,
  metricRange,
  rateTier,
  tokensPerSecond,
  tokensToday,
} from '../estimate';
import { compact, plain } from '../format';
import { isoToDays } from '../time';
import { metric, platform } from './fixtures';

const p = platform();
const app = p.components[0]!;
const api = p.components[1]!;

const metrics = [
  metric({
    id: 'app-wau-1',
    component: 'app',
    kind: 'users',
    window: 'weekly',
    value: 1e8,
    asOf: '2024-01-15',
  }),
  metric({
    id: 'app-wau-2',
    component: 'app',
    kind: 'users',
    window: 'weekly',
    value: 3e8,
    asOf: '2025-06-01',
  }),
  metric({
    id: 'api-tpm',
    component: 'api',
    kind: 'tokens',
    period: 'minute',
    value: 1e9,
    asOf: '2025-10-06',
  }),
  metric({
    id: 'api-tpm-2',
    component: 'api',
    kind: 'tokens',
    period: 'minute',
    value: 2e9,
    asOf: '2026-09-20',
  }),
  metric({ id: 'context', kind: 'other', metric: 'downloads', value: 5e8, asOf: '2025-01-01' }),
];
const pm = buildPlatformModel(p, metrics);
const NOW = isoToDays('2026-09-25') + 0.5;

describe('metric ranges', () => {
  it('widen according to how a figure was stated', () => {
    const exact = metricRange(metrics[2]!);
    expect(exact.high / exact.central).toBeCloseTo(UNCERTAINTY.exact.value, 10);
    const over = metricRange(
      metric({
        id: 'o',
        kind: 'tokens',
        period: 'day',
        value: 100,
        asOf: '2025-01-01',
        qualifier: 'over',
      }),
    );
    expect(over.low).toBe(100);
    expect(over.central).toBe(100);
    expect(over.high).toBeCloseTo(100 * UNCERTAINTY.over.value, 10);
    const ranged = metricRange(
      metric({
        id: 'r',
        kind: 'tokens',
        period: 'day',
        value: 100,
        low: 80,
        high: 150,
        qualifier: 'range',
        asOf: '2025-01-01',
      }),
    );
    expect(ranged).toEqual({ low: 80, central: 100, high: 150 });
  });

  it('third-party figures are wider than primary ones', () => {
    const primary = metricRange(metrics[0]!);
    const third = metricRange({ ...metrics[0]!, sourceKind: 'third-party' });
    expect(third.high / third.low).toBeGreaterThan(primary.high / primary.low);
  });
});

describe('anchors from metrics', () => {
  it('converts reported tokens per minute to per day and keeps them "reported"', () => {
    const a = anchorFromMetric(metrics[2]!, api)!;
    expect(a.rate.central).toBeCloseTo(1e9 * 1440, 0);
    expect(a.tier).toBe('reported');
    expect(a.formula).toBe('1B tokens/minute × 1,440');
  });

  it('users → tokens uses stickiness × requests × tokens and is modeled (assumption constants)', () => {
    const a = anchorFromMetric(metrics[0]!, app)!;
    const expected =
      1e8 *
      USAGE.dauPerWau_assistant.value *
      USAGE.requestsPerDau_assistant.value *
      USAGE.tokensPerRequest_assistant.value;
    expect(a.rate.central / expected).toBeCloseTo(1, 10);
    expect(a.tier).toBe('modeled');
    expect(a.refs).toEqual([
      'app-wau-1',
      'USAGE.dauPerWau_assistant',
      'USAGE.requestsPerDau_assistant',
      'USAGE.tokensPerRequest_assistant',
    ]);
    expect(a.formula).toBe('100M WAU × 0.45 DAU/WAU × 8 requests/day × 2k tokens/request');
  });

  it('users → tokens with a platform-calibrated tokens-per-user constant', () => {
    const calibrated = {
      ...api,
      overrides: { userWindow: 'monthly' as const, tokensPerUserDay: 'tokensPerMauDay_deepseek' },
    };
    const m = metric({
      id: 'mau',
      component: 'api',
      kind: 'users',
      window: 'monthly',
      value: 1e8,
      asOf: '2026-01-01',
    });
    const a = anchorFromMetric(m, calibrated)!;
    expect(a.rate.central).toBeCloseTo(1e8 * USAGE.tokensPerMauDay_deepseek.value, -3);
    expect(a.refs).toEqual(['mau', 'USAGE.tokensPerMauDay_deepseek']);
    expect(a.tier).toBe('derived'); // both calibration inputs are published
    const weekly = metric({
      id: 'wau',
      component: 'api',
      kind: 'users',
      window: 'weekly',
      value: 1e8,
      asOf: '2026-01-01',
    });
    expect(() => anchorFromMetric(weekly, calibrated)).toThrow(/per monthly user/);
  });

  it('users → tokens with calibrated requests per user', () => {
    const calibrated = {
      ...app,
      overrides: {
        userWindow: 'monthly' as const,
        requestsPerUserDay: 'requestsPerMauDay_characterai',
      },
    };
    const m = metric({
      id: 'mau2',
      component: 'app',
      kind: 'users',
      window: 'monthly',
      value: 2e7,
      asOf: '2025-01-15',
    });
    const a = anchorFromMetric(m, calibrated)!;
    expect(a.rate.central).toBeCloseTo(
      2e7 * USAGE.requestsPerMauDay_characterai.value * USAGE.tokensPerRequest_assistant.value,
      -3,
    );
  });

  it('requests → tokens', () => {
    const m = metric({
      id: 'q',
      component: 'app',
      kind: 'requests',
      period: 'day',
      value: 2.5e9,
      asOf: '2025-07-21',
    });
    const a = anchorFromMetric(m, app)!;
    expect(a.rate.central).toBeCloseTo(2.5e9 * USAGE.tokensPerRequest_assistant.value, -3);
  });

  it('revenue → tokens', () => {
    const m = metric({
      id: 'rev',
      component: 'api',
      kind: 'revenue',
      period: 'year',
      value: 3.65e9,
      asOf: '2025-07-21',
    });
    const a = anchorFromMetric(m, api)!;
    const expected =
      ((3.65e9 / 365.25) * USAGE.tokenRevenueShare.value) /
      (USAGE.pricePerMillionTokens.value / 1e6);
    expect(a.rate.central / expected).toBeCloseTo(1, 10);
  });

  it('ignores context-only metrics and other components', () => {
    expect(anchorFromMetric(metrics[4]!, app)).toBeNull();
    expect(anchorFromMetric(metrics[2]!, app)).toBeNull();
  });

  it('rejects inconsistent metric definitions at the schema level', () => {
    expect(() => metric({ id: 'bad', kind: 'tokens', value: 1, asOf: '2025-01-01' })).toThrow();
    expect(() => metric({ id: 'bad2', kind: 'users', value: 1, asOf: '2025-01-01' })).toThrow();
    expect(() =>
      metric({ id: 'bad3', kind: 'revenue', period: 'month', value: 1, asOf: '2025-01-01' }),
    ).toThrow();
  });
});

describe('platform model', () => {
  it('is zero before launch and positive after', () => {
    expect(dailyRate(pm, isoToDays('2022-06-01')).central).toBe(0);
    expect(cumulative(pm, isoToDays('2022-06-01')).central).toBe(0);
    expect(dailyRate(pm, NOW).central).toBeGreaterThan(0);
  });

  it('components add up', () => {
    const total = dailyRate(pm, NOW).central;
    const api2 = 2e9 * 1440;
    expect(total).toBeGreaterThan(api2 * 0.9);
  });

  it('counters are deterministic: same inputs, same numbers, regardless of evaluation order', () => {
    const pm2 = buildPlatformModel(platform(), [...metrics].reverse());
    const t = NOW + 0.123456;
    tokensToday(pm2, t + 1); // evaluate something else first
    expect(cumulative(pm2, t)).toEqual(cumulative(pm, t));
    expect(tokensPerSecond(pm2, t)).toEqual(tokensPerSecond(pm, t));
  });

  it('tokens today is the integral since 00:00 UTC and grows through the day', () => {
    const day = Math.floor(NOW);
    expect(tokensToday(pm, day).central).toBe(0);
    const morning = tokensToday(pm, day + 0.25).central;
    const evening = tokensToday(pm, day + 0.9).central;
    expect(evening).toBeGreaterThan(morning);
    expect(
      tokensToday(pm, day + 0.9999).central / dailyRate(pm, day + 0.5).central,
    ).toBeGreaterThan(0.7);
  });

  it('since-you-arrived equals the integral of tokens per second', () => {
    const t0 = NOW;
    const t1 = NOW + 60 / 86400;
    const counted = between(pm, t0, t1).central;
    const approx = tokensPerSecond(pm, t0 + 30 / 86400).central * 60;
    expect(counted / approx).toBeCloseTo(1, 4);
  });

  it('reports honest tiers', () => {
    // the API has a reported figure 5 days before NOW, but the app component (users-derived) is modeled
    expect(rateTier(pm, NOW)).toBe('modeled');
    expect(['derived', 'modeled']).toContain(cumulativeTier(pm, NOW));
    expect(latestAnchor(pm, NOW)?.refs[0]).toBe('api-tpm-2');
  });

  it('global total removes tokens routed to other listed platforms', () => {
    const own = dailyRate(pm, NOW).central;
    const global = globalDailyRate([pm], NOW).central;
    expect(global).toBeLessThan(own);
    expect(globalCumulative([pm], NOW).central).toBeLessThan(cumulative(pm, NOW).central);
  });
});

describe('formatting', () => {
  it('compacts numbers for formulas', () => {
    expect(compact(1.3e15)).toBe('1.3 quadrillion');
    expect(compact(6e9)).toBe('6B');
    expect(compact(100)).toBe('100');
    expect(compact(1440)).toBe('1.44k');
    expect(compact(30.4375)).toBe('30');
    expect(compact(0.45)).toBe('0.45');
    expect(compact(123e12)).toBe('123T');
    expect(plain(1440)).toBe('1,440');
    expect(plain(30.4375)).toBe('30.44');
    expect(plain(1234567.8)).toBe('1,234,568');
    expect(plain(0.25)).toBe('0.25');
  });
});
