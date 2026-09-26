/**
 * Fun-but-honest equivalences: "tokens today = N× every book in the Library
 * of Congress". Each one is built from cited constants and carries a range.
 */
import { EQUIV, isDisplayable } from './constants';
import { divide, fromConstant, multiply, scale } from './range';
import { DAYS_PER_YEAR } from './time';
import type { Range } from './types';

export interface EquivalenceDef {
  readonly id: string;
  /** Tokens contained in one unit of the thing. */
  readonly tokensPerUnit: () => Range;
  /** "{n} × every book in the Library of Congress" — {n} is replaced by the count. */
  readonly template: string;
  readonly refs: readonly string[];
}

const tpw = () => fromConstant(EQUIV.tokensPerWord);

export const EQUIVALENCES: readonly EquivalenceDef[] = [
  {
    id: 'library-of-congress',
    tokensPerUnit: () =>
      multiply(fromConstant(EQUIV.locBooks), fromConstant(EQUIV.wordsPerBook), tpw()),
    template: '{n} × every book in the Library of Congress',
    refs: ['EQUIV.locBooks', 'EQUIV.wordsPerBook', 'EQUIV.tokensPerWord'],
  },
  {
    id: 'wikipedia',
    tokensPerUnit: () => multiply(fromConstant(EQUIV.enWikipediaWords), tpw()),
    template: '{n} × all of English Wikipedia',
    refs: ['EQUIV.enWikipediaWords', 'EQUIV.tokensPerWord'],
  },
  {
    id: 'lifetime-speech',
    tokensPerUnit: () =>
      multiply(
        scale(fromConstant(EQUIV.wordsSpokenPerDay), DAYS_PER_YEAR),
        fromConstant(EQUIV.lifeExpectancyYears),
        tpw(),
      ),
    template: '{n} × every word a person speaks in a lifetime',
    refs: ['EQUIV.wordsSpokenPerDay', 'EQUIV.lifeExpectancyYears', 'EQUIV.tokensPerWord'],
  },
];

export interface Equivalent {
  readonly id: string;
  readonly count: Range;
  readonly template: string;
  readonly refs: readonly string[];
  /** False while any constant behind it is pending verification — the UI must not show it. */
  readonly displayable: boolean;
}

/** How many units of each equivalence `tokens` amounts to. */
export function equivalents(tokens: Range): Equivalent[] {
  return EQUIVALENCES.map((e) => ({
    id: e.id,
    count: divide(tokens, e.tokensPerUnit()),
    template: e.template,
    refs: e.refs,
    displayable: isDisplayable(e.refs),
  }));
}
