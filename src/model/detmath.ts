/**
 * Deterministic transcendental functions.
 *
 * ECMAScript only guarantees correctly rounded results for + − × ÷ and sqrt.
 * `Math.exp`, `Math.log`, `Math.sin` … are "implementation-approximated" and
 * can differ in the last bit between engines (V8, JavaScriptCore, SpiderMonkey).
 * The live counters must show the same number on every device at the same
 * moment, so everything on the counter path uses these functions, which are
 * built only from IEEE-754 basic arithmetic and exact bit manipulation.
 *
 * Accuracy: relative error below 1e-15 in the ranges we use (tested).
 */

const buf = new DataView(new ArrayBuffer(8));

/** Exact 2^k for integer k in [-1022, 1023], built from the exponent bits. */
function pow2i(k: number): number {
  buf.setUint32(0, (k + 1023) << 20);
  buf.setUint32(4, 0);
  return buf.getFloat64(0);
}

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;

/** Deterministic e^x. */
export function dexp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.78) return Infinity;
  if (x < -745.13) return 0;
  if (x === 0) return 1;
  // x = k·ln2 + r, |r| <= ln2/2 (Cody–Waite reduction)
  const k = Math.floor(x * INV_LN2 + 0.5);
  const r = x - k * LN2_HI - k * LN2_LO;
  // Taylor series of e^r to degree 17 (error < 1e-18 for |r| <= 0.347)
  let p = 1 / 355687428096000; // 1/17!
  p = p * r + 1 / 20922789888000;
  p = p * r + 1 / 1307674368000;
  p = p * r + 1 / 87178291200;
  p = p * r + 1 / 6227020800;
  p = p * r + 1 / 479001600;
  p = p * r + 1 / 39916800;
  p = p * r + 1 / 3628800;
  p = p * r + 1 / 362880;
  p = p * r + 1 / 40320;
  p = p * r + 1 / 5040;
  p = p * r + 1 / 720;
  p = p * r + 1 / 120;
  p = p * r + 1 / 24;
  p = p * r + 1 / 6;
  p = p * r + 0.5;
  p = p * r + 1;
  p = p * r + 1;
  // Split the scaling to stay inside the normal exponent range.
  if (k > 1023) return p * pow2i(1023) * pow2i(k - 1023);
  if (k < -1022) return p * pow2i(-1022) * pow2i(k + 1022);
  return p * pow2i(k);
}

/** Deterministic natural logarithm. */
export function dlog(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let scale = 0;
  if (x < 2.2250738585072014e-308) {
    // subnormal: lift into the normal range first
    x *= 18014398509481984; // 2^54
    scale = -54;
  }
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  let e = ((hi >>> 20) & 0x7ff) - 1023 + scale;
  // mantissa m in [1, 2)
  buf.setUint32(0, (hi & 0x000fffff) | 0x3ff00000);
  let m = buf.getFloat64(0);
  if (m > Math.SQRT2) {
    m *= 0.5;
    e += 1;
  }
  // log(m) = 2·atanh(s), s = (m−1)/(m+1), |s| <= 0.1716
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let p = 1 / 27;
  p = p * s2 + 1 / 25;
  p = p * s2 + 1 / 23;
  p = p * s2 + 1 / 21;
  p = p * s2 + 1 / 19;
  p = p * s2 + 1 / 17;
  p = p * s2 + 1 / 15;
  p = p * s2 + 1 / 13;
  p = p * s2 + 1 / 11;
  p = p * s2 + 1 / 9;
  p = p * s2 + 1 / 7;
  p = p * s2 + 1 / 5;
  p = p * s2 + 1 / 3;
  p = p * s2 + 1;
  const logm = 2 * s * p;
  return e * LN2_HI + (e * LN2_LO + logm);
}

/** Deterministic a^b for a > 0. */
export function dpow(a: number, b: number): number {
  if (b === 0) return 1;
  if (a === 1) return 1;
  return dexp(b * dlog(a));
}

const TWO_PI = 6.283185307179586;

function sinPoly(x: number): number {
  // |x| <= π/4, Taylor to x^19
  const x2 = x * x;
  let p = -1 / 121645100408832000; // -1/19!
  p = p * x2 + 1 / 355687428096000;
  p = p * x2 - 1 / 1307674368000;
  p = p * x2 + 1 / 6227020800;
  p = p * x2 - 1 / 39916800;
  p = p * x2 + 1 / 362880;
  p = p * x2 - 1 / 5040;
  p = p * x2 + 1 / 120;
  p = p * x2 - 1 / 6;
  p = p * x2 + 1;
  return x * p;
}

function cosPoly(x: number): number {
  // |x| <= π/4, Taylor to x^20
  const x2 = x * x;
  let p = 1 / 2432902008176640000; // 1/20!
  p = p * x2 - 1 / 6402373705728000;
  p = p * x2 + 1 / 20922789888000;
  p = p * x2 - 1 / 87178291200;
  p = p * x2 + 1 / 479001600;
  p = p * x2 - 1 / 3628800;
  p = p * x2 + 1 / 40320;
  p = p * x2 - 1 / 720;
  p = p * x2 + 1 / 24;
  p = p * x2 - 0.5;
  p = p * x2 + 1;
  return p;
}

/**
 * sin(2π·turns). Taking the angle in turns makes range reduction exact:
 * the fractional part of a double is computed without rounding error.
 */
export function sinTurns(turns: number): number {
  let f = turns - Math.floor(turns); // [0, 1)
  // reduce to octants
  const octant = Math.floor(f * 8);
  f -= octant / 8; // [0, 1/8)
  const a = f * TWO_PI; // [0, π/4)
  switch (octant) {
    case 0:
      return sinPoly(a);
    case 1:
      return cosPoly(Math.PI / 4 - a);
    case 2:
      return cosPoly(a);
    case 3:
      return sinPoly(Math.PI / 4 - a);
    case 4:
      return -sinPoly(a);
    case 5:
      return -cosPoly(Math.PI / 4 - a);
    case 6:
      return -cosPoly(a);
    default:
      return -sinPoly(Math.PI / 4 - a);
  }
}

/** cos(2π·turns). */
export function cosTurns(turns: number): number {
  return sinTurns(turns + 0.25);
}
