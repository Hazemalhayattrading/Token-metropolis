import type { Basis, Tier } from './types';

const RANK: Record<Tier, number> = { reported: 0, derived: 1, modeled: 2 };

/** The weakest of the given tiers ("a chain is as strong as its weakest link"). */
export function weakest(...tiers: readonly Tier[]): Tier {
  let worst: Tier = 'reported';
  for (const t of tiers) if (RANK[t] > RANK[worst]) worst = t;
  return worst;
}

/** The tier an input of a given basis caps a calculation at. */
export function tierOfBasis(basis: Basis): Tier {
  switch (basis) {
    case 'exact':
      return 'reported';
    case 'published':
      return 'derived';
    case 'assumption':
      return 'modeled';
  }
}

/** Calculations can never be more trustworthy than "derived", even from reported inputs, unless they are pure unit conversions. */
export function atLeastDerived(t: Tier): Tier {
  return weakest(t, 'derived');
}

export const TIER_LABEL: Record<Tier, string> = {
  reported: 'Reported',
  derived: 'Estimated',
  modeled: 'Modeled',
};
