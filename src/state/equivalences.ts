/**
 * "Since you arrived", in other words (brief §5.3 item 5): the tokens processed
 * during the visit expressed as words, electricity and cooling water. Each
 * equivalence carries its range and tier and is shown only when every
 * constant behind it has been checked (isDisplayable).
 */
import { COMPUTE, EQUIV, isDisplayable } from '../model/constants';
import { joulesPerToken } from '../model/derived';
import { divide, fromConstant, multiply, scale } from '../model/range';
import { tierOfBasis, weakest } from '../model/tier';
import type { Range, Tier } from '../model/types';

export type EquivalenceId = 'words' | 'energy' | 'water';

export interface Equivalence {
  readonly id: EquivalenceId;
  readonly value: Range;
  readonly tier: Tier;
  readonly refs: readonly string[];
}

const J_PER_KWH = 3.6e6;
const ENERGY_REFS = [
  'COMPUTE.throughputTokensPerSecPerGpu',
  'COMPUTE.kwPerGpu',
  'COMPUTE.pue',
] as const;

/** Equivalences of `tokens` (a range with its tier), displayable ones only, in display order. */
export function arrivalEquivalences(tokens: Range, tier: Tier): Equivalence[] {
  if (!(tokens.central > 0) || !(tokens.low > 0)) return [];
  const kwh = scale(multiply(tokens, joulesPerToken()), 1 / J_PER_KWH);
  const all: Equivalence[] = [
    {
      id: 'words',
      value: divide(tokens, fromConstant(EQUIV.tokensPerWord)),
      tier: weakest(tier, tierOfBasis(EQUIV.tokensPerWord.basis)),
      refs: ['EQUIV.tokensPerWord'],
    },
    { id: 'energy', value: kwh, tier: weakest(tier, 'modeled'), refs: [...ENERGY_REFS] },
    {
      id: 'water',
      value: multiply(kwh, fromConstant(COMPUTE.wueLitersPerKwh)),
      tier: weakest(tier, 'modeled'),
      refs: [...ENERGY_REFS, 'COMPUTE.wueLitersPerKwh'],
    },
  ];
  return all.filter((e) => isDisplayable(e.refs));
}
