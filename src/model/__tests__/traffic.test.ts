import { describe, expect, it } from 'vitest';
import { TRAFFIC } from '../constants';
import { trafficShape } from '../estimate';
import {
  evalShape,
  REGION_IDS,
  shapeAt,
  shapeLowerBound,
  shapeTerms,
  validateMix,
  type RegionMix,
} from '../traffic';
import { PROFILES } from '../../data/schema';

const only = (r: (typeof REGION_IDS)[number]): RegionMix =>
  Object.fromEntries(REGION_IDS.map((id) => [id, id === r ? 1 : 0])) as RegionMix;

const mixed: RegionMix = {
  northAmerica: 0.3,
  latinAmerica: 0.1,
  europeAfrica: 0.25,
  southAsiaMiddleEast: 0.15,
  eastAsiaPacific: 0.2,
};

describe('traffic curve', () => {
  it('averages to exactly 1 over a week for every profile', () => {
    for (const p of PROFILES) {
      const terms = shapeTerms(mixed, trafficShape(p));
      const n = 7 * 24 * 60;
      let acc = 0;
      for (let i = 0; i < n; i++) acc += evalShape(terms, 20000 + i / (24 * 60));
      expect(acc / n).toBeCloseTo(1, 9);
    }
  });

  it('never drops near zero', () => {
    for (const p of PROFILES) {
      // worst case with every term aligned (not reachable in practice)
      expect(shapeLowerBound(trafficShape(p))).toBeGreaterThanOrEqual(0.15);
      // actual minimum over a week for a single region
      let min = Infinity;
      for (let m = 0; m < 7 * 1440; m += 5)
        min = Math.min(min, shapeAt(20000 + m / 1440, only('northAmerica'), trafficShape(p)));
      expect(min).toBeGreaterThan(0.25);
    }
    expect(Object.keys(TRAFFIC).sort()).toEqual([...PROFILES].sort());
  });

  it('peaks near the configured local hour', () => {
    const s = trafficShape('assistant');
    // A Wednesday in UTC; Europe is UTC+1 in the model.
    const day = Date.UTC(2026, 8, 23) / 86_400_000;
    let best = -1;
    let bestHour = -1;
    for (let m = 0; m < 24 * 60; m++) {
      const v = shapeAt(day + m / 1440, only('europeAfrica'), s);
      if (v > best) {
        best = v;
        bestHour = m / 60;
      }
    }
    const localPeak = (bestHour + 1) % 24;
    expect(Math.abs(localPeak - s.p1)).toBeLessThan(2.5);
  });

  it('Asia wakes up first: an East-Asian platform peaks earlier in UTC than a North American one', () => {
    const s = trafficShape('assistant');
    const day = Date.UTC(2026, 8, 23) / 86_400_000;
    const peakUtc = (mix: RegionMix) => {
      let best = -1;
      let at = 0;
      for (let m = 0; m < 1440; m++) {
        const v = shapeAt(day + m / 1440, mix, s);
        if (v > best) {
          best = v;
          at = m / 60;
        }
      }
      return at;
    };
    expect(peakUtc(only('eastAsiaPacific'))).toBeLessThan(peakUtc(only('northAmerica')));
  });

  it('coding tools dip at weekends', () => {
    const s = trafficShape('coding');
    const wed = Date.UTC(2026, 8, 23) / 86_400_000;
    const sun = Date.UTC(2026, 8, 27) / 86_400_000;
    const dayMean = (d: number) => {
      let acc = 0;
      for (let m = 0; m < 1440; m++) acc += shapeAt(d + m / 1440, only('europeAfrica'), s);
      return acc / 1440;
    };
    expect(dayMean(wed)).toBeGreaterThan(dayMean(sun) * 1.2);
  });

  it('validates region mixes', () => {
    expect(() => validateMix(mixed)).not.toThrow();
    expect(() => validateMix({ ...mixed, northAmerica: 0.5 })).toThrow(RangeError);
  });
});
