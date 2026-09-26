import { describe, expect, it } from 'vitest';
import { trafficShape } from '../estimate';
import { buildCurve, rateAt } from '../growth';
import { buildShapedCurve, shapedCumulativeAt } from '../integrate';
import { spread } from '../range';
import { evalShape, shapeTerms, type RegionMix } from '../traffic';
import { anchor, DAY0, PARAMS, simpson } from './helpers';

const mix: RegionMix = {
  northAmerica: 0.4,
  latinAmerica: 0.05,
  europeAfrica: 0.25,
  southAsiaMiddleEast: 0.1,
  eastAsiaPacific: 0.2,
};
const terms = shapeTerms(mix, trafficShape('coding'));
// A short first gap gives a steep seed ramp — the hardest case for monotonicity.
const curve = buildCurve(
  DAY0,
  [
    anchor(DAY0 + 5, spread(1e9, 1.2)),
    anchor(DAY0 + 200, spread(3e11, 1.2)),
    anchor(DAY0 + 420, spread(9e11, 1.3)),
  ],
  PARAMS,
);
const shaped = buildShapedCurve(curve, terms);
const f = (x: number) => rateAt(curve, x).central * evalShape(terms, x);

describe('exact integral of growth × traffic shape', () => {
  it('matches fine numerical integration', () => {
    for (const t of [
      DAY0 + 0.3,
      DAY0 + 4.9,
      DAY0 + 17.61,
      DAY0 + 199.2,
      DAY0 + 421.7,
      DAY0 + 800.05,
    ]) {
      const exact = shapedCumulativeAt(shaped, t).central;
      const numeric = simpson(f, DAY0, t, Math.max(2000, Math.ceil((t - DAY0) * 400) * 2));
      expect(exact / numeric).toBeCloseTo(1, 7);
    }
  });

  it('is strictly increasing (the counter never runs backwards)', () => {
    let prev = shapedCumulativeAt(shaped, DAY0).central;
    for (let t = DAY0 + 0.001; t < DAY0 + 900; t += 0.0371) {
      const v = shapedCumulativeAt(shaped, t);
      expect(v.central).toBeGreaterThan(prev);
      expect(v.low).toBeLessThanOrEqual(v.central);
      expect(v.central).toBeLessThanOrEqual(v.high);
      prev = v.central;
    }
  });

  it('its derivative is the displayed rate', () => {
    for (const t of [DAY0 + 30.123, DAY0 + 333.5, DAY0 + 600.9]) {
      const h = 1e-4;
      const slope =
        (shapedCumulativeAt(shaped, t + h).central - shapedCumulativeAt(shaped, t - h).central) /
        (2 * h);
      expect(slope / f(t)).toBeCloseTo(1, 5);
    }
  });

  it('a whole day integrates to roughly the daily rate', () => {
    const t = DAY0 + 300;
    const day = shapedCumulativeAt(shaped, t + 1).central - shapedCumulativeAt(shaped, t).central;
    const r = rateAt(curve, t + 0.5).central;
    // weekly term makes single days deviate a little
    expect(day / r).toBeGreaterThan(0.75);
    expect(day / r).toBeLessThan(1.25);
  });
});
