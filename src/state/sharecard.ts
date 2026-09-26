/**
 * What the share card says (brief §5.3 item 10: "a shareable image of the current view with key
 * numbers and the tier badges intact"). Pure: the same estimates, labels and tiers as the HUD
 * (the whole city) and the HQ panel (one HQ), at the date shown.
 */
import { COPY } from '../copy';
import {
  between,
  cumulative,
  cumulativeTier,
  dailyRate,
  globalBetween,
  globalDailyRate,
  globalTokensPerSecond,
  instantTier,
  rateTier,
  tokensPerSecond,
} from '../model/estimate';
import { atLeastDerived, weakest } from '../model/tier';
import { daysToIso, daysToMs, utcDayStart } from '../model/time';
import type { Range, Tier } from '../model/types';
import { humanNumber } from '../ui/format';
import type { City } from './city';

export interface CardStat {
  readonly label: string;
  readonly value: string;
  readonly range: string;
  readonly tier: Tier;
}

export interface CardText {
  readonly title: string;
  readonly subtitle: string;
  readonly stats: readonly CardStat[];
}

export interface CardView {
  /** Days since the epoch: the date shown. */
  readonly t: number;
  /** Real time now (days), which ends "today so far" in history mode. */
  readonly liveNow: number;
  /** The time machine is showing the past (labels change, as in the HUD and panel). */
  readonly history: boolean;
  /** The HQ whose panel is open, or null for the whole city. */
  readonly platformId: string | null;
  /** The interior shown with that HQ ('overview' when none). */
  readonly view?: 'overview' | 'offices' | 'hall' | 'power' | 'lab';
}

const hhmm = (t: number) => new Date(daysToMs(t)).toISOString().slice(11, 16);

function stat(label: string, r: Range, tier: Tier, unit = ''): CardStat {
  return {
    label,
    value: `${humanNumber(r.central)}${unit}`,
    range: COPY.panel.range(humanNumber(r.low), humanNumber(r.high)),
    tier,
  };
}

export function shareCardText(city: City, v: CardView): CardText {
  const { t, history } = v;
  const date = daysToIso(t);
  const dayStart = utcDayStart(t);
  // Live: since 00:00 UTC. History: the whole UTC day shown (up to now if that day is today).
  const end = history ? Math.min(dayStart + 1, v.liveNow) : t;
  const soFar = dayStart + 1 > v.liveNow;
  const subtitle = COPY.share.subtitle(date, hhmm(t), history);
  const perSecond = ` ${COPY.share.perSecond}`;
  const perDay = ` ${COPY.share.perDay}`;

  const pm = v.platformId ? city.byId.get(v.platformId) : undefined;
  if (!pm) {
    // The whole city, as in the HUD: sums are calculations (at best Estimated) and never better
    // than their weakest part.
    const iTier = atLeastDerived(weakest(...city.platforms.map((p) => instantTier(p, t))));
    const rTier = atLeastDerived(weakest(...city.platforms.map((p) => rateTier(p, t))));
    return {
      title: COPY.share.cityTitle(city.platforms.length),
      subtitle,
      stats: [
        stat(
          history ? COPY.time.todayLabelHistory(date) : COPY.hud.todayLabel,
          globalBetween(city.platforms, dayStart, end),
          iTier,
        ),
        stat(
          history ? COPY.time.rateLabelHistory : COPY.hud.rateLabel,
          globalTokensPerSecond(city.platforms, t),
          iTier,
          perSecond,
        ),
        stat(COPY.panel.perDay, globalDailyRate(city.platforms, t), rTier, perDay),
      ],
    };
  }

  const p = pm.platform;
  const where = v.view && v.view !== 'overview' ? ` · ${COPY.views[v.view]}` : '';
  const title = `${p.name}${where}`;
  const day = dailyRate(pm, t);
  if (!(day.central > 0)) {
    // Not launched at the date shown: no number, so no tier (as in the panel and the race).
    return { title, subtitle: `${subtitle} · ${COPY.time.notLaunched}`, stats: [] };
  }
  const iTier = instantTier(pm, t);
  return {
    title,
    subtitle,
    stats: [
      stat(
        history
          ? soFar
            ? COPY.time.panelDaySoFar(date)
            : COPY.time.panelDay(date)
          : COPY.panel.today,
        between(pm, dayStart, end),
        iTier,
      ),
      stat(
        history ? COPY.time.rateLabelHistory : COPY.panel.now,
        tokensPerSecond(pm, t),
        iTier,
        perSecond,
      ),
      stat(COPY.panel.perDay, day, rateTier(pm, t), perDay),
      stat(COPY.panel.sinceLaunch, cumulative(pm, t), cumulativeTier(pm, t)),
    ],
  };
}
