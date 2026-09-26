/**
 * Model-launch events over time (public/data/events.json): which launches are
 * "on" at a given moment (the 72-hour launch day), which ones a playback just
 * crossed, and the latest ones for the "What's new" feed. Pure functions.
 */
import type { TimelineEvent } from '../data/schema';
import { isoToDays } from '../model/time';

/** How long an HQ celebrates a launch: 72 hours from 00:00 UTC on the launch date. */
export const LAUNCH_WINDOW_DAYS = 3;

export function eventDay(e: TimelineEvent): number {
  return isoToDays(e.date);
}

/** The date as precisely as it is known: YYYY-MM-DD, or YYYY-MM for month-precision launches. */
export function eventDateLabel(e: TimelineEvent): string {
  return e.datePrecision === 'month' ? e.date.slice(0, 7) : e.date;
}

const byId = (a: TimelineEvent, b: TimelineEvent) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Newest first; ties broken by id so the order is stable. */
function newestFirst(a: TimelineEvent, b: TimelineEvent): number {
  return eventDay(b) - eventDay(a) || byId(a, b);
}

/** Oldest first; ties broken by id. */
function oldestFirst(a: TimelineEvent, b: TimelineEvent): number {
  return eventDay(a) - eventDay(b) || byId(a, b);
}

/** Platform id → its launches whose launch day is on at `t` (day ≤ t < day + window), newest first. */
export function activeLaunches(
  events: readonly TimelineEvent[],
  t: number,
  windowDays = LAUNCH_WINDOW_DAYS,
): Map<string, TimelineEvent[]> {
  const out = new Map<string, TimelineEvent[]>();
  for (const e of [...events].sort(newestFirst)) {
    // Without a known day there is no launch day to celebrate.
    if (e.datePrecision === 'month') continue;
    const d = eventDay(e);
    if (d <= t && t < d + windowDays) {
      const list = out.get(e.platform) ?? [];
      list.push(e);
      out.set(e.platform, list);
    }
  }
  return out;
}

/**
 * Launches whose date a forward move from `from` to `to` passed (day in (from, to]), oldest first.
 * Moving backwards (scrubbing into the past) fires nothing.
 */
export function crossedEvents(
  events: readonly TimelineEvent[],
  from: number,
  to: number,
): TimelineEvent[] {
  if (!(to > from)) return [];
  return events
    .filter((e) => {
      const d = eventDay(e);
      return d > from && d <= to;
    })
    .sort(oldestFirst);
}

/** The latest `n` launches on or before `t`, newest first. */
export function latestEvents(
  events: readonly TimelineEvent[],
  t: number,
  n: number,
): TimelineEvent[] {
  return events
    .filter((e) => eventDay(e) <= t)
    .sort(newestFirst)
    .slice(0, Math.max(0, n));
}
