import { describe, expect, it } from 'vitest';
import { decadeScale, gaugeFraction } from './gauge';

describe('gauge scale', () => {
  it('maps values logarithmically and clamps', () => {
    expect(gaugeFraction(10, 1, 100)).toBeCloseTo(0.5, 12);
    expect(gaugeFraction(1, 1, 100)).toBe(0);
    expect(gaugeFraction(1000, 1, 100)).toBe(1);
    expect(gaugeFraction(0.01, 1, 100)).toBe(0);
    expect(gaugeFraction(0, 1, 100)).toBe(0);
    expect(gaugeFraction(Number.NaN, 1, 100)).toBe(0);
  });

  it('snaps to whole decades that cover the data', () => {
    const s = decadeScale(0.23, 1840);
    expect(s.min).toBeCloseTo(0.1, 12);
    expect(s.max).toBe(10_000);
    expect(s.ticks).toHaveLength(6);
    const single = decadeScale(5, 5);
    expect(single.max).toBeGreaterThan(single.min);
  });
});
