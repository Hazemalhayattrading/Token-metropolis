/**
 * The HQ info panel: every number with its tier badge, range, formula and
 * source (brief §2.2). Desktop: side panel. Mobile: bottom sheet.
 */
import { COPY } from '../copy';
import { isDisplayable } from '../model/constants';
import { gpuEquivalents, powerMW, waterLitersPerDay } from '../model/derived';
import {
  between,
  cumulative,
  cumulativeTier,
  dailyRate,
  latestAnchor,
  rateTier,
  tokensPerSecond,
} from '../model/estimate';
import { daysToIso, utcDayStart } from '../model/time';
import type { Estimate, Range, Tier } from '../model/types';
import type { City } from '../state/city';
import type { Clock } from '../state/clock';
import { localTimeLabel } from '../state/localtime';
import { tierBadge } from './badge';
import { byId, h } from './dom';
import { describeValue, fullNumber, humanNumber } from './format';

export interface Panel {
  show(id: string): void;
  hide(): void;
  update(): void;
  readonly openId: string | null;
}

interface Row {
  value: HTMLElement;
  range: HTMLElement;
  badge: HTMLElement;
}

function row(label: string, unit: string): { el: HTMLElement; row: Row } {
  const value = h('span', { class: 'metric__value' });
  const range = h('span', { class: 'metric__range' });
  const badge = h('span', { class: 'metric__badge' });
  const el = h(
    'div',
    { class: 'metric' },
    h('div', { class: 'metric__head' }, h('span', { class: 'metric__label' }, label), badge),
    h('div', { class: 'metric__body' }, value, h('span', { class: 'metric__unit' }, unit)),
    range,
  );
  return { el, row: { value, range, badge } };
}

function setRow(
  r: Row,
  value: string,
  range: Range | null,
  tier: Tier,
  fmt: (n: number) => string = humanNumber,
): void {
  r.value.textContent = value;
  r.range.textContent = range ? COPY.panel.range(fmt(range.low), fmt(range.high)) : '';
  if (r.badge.dataset.tier !== tier) {
    r.badge.dataset.tier = tier;
    r.badge.replaceChildren(tierBadge(tier));
  }
}

export function createPanel(city: City, clock: Clock, onClose: () => void): Panel {
  const root = byId('panel');
  let openId: string | null = null;
  let rows: Record<string, Row> = {};
  let lastSlow = 0;
  let lastFast = 0;

  const close = h(
    'button',
    { class: 'panel__close', type: 'button', 'aria-label': COPY.panel.close },
    '×',
  );
  close.addEventListener('click', onClose);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onClose();
  });

  function render(id: string): void {
    const pm = city.byId.get(id)!;
    const p = pm.platform;
    const t = clock.now();
    const metricsById = new Map(city.dataset.metrics.map((m) => [m.id, m]));
    const anchor = latestAnchor(pm, t);
    const metric = anchor ? metricsById.get(anchor.refs[0] ?? '') : undefined;

    const today = row(COPY.panel.today, COPY.panel.tokens);
    const now = row(COPY.panel.now, COPY.panel.perSecond);
    const perDay = row(COPY.panel.perDay, COPY.panel.tokens);
    const total = row(COPY.panel.sinceLaunch, COPY.panel.tokens);
    const gpus = row(COPY.panel.gpus, COPY.panel.gpuUnit);
    const power = row(COPY.panel.power, 'MW');
    const water = row(COPY.panel.water, COPY.panel.waterUnit);
    rows = {
      today: today.row,
      now: now.row,
      perDay: perDay.row,
      total: total.row,
      gpus: gpus.row,
      power: power.row,
      water: water.row,
    };

    const extrapolatedDays = anchor ? Math.max(0, t - anchor.t) : 0;

    root.replaceChildren(
      h(
        'div',
        { class: 'panel__inner', style: `--accent: ${p.identity.palette.accent}` },
        h(
          'header',
          { class: 'panel__header' },
          h('h2', { class: 'panel__title', id: 'panel-title' }, p.name),
          h(
            'p',
            { class: 'panel__meta' },
            `${p.parent} · ${p.hq.city} · `,
            h('span', { id: 'panel-localtime' }),
          ),
          close,
        ),
        h('p', { class: 'panel__scope' }, p.scope),
        h('div', { class: 'panel__grid' }, today.el, now.el, perDay.el, total.el),
        h('h3', { class: 'panel__section' }, COPY.panel.infrastructure),
        h('div', { class: 'panel__grid' }, gpus.el, power.el, water.el),
        h('p', { class: 'panel__note' }, COPY.panel.infraNote),
        h('h3', { class: 'panel__section' }, COPY.panel.latest),
        metric && anchor
          ? h(
              'div',
              { class: 'source' },
              h(
                'p',
                { class: 'source__figure' },
                describeValue(metric),
                ' ',
                tierBadge(metric.sourceKind === 'primary' ? 'reported' : 'derived'),
              ),
              h('p', { class: 'source__quote' }, `“${metric.quote}”`),
              h(
                'p',
                { class: 'source__meta' },
                `${metric.scope} · ${daysToIso(anchor.t)} · `,
                h(
                  'a',
                  { href: metric.source.url, rel: 'noopener nofollow', target: '_blank' },
                  metric.source.publisher,
                ),
                metric.verified === 'snippet' ? ` · ${COPY.panel.snippet}` : '',
              ),
            )
          : h('p', {}, '—'),
        h('h3', { class: 'panel__section' }, COPY.panel.how),
        h('p', { class: 'panel__formula' }, anchor?.formula ?? '—'),
        extrapolatedDays > 14
          ? h('p', { class: 'panel__note' }, COPY.panel.extrapolated(Math.round(extrapolatedDays)))
          : null,
        h(
          'p',
          { class: 'panel__note' },
          h(
            'a',
            {
              href: 'https://github.com/Hazemalhayattrading/Token-metropolis/blob/main/METHODOLOGY.md',
              rel: 'noopener',
            },
            COPY.hud.methodLink,
          ),
        ),
      ),
    );
    lastSlow = 0;
    lastFast = 0;
  }

  function update(): void {
    if (!openId) return;
    const nowMs = performance.now();
    if (nowMs - lastFast < 80) return;
    lastFast = nowMs;
    const pm = city.byId.get(openId)!;
    const t = clock.now();
    const tier = rateTier(pm, t);
    const today = between(pm, utcDayStart(t), t);
    const tps = tokensPerSecond(pm, t);
    setRow(rows.today!, fullNumber(today.central), today, tier);
    setRow(rows.now!, humanNumber(tps.central), tps, tier);
    if (nowMs - lastSlow > 2000) {
      lastSlow = nowMs;
      const day = dailyRate(pm, t);
      setRow(rows.perDay!, humanNumber(day.central), day, tier);
      const cum = cumulative(pm, t);
      setRow(rows.total!, humanNumber(cum.central), cum, cumulativeTier(pm, t));
      const g: Estimate = gpuEquivalents(tps, tier);
      setRow(rows.gpus!, humanNumber(g.range.central), g.range, g.tier);
      const mw = powerMW(g.range, tier);
      setRow(
        rows.power!,
        mw.range.central.toFixed(mw.range.central < 10 ? 1 : 0),
        mw.range,
        mw.tier,
        (n) => n.toFixed(n < 10 ? 1 : 0),
      );
      const w = waterLitersPerDay(day, tier);
      if (isDisplayable(w.refs)) setRow(rows.water!, humanNumber(w.range.central), w.range, w.tier);
      const lt = document.getElementById('panel-localtime');
      if (lt)
        lt.textContent = COPY.panel.localTime(localTimeLabel(pm.platform.hq.timezone, Date.now()));
    }
  }

  return {
    get openId() {
      return openId;
    },
    show(id) {
      openId = id;
      render(id);
      update();
      root.hidden = false;
      root.setAttribute('aria-labelledby', 'panel-title');
      requestAnimationFrame(() => root.classList.add('panel--open'));
    },
    hide() {
      openId = null;
      root.classList.remove('panel--open');
      root.hidden = true;
    },
    update,
  };
}
