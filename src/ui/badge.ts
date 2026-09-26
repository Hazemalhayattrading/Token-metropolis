import { COPY } from '../copy';
import type { Tier } from '../model/types';
import { h } from './dom';

/** A tier chip. Every number on screen carries one (brief §2.1). */
export function tierBadge(tier: Tier): HTMLSpanElement {
  return h('span', { class: `tier tier--${tier}`, title: COPY.tierHelp[tier] }, COPY.tiers[tier]);
}
