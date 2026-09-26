/**
 * Pure logic behind the M5 overlays: the bar-chart race (rows, scale, bar and
 * whisker geometry), the "What's new" feed (latest launches with the ones
 * still inside their 72-hour launch day pinned first) and the launch toasts
 * (stacking and screen-reader announcement pacing). No DOM here.
 */
import type { TimelineEvent } from '../data/schema';
import { dailyRate, rateTier } from '../model/estimate';
import type { Tier } from '../model/types';
import type { City } from './city';
import { eventDay, LAUNCH_WINDOW_DAYS, latestEvents } from './events';

// ---------------------------------------------------------------------------
// Race
// ---------------------------------------------------------------------------

export interface RaceRow {
  readonly id: string;
  readonly name: string;
  readonly accent: string;
  readonly central: number;
  readonly low: number;
  readonly high: number;
  readonly tier: Tier;
  readonly launched: boolean;
}

/** Case-insensitive code-point order (deterministic on every engine), ties broken by id. */
function byName(a: RaceRow, b: RaceRow): number {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function raceOrder(a: RaceRow, b: RaceRow): number {
  if (a.launched !== b.launched) return a.launched ? -1 : 1;
  if (!a.launched) return byName(a, b);
  return b.central - a.central || byName(a, b);
}

/**
 * Every platform's smooth daily rate at `t`, largest first. Platforms with no
 * volume yet (daily rate 0: not launched at `t`) come last, alphabetically.
 */
export function raceRows(city: City, t: number): RaceRow[] {
  return city.platforms
    .map((pm): RaceRow => {
      const r = dailyRate(pm, t);
      return {
        id: pm.platform.id,
        name: pm.platform.name,
        accent: pm.platform.identity.palette.accent,
        central: r.central,
        low: r.low,
        high: r.high,
        tier: rateTier(pm, t),
        launched: r.central > 0,
      };
    })
    .sort(raceOrder);
}

/** The linear axis maximum: the leader's central value (at least 1, so it is never 0). */
export function raceScale(rows: readonly RaceRow[]): number {
  let max = 1;
  for (const r of rows) if (r.central > max) max = r.central;
  return max;
}

const clamp01 = (x: number) => (x > 1 ? 1 : x > 0 ? x : 0);

/** Bar length as a fraction of the track, clamped to [0, 1]. */
export function barFraction(value: number, scale: number): number {
  return scale > 0 ? clamp01(value / scale) : 0;
}

export interface Whisker {
  /** Left end (low) as a fraction of the track. */
  readonly left: number;
  /** Length (low → high, clamped to the track) as a fraction of the track. */
  readonly width: number;
  /** True when the high end lies beyond the track (it is drawn open-ended). */
  readonly clipped: boolean;
}

/** The plausible-range whisker of a row on the same linear scale as the bars. */
export function whiskerSpan(row: Pick<RaceRow, 'low' | 'high'>, scale: number): Whisker {
  const left = barFraction(row.low, scale);
  const right = barFraction(row.high, scale);
  return { left, width: Math.max(0, right - left), clipped: row.high > scale };
}

// ---------------------------------------------------------------------------
// "What's new" feed
// ---------------------------------------------------------------------------

export interface FeedItem {
  readonly event: TimelineEvent;
  /** Still inside its launch day (the same 72-hour window the city celebrates). */
  readonly isNew: boolean;
}

/** A launch is "new" at `t` while its launch day is on: day ≤ t < day + window. */
export function isNewLaunch(e: TimelineEvent, t: number, windowDays = LAUNCH_WINDOW_DAYS): boolean {
  const d = eventDay(e);
  return d <= t && t < d + windowDays;
}

/** The latest `n` launches on or before `t`, newest first, with the "new" ones pinned first. */
export function feedItems(events: readonly TimelineEvent[], t: number, n = 8): FeedItem[] {
  const items = latestEvents(events, t, n).map((event) => ({
    event,
    isNew: isNewLaunch(event, t),
  }));
  return [...items.filter((i) => i.isNew), ...items.filter((i) => !i.isNew)];
}

/** A compact identity of a feed state, to skip re-rendering when nothing changed. */
export function feedSignature(items: readonly FeedItem[]): string {
  return items.map((i) => `${i.event.id}${i.isNew ? '*' : ''}`).join('|');
}

// ---------------------------------------------------------------------------
// Launch toasts
// ---------------------------------------------------------------------------

/** Put `next` on top of a newest-first stack; anything beyond `max` is dropped (oldest first). */
export function stackToasts<T>(
  stack: readonly T[],
  next: T,
  max: number,
): { visible: T[]; dropped: T[] } {
  const all = [next, ...stack];
  const keep = Math.max(0, max);
  return { visible: all.slice(0, keep), dropped: all.slice(keep) };
}

/**
 * How long to wait before announcing the newest toast to screen readers: let a
 * burst settle (`settleMs`), and never speak more than once per `cooldownMs`.
 * `lastAt` is the time of the previous announcement (−Infinity if none).
 */
export function announceDelay(
  lastAt: number,
  now: number,
  settleMs: number,
  cooldownMs: number,
): number {
  return Math.max(settleMs, lastAt + cooldownMs - now);
}
