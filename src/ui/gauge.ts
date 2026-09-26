/**
 * A semicircular log-scale gauge: the shaded band is the plausible range, the
 * needle the central value. All HQs share one scale so gauges compare.
 * The numbers themselves are in HTML next to the drawing (the SVG is decorative).
 */
import type { Range, Tier } from '../model/types';
import { tierBadge } from './badge';
import { h } from './dom';

const NS = 'http://www.w3.org/2000/svg';
const CX = 100;
const CY = 100;
const R = 80;

/** Position of `v` on a log scale between `min` and `max`, clamped to [0, 1]. */
export function gaugeFraction(v: number, min: number, max: number): number {
  if (!(v > 0) || !(min > 0) || !(max > min)) return 0;
  const t = (Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
  return Math.min(1, Math.max(0, t));
}

/** Decade ticks covering [lo, hi]: min is the decade at or below lo, max the one at or above hi. */
export function decadeScale(lo: number, hi: number): { min: number; max: number; ticks: number[] } {
  if (!(lo > 0 && Number.isFinite(lo) && hi > 0 && Number.isFinite(hi))) {
    return { min: 1, max: 10, ticks: [1, 10] };
  }
  const a = Math.floor(Math.log10(Math.max(lo, 1e-9)));
  const b = Math.max(a + 1, Math.ceil(Math.log10(Math.max(hi, 1e-9))));
  const ticks: number[] = [];
  for (let e = a; e <= b; e++) ticks.push(10 ** e);
  return { min: 10 ** a, max: 10 ** b, ticks };
}

function point(t: number, r: number): [number, number] {
  const a = Math.PI * (1 - t);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

function arc(t0: number, t1: number, r: number): string {
  const [x0, y0] = point(t0, r);
  const [x1, y1] = point(t1, r);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export interface GaugeOptions {
  label: string;
  unit: string;
  min: number;
  max: number;
  ticks: readonly number[];
  tickLabel: (v: number) => string;
}

export interface Gauge {
  readonly el: HTMLElement;
  set(range: Range, tier: Tier, value: string, rangeText: string): void;
}

export function createGauge(o: GaugeOptions): Gauge {
  const drawing = svg('svg', {
    viewBox: '-28 -14 256 128',
    class: 'gauge__svg',
    'aria-hidden': 'true',
  });
  drawing.append(svg('path', { d: arc(0, 1, R), class: 'gauge__track' }));
  // Label every decade, or every other one (plus the last) when there are many.
  const every = o.ticks.length > 5 ? 2 : 1;
  o.ticks.forEach((tv, i) => {
    const t = gaugeFraction(tv, o.min, o.max);
    const [x0, y0] = point(t, R - 7);
    const [x1, y1] = point(t, R + 7);
    drawing.append(svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'gauge__tick' }));
    if (i % every !== 0 && i !== o.ticks.length - 1) return;
    const [lx, ly] = point(t, R + 12);
    drawing.append(
      Object.assign(
        svg('text', {
          x: lx.toFixed(1),
          y: (ly + 4).toFixed(1),
          class: 'gauge__tick-label',
          'text-anchor': t < 0.35 ? 'end' : t > 0.65 ? 'start' : 'middle',
        }),
        { textContent: o.tickLabel(tv) },
      ),
    );
  });
  const band = svg('path', { d: arc(0, 0, R), class: 'gauge__band' });
  const needle = svg('line', { x1: CX, y1: CY, x2: CX, y2: CY - R + 12, class: 'gauge__needle' });
  const hub = svg('circle', { cx: CX, cy: CY, r: 4.5, class: 'gauge__hub' });
  drawing.append(band, needle, hub);

  const value = h('span', { class: 'metric__value' });
  const range = h('span', { class: 'metric__range' });
  const badge = h('span', { class: 'metric__badge' });
  const el = h(
    'div',
    { class: 'metric gauge' },
    h('div', { class: 'metric__head' }, h('span', { class: 'metric__label' }, o.label), badge),
    drawing,
    h(
      'div',
      { class: 'metric__body gauge__body' },
      value,
      h('span', { class: 'metric__unit' }, o.unit),
    ),
    range,
  );

  return {
    el,
    set(r, tier, text, rangeText) {
      const lo = gaugeFraction(r.low, o.min, o.max);
      const hi = gaugeFraction(r.high, o.min, o.max);
      band.setAttribute('d', arc(lo, Math.max(hi, lo + 0.004), R));
      const [nx, ny] = point(gaugeFraction(r.central, o.min, o.max), R - 12);
      needle.setAttribute('x2', nx.toFixed(2));
      needle.setAttribute('y2', ny.toFixed(2));
      value.textContent = text;
      range.textContent = rangeText;
      if (badge.dataset.tier !== tier) {
        badge.dataset.tier = tier;
        badge.replaceChildren(tierBadge(tier));
      }
    },
  };
}
