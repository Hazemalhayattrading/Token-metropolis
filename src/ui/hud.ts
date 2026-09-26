/**
 * Heads-up display: the global live counters. Numbers are recomputed from the
 * clock every frame (never accumulated), so they are correct after the tab
 * sleeps and identical on every device at the same moment.
 */
import { COPY } from '../copy';
import type { LoadedData } from '../data/load';
import {
  globalBetween,
  globalDailyRate,
  globalTokensPerSecond,
  instantTier,
} from '../model/estimate';
import { weakest } from '../model/tier';
import { daysToIso, utcDayStart } from '../model/time';
import type { City } from '../state/city';
import type { Clock } from '../state/clock';
import { tierBadge } from './badge';
import { byId, h } from './dom';
import { fullNumber, humanNumber, timeAgo } from './format';

export interface Hud {
  update(): void;
}

/**
 * @param clock    the time shown (live, or the time machine's date)
 * @param live     real time — "since you arrived" always counts the visitor's own session
 * @param history  whether the time machine is showing the past (labels change)
 */
export function mountHud(
  city: City,
  data: LoadedData,
  clock: Clock,
  arrivedAt: number,
  live: Clock = clock,
  history: () => boolean = () => false,
): Hud {
  const root = byId('hud');
  // Today-so-far and per-second figures depend on the time-of-day curve (see instantTier).
  const tier = weakest(...city.platforms.map((pm) => instantTier(pm, clock.now())));

  const today = h('output', { class: 'counter__value', 'aria-live': 'off' });
  const todayLabel = h('span', {}, COPY.hud.todayLabel);
  const qualifier = h('p', { class: 'counter__qualifier' }, COPY.hud.todayQualifier);
  const rateLabel = h('p', { class: 'stat__label' }, COPY.hud.rateLabel);
  const range = h('p', { class: 'counter__range' });
  const arrived = h('output', { class: 'stat__value' });
  const rate = h('output', { class: 'stat__value' });
  const updated = h('p', { class: 'hud__updated' });

  root.replaceChildren(
    h(
      'section',
      { class: 'counter panel', 'aria-label': COPY.hud.todayLabel },
      h('p', { class: 'counter__label' }, todayLabel, ' ', tierBadge(tier)),
      today,
      qualifier,
      range,
      h(
        'div',
        { class: 'stats' },
        h(
          'div',
          { class: 'stat' },
          h('p', { class: 'stat__label' }, COPY.hud.arrivedLabel),
          arrived,
        ),
        h(
          'div',
          { class: 'stat' },
          rateLabel,
          rate,
          h('span', { class: 'stat__unit' }, COPY.hud.perSecond),
        ),
      ),
    ),
    h(
      'nav',
      { class: 'hud__links', 'aria-label': 'Site' },
      h('a', { href: '#data-view' }, COPY.hud.dataLink),
      h(
        'a',
        {
          href: 'https://github.com/Hazemalhayattrading/Token-metropolis/blob/main/METHODOLOGY.md',
          rel: 'noopener',
        },
        COPY.hud.methodLink,
      ),
    ),
    updated,
  );
  if (data.origin === 'cache')
    root.append(h('p', { class: 'notice', role: 'status' }, COPY.hud.offline));

  let lastSlow = 0;
  let lastFast = 0;
  let lastDay = '';
  let wasHistory = false;
  const update = () => {
    const nowMs = performance.now();
    if (nowMs - lastFast < 50) return; // ~20 text updates per second is plenty
    lastFast = nowMs;
    const t = clock.now();
    const past = history();
    const dayIso = daysToIso(t);
    if (past !== wasHistory || (past && dayIso !== lastDay)) {
      wasHistory = past;
      lastDay = dayIso;
      lastSlow = 0;
      root.classList.toggle('hud--history', past);
      todayLabel.textContent = past ? COPY.time.todayLabelHistory(dayIso) : COPY.hud.todayLabel;
      qualifier.textContent = past ? COPY.time.todayQualifierHistory : COPY.hud.todayQualifier;
      rateLabel.textContent = past ? COPY.time.rateLabelHistory : COPY.hud.rateLabel;
    }
    const liveNow = live.now();
    // Live: since 00:00 UTC. History: the whole UTC day shown (up to now if that day is today),
    // so scrubbing day by day reads as daily totals rather than midnight zeros.
    const dayStart = utcDayStart(t);
    const end = past ? Math.min(dayStart + 1, liveNow) : t;
    today.textContent = fullNumber(globalBetween(city.platforms, dayStart, end).central);
    arrived.textContent = fullNumber(globalBetween(city.platforms, arrivedAt, liveNow).central);
    rate.textContent = humanNumber(globalTokensPerSecond(city.platforms, t).central, 'long');
    const now = Date.now();
    if (now - lastSlow > 5000) {
      lastSlow = now;
      const day = globalDailyRate(city.platforms, t);
      range.textContent = `${COPY.hud.range(humanNumber(day.low), humanNumber(day.high))} tokens per day`;
      updated.textContent = COPY.hud.updated(timeAgo(Date.parse(data.meta.lastUpdated), now));
    }
  };
  update();
  return { update };
}
