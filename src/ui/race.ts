/**
 * Race mode (brief §5.3 item 3): a bar-chart race of every platform's daily
 * tokens, read from the same clock as the rest of the city, so it replays
 * with the time machine.
 *
 * One linear axis (the leader fills the track), the central value as the bar,
 * the plausible range as a thin whisker under it, the value to the right and
 * the tier chip on every row. The DOM order is always the rank order (an <ol>),
 * so screen readers read the ranking correctly; rank changes animate with FLIP
 * (a translateY from the old position), and never in reduced-motion mode.
 */
import { COPY } from '../copy';
import { daysToIso } from '../model/time';
import type { City } from '../state/city';
import type { Clock } from '../state/clock';
import { barFraction, raceRows, raceScale, whiskerSpan, type RaceRow } from '../state/race';
import { tierBadge } from './badge';
import { h } from './dom';
import { humanNumber } from './format';
import { METHODOLOGY_URL } from './links';

export interface Race {
  readonly open: boolean;
  show(): void;
  hide(): void;
  update(): void;
  dispose(): void;
}

/** ~8 recomputes per second; the bars ease between them. */
const RECOMPUTE_MS = 125;
const FLIP_MS = 450;
const FLIP_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

interface RowView {
  readonly li: HTMLLIElement;
  readonly rank: HTMLElement;
  readonly track: HTMLElement;
  readonly bar: HTMLElement;
  readonly whisker: HTMLElement;
  readonly num: HTMLElement;
  readonly unit: HTMLElement;
  readonly spoken: HTMLElement;
  readonly badge: HTMLElement;
  /** Last written values: the DOM is only touched when one changes. */
  readonly last: Record<string, string>;
  anim: Animation | null;
}

let uid = 0;

const pct = (f: number) => `${(f * 100).toFixed(2)}%`;

function makeRow(
  id: string,
  name: string,
  accent: string,
  onSelect: ((id: string) => void) | undefined,
): RowView {
  const rank = h('span', { class: 'race__rank' });
  const bar = h('span', { class: 'race__bar' });
  const whisker = h('span', { class: 'race__whisker' });
  const track = h('span', { class: 'race__track', 'aria-hidden': 'true' }, bar, whisker);
  const num = h('span', { class: 'race__num' });
  const unit = h('span', { class: 'race__unit' });
  const spoken = h('span', { class: 'race-sr' });
  const badge = h('span', { class: 'race__badge' });
  const li = h(
    'li',
    { class: 'race__row', 'data-id': id },
    rank,
    // The name opens the HQ panel, where every figure has its range, formula and source.
    onSelect
      ? h('button', { class: 'race__name race__name--link', type: 'button' }, name)
      : h('span', { class: 'race__name' }, name),
    // Visible short value ("1.2T tokens/day"); screen readers get the spelled-out value + range.
    h('span', { class: 'race__value', 'aria-hidden': 'true' }, num, unit),
    spoken,
    badge,
    track,
  );
  li.style.setProperty('--race-accent', accent);
  li.querySelector('button.race__name')?.addEventListener('click', () => onSelect?.(id));
  return { li, rank, track, bar, whisker, num, unit, spoken, badge, last: {}, anim: null };
}

/** Write `value` through `write` only if it differs from the last value written under `key`. */
function put(v: RowView, key: string, value: string, write: (s: string) => void): void {
  if (v.last[key] === value) return;
  v.last[key] = value;
  write(value);
}

function paint(v: RowView, r: RaceRow, rank: number, scale: number): void {
  const on = r.launched;
  put(v, 'launched', String(on), () => {
    v.li.classList.toggle('race__row--waiting', !on);
    // aria-hidden needs an explicit "true" (an empty value means "not hidden").
    if (on) v.rank.removeAttribute('aria-hidden');
    else v.rank.setAttribute('aria-hidden', 'true');
    v.unit.textContent = on ? ` ${COPY.race.perDay}` : '';
  });
  put(v, 'rank', on ? COPY.race.rank(rank) : '–', (s) => (v.rank.textContent = s));
  put(v, 'bar', on ? pct(barFraction(r.central, scale)) : '0%', (s) => (v.bar.style.width = s));

  const w = on ? whiskerSpan(r, scale) : { left: 0, width: 0, clipped: false };
  put(v, 'wl', pct(w.left), (s) => (v.whisker.style.left = s));
  put(v, 'ww', pct(w.width), (s) => (v.whisker.style.width = s));
  put(v, 'wc', String(w.clipped), () =>
    v.whisker.classList.toggle('race__whisker--open', w.clipped),
  );

  put(v, 'num', on ? humanNumber(r.central, 'short') : COPY.race.notLaunched, (s) => {
    v.num.textContent = s;
  });
  const spoken = on
    ? `${humanNumber(r.central, 'long')} ${COPY.race.perDayLong}, ${COPY.panel.range(
        humanNumber(r.low, 'long'),
        humanNumber(r.high, 'long'),
      )}`
    : COPY.race.notLaunched;
  put(v, 'spoken', spoken, (s) => (v.spoken.textContent = s));
  const tip = on
    ? `${COPY.panel.range(humanNumber(r.low, 'short'), humanNumber(r.high, 'short'))} ${COPY.race.perDay}`
    : '';
  put(v, 'tip', tip, (s) => (s ? (v.track.title = s) : v.track.removeAttribute('title')));
  // No number, no tier: a platform that has not launched yet shows no chip.
  put(v, 'tier', on ? r.tier : '', () =>
    v.badge.replaceChildren(...(on ? [tierBadge(r.tier)] : [])),
  );
}

export function mountRace(
  root: HTMLElement,
  city: City,
  clock: Clock,
  opts: { onClose(): void; reducedMotion: boolean; onSelect?: (platformId: string) => void },
): Race {
  const titleId = `race-title-${++uid}`;
  const date = h('time', { class: 'race__date' });
  const close = h(
    'button',
    { class: 'race__close', type: 'button', 'aria-label': COPY.race.close, title: COPY.race.close },
    '×',
  );
  const list = h('ol', { class: 'race__list', role: 'list' });
  const panel = h(
    'div',
    {
      class: `race${opts.reducedMotion ? ' race--static' : ''}`,
      role: 'region',
      'aria-labelledby': titleId,
      tabindex: '-1',
      hidden: true,
    },
    h(
      'header',
      { class: 'race__header' },
      h(
        'div',
        { class: 'race__heading' },
        h('h2', { class: 'race__title', id: titleId }, COPY.race.title),
        h('p', { class: 'race__subtitle' }, COPY.race.subtitle, ' · ', date),
      ),
      close,
    ),
    list,
    h(
      'p',
      { class: 'race__note' },
      COPY.race.scaleNote,
      ' ',
      h('a', { href: METHODOLOGY_URL, rel: 'noopener' }, COPY.hud.methodLink),
    ),
  );

  const views = new Map<string, RowView>();
  for (const pm of city.platforms) {
    const p = pm.platform;
    const v = makeRow(p.id, p.name, p.identity.palette.accent, opts.onSelect);
    views.set(p.id, v);
    list.append(v.li);
  }
  root.replaceChildren(panel);

  let isOpen = false;
  let lastCompute = -Infinity;
  let lastIso = '';
  let lastOrder = '';
  let lastMore = false;
  let returnFocus: HTMLElement | null = null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); // the city also closes its HQ panel on Escape
    opts.onClose();
  };
  const onCloseClick = () => opts.onClose();
  const onScroll = () => updateScrollHint();
  panel.addEventListener('keydown', onKey);
  close.addEventListener('click', onCloseClick);
  list.addEventListener('scroll', onScroll, { passive: true });

  function stopAnimations(): void {
    for (const v of views.values()) {
      v.anim?.cancel();
      v.anim = null;
    }
  }

  /** DOM order = rank order; only rows that are out of place are moved. */
  function placeInOrder(rows: readonly RaceRow[]): void {
    // Moving a node drops keyboard focus inside it, so remember it and put it back.
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && list.contains(active) ? active : null;
    let cursor = list.firstElementChild;
    for (const r of rows) {
      const li = views.get(r.id)?.li;
      if (!li) continue;
      if (li === cursor) cursor = cursor.nextElementSibling;
      else list.insertBefore(li, cursor);
    }
    if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  /** Where each row is drawn now, including any move still in flight. */
  function measure(): Map<string, number> {
    const tops = new Map<string, number>();
    for (const [id, v] of views) tops.set(id, v.li.getBoundingClientRect().top);
    return tops;
  }

  /** FLIP: start every moved row at its old place and ease it into the new one. */
  function play(first: ReadonlyMap<string, number>): void {
    for (const [id, v] of views) {
      const dy = (first.get(id) ?? 0) - v.li.getBoundingClientRect().top;
      if (Math.abs(dy) < 0.5) continue;
      v.anim = v.li.animate(
        [{ transform: `translateY(${dy.toFixed(1)}px)` }, { transform: 'translateY(0)' }],
        { duration: FLIP_MS, easing: FLIP_EASE },
      );
    }
  }

  /** Fade the bottom edge while more rows are hidden below. */
  function updateScrollHint(): void {
    const more = list.scrollTop + list.clientHeight < list.scrollHeight - 2;
    if (more !== lastMore) {
      lastMore = more;
      list.classList.toggle('race__list--more', more);
    }
  }

  function render(): void {
    const t = clock.now();
    const iso = daysToIso(t);
    if (iso !== lastIso) {
      lastIso = iso;
      date.dateTime = iso;
      date.textContent = COPY.time.date(iso);
    }
    const rows = raceRows(city, t);
    const scale = raceScale(rows);
    const order = rows.map((r) => r.id).join(',');
    const reordered = order !== lastOrder;
    const animate =
      reordered &&
      lastOrder !== '' &&
      !opts.reducedMotion &&
      list.getClientRects().length > 0 && // not display:none
      typeof list.animate === 'function';
    const first = animate ? measure() : null;
    if (reordered) {
      stopAnimations();
      placeInOrder(rows);
      lastOrder = order;
    }
    // Paint before the FLIP "last" measurement: a platform that launches also changes height.
    rows.forEach((r, i) => {
      const v = views.get(r.id);
      if (v) paint(v, r, i + 1, scale);
    });
    if (first) play(first);
    updateScrollHint();
  }

  return {
    get open() {
      return isOpen;
    },
    show() {
      if (isOpen) return;
      isOpen = true;
      const active = document.activeElement;
      returnFocus = active instanceof HTMLElement && !panel.contains(active) ? active : null;
      panel.hidden = false;
      lastCompute = performance.now();
      render();
      if (opts.reducedMotion) panel.classList.add('race--open');
      else
        requestAnimationFrame(() => {
          if (isOpen) panel.classList.add('race--open');
        });
    },
    hide() {
      if (!isOpen) return;
      isOpen = false;
      // Never strand keyboard focus inside a panel that is about to disappear.
      if (panel.contains(document.activeElement) && returnFocus?.isConnected) {
        returnFocus.focus({ preventScroll: true });
      }
      returnFocus = null;
      stopAnimations();
      panel.classList.remove('race--open');
      panel.hidden = true;
    },
    update() {
      if (!isOpen) return;
      const now = performance.now();
      if (now - lastCompute < RECOMPUTE_MS) return;
      lastCompute = now;
      render();
    },
    dispose() {
      isOpen = false;
      stopAnimations();
      panel.removeEventListener('keydown', onKey);
      close.removeEventListener('click', onCloseClick);
      list.removeEventListener('scroll', onScroll);
      root.replaceChildren();
    },
  };
}
