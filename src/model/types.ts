/**
 * Data tiers — see METHODOLOGY.md §2.
 * - reported: published by the company or a primary source.
 * - derived:  calculated from reported or published inputs ("Estimated" in the UI).
 * - modeled:  relies on at least one assumption with no public data.
 */
export type Tier = 'reported' | 'derived' | 'modeled';

/** A quantity with an uncertainty band. Invariant: 0 <= low <= central <= high. */
export interface Range {
  readonly low: number;
  readonly central: number;
  readonly high: number;
}

/**
 * How trustworthy a numeric input is:
 * - exact:      a definition or unit conversion (never weakens a tier)
 * - published:  a sourced figure or benchmark (weakens reported → derived)
 * - assumption: our judgement call (weakens anything → modeled)
 */
export type Basis = 'exact' | 'published' | 'assumption';

export interface SourceRef {
  readonly title: string;
  readonly url: string;
}

/**
 * How a constant's figure was checked during research:
 * - page:    read on the source page itself
 * - snippet: seen only in a search-result summary of the source (weaker)
 * - judgement: our own assumption; nothing external to check, the note explains it
 * - pending: not yet checked against the source (value from reference
 *            knowledge). Pending constants must not reach the UI — see
 *            `isDisplayable` in constants.ts and TASKS.md.
 */
export type Verification = 'page' | 'snippet' | 'judgement' | 'pending';

/** A model constant. Every assumption in the project lives in constants.ts as one of these. */
export interface Constant {
  readonly value: number;
  readonly low: number;
  readonly high: number;
  readonly unit: string;
  readonly basis: Basis;
  readonly source: readonly SourceRef[];
  /** ISO date the sources were accessed, or null if not yet checked. */
  readonly accessed: string | null;
  readonly verified: Verification;
  readonly note: string;
}

/** A value produced by the model, carrying everything the UI needs to be honest about it. */
export interface Estimate {
  readonly range: Range;
  readonly tier: Tier;
  /** Plain-language formula, e.g. "2.5B prompts/day × 2,000 tokens/prompt". */
  readonly formula: string;
  /** Ids of the metrics (data/manual/metrics.yaml) and constants (constants.ts) that fed this value. */
  readonly refs: readonly string[];
}
