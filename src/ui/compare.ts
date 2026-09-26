/**
 * Compare mode (brief §5.3 item 7): two or three platforms side by side. The
 * world renders one viewport per campus; this overlay puts a header and a
 * metrics card over each viewport column — every figure with its range and
 * tier, the HQ's scope, and the latest published figure (what it is, when,
 * who published it). Each HQ name opens that HQ's panel with every formula.
 */
import { COPY } from '../copy';
import { isDisplayable } from '../model/constants';
import { gpuEquivalents, powerMW, waterLitersPerDay } from '../model/derived';
import {
  cumulative,
  cumulativeTier,
  dailyRate,
  instantTier,
  latestAnchor,
  rateTier,
  tokensPerSecond,
} from '../model/estimate';
import { daysToIso } from '../model/time';
import type { Range, Tier } from '../model/types';
import type { City } from '../state/city';
import type { Clock } from '../state/clock';
import { tierBadge } from './badge';
import { h } from './dom';
import { describeValue, formatMW, humanNumber } from './format';
import { METHODOLOGY_URL } from './links';

export const COMPARE_MAX = 3;
/** A comparison needs two platforms: fewer, and the columns lose their remove buttons. */
export const COMPARE_MIN = 2;

export interface Compare {
  readonly open: boolean;
  readonly ids: readonly string[];
  show(initial: readonly string[]): void;
  hide(): void;
  update(): void;
  dispose(): void;
}

export interface CompareOptions {
  onChange(ids: readonly string[]): void;
  onClose(): void;
  /** The visitor chose an HQ's name: leave compare and open its panel. */
  onOpenHq(id: string): void;
  history: () => boolean;
}

interface Cell {
  value: HTMLElement;
  range: HTMLElement;
  badge: HTMLElement;
}

function setCell(
  c: Cell,
  value: string,
  range: Range | null,
  tier: Tier | null,
  fmt = humanNumber,
) {
  c.value.textContent = value;
  c.range.textContent = range ? COPY.panel.range(fmt(range.low), fmt(range.high)) : '';
  const key = tier ?? 'none';
  if (c.badge.dataset.tier !== key) {
    c.badge.dataset.tier = key;
    c.badge.replaceChildren(...(tier ? [tierBadge(tier)] : []));
  }
}

export function mountCompare(
  root: HTMLElement,
  city: City,
  clock: Clock,
  opts: CompareOptions,
): Compare {
  let isOpen = false;
  let ids: string[] = [];
  let cells: Map<string, Record<string, Cell>> = new Map();
  let latestEls: Map<string, HTMLElement> = new Map();
  let nowLabels: HTMLElement[] = [];
  let lastUpdate = 0;
  let returnFocus: HTMLElement | null = null;

  // Choosing in the list only selects; the Add button commits (arrow keys never add a column).
  const picker = h('select', { class: 'compare__picker', 'aria-label': COPY.compare.addLabel });
  const add = h('button', { class: 'compare__add', type: 'button' }, COPY.compare.addButton);
  const close = h(
    'button',
    { class: 'compare__close', type: 'button', 'aria-label': COPY.compare.close },
    '×',
  );
  const grid = h('div', { class: 'compare__grid' });
  const bar = h(
    'div',
    { class: 'compare__bar' },
    h('h2', { class: 'compare__title' }, COPY.compare.title),
    picker,
    add,
    h('p', { class: 'compare__note' }, COPY.compare.scaleNote),
    h(
      'a',
      { class: 'compare__method', href: METHODOLOGY_URL, rel: 'noopener' },
      COPY.compare.method,
    ),
    close,
  );
  const panel = h('section', { class: 'compare', 'aria-label': COPY.compare.title }, bar, grid);
  root.replaceChildren(panel);

  function renderPicker(): void {
    picker.replaceChildren(
      h('option', { value: '' }, ids.length >= COMPARE_MAX ? COPY.compare.hint : COPY.compare.add),
      ...city.platforms
        .filter((pm) => !ids.includes(pm.platform.id))
        .map((pm) => h('option', { value: pm.platform.id }, pm.platform.name)),
    );
    picker.disabled = ids.length >= COMPARE_MAX;
    syncAdd();
  }

  function syncAdd(): void {
    add.disabled = picker.disabled || picker.value === '';
  }

  function metric(label: string, id: string, key: string): HTMLElement {
    const c: Cell = {
      value: h('span', { class: 'compare__value' }),
      range: h('span', { class: 'compare__range' }),
      badge: h('span', { class: 'compare__badge' }),
    };
    cells.get(id)![key] = c;
    const labelEl = h('dt', {}, label);
    if (key === 'now') nowLabels.push(labelEl);
    return h(
      'div',
      { class: 'compare__metric', 'data-key': key },
      labelEl,
      h('dd', {}, c.value, ' ', c.badge, c.range),
    );
  }

  function renderGrid(): void {
    cells = new Map();
    latestEls = new Map();
    nowLabels = [];
    grid.style.setProperty('--compare-n', String(Math.max(1, ids.length)));
    grid.replaceChildren(
      ...ids.map((id) => {
        const p = city.byId.get(id)!.platform;
        cells.set(id, {});
        const remove = h(
          'button',
          {
            class: 'compare__remove',
            type: 'button',
            'aria-label': COPY.compare.remove(p.name),
            'data-remove': id,
            disabled: ids.length <= COMPARE_MIN,
          },
          '×',
        );
        remove.addEventListener('click', () => removeId(id));
        const name = h(
          'button',
          {
            class: 'compare__name-button',
            type: 'button',
            title: COPY.compare.openHq(p.name),
            'data-open': id,
          },
          p.name,
        );
        name.addEventListener('click', () => opts.onOpenHq(id));
        const latest = h('p', { class: 'compare__latest' });
        latestEls.set(id, latest);
        return h(
          'article',
          { class: 'compare__col', style: `--accent: ${p.identity.palette.accent}` },
          h(
            'header',
            { class: 'compare__head' },
            h('span', { class: 'compare__swatch', 'aria-hidden': 'true' }),
            h('h3', { class: 'compare__name' }, name),
            remove,
          ),
          h(
            'div',
            { class: 'compare__card' },
            h('p', { class: 'compare__scope', title: p.scope }, p.scope),
            h(
              'dl',
              { class: 'compare__metrics' },
              metric(COPY.compare.rows.perDay, id, 'perDay'),
              metric(COPY.compare.rows.now, id, 'now'),
              metric(COPY.compare.rows.total, id, 'total'),
              metric(COPY.compare.rows.gpus, id, 'gpus'),
              metric(COPY.compare.rows.power, id, 'power'),
              metric(COPY.compare.rows.water, id, 'water'),
            ),
            h('p', { class: 'compare__latest-label' }, COPY.compare.rows.latest),
            latest,
          ),
        );
      }),
    );
    lastUpdate = 0;
    update();
  }

  function setIds(next: readonly string[]): void {
    ids = [...new Set(next)].slice(0, COMPARE_MAX);
    renderPicker();
    renderGrid();
    opts.onChange(ids);
  }

  /** Remove a column (never below two) and keep keyboard focus in the overlay. */
  function removeId(id: string): void {
    if (ids.length <= COMPARE_MIN) return;
    const at = ids.indexOf(id);
    setIds(ids.filter((x) => x !== id));
    const next = ids[Math.min(at, ids.length - 1)];
    const target =
      grid.querySelector<HTMLElement>(`[data-open="${next}"]`) ??
      (picker.disabled ? close : picker);
    target.focus({ preventScroll: true });
  }

  function addPicked(): void {
    const id = picker.value;
    if (!id || ids.length >= COMPARE_MAX) return;
    setIds([...ids, id]);
    // The list disables itself at three columns: never leave focus on a disabled control.
    (picker.disabled
      ? (grid.querySelector<HTMLElement>(`[data-open="${id}"]`) ?? close)
      : picker
    ).focus({ preventScroll: true });
  }

  function update(): void {
    if (!isOpen) return;
    const nowMs = performance.now();
    if (nowMs - lastUpdate < 500) return;
    lastUpdate = nowMs;
    const t = clock.now();
    const past = opts.history();
    for (const l of nowLabels)
      l.textContent = past ? COPY.compare.rows.nowHistory : COPY.compare.rows.now;
    for (const id of ids) {
      const pm = city.byId.get(id)!;
      const c = cells.get(id)!;
      const day = dailyRate(pm, t);
      if (!(day.central > 0)) {
        for (const cell of Object.values(c)) setCell(cell, COPY.race.notLaunched, null, null);
        const el = latestEls.get(id)!;
        el.textContent = '—';
        el.dataset.key = 'not-launched'; // so the figure comes back once the HQ has launched
        continue;
      }
      const tier = rateTier(pm, t);
      const tps = tokensPerSecond(pm, t);
      const g = gpuEquivalents(tps, tier);
      const p = powerMW(g.range, tier);
      const w = waterLitersPerDay(day, tier);
      const cum = cumulative(pm, t);
      setCell(c.perDay!, humanNumber(day.central), day, tier);
      setCell(c.now!, `${humanNumber(tps.central)}/s`, tps, instantTier(pm, t));
      setCell(c.total!, humanNumber(cum.central), cum, cumulativeTier(pm, t));
      setCell(c.gpus!, humanNumber(g.range.central), g.range, g.tier);
      setCell(c.power!, `${formatMW(p.range.central)} MW`, p.range, p.tier, formatMW);
      if (isDisplayable(w.refs))
        setCell(c.water!, `${humanNumber(w.range.central)} L/day`, w.range, w.tier);
      const a = latestAnchor(pm, t);
      const m = a ? city.dataset.metrics.find((x) => x.id === (a.refs[0] ?? '')) : undefined;
      const el = latestEls.get(id)!;
      const key = a ? `${a.refs[0] ?? ''}@${a.t}` : 'none';
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        // What was published (often users or revenue, not tokens), its tier, when and by whom.
        el.replaceChildren(
          ...(m && a
            ? [
                h('span', { class: 'compare__figure', title: m.scope }, describeValue(m)),
                ' ',
                tierBadge(m.sourceKind === 'primary' ? 'reported' : 'derived'),
                h('br'),
                `${daysToIso(a.t)} · `,
                h(
                  'a',
                  { href: m.source.url, rel: 'noopener nofollow', target: '_blank' },
                  m.source.publisher,
                ),
                m.verified === 'snippet' ? ` · ${COPY.panel.snippet}` : '',
              ]
            : ['—']),
        );
      }
    }
  }

  picker.addEventListener('change', syncAdd);
  add.addEventListener('click', addPicked);
  close.addEventListener('click', () => opts.onClose());
  // Escape closes compare wherever focus is (the overlay is the whole screen while open).
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !isOpen || e.defaultPrevented) return;
    e.stopPropagation();
    opts.onClose();
  };

  return {
    get open() {
      return isOpen;
    },
    get ids() {
      return ids;
    },
    show(initial) {
      const active = document.activeElement;
      returnFocus = active instanceof HTMLElement ? active : null;
      isOpen = true;
      root.hidden = false;
      document.addEventListener('keydown', onKey);
      setIds(initial);
      requestAnimationFrame(() => picker.focus({ preventScroll: true }));
    },
    hide() {
      isOpen = false;
      root.hidden = true;
      document.removeEventListener('keydown', onKey);
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      returnFocus = null;
    },
    update,
    dispose() {
      document.removeEventListener('keydown', onKey);
      root.replaceChildren();
    },
  };
}
