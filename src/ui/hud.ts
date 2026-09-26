/**
 * Heads-up display: the global live counters. Numbers are recomputed from the
 * clock every frame (never accumulated), so they are correct after the tab
 * sleeps and identical on every device at the same moment.
 */
import { COPY } from '../copy';
import type { LoadedData } from '../data/load';
import { globalBetween, globalDailyRate, globalTokensPerSecond, rateTier } from '../model/estimate';
import { weakest } from '../model/tier';
import { utcDayStart } from '../model/time';
import type { City } from '../state/city';
import type { Clock } from '../state/clock';
import { tierBadge } from './badge';
import { byId, h } from './dom';
import { fullNumber, humanNumber, timeAgo } from './format';

export interface Hud {
  update(): void;
}

export function mountHud(city: City, data: LoadedData, clock: Clock, arrivedAt: number): Hud {
  const root = byId('hud');
  const tier = weakest(...city.platforms.map((pm) => rateTier(pm, clock.now())));

  const today = h('output', { class: 'counter__value', 'aria-live': 'off' });
  const range = h('p', { class: 'counter__range' });
  const arrived = h('output', { class: 'stat__value' });
  const rate = h('output', { class: 'stat__value' });
  const updated = h('p', { class: 'hud__updated' });

  root.replaceChildren(
    h(
      'section',
      { class: 'counter panel', 'aria-label': COPY.hud.todayLabel },
      h('p', { class: 'counter__label' }, COPY.hud.todayLabel, ' ', tierBadge(tier)),
      today,
      h('p', { class: 'counter__qualifier' }, COPY.hud.todayQualifier),
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
          h('p', { class: 'stat__label' }, COPY.hud.rateLabel),
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
  const update = () => {
    const nowMs = performance.now();
    if (nowMs - lastFast < 50) return; // ~20 text updates per second is plenty
    lastFast = nowMs;
    const t = clock.now();
    const sinceMidnight = globalBetween(city.platforms, utcDayStart(t), t);
    today.textContent = fullNumber(sinceMidnight.central);
    arrived.textContent = fullNumber(globalBetween(city.platforms, arrivedAt, t).central);
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
