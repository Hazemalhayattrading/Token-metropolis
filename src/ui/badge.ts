import { COPY } from '../copy';
import type { Tier } from '../model/types';
import { h } from './dom';

/** A tier chip. Every number on screen carries one (brief §2.1). */
export function tierBadge(tier: Tier): HTMLSpanElement {
  return h('span', { class: `tier tier--${tier}`, title: COPY.tierHelp[tier] }, COPY.tiers[tier]);
}

/** Shown instead of a tier where a published fact has not yet been checked against its source. */
export function uncheckedBadge(): HTMLSpanElement {
  return h('span', { class: 'tier tier--unchecked', title: COPY.uncheckedHelp }, COPY.unchecked);
}
