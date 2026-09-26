import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '../data/schema';
import { isoToDays } from '../model/time';
import {
  activeLaunches,
  crossedEvents,
  eventDateLabel,
  eventDay,
  latestEvents,
  LAUNCH_WINDOW_DAYS,
} from './events';

function ev(id: string, date: string, platform = 'p'): TimelineEvent {
  return {
    id,
    date,
    platform,
    kind: 'model-launch',
    title: `${id} released`,
    source: { title: 'Source', publisher: 'Pub', url: 'https://example.com/' },
  } as TimelineEvent;
}

const EVENTS = [
  ev('a', '2024-01-10', 'x'),
  ev('b', '2024-01-11', 'y'),
  ev('c', '2024-03-01', 'x'),
  ev('d', '2024-03-01', 'z'),
];

describe('launch events', () => {
  it('a launch day lasts 72 hours from 00:00 UTC', () => {
    const d = eventDay(EVENTS[0]!);
    expect(activeLaunches(EVENTS, d - 1e-6).has('x')).toBe(false);
    expect(
      activeLaunches(EVENTS, d)
        .get('x')
        ?.map((e) => e.id),
    ).toEqual(['a']);
    expect(activeLaunches(EVENTS, d + LAUNCH_WINDOW_DAYS - 1e-6).has('x')).toBe(true);
    expect(activeLaunches(EVENTS, d + LAUNCH_WINDOW_DAYS).has('x')).toBe(false);
  });

  it('fires crossed launches only when moving forward, oldest first', () => {
    const from = isoToDays('2024-01-01');
    const to = isoToDays('2024-03-02');
    expect(crossedEvents(EVENTS, from, to).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(crossedEvents(EVENTS, to, from)).toEqual([]);
    // a launch exactly at `from` has already fired
    expect(
      crossedEvents(EVENTS, isoToDays('2024-01-10'), isoToDays('2024-01-12')).map((e) => e.id),
    ).toEqual(['b']);
  });

  it('lists the latest launches up to a date, newest first and stable on ties', () => {
    expect(latestEvents(EVENTS, isoToDays('2024-02-01'), 5).map((e) => e.id)).toEqual(['b', 'a']);
    expect(latestEvents(EVENTS, isoToDays('2024-12-31'), 3).map((e) => e.id)).toEqual([
      'c',
      'd',
      'b',
    ]);
    expect(latestEvents(EVENTS, isoToDays('2023-01-01'), 3)).toEqual([]);
  });
});

describe('month-precision launches', () => {
  it('show as YYYY-MM and get no launch day', () => {
    const m = { ...ev('m', '2026-07-15', 'q'), datePrecision: 'month' as const };
    expect(eventDateLabel(m)).toBe('2026-07');
    expect(eventDateLabel(ev('d', '2026-07-15'))).toBe('2026-07-15');
    expect(activeLaunches([m], eventDay(m) + 0.5).size).toBe(0);
  });
});
