import { describe, expect, it } from 'vitest';
import {
  buildCurve,
  cumulativeTierAt,
  integralAt,
  mergeAnchors,
  rateAt,
  rateTierAt,
  segmentAt,
} from '../growth';
import { range, spread } from '../range';
import { anchor, DAY0, PARAMS, simpson } from './helpers';

const a1 = anchor(DAY0 + 100, spread(1e12, 1.1));
const a2 = anchor(DAY0 + 300, spread(4e12, 1.1));
const a3 = anchor(DAY0 + 500, spread(1e13, 1.2), 'derived');
const curve = buildCurve(DAY0, [a3, a1, a2], PARAMS);

describe('growth curve', () => {
  it('is zero before launch', () => {
    expect(rateAt(curve, DAY0 - 1)).toEqual({ low: 0, central: 0, high: 0 });
    expect(integralAt(curve, DAY0 - 1).central).toBe(0);
  });

  it('passes exactly through every anchor', () => {
    for (const a of [a1, a2, a3]) {
      const r = rateAt(curve, a.t);
      expect(r.central / a.rate.central).toBeCloseTo(1, 12);
      expect(r.low / a.rate.low).toBeCloseTo(1, 12);
      expect(r.high / a.rate.high).toBeCloseTo(1, 12);
    }
  });

  it('interpolates exponentially (midpoint = geometric mean)', () => {
    const mid = rateAt(curve, (a1.t + a2.t) / 2).central;
    expect(mid / Math.sqrt(1e12 * 4e12)).toBeCloseTo(1, 12);
  });

  it('starts from a small seed at launch', () => {
    const r0 = rateAt(curve, DAY0).central;
    expect(r0 / a1.rate.central).toBeCloseTo(PARAMS.seedFraction.central, 10);
  });

  it('closed-form integral matches numerical integration', () => {
    for (const t of [DAY0 + 50, DAY0 + 250, DAY0 + 480, DAY0 + 700, DAY0 + 1200]) {
      const exact = integralAt(curve, t).central;
      const numeric = simpson((x) => rateAt(curve, x).central, DAY0, t, 20000);
      expect(exact / numeric).toBeCloseTo(1, 6);
    }
  });

  it('keeps low <= central <= high everywhere, including far extrapolation', () => {
    for (let t = DAY0 - 10; t < DAY0 + 3000; t += 7.3) {
      const r = rateAt(curve, t);
      expect(r.low).toBeLessThanOrEqual(r.central);
      expect(r.central).toBeLessThanOrEqual(r.high);
      const c = integralAt(curve, t);
      expect(c.low).toBeLessThanOrEqual(c.central);
      expect(c.central).toBeLessThanOrEqual(c.high);
    }
  });

  it('widens the band the longer it extrapolates', () => {
    const width = (t: number) => {
      const r = rateAt(curve, t);
      return r.high / r.low;
    };
    expect(width(a3.t + 180)).toBeGreaterThan(width(a3.t));
    expect(width(a3.t + 540)).toBeGreaterThan(width(a3.t + 180));
  });

  it('damps extrapolated growth month over month', () => {
    const m = 30.4375;
    const g1 = rateAt(curve, a3.t + 2 * m).central / rateAt(curve, a3.t + m).central;
    const g2 = rateAt(curve, a3.t + 20 * m).central / rateAt(curve, a3.t + 19 * m).central;
    expect(g1).toBeGreaterThan(1);
    expect(g2).toBeGreaterThan(1);
    expect(g2).toBeLessThan(g1);
  });

  it('fits growth from recent anchors and clamps it', () => {
    // a2 → a3 (the most recent anchor ≥ 60 days before the last): ln(2.5) over 200 days
    expect(curve.logGrowthPerYear).toBeCloseTo((Math.log(2.5) / 200) * 365.25, 6);
    // a slow-down in the latest quarter is picked up instead of the older, faster trend
    const slowing = buildCurve(
      DAY0,
      [
        anchor(DAY0 + 10, spread(1, 1.1)),
        anchor(DAY0 + 200, spread(10, 1.1)),
        anchor(DAY0 + 290, spread(12, 1.1)),
      ],
      PARAMS,
    );
    expect(slowing.logGrowthPerYear).toBeCloseTo((Math.log(1.2) / 90) * 365.25, 6);
    const wild = buildCurve(
      DAY0,
      [anchor(DAY0 + 10, spread(1, 1.1)), anchor(DAY0 + 80, spread(1e6, 1.1))],
      PARAMS,
    );
    expect(wild.logGrowthPerYear).toBe(PARAMS.maxLogGrowthPerYear);
  });

  it('labels segments and tiers honestly', () => {
    expect(segmentAt(curve, DAY0 + 10)?.kind).toBe('seed');
    expect(segmentAt(curve, DAY0 + 10)?.tier).toBe('modeled');
    expect(segmentAt(curve, DAY0 + 200)?.kind).toBe('interpolated');
    expect(segmentAt(curve, DAY0 + 200)?.tier).toBe('derived'); // interpolation is never "reported"
    expect(segmentAt(curve, DAY0 + 900)?.kind).toBe('extrapolated');
    // reported only close to a reported anchor
    expect(rateTierAt(curve, a1.t + 3, 14)).toBe('reported');
    // a published figure never vouches for the days before it, nor for the time before launch
    expect(rateTierAt(curve, a1.t - 3, 14)).not.toBe('reported');
    expect(rateTierAt(curve, curve.start - 1, 14)).toBe('modeled');
    expect(rateTierAt(curve, a1.t + 40, 14)).toBe('derived');
    // a3 is derived, so a value near it is derived, never reported
    expect(rateTierAt(curve, a3.t, 14)).toBe('derived');
    // cumulative is never "reported"
    expect(cumulativeTierAt(curve, DAY0 + 600)).toBe('derived');
    // early on the seed dominates → modeled
    expect(cumulativeTierAt(curve, DAY0 + 90)).toBe('modeled');
  });

  it('uses modeled default growth with a single anchor', () => {
    const one = buildCurve(DAY0, [anchor(DAY0 + 30, spread(5e11, 1.1))], PARAMS);
    expect(one.growthTier).toBe('modeled');
    expect(one.logGrowthPerYear).toBe(PARAMS.defaultLogGrowthPerYear);
    expect(segmentAt(one, DAY0 + 400)?.tier).toBe('modeled');
  });

  it('merges anchors that are too close: stronger tier wins, equal tiers average', () => {
    const merged = mergeAnchors([
      anchor(DAY0 + 1, range(1, 2, 3), 'derived'),
      anchor(DAY0 + 3, range(4, 5, 6), 'reported'),
      anchor(DAY0 + 50, range(1, 1, 1), 'modeled'),
      anchor(DAY0 + 52, range(4, 4, 4), 'modeled'),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.rate.central).toBe(5);
    expect(merged[1]!.rate.central).toBe(2);
  });

  it('rejects a curve without anchors', () => {
    expect(() => buildCurve(DAY0, [], PARAMS)).toThrow(RangeError);
  });
});
