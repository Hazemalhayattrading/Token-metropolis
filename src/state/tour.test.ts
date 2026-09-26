import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '../copy';
import type { Metric, Platform } from '../data/schema';
import { validateDataset } from '../data/validate';
import { metric, platform } from '../model/__tests__/fixtures';
import { dailyRate, globalDailyRate, rateTier } from '../model/estimate';
import { daysToMs, isoToDays } from '../model/time';
import { humanNumber } from '../ui/format';
import { buildCity, type City } from './city';
import { daylight, localHour } from './localtime';
import {
  captionNumber,
  createIdleTimer,
  GROWTH_WINDOW_DAYS,
  holdFor,
  tourStops,
  type TourStop,
} from './tour';

// ---------------------------------------------------------------------------
// A small synthetic city (one component per HQ, anchored by tokens/day figures)
// ---------------------------------------------------------------------------

interface Spec {
  id: string;
  name: string;
  tz: string;
  city: string;
  launch: string;
  /** [asOf, tokens/day] anchors. */
  anchors: [string, number][];
}

function build(specs: readonly Spec[]): City {
  const platforms: Platform[] = [];
  const metrics: Metric[] = [];
  for (const s of specs) {
    platforms.push(
      platform({
        id: s.id,
        name: s.name,
        hq: { city: s.city, country: 'Testland', lat: 0, lon: 0, timezone: s.tz, verified: 'page' },
        launch: {
          date: s.launch,
          precision: 'day',
          what: 'Public launch',
          source: { title: 'Test source', publisher: 'Test', url: 'https://example.com/source' },
          verified: 'page',
        },
        components: [
          {
            id: 'app',
            label: 'Consumer app',
            profile: 'assistant',
            routedShare: { value: 0, low: 0, high: 0, note: 'own models' },
          },
        ],
      }),
    );
    s.anchors.forEach(([asOf, value], i) =>
      metrics.push(
        metric({
          id: `${s.id}-tpd-${i}`,
          platform: s.id,
          component: 'app',
          kind: 'tokens',
          period: 'day',
          value,
          asOf,
        }),
      ),
    );
  }
  return buildCity({ platforms, metrics, models: [] });
}

const LA = 'America/Los_Angeles';
const SH = 'Asia/Shanghai';
const LON = 'Europe/London';

const SPECS: Spec[] = [
  {
    id: 'alpha',
    name: 'Alpha',
    tz: LA,
    city: 'Los Angeles',
    launch: '2023-01-01',
    anchors: [['2026-06-01', 3e13]],
  },
  {
    id: 'bravo',
    name: 'Bravo',
    tz: SH,
    city: 'Shanghai',
    launch: '2023-01-01',
    anchors: [['2026-06-01', 2e13]],
  },
  {
    id: 'charlie',
    name: 'Charlie',
    tz: LA,
    city: 'Los Angeles',
    launch: '2023-01-01',
    anchors: [['2026-06-01', 1e13]],
  },
  // grew about five-fold over the last three months
  {
    id: 'delta',
    name: 'Delta',
    tz: LON,
    city: 'London',
    launch: '2023-01-01',
    anchors: [
      ['2026-03-01', 1e12],
      ['2026-06-01', 5e12],
    ],
  },
  {
    id: 'foxtrot',
    name: 'Foxtrot',
    tz: LA,
    city: 'Los Angeles',
    launch: '2023-01-01',
    anchors: [['2026-06-01', 2e12]],
  },
  {
    id: 'echo',
    name: 'Echo',
    tz: LA,
    city: 'Los Angeles',
    launch: '2023-01-01',
    anchors: [['2026-06-01', 1e12]],
  },
];
const CITY = build(SPECS);
/** 13:00 in Los Angeles (daytime), 04:00 in Shanghai and 21:00 in London (night). */
const T = isoToDays('2026-06-01T20:00:00Z');

const hqIds = (stops: readonly TourStop[]) => stops.filter((s) => s.kind === 'hq').map((s) => s.id);
/** Digits other than a HH:MM clock time. */
const hasFigure = (text: string) => /\d/.test(text.replace(/\b\d{2}:\d{2}\b/g, ''));

describe('tourStops', () => {
  const stops = tourStops(CITY, T);

  it('opens and closes on the city overview', () => {
    expect(stops[0]).toMatchObject({ kind: 'overview', caption: COPY.tour.opening });
    expect(stops[0]!.tier).toBeUndefined();
    expect(stops.at(-1)!.kind).toBe('overview');
  });

  it('visits the three largest HQs in order, each with its tokens/day and tier', () => {
    const ranked = [...CITY.platforms].sort(
      (a, b) => dailyRate(b, T).central - dailyRate(a, T).central,
    );
    expect(stops.slice(1, 4).map((s) => s.id)).toEqual(['alpha', 'bravo', 'charlie']);
    ranked.slice(0, 3).forEach((pm, i) => {
      const s = stops[i + 1]!;
      expect(s.kind).toBe('hq');
      expect(s.caption).toBe(
        COPY.tour.ranked(
          COPY.tour.ranks[i]!,
          pm.platform.name,
          captionNumber(dailyRate(pm, T).central),
        ),
      );
      expect(s.tier).toBe(rateTier(pm, T));
    });
  });

  it('then the smallest HQ', () => {
    expect(stops[4]).toMatchObject({ kind: 'hq', id: 'echo' });
    expect(stops[4]!.caption).toContain(
      captionNumber(dailyRate(CITY.byId.get('echo')!, T).central),
    );
    expect(stops[4]!.tier).toBe(rateTier(CITY.byId.get('echo')!, T));
  });

  it('finds the fastest-growing HQ over 90 days; its tier is at best Estimated', () => {
    const growth = stops.find((s) => s.caption.startsWith('Growing fastest'))!;
    expect(growth).toMatchObject({ kind: 'hq', id: 'delta' });
    const pm = CITY.byId.get('delta')!;
    const ratio = dailyRate(pm, T).central / dailyRate(pm, T - GROWTH_WINDOW_DAYS).central;
    expect(ratio).toBeGreaterThan(2);
    expect(growth.caption).toBe(COPY.tour.growthMultiple('Delta', ratio.toFixed(1)));
    expect(growth.tier).toBeDefined();
    expect(growth.tier).not.toBe('reported');
  });

  it('shows an HQ in daytime, preferring one the tour has not visited', () => {
    const day = stops.find((s) => s.caption.includes('daytime'))!;
    expect(day).toMatchObject({ kind: 'hq', id: 'foxtrot' });
    expect(day.caption).toBe(COPY.tour.daytime('Foxtrot', 'Los Angeles', '13:00'));
    expect(day.tier).toBeUndefined();
    const pm = CITY.byId.get('foxtrot')!;
    expect(daylight(localHour(pm.platform.hq.timezone, daysToMs(T)))).toBeGreaterThanOrEqual(0.5);
  });

  it('closes with the city total and its tier (a sum is at best Estimated)', () => {
    const last = stops.at(-1)!;
    expect(last.caption).toBe(
      COPY.tour.closing(captionNumber(globalDailyRate(CITY.platforms, T).central)),
    );
    expect(last.tier).toBeDefined();
    expect(last.tier).not.toBe('reported');
  });

  it('is a curated 6–9 stops, and every caption stating a number carries a tier', () => {
    expect(stops.length).toBeGreaterThanOrEqual(6);
    expect(stops.length).toBeLessThanOrEqual(9);
    for (const s of stops) {
      if (hasFigure(s.caption)) expect(s.tier, s.caption).toBeDefined();
      else expect(s.tier, s.caption).toBeUndefined();
      expect(s.holdSeconds).toBeGreaterThanOrEqual(6);
      expect(s.holdSeconds).toBeLessThanOrEqual(11.5);
      if (s.kind === 'hq') expect(CITY.byId.has(s.id!)).toBe(true);
      else expect(s.id).toBeUndefined();
    }
  });

  it('is deterministic', () => {
    expect(tourStops(CITY, T)).toEqual(stops);
  });

  it('skips the daytime stop when every HQ is in night', () => {
    // 12:00 UTC: 05:00 in Los Angeles, 20:00 in Shanghai, 13:00 in London — drop London.
    const night = build(SPECS.filter((s) => s.tz !== LON));
    const t = isoToDays('2026-06-01T12:00:00Z');
    const s = tourStops(night, t);
    expect(s.some((x) => x.caption.includes('daytime'))).toBe(false);
    expect(s.length).toBeGreaterThanOrEqual(6);
  });

  it('falls back to a visited HQ in daytime rather than none', () => {
    // At 20:00 UTC only the Los Angeles HQs are in daytime; keep just the visited ones.
    const small = build(SPECS.filter((s) => s.id !== 'foxtrot'));
    const day = tourStops(small, T).find((x) => x.caption.includes('daytime'))!;
    expect(day.id).toBe('alpha');
  });

  it('then prefers the daytime HQ visited least', () => {
    // Alpha is both the largest and the fastest-growing (two visits); Charlie was visited once.
    const specs = SPECS.filter((s) => s.id !== 'foxtrot').map((s) =>
      s.id === 'alpha'
        ? {
            ...s,
            anchors: [
              ['2026-03-01', 3e12],
              ['2026-06-01', 3e13],
            ] as [string, number][],
          }
        : s,
    );
    const stops = tourStops(build(specs), T);
    expect(stops.find((x) => x.caption.startsWith('Growing fastest'))!.id).toBe('alpha');
    expect(stops.find((x) => x.caption.includes('daytime'))!.id).toBe('charlie');
  });

  it('skips the growth stop when no 90-day comparison is possible', () => {
    const young = build(
      SPECS.map((s) => ({
        ...s,
        launch: '2026-05-01',
        anchors: [['2026-06-01', s.anchors.at(-1)![1]]],
      })),
    );
    const s = tourStops(young, T);
    expect(s.some((x) => x.caption.startsWith('Growing fastest'))).toBe(false);
    expect(s.length).toBeGreaterThanOrEqual(6);
  });

  it('degrades gracefully early in history', () => {
    // Before any launch: only the opening.
    expect(tourStops(CITY, isoToDays('2022-06-01'))).toEqual([stops[0]]);
    // Three HQs: no "smallest" stop (it would repeat number three).
    const three = build(SPECS.slice(0, 3));
    const s = tourStops(three, T);
    expect(s.some((x) => x.caption.startsWith('The smallest'))).toBe(false);
    expect(hqIds(s).slice(0, 3)).toEqual(['alpha', 'bravo', 'charlie']);
    expect(tourStops(CITY, Number.NaN)).toEqual([stops[0]]);
  });
});

describe('tourStops on the curated dataset', () => {
  const read = (f: string) =>
    JSON.parse(readFileSync(join(__dirname, '..', '..', 'public', 'data', f), 'utf8')) as unknown;
  const result = validateDataset(
    {
      platforms: read('platforms.json'),
      metrics: read('metrics.json'),
      models: read('models.json'),
    },
    { expectedPlatforms: 15 },
  );
  if (!result.ok) throw new Error(result.errors.join('\n'));
  const city = buildCity(result.data);

  it('gives 6–9 stops with tiers on every figure, around the clock', () => {
    for (let hour = 0; hour < 24; hour += 3) {
      const t = isoToDays('2026-09-25T00:00:00Z') + hour / 24;
      const stops = tourStops(city, t);
      expect(stops.length).toBeGreaterThanOrEqual(6);
      expect(stops.length).toBeLessThanOrEqual(9);
      for (const s of stops) {
        if (hasFigure(s.caption)) expect(s.tier, s.caption).toBeDefined();
        if (s.kind === 'hq') {
          const pm = city.byId.get(s.id!);
          expect(pm, s.id).toBeDefined();
          expect(s.caption).toContain(pm!.platform.name);
        }
      }
    }
  });
});

describe('holdFor', () => {
  it('scales with the caption, within 6–10 s plus any extra', () => {
    expect(holdFor('Short')).toBe(6);
    expect(holdFor('x'.repeat(400))).toBe(10);
    expect(holdFor('Short', 1.5)).toBe(7.5);
    const mid = holdFor('x'.repeat(80));
    expect(mid).toBeGreaterThan(6);
    expect(mid).toBeLessThan(10);
  });
});

describe('captionNumber', () => {
  it('is humanNumber with the number and its scale word kept together', () => {
    expect(captionNumber(2.7e14)).toBe('270\u00a0trillion');
    expect(captionNumber(2.7e14).replace('\u00a0', ' ')).toBe(humanNumber(2.7e14));
    expect(captionNumber(512)).toBe('512');
  });
});

// ---------------------------------------------------------------------------
// Idle detection
// ---------------------------------------------------------------------------

describe('createIdleTimer', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  const setup = (timeoutMs = 30_000) => {
    const target = new EventTarget();
    const onIdle = vi.fn();
    const onActive = vi.fn();
    const timer = createIdleTimer({ timeoutMs, onIdle, onActive, target });
    const poke = (type = 'pointerdown', props: Record<string, unknown> = {}) =>
      target.dispatchEvent(Object.assign(new Event(type), props));
    return { target, onIdle, onActive, timer, poke };
  };

  it('fires onIdle once after the timeout without activity', () => {
    const { onIdle, onActive, timer } = setup();
    vi.advanceTimersByTime(29_999);
    expect(onIdle).not.toHaveBeenCalled();
    expect(timer.idle).toBe(false);
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(timer.idle).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(onActive).not.toHaveBeenCalled();
    timer.dispose();
  });

  it('restarts the countdown on any pointer, key, wheel or touch activity', () => {
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
      const { onIdle, timer, poke } = setup();
      vi.advanceTimersByTime(20_000);
      poke(type);
      vi.advanceTimersByTime(29_000);
      expect(onIdle, type).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1_000);
      expect(onIdle, type).toHaveBeenCalledTimes(1);
      timer.dispose();
    }
  });

  it('ignores events that are not activity', () => {
    const { onIdle, timer, poke } = setup();
    vi.advanceTimersByTime(20_000);
    poke('scroll');
    poke('focusin');
    vi.advanceTimersByTime(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    timer.dispose();
  });

  it('calls onActive on the next activity after idle, then counts down again', () => {
    const { onIdle, onActive, timer, poke } = setup();
    poke('keydown'); // activity before idle is not "coming back"
    expect(onActive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    poke('keydown');
    expect(onActive).toHaveBeenCalledTimes(1);
    expect(timer.idle).toBe(false);
    poke('keydown');
    expect(onActive).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(onIdle).toHaveBeenCalledTimes(2);
    timer.dispose();
  });

  it('does not wake for a pointer that has not moved (synthetic moves)', () => {
    const { onIdle, onActive, timer, poke } = setup();
    poke('pointermove', { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(30_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    poke('pointermove', { clientX: 100, clientY: 100 });
    poke('pointermove', { clientX: 102, clientY: 101 });
    expect(onActive).not.toHaveBeenCalled();
    poke('pointermove', { clientX: 120, clientY: 101 });
    expect(onActive).toHaveBeenCalledTimes(1);
    timer.dispose();
  });

  it('takes the first pointer position seen while idle as a baseline only', () => {
    const { onActive, timer, poke } = setup();
    vi.advanceTimersByTime(30_000);
    poke('pointermove', { clientX: 400, clientY: 300 });
    expect(onActive).not.toHaveBeenCalled();
    poke('pointermove', { clientX: 440, clientY: 300 });
    expect(onActive).toHaveBeenCalledTimes(1);
    timer.dispose();
  });

  it('stops listening and counting when disposed', () => {
    const { onIdle, onActive, timer, poke } = setup();
    timer.dispose();
    vi.advanceTimersByTime(60_000);
    poke('keydown');
    expect(onIdle).not.toHaveBeenCalled();
    expect(onActive).not.toHaveBeenCalled();
  });

  it('listens in the capture phase, passively', () => {
    const target = new EventTarget();
    const spy = vi.spyOn(target, 'addEventListener');
    const timer = createIdleTimer({ timeoutMs: 1000, onIdle() {}, onActive() {}, target });
    expect(spy).toHaveBeenCalledWith('keydown', expect.any(Function), {
      capture: true,
      passive: true,
    });
    timer.dispose();
  });

  it('never goes idle with an infinite timeout', () => {
    const { onIdle, timer } = setup(Number.POSITIVE_INFINITY);
    vi.advanceTimersByTime(10 * 86_400_000);
    expect(onIdle).not.toHaveBeenCalled();
    timer.dispose();
  });
});
