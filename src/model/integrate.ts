/**
 * Exact integral of (growth curve × traffic shape).
 *
 * On each piece the rate is r0·e^{k(s−t0)} and the shape is
 * 1 + Σ amp_j·cos(2π(f_j·s + φ_j)). Both integrals have closed forms:
 *
 *   ∫ e^{k u} ds                         = (e^{kΔ} − 1)/k
 *   ∫ e^{k u}·cos(ωs + θ₀) ds            = e^{k u}(k·cos θ + ω·sin θ)/(k² + ω²)
 *
 * so the live counter is the true integral of the displayed tokens/second:
 * strictly increasing, identical on every device (deterministic math), and
 * never drifting from the rate shown next to it.
 */
import { cosTurns, dexp, sinTurns } from './detmath';
import { expIntegral, findPieceIndex, type Curve, type Piece } from './growth';
import type { ShapeTerm } from './traffic';
import type { Range } from './types';

const TWO_PI = 2 * Math.PI;

type Side = 'low' | 'central' | 'high';
const SIDES: readonly Side[] = ['low', 'central', 'high'];

/** ∫_{p.t0}^{t} r(s)·shape(s) ds on a single piece. */
function pieceShapedIntegral(p: Piece, terms: readonly ShapeTerm[], t: number): number {
  const delta = t - p.t0;
  if (delta <= 0) return 0;
  let v = expIntegral(p.r0, p.k, delta);
  const growth = dexp(p.k * delta);
  for (const term of terms) {
    const w = TWO_PI * term.f;
    const denom = p.k * p.k + w * w;
    const a1 = term.f * t + term.phi;
    const a0 = term.f * p.t0 + term.phi;
    const end = growth * (p.k * cosTurns(a1) + w * sinTurns(a1));
    const begin = p.k * cosTurns(a0) + w * sinTurns(a0);
    v += (term.amp * p.r0 * (end - begin)) / denom;
  }
  return v;
}

export interface ShapedCurve {
  readonly curve: Curve;
  readonly terms: readonly ShapeTerm[];
  /** Cumulative integral at the start of each piece, per side. */
  readonly offsets: Readonly<Record<Side, Float64Array>>;
}

export function buildShapedCurve(curve: Curve, terms: readonly ShapeTerm[]): ShapedCurve {
  const offsets = {} as Record<Side, Float64Array>;
  for (const side of SIDES) {
    const pieces = curve.pieces[side];
    const arr = new Float64Array(pieces.length);
    let cum = 0;
    for (let i = 0; i < pieces.length; i++) {
      arr[i] = cum;
      const p = pieces[i]!;
      if (Number.isFinite(p.t1)) cum += pieceShapedIntegral(p, terms, p.t1);
    }
    offsets[side] = arr;
  }
  return { curve, terms, offsets };
}

/** Tokens processed from the curve start up to t, following the traffic shape. */
export function shapedCumulativeAt(sc: ShapedCurve, t: number): Range {
  if (t <= sc.curve.start) return { low: 0, central: 0, high: 0 };
  const out = { low: 0, central: 0, high: 0 };
  for (const side of SIDES) {
    const pieces = sc.curve.pieces[side];
    const i = findPieceIndex(pieces, t);
    out[side] = sc.offsets[side][i]! + pieceShapedIntegral(pieces[i]!, sc.terms, t);
  }
  return out;
}
