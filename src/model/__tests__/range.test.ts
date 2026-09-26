import { describe, expect, it } from 'vitest';
import {
  complement,
  divide,
  isOrdered,
  multiply,
  point,
  range,
  scale,
  spread,
  sum,
  widen,
} from '../range';
import { atLeastDerived, tierOfBasis, weakest } from '../tier';

describe('range arithmetic', () => {
  it('rejects unordered ranges', () => {
    expect(() => range(2, 1, 3)).toThrow(RangeError);
    expect(() => range(1, 4, 3)).toThrow(RangeError);
  });

  it('multiplies point values exactly', () => {
    expect(multiply(point(3), point(4))).toEqual(point(12));
  });

  it('combines uncertainties in quadrature on a log scale', () => {
    // two independent ×/÷2 factors → ×/÷ 2^√2, not ×/÷4
    const r = multiply(spread(10, 2), spread(10, 2));
    expect(r.central).toBe(100);
    expect(r.high / r.central).toBeCloseTo(2 ** Math.SQRT2, 10);
    expect(r.central / r.low).toBeCloseTo(2 ** Math.SQRT2, 10);
  });

  it('keeps asymmetric sides separate', () => {
    const r = multiply(range(9, 10, 20), point(1));
    expect(r.low).toBeCloseTo(9, 10);
    expect(r.high).toBeCloseTo(20, 10);
  });

  it('divide swaps the divisor sides', () => {
    const r = divide(point(100), range(5, 10, 40));
    expect(r.central).toBe(10);
    expect(r.low).toBeCloseTo(100 / 40, 10);
    expect(r.high).toBeCloseTo(100 / 5, 10);
  });

  it('divide refuses a divisor that can be zero', () => {
    expect(() => divide(point(1), range(0, 1, 2))).toThrow(RangeError);
  });

  it('scale, sum, complement, widen behave', () => {
    expect(scale(range(1, 2, 3), 2)).toEqual(range(2, 4, 6));
    expect(sum(range(1, 2, 3), range(1, 1, 1))).toEqual(range(2, 3, 4));
    expect(complement(range(0.1, 0.2, 0.4))).toEqual({ low: 0.6, central: 0.8, high: 0.9 });
    const w = widen(point(10), 0.5);
    expect(w.low).toBeLessThan(10);
    expect(w.high).toBeGreaterThan(10);
    expect(w.high * w.low).toBeCloseTo(100, 8); // symmetric in log space
  });

  it('results are always ordered', () => {
    const rs = [range(1, 2, 5), range(0.5, 3, 3.1), spread(7, 1.5), point(4)];
    for (const a of rs)
      for (const b of rs) {
        expect(isOrdered(multiply(a, b))).toBe(true);
        expect(isOrdered(divide(a, b))).toBe(true);
      }
  });
});

describe('tiers', () => {
  it('a chain is as strong as its weakest link', () => {
    expect(weakest()).toBe('reported');
    expect(weakest('reported', 'derived')).toBe('derived');
    expect(weakest('modeled', 'reported', 'derived')).toBe('modeled');
  });
  it('maps input basis to the tier it caps', () => {
    expect(tierOfBasis('exact')).toBe('reported');
    expect(tierOfBasis('published')).toBe('derived');
    expect(tierOfBasis('assumption')).toBe('modeled');
    expect(atLeastDerived('reported')).toBe('derived');
    expect(atLeastDerived('modeled')).toBe('modeled');
  });
});
