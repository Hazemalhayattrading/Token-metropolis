import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { Platform, TimelineEvent } from '../data/schema';
import { validateDataset } from '../data/validate';
import { dailyRate, rateTier } from '../model/estimate';
import { isoToDays } from '../model/time';
import { metric, platform } from '../model/__tests__/fixtures';
import { buildCity, type City } from './city';
import { LAUNCH_WINDOW_DAYS } from './events';
import {
  announceDelay,
  barFraction,
  feedItems,
  feedSignature,
  isNewLaunch,
  raceRows,
  raceScale,
  stackToasts,
  whiskerSpan,
} from './race';

// ---------------------------------------------------------------------------
// A small synthetic city: one component per platform, anchored by one tokens/day figure.
// ---------------------------------------------------------------------------

function synthetic(id: string, name: string, launch: string, perDay: number, accent: string) {
  const p: Platform = platform({
    id,
    name,
    launch: {
      date: launch,
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
    identity: {
      palette: { primary: '#112233', secondary: '#223344', accent, glow: '#445566' },
      architecture: 'A test tower of glass',
      motif: 'test',
    },
  });
  const m = metric({
    id: `${id}-tpd`,
    platform: id,
    component: 'app',
    kind: 'tokens',
    period: 'day',
    value: perDay,
    asOf: '2026-06-01',
  });
  return { p, m };
}

const parts = [
  synthetic('alpha', 'Alpha', '2023-01-01', 5e12, '#ff0000'),
  synthetic('bravo', 'bravo', '2023-01-01', 2e13, '#00ff00'),
  synthetic('charlie', 'Charlie', '2023-01-01', 1e12, '#0000ff'),
  // launch after the dates below that test the "not launched" ordering
  synthetic('zulu', 'Zulu', '2026-01-01', 3e13, '#ffff00'),
  synthetic('echo', 'Echo', '2026-01-01', 4e11, '#00ffff'),
];
const CITY: City = buildCity({
  platforms: parts.map((x) => x.p),
  metrics: parts.map((x) => x.m),
  models: [],
});
const T = isoToDays('2026-06-01T12:00:00Z');
const EARLY = isoToDays('2025-06-01');

describe('raceRows (synthetic city)', () => {
  it('lists every platform once, largest daily rate first', () => {
    const rows = raceRows(CITY, T);
    expect(rows.map((r) => r.id)).toEqual(['zulu', 'bravo', 'alpha', 'charlie', 'echo']);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.central).toBeGreaterThanOrEqual(rows[i]!.central);
    }
  });

  it('carries the daily-rate range, tier, name and accent of each platform', () => {
    for (const row of raceRows(CITY, T)) {
      const pm = CITY.byId.get(row.id)!;
      const r = dailyRate(pm, T);
      expect(row).toMatchObject({
        name: pm.platform.name,
        accent: pm.platform.identity.palette.accent,
        low: r.low,
        central: r.central,
        high: r.high,
        tier: rateTier(pm, T),
        launched: true,
      });
      expect(row.low).toBeLessThanOrEqual(row.central);
      expect(row.central).toBeLessThanOrEqual(row.high);
    }
  });

  it('puts platforms that have not launched yet last, alphabetically, case-insensitively', () => {
    const rows = raceRows(CITY, EARLY);
    expect(rows.map((r) => r.id)).toEqual(['bravo', 'alpha', 'charlie', 'echo', 'zulu']);
    const unlaunched = rows.filter((r) => !r.launched);
    expect(unlaunched.map((r) => r.id)).toEqual(['echo', 'zulu']);
    for (const r of unlaunched) expect(r.central).toBe(0);
    // before anyone launched: all alphabetical ("bravo" sorts between Alpha and Charlie)
    expect(raceRows(CITY, isoToDays('2022-06-01')).map((r) => r.name)).toEqual([
      'Alpha',
      'bravo',
      'Charlie',
      'Echo',
      'Zulu',
    ]);
  });

  it('is deterministic', () => {
    expect(raceRows(CITY, T + 0.37)).toEqual(raceRows(CITY, T + 0.37));
  });
});

describe('race scale and geometry', () => {
  it('scales to the leader, and never to less than 1', () => {
    const rows = raceRows(CITY, T);
    expect(raceScale(rows)).toBe(rows[0]!.central);
    expect(raceScale([])).toBe(1);
    expect(raceScale(raceRows(CITY, isoToDays('2022-06-01')))).toBe(1);
  });

  it('bars are a clamped fraction of the leader', () => {
    expect(barFraction(50, 200)).toBe(0.25);
    expect(barFraction(300, 200)).toBe(1);
    expect(barFraction(-1, 200)).toBe(0);
    expect(barFraction(5, 0)).toBe(0);
    const rows = raceRows(CITY, T);
    const scale = raceScale(rows);
    expect(barFraction(rows[0]!.central, scale)).toBe(1);
  });

  it('whiskers span low..high on the same scale, clamped to the track', () => {
    const mid = whiskerSpan({ low: 20, high: 60 }, 100);
    expect(mid.left).toBeCloseTo(0.2);
    expect(mid.width).toBeCloseTo(0.4);
    expect(mid.clipped).toBe(false);
    const leader = whiskerSpan({ low: 60, high: 180 }, 100);
    expect(leader.left).toBeCloseTo(0.6);
    expect(leader.width).toBeCloseTo(0.4);
    expect(leader.clipped).toBe(true);
    expect(whiskerSpan({ low: 0, high: 0 }, 1)).toEqual({ left: 0, width: 0, clipped: false });
  });
});

// ---------------------------------------------------------------------------
// The real curated dataset (loaded like src/data/dataset.test.ts)
// ---------------------------------------------------------------------------

const read = (f: string) =>
  parse(readFileSync(join(__dirname, '..', '..', 'data', 'manual', f), 'utf8')) as unknown;
const NOW = isoToDays('2026-09-25T12:00:00Z');
const result = validateDataset(
  { platforms: read('platforms.yaml'), metrics: read('metrics.yaml'), models: read('models.yaml') },
  { now: NOW, expectedPlatforms: 15 },
);
if (!result.ok) throw new Error(`dataset invalid:\n${result.errors.join('\n')}`);
const REAL = buildCity(result.data);

describe('raceRows (curated dataset)', () => {
  it('has all 15 platforms, all launched today, in descending order', () => {
    const rows = raceRows(REAL, NOW);
    expect(rows).toHaveLength(15);
    expect(new Set(rows.map((r) => r.id)).size).toBe(15);
    expect(rows.every((r) => r.launched)).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.central).toBeGreaterThanOrEqual(rows[i]!.central);
    }
    for (const r of rows) expect(r.accent).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('at the start of the time machine only the pioneers race; the rest wait alphabetically', () => {
    const rows = raceRows(REAL, isoToDays('2022-12-01'));
    const launched = rows.filter((r) => r.launched).map((r) => r.id);
    expect([...launched].sort()).toEqual(['characterai', 'chatgpt', 'github-copilot']);
    expect(rows.slice(0, 3).every((r) => r.launched)).toBe(true);
    const waiting = rows.slice(3).map((r) => r.name.toLowerCase());
    expect(waiting).toEqual([...waiting].sort());
  });
});

// ---------------------------------------------------------------------------
// Feed and toasts
// ---------------------------------------------------------------------------

function ev(id: string, date: string, platformId = 'p'): TimelineEvent {
  return {
    id,
    date,
    platform: platformId,
    kind: 'model-launch',
    title: `${id} released`,
    source: { title: 'Source', publisher: 'Pub', url: 'https://example.com/' },
  } as TimelineEvent;
}

const EVENTS = [
  ev('a', '2024-01-10'),
  ev('b', '2024-01-20'),
  ev('c', '2024-03-01'),
  ev('d', '2024-03-02'),
  ev('e', '2024-03-02'),
];

describe('feed', () => {
  it('a launch is new for the 72-hour launch day, from 00:00 UTC', () => {
    const e = EVENTS[0]!;
    const d = isoToDays(e.date);
    expect(isNewLaunch(e, d - 1e-6)).toBe(false);
    expect(isNewLaunch(e, d)).toBe(true);
    expect(isNewLaunch(e, d + LAUNCH_WINDOW_DAYS - 1e-6)).toBe(true);
    expect(isNewLaunch(e, d + LAUNCH_WINDOW_DAYS)).toBe(false);
  });

  it('lists the latest launches newest first, new ones pinned first', () => {
    const t = isoToDays('2024-03-03T08:00:00Z');
    const items = feedItems(EVENTS, t, 8);
    expect(items.map((i) => i.event.id)).toEqual(['d', 'e', 'c', 'b', 'a']);
    expect(items.map((i) => i.isNew)).toEqual([true, true, true, false, false]);
    expect(feedItems(EVENTS, t, 2).map((i) => i.event.id)).toEqual(['d', 'e']);
  });

  it('shows nothing before the first launch and nothing new long after', () => {
    expect(feedItems(EVENTS, isoToDays('2023-01-01'))).toEqual([]);
    const later = feedItems(EVENTS, isoToDays('2025-01-01'));
    expect(later.some((i) => i.isNew)).toBe(false);
    expect(later).toHaveLength(5);
  });

  it('signature changes only when the list or a "new" flag changes', () => {
    const a = feedSignature(feedItems(EVENTS, isoToDays('2024-03-03')));
    const b = feedSignature(feedItems(EVENTS, isoToDays('2024-03-03T20:00:00Z')));
    const c = feedSignature(feedItems(EVENTS, isoToDays('2024-03-05')));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('toasts', () => {
  it('stacks newest on top and drops the oldest beyond the limit', () => {
    let stack: string[] = [];
    const dropped: string[] = [];
    for (const x of ['1', '2', '3', '4', '5']) {
      const r = stackToasts(stack, x, 3);
      stack = r.visible;
      dropped.push(...r.dropped);
    }
    expect(stack).toEqual(['5', '4', '3']);
    expect(dropped).toEqual(['1', '2']);
    expect(stackToasts([], 'x', 0)).toEqual({ visible: [], dropped: ['x'] });
  });

  it('paces screen-reader announcements', () => {
    // first announcement: only the settle delay
    expect(announceDelay(-Infinity, 1000, 200, 3000)).toBe(200);
    // right after one: wait out the cooldown
    expect(announceDelay(1000, 1500, 200, 3000)).toBe(2500);
    // long after: settle only
    expect(announceDelay(1000, 10_000, 200, 3000)).toBe(200);
  });
});
