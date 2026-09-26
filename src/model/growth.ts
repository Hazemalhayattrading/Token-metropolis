/**
 * Growth curves: daily token rate over time, anchored on data points.
 *
 * The curve is piecewise exponential ("log-linear"):
 *   - launch → first anchor: exponential ramp from a small seed (modeled);
 *   - between anchors: exponential interpolation (constant growth rate);
 *   - after the last anchor: extrapolation at the recent fitted growth rate,
 *     damped month by month so no curve explodes, with an uncertainty band
 *     that widens the longer we extrapolate.
 *
 * Each of low / central / high is its own piecewise-exponential curve, so the
 * integral (cumulative tokens) has an exact closed form per segment and a
 * prefix sum makes any lookup O(log n). All arithmetic on this path is
 * deterministic (see detmath.ts).
 */
import { dexp, dlog } from './detmath';
import { Z90 } from './range';
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from './time';
import type { Range, Tier } from './types';
import { weakest } from './tier';

export interface Anchor {
  /** Days since epoch (UTC). */
  readonly t: number;
  /** Tokens per day at t. */
  readonly rate: Range;
  readonly tier: Tier;
  readonly label: string;
  readonly formula: string;
  /** Metric ids / constant keys behind this anchor. */
  readonly refs: readonly string[];
}

export interface GrowthParams {
  /** Seed rate at launch as a fraction of the first anchor (modeled). */
  readonly seedFraction: Range;
  /** Default growth if only one anchor exists, as ln(multiplier) per year. */
  readonly defaultLogGrowthPerYear: number;
  /** Uncertainty of the growth rate, as log-σ per year of extrapolation. */
  readonly growthSigmaPerYear: number;
  /** Clamp for fitted growth, ln(multiplier) per year. */
  readonly minLogGrowthPerYear: number;
  readonly maxLogGrowthPerYear: number;
  /** Growth rate decays with this e-folding time (days) when extrapolating. */
  readonly dampingDays: number;
  /** How far past the last anchor (days) the damped monthly segments extend. */
  readonly horizonDays: number;
}

/** One exponential piece of a scalar curve: r(t) = r0·e^{k(t − t0)} on [t0, t1). */
export interface Piece {
  readonly t0: number;
  readonly t1: number;
  readonly r0: number;
  readonly k: number;
  /** ∫ from curve start to t0. */
  readonly cum0: number;
}

export type SegmentKind = 'seed' | 'interpolated' | 'extrapolated';

export interface Segment {
  readonly t0: number;
  readonly t1: number;
  readonly kind: SegmentKind;
  readonly tier: Tier;
}

export interface Curve {
  readonly start: number;
  readonly anchors: readonly Anchor[];
  readonly segments: readonly Segment[];
  readonly growthTier: Tier;
  /** Fitted (or default) growth used for extrapolation, ln(multiplier)/year. */
  readonly logGrowthPerYear: number;
  readonly pieces: { readonly low: Piece[]; readonly central: Piece[]; readonly high: Piece[] };
}

/** ∫_0^Δ r0·e^{k s} ds, stable for k → 0. */
export function expIntegral(r0: number, k: number, delta: number): number {
  const x = k * delta;
  if (Math.abs(x) < 1e-6) {
    // series: Δ(1 + x/2 + x²/6)
    return r0 * delta * (1 + x / 2 + (x * x) / 6);
  }
  return (r0 * (dexp(x) - 1)) / k;
}

function buildPieces(
  nodes: readonly { t: number; r: number }[],
  tail: { k: number } | null,
): Piece[] {
  const pieces: Piece[] = [];
  let cum = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i]!;
    const b = nodes[i + 1]!;
    const dt = b.t - a.t;
    const k = dt > 0 && a.r > 0 && b.r > 0 ? dlog(b.r / a.r) / dt : 0;
    pieces.push({ t0: a.t, t1: b.t, r0: a.r, k, cum0: cum });
    cum += expIntegral(a.r, k, dt);
  }
  const last = nodes[nodes.length - 1]!;
  pieces.push({ t0: last.t, t1: Infinity, r0: last.r, k: tail ? tail.k : 0, cum0: cum });
  return pieces;
}

/** Index of the piece containing t (the first piece for t before the curve start). */
export function findPieceIndex(pieces: readonly Piece[], t: number): number {
  let lo = 0;
  let hi = pieces.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pieces[mid]!.t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function findPiece(pieces: readonly Piece[], t: number): Piece {
  return pieces[findPieceIndex(pieces, t)]!;
}

export function pieceRate(p: Piece, t: number): number {
  return p.r0 * dexp(p.k * (t - p.t0));
}

function pieceCum(p: Piece, t: number): number {
  return p.cum0 + expIntegral(p.r0, p.k, t - p.t0);
}

/**
 * Fit ln-growth/year for extrapolation: from the most recent anchor that is at
 * least 60 days older than the last one (so recent slow-downs or speed-ups
 * show), falling back to the previous anchor.
 */
function fitGrowth(anchors: readonly Anchor[], params: GrowthParams): { g: number; tier: Tier } {
  if (anchors.length < 2) return { g: params.defaultLogGrowthPerYear, tier: 'modeled' };
  const last = anchors[anchors.length - 1]!;
  let base: Anchor | undefined;
  for (let i = anchors.length - 2; i >= 0; i--) {
    if (last.t - anchors[i]!.t >= 60) {
      base = anchors[i];
      break;
    }
  }
  base ??= anchors[anchors.length - 2]!;
  const gap = last.t - base.t;
  if (gap <= 0) return { g: params.defaultLogGrowthPerYear, tier: 'modeled' };
  let g = (dlog(last.rate.central / base.rate.central) / gap) * DAYS_PER_YEAR;
  g = Math.min(params.maxLogGrowthPerYear, Math.max(params.minLogGrowthPerYear, g));
  return { g, tier: weakest(last.tier, base.tier, 'derived') };
}

/**
 * Merge anchors that fall within `mergeDays` of each other: the stronger tier
 * wins; equal tiers are combined by geometric mean.
 */
export function mergeAnchors(anchors: readonly Anchor[], mergeDays = 7): Anchor[] {
  const sorted = [...anchors].sort((a, b) => a.t - b.t);
  const out: Anchor[] = [];
  const rank: Record<Tier, number> = { reported: 0, derived: 1, modeled: 2 };
  for (const a of sorted) {
    const prev = out[out.length - 1];
    if (prev && a.t - prev.t < mergeDays) {
      if (rank[a.tier] < rank[prev.tier]) out[out.length - 1] = a;
      else if (rank[a.tier] === rank[prev.tier]) {
        const gm = (x: number, y: number) => Math.sqrt(x * y);
        out[out.length - 1] = {
          t: (prev.t + a.t) / 2,
          rate: {
            low: gm(prev.rate.low, a.rate.low),
            central: gm(prev.rate.central, a.rate.central),
            high: gm(prev.rate.high, a.rate.high),
          },
          tier: prev.tier,
          label: `${prev.label}; ${a.label}`,
          formula: `geometric mean of (${prev.formula}) and (${a.formula})`,
          refs: [...new Set([...prev.refs, ...a.refs])],
        };
      }
      continue;
    }
    out.push(a);
  }
  return out;
}

/** Build a growth curve from a launch date and anchors. */
export function buildCurve(
  start: number,
  rawAnchors: readonly Anchor[],
  params: GrowthParams,
): Curve {
  const anchors = mergeAnchors(rawAnchors.filter((a) => a.t >= start));
  if (anchors.length === 0)
    throw new RangeError('buildCurve() needs at least one anchor on/after start');
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  const { g, tier: growthTier } = fitGrowth(anchors, params);

  type Side = 'low' | 'central' | 'high';
  const sides: Side[] = ['low', 'central', 'high'];
  const nodes: Record<Side, { t: number; r: number }[]> = { low: [], central: [], high: [] };
  const segments: Segment[] = [];

  // 1. Seed segment (launch → first anchor)
  if (first.t > start) {
    const seed = params.seedFraction;
    // Wider at launch: the seed's own uncertainty is applied on top of the anchor's.
    nodes.low.push({ t: start, r: first.rate.low * seed.low });
    nodes.central.push({ t: start, r: first.rate.central * seed.central });
    nodes.high.push({ t: start, r: first.rate.high * seed.high });
    segments.push({ t0: start, t1: first.t, kind: 'seed', tier: 'modeled' });
  }

  // 2. Anchors (interpolated between)
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]!;
    for (const s of sides) nodes[s].push({ t: a.t, r: a.rate[s] });
    if (i > 0) {
      const p = anchors[i - 1]!;
      segments.push({
        t0: p.t,
        t1: a.t,
        kind: 'interpolated',
        tier: weakest(p.tier, a.tier, 'derived'),
      });
    }
  }

  // 3. Extrapolation: monthly steps with geometrically damped growth and widening band.
  const gPerDay = g / DAYS_PER_YEAR;
  const sigmaPerDay = params.growthSigmaPerYear / DAYS_PER_YEAR;
  const steps = Math.ceil(params.horizonDays / DAYS_PER_MONTH);
  for (let i = 1; i <= steps; i++) {
    const dt = i * DAYS_PER_MONTH;
    // Effective elapsed time under exponential damping of the growth rate.
    const eff = params.dampingDays * (1 - dexp(-dt / params.dampingDays));
    const logC = gPerDay * eff; // accumulated ln growth of the central curve since the last anchor
    const extra = Z90 * sigmaPerDay * eff;
    const t = last.t + dt;
    nodes.central.push({ t, r: last.rate.central * dexp(logC) });
    nodes.low.push({ t, r: last.rate.low * dexp(logC - extra) });
    nodes.high.push({ t, r: last.rate.high * dexp(logC + extra) });
  }
  const extrapTier = weakest(growthTier, last.tier, 'derived');
  segments.push({ t0: last.t, t1: Infinity, kind: 'extrapolated', tier: extrapTier });

  // Beyond the horizon: keep the last monthly growth rate of each side.
  const tailK = (side: Side): { k: number } => {
    const n = nodes[side];
    const a = n[n.length - 2]!;
    const b = n[n.length - 1]!;
    return { k: dlog(b.r / a.r) / (b.t - a.t) };
  };

  return {
    start,
    anchors,
    segments,
    growthTier,
    logGrowthPerYear: g,
    pieces: {
      low: buildPieces(nodes.low, tailK('low')),
      central: buildPieces(nodes.central, tailK('central')),
      high: buildPieces(nodes.high, tailK('high')),
    },
  };
}

/** Daily token rate (tokens/day) at time t. Zero before launch. */
export function rateAt(c: Curve, t: number): Range {
  if (t < c.start) return { low: 0, central: 0, high: 0 };
  return {
    low: pieceRate(findPiece(c.pieces.low, t), t),
    central: pieceRate(findPiece(c.pieces.central, t), t),
    high: pieceRate(findPiece(c.pieces.high, t), t),
  };
}

/** Smooth-rate integral from launch to t (tokens), without the diurnal term. */
export function integralAt(c: Curve, t: number): Range {
  if (t <= c.start) return { low: 0, central: 0, high: 0 };
  return {
    low: pieceCum(findPiece(c.pieces.low, t), t),
    central: pieceCum(findPiece(c.pieces.central, t), t),
    high: pieceCum(findPiece(c.pieces.high, t), t),
  };
}

/** Instantaneous growth rate k (per day) of the central curve at t. */
export function logSlopeAt(c: Curve, t: number): number {
  if (t < c.start) return 0;
  return findPiece(c.pieces.central, t).k;
}

export function segmentAt(c: Curve, t: number): Segment | undefined {
  return c.segments.find((s) => t >= s.t0 && t < s.t1);
}

/**
 * Tier of the rate at time t. A value is "reported" only within `freshDays`
 * of a reported anchor; otherwise it inherits the segment's tier.
 */
export function rateTierAt(c: Curve, t: number, freshDays: number): Tier {
  if (t < c.start) return 'reported';
  for (const a of c.anchors)
    if (a.tier === 'reported' && Math.abs(t - a.t) <= freshDays) return 'reported';
  return segmentAt(c, t)?.tier ?? 'modeled';
}

/**
 * Tier of the cumulative total at time t: never better than "derived"
 * (it's an integral of a fitted curve), and "modeled" if segments that are
 * modeled contribute at least `modeledShareThreshold` of the total.
 */
export function cumulativeTierAt(c: Curve, t: number, modeledShareThreshold = 0.05): Tier {
  const total = integralAt(c, t).central;
  if (total <= 0) return 'derived';
  let modeled = 0;
  let tier: Tier = 'derived';
  for (const s of c.segments) {
    if (s.t0 >= t) break;
    const t1 = Math.min(s.t1, t);
    const share = integralAt(c, t1).central - integralAt(c, s.t0).central;
    if (s.tier === 'modeled') modeled += share;
    else tier = weakest(tier, s.tier);
  }
  return modeled / total >= modeledShareThreshold ? 'modeled' : tier;
}

/** Log-σ implied by a daily-rate extrapolation of `days`, for display ("range widens by …"). */
export function extrapolationSigma(params: GrowthParams, days: number): number {
  const eff = params.dampingDays * (1 - dexp(-days / params.dampingDays));
  return (params.growthSigmaPerYear / DAYS_PER_YEAR) * eff;
}
