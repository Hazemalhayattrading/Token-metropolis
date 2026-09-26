/**
 * The accessible data view: every platform's estimate with tier, range, scope
 * and its latest published figure linked to the source. Visible as the 2D
 * fallback; reachable by keyboard and screen readers in 3D mode.
 */
import { COPY } from '../copy';
import { dailyRate, latestAnchor, rateTier } from '../model/estimate';
import { daysToIso } from '../model/time';
import { ranked, type City } from '../state/city';
import { tierBadge } from './badge';
import { h } from './dom';
import { describeValue, humanNumber } from './format';

export function renderDataTable(container: HTMLElement, city: City, t: number): void {
  const metricsById = new Map(city.dataset.metrics.map((m) => [m.id, m]));
  const rows = ranked(city, t).map((pm) => {
    const r = dailyRate(pm, t);
    const anchor = latestAnchor(pm, t);
    const metric = anchor ? metricsById.get(anchor.refs[0] ?? '') : undefined;
    return h(
      'tr',
      {},
      h(
        'th',
        { scope: 'row' },
        pm.platform.name,
        h('span', { class: 'table__parent' }, pm.platform.parent),
      ),
      h('td', { class: 'num' }, humanNumber(r.central)),
      h('td', { class: 'num' }, `${humanNumber(r.low)} – ${humanNumber(r.high)}`),
      h('td', {}, tierBadge(rateTier(pm, t))),
      h(
        'td',
        {},
        metric && anchor
          ? h(
              'span',
              {},
              `${describeValue(metric)} (${daysToIso(anchor.t)}) · `,
              h(
                'a',
                { href: metric.source.url, rel: 'noopener nofollow' },
                metric.source.publisher,
              ),
            )
          : '—',
      ),
      h('td', { class: 'table__scope' }, pm.platform.scope),
    );
  });
  container.replaceChildren(
    h(
      'table',
      { class: 'data-table' },
      h('caption', {}, COPY.table.caption),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, COPY.table.platform),
          h('th', { scope: 'col', class: 'num' }, COPY.table.perDay),
          h('th', { scope: 'col', class: 'num' }, COPY.table.range),
          h('th', { scope: 'col' }, COPY.table.tier),
          h('th', { scope: 'col' }, COPY.table.latest),
          h('th', { scope: 'col' }, COPY.table.scope),
        ),
      ),
      h('tbody', {}, ...rows),
    ),
  );
}
