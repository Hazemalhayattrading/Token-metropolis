/**
 * Uncertainty arithmetic.
 *
 * Every input range is read as a ~90% interval around a median ("central").
 * Products and quotients combine uncertainties in quadrature on a log scale
 * (log-normal propagation), with the lower and upper sides tracked separately
 * so asymmetric ranges stay asymmetric. This avoids the false alarm of
 * multiplying all the lows together (which would describe a ~1-in-a-million
 * coincidence rather than a plausible low case).
 *
 * Sums use the conservative rule (add lows, add highs) because the addends
 * usually share assumptions and are not independent.
 */
import { dexp, dlog } from './detmath';
import type { Constant, Range } from './types';

/** z-score of a two-sided 90% interval. */
export const Z90 = 1.6448536269514722;

export function range(low: number, central: number, high: number): Range {
  if (!(low <= central && central <= high)) {
    throw new RangeError(`Invalid range: ${low} <= ${central} <= ${high} does not hold`);
  }
  return { low, central, high };
}

export function point(value: number): Range {
  return { low: value, central: value, high: value };
}

export function fromConstant(c: Constant): Range {
  return range(c.low, c.value, c.high);
}

/** Log-scale half-widths (as σ) of a positive range. */
function sigmas(r: Range): { lo: number; hi: number } {
  if (r.central <= 0) return { lo: 0, hi: 0 };
  const lo = r.low > 0 ? dlog(r.central / r.low) / Z90 : Infinity;
  const hi = dlog(r.high / r.central) / Z90;
  return { lo, hi };
}

function fromSigmas(central: number, lo: number, hi: number): Range {
  if (central === 0) return point(0);
  const low = lo === Infinity ? 0 : central * dexp(-Z90 * lo);
  const high = central * dexp(Z90 * hi);
  // Guard against round-off producing low > central by one ulp.
  return { low: Math.min(low, central), central, high: Math.max(high, central) };
}

/** Product of independent positive ranges (log-normal propagation). */
export function multiply(...factors: readonly Range[]): Range {
  let central = 1;
  let lo2 = 0;
  let hi2 = 0;
  for (const f of factors) {
    if (f.central < 0 || f.low < 0) throw new RangeError('multiply() expects non-negative ranges');
    central *= f.central;
    const s = sigmas(f);
    lo2 += s.lo * s.lo;
    hi2 += s.hi * s.hi;
  }
  return fromSigmas(central, Math.sqrt(lo2), Math.sqrt(hi2));
}

/** Quotient a / b of independent positive ranges. The low side of `b` widens the high side of the result. */
export function divide(a: Range, b: Range): Range {
  if (b.low <= 0) throw new RangeError('divide() needs a strictly positive divisor range');
  const sa = sigmas(a);
  const sb = sigmas(b);
  return fromSigmas(
    a.central / b.central,
    Math.sqrt(sa.lo * sa.lo + sb.hi * sb.hi),
    Math.sqrt(sa.hi * sa.hi + sb.lo * sb.lo),
  );
}

/** Multiply by an exact scalar (unit conversion). */
export function scale(r: Range, k: number): Range {
  if (k < 0) throw new RangeError('scale() expects a non-negative factor');
  return { low: r.low * k, central: r.central * k, high: r.high * k };
}

/** Conservative sum: lows add, highs add. */
export function sum(...terms: readonly Range[]): Range {
  let low = 0;
  let central = 0;
  let high = 0;
  for (const t of terms) {
    low += t.low;
    central += t.central;
    high += t.high;
  }
  return { low, central, high };
}

/** 1 − r for a fraction range in [0, 1]; the sides swap. */
export function complement(r: Range): Range {
  if (r.low < 0 || r.high > 1) throw new RangeError('complement() expects a fraction in [0, 1]');
  return { low: 1 - r.high, central: 1 - r.central, high: 1 - r.low };
}

/** Widen a range multiplicatively by an extra log-σ on both sides (e.g. extrapolation drift). */
export function widen(r: Range, extraSigma: number): Range {
  if (extraSigma <= 0) return r;
  const s = sigmas(r);
  return fromSigmas(
    r.central,
    Math.sqrt(s.lo * s.lo + extraSigma * extraSigma),
    Math.sqrt(s.hi * s.hi + extraSigma * extraSigma),
  );
}

/** Symmetric multiplicative range: central ÷ factor … central × factor. */
export function spread(central: number, factor: number): Range {
  if (factor < 1) throw new RangeError('spread() factor must be >= 1');
  return { low: central / factor, central, high: central * factor };
}

export function isOrdered(r: Range): boolean {
  return r.low <= r.central && r.central <= r.high;
}
