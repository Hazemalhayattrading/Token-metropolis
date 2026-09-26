import { describe, expect, it, vi } from 'vitest';
import { isoToDays } from '../model/time';
import {
  createTimeMachine,
  DEFAULT_SPEED,
  HISTORY_START,
  LIVE_SNAP_DAYS,
  nextSpeed,
  sliderBounds,
  speedPreset,
  SPEEDS,
  trackFraction,
  utcParts,
  type TimeState,
} from './timemachine';

/** A fake live clock and a fake real-time source (ms) the test moves by hand. */
function rig(liveAt = isoToDays('2026-09-26T12:00:00Z')) {
  const clock = { live: liveAt, perf: 1000 };
  const tm = createTimeMachine({ now: () => clock.live }, () => clock.perf);
  const seen: TimeState[] = [];
  tm.subscribe((s) => seen.push(s));
  /** Advance real time by `seconds` (the live clock moves too, at 1:1). */
  const wait = (seconds: number) => {
    clock.perf += seconds * 1000;
    clock.live += seconds / 86_400;
  };
  return { clock, tm, seen, wait };
}

describe('time machine constants', () => {
  it('starts on 2022-11-01 00:00 UTC', () => {
    expect(HISTORY_START).toBe(isoToDays('2022-11-01'));
    expect(Number.isInteger(HISTORY_START)).toBe(true);
    expect(utcParts(HISTORY_START)).toEqual({ date: '2022-11-01', time: '00:00' });
  });

  it('offers week, month and quarter per second, defaulting to a month', () => {
    expect(SPEEDS.map((s) => [s.id, s.daysPerSecond])).toEqual([
      ['week', 7],
      ['month', 30.44],
      ['quarter', 91.31],
    ]);
    expect(DEFAULT_SPEED).toBe(30.44);
    expect(Object.isFrozen(SPEEDS)).toBe(true);
  });
});

describe('live mode', () => {
  it('follows the live clock and is not playing', () => {
    const { clock, tm, seen, wait } = rig();
    expect(tm.state()).toEqual({ mode: 'live', t: clock.live, playing: false, speed: 30.44 });
    wait(10);
    expect(tm.now()).toBe(clock.live);
    expect(tm.liveNow?.()).toBe(clock.live);
    expect(seen).toEqual([]); // no notifications just because time passes
  });
});

describe('seek', () => {
  it('freezes history at the sought time', () => {
    const { tm, seen, wait } = rig();
    const t = isoToDays('2024-03-01T14:05:00Z');
    tm.seek(t);
    expect(tm.state()).toMatchObject({ mode: 'history', t, playing: false });
    wait(30);
    expect(tm.now()).toBe(t);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ mode: 'history', t });
  });

  it('clamps to the start of history', () => {
    const { tm } = rig();
    tm.seek(isoToDays('2020-01-01'));
    expect(tm.state()).toMatchObject({ mode: 'history', t: HISTORY_START });
  });

  it('clamps to the present, which is live mode', () => {
    const { clock, tm, seen } = rig();
    tm.seek(clock.live - 10);
    tm.seek(clock.live + 365);
    expect(tm.state()).toMatchObject({ mode: 'live', t: clock.live, playing: false });
    expect(seen.map((s) => s.mode)).toEqual(['history', 'live']);
  });

  it('snaps to live within one minute of the present', () => {
    const { clock, tm } = rig();
    tm.seek(clock.live - LIVE_SNAP_DAYS * 0.9);
    expect(tm.state().mode).toBe('live');
    tm.seek(clock.live - LIVE_SNAP_DAYS * 1.5);
    expect(tm.state().mode).toBe('history');
  });

  it('ignores non-finite targets', () => {
    const { tm, seen } = rig();
    tm.seek(Number.NaN);
    tm.seek(Number.POSITIVE_INFINITY);
    expect(tm.state().mode).toBe('live');
    expect(seen).toEqual([]);
  });

  it('keeps playing from the new time when seeking during playback', () => {
    const { tm, wait } = rig();
    tm.seek(isoToDays('2023-01-01'));
    tm.play(7);
    wait(2);
    const target = isoToDays('2025-06-01');
    tm.seek(target);
    expect(tm.state()).toMatchObject({ mode: 'history', t: target, playing: true });
    wait(1);
    expect(tm.now()).toBeCloseTo(target + 7, 9);
  });
});

describe('playback', () => {
  it('restarts from the start of history when played from live', () => {
    const { tm, seen, wait } = rig();
    tm.play();
    expect(tm.state()).toMatchObject({
      mode: 'history',
      t: HISTORY_START,
      playing: true,
      speed: DEFAULT_SPEED,
    });
    wait(2);
    expect(tm.now()).toBeCloseTo(HISTORY_START + 2 * DEFAULT_SPEED, 9);
    expect(seen).toHaveLength(1); // not one per frame
  });

  it('plays from the current time in history, at a chosen speed', () => {
    const { tm, wait } = rig();
    const t = isoToDays('2024-01-01');
    tm.seek(t);
    tm.play(91.31);
    wait(0.5);
    expect(tm.state()).toMatchObject({ playing: true, speed: 91.31 });
    expect(tm.now()).toBeCloseTo(t + 0.5 * 91.31, 9);
  });

  it('restarts from the start when played at the very end of history', () => {
    const { clock, tm } = rig();
    const t = clock.live - LIVE_SNAP_DAYS * 2;
    tm.seek(t);
    expect(tm.state().mode).toBe('history');
    clock.live = t + LIVE_SNAP_DAYS / 2; // e.g. the device clock was corrected backwards
    tm.play();
    expect(tm.state()).toMatchObject({ t: HISTORY_START, playing: true });
  });

  it('ignores an invalid speed passed to play', () => {
    const { tm } = rig();
    tm.play(-3);
    expect(tm.state()).toMatchObject({ playing: true, speed: DEFAULT_SPEED });
    tm.pause();
    tm.play(Number.NaN);
    expect(tm.state().speed).toBe(DEFAULT_SPEED);
  });

  it('is a no-op to play while already playing at the same speed', () => {
    const { tm, seen, wait } = rig();
    tm.play();
    wait(1);
    const before = tm.now();
    tm.play();
    tm.play(DEFAULT_SPEED);
    expect(tm.now()).toBe(before);
    expect(seen).toHaveLength(1);
  });

  it('pauses and resumes without losing time', () => {
    const { tm, seen, wait } = rig();
    const t = isoToDays('2024-05-01');
    tm.seek(t);
    tm.play(7);
    wait(1);
    tm.pause();
    const paused = tm.now();
    expect(paused).toBeCloseTo(t + 7, 9);
    expect(tm.state()).toMatchObject({ mode: 'history', playing: false });
    wait(60); // real time passes while paused
    expect(tm.now()).toBe(paused);
    tm.play();
    wait(2);
    expect(tm.now()).toBeCloseTo(paused + 14, 9);
    expect(seen.map((s) => s.playing)).toEqual([false, true, false, true]);
  });

  it('pausing when not playing does nothing', () => {
    const { tm, seen } = rig();
    tm.pause();
    tm.seek(isoToDays('2024-01-01'));
    tm.pause();
    expect(seen).toHaveLength(1);
  });

  it('never runs backwards if the real-time source does', () => {
    const { clock, tm } = rig();
    const t = isoToDays('2024-01-01');
    tm.seek(t);
    tm.play();
    clock.perf -= 500;
    expect(tm.now()).toBe(t);
  });
});

describe('speed changes', () => {
  it('keep t continuous while playing', () => {
    const { tm, seen, wait } = rig();
    const t = isoToDays('2023-06-01');
    tm.seek(t);
    tm.play(7);
    wait(2); // +14 days
    tm.setSpeed(91.31);
    expect(tm.now()).toBeCloseTo(t + 14, 9);
    wait(1); // +91.31 days
    expect(tm.now()).toBeCloseTo(t + 14 + 91.31, 9);
    expect(seen.at(-1)).toMatchObject({ speed: 91.31, playing: true });
  });

  it('apply to the next playback when paused, without moving t', () => {
    const { tm, wait } = rig();
    const t = isoToDays('2023-06-01');
    tm.seek(t);
    tm.setSpeed(7);
    expect(tm.state()).toMatchObject({ t, speed: 7, playing: false });
    tm.play();
    wait(1);
    expect(tm.now()).toBeCloseTo(t + 7, 9);
  });

  it('ignore invalid or unchanged speeds', () => {
    const { tm, seen } = rig();
    tm.setSpeed(0);
    tm.setSpeed(-1);
    tm.setSpeed(Number.POSITIVE_INFINITY);
    tm.setSpeed(DEFAULT_SPEED);
    expect(tm.state().speed).toBe(DEFAULT_SPEED);
    expect(seen).toEqual([]);
  });
});

describe('reaching the present', () => {
  it('switches to live, stops and notifies once, clamped to the live time', () => {
    const { clock, tm, seen, wait } = rig();
    tm.seek(clock.live - 10);
    tm.play(7);
    wait(1);
    expect(tm.state().mode).toBe('history');
    wait(1); // would be 4 days past the present
    expect(tm.now()).toBe(clock.live);
    expect(tm.state()).toMatchObject({ mode: 'live', playing: false, t: clock.live });
    const last = seen.at(-1)!;
    expect(last).toMatchObject({ mode: 'live', playing: false, t: clock.live });
    expect(seen.map((s) => s.mode)).toEqual(['history', 'history', 'live']);
    wait(5);
    tm.now();
    expect(seen).toHaveLength(3);
  });

  it('notifies after the state is updated, so subscribers can read it back safely', () => {
    const { clock, tm, wait } = rig();
    const reads: [TimeState, number][] = [];
    tm.subscribe(() => reads.push([tm.state(), tm.now()]));
    tm.seek(clock.live - 1);
    tm.play(7);
    reads.length = 0;
    wait(1);
    expect(tm.now()).toBe(clock.live);
    expect(reads).toHaveLength(1);
    const [s, t] = reads[0]!;
    expect(s).toMatchObject({ mode: 'live', playing: false });
    expect(t).toBe(clock.live);
  });

  it('lets a subscriber restart playback when the present is reached', () => {
    const { clock, tm, wait } = rig();
    let loops = 0;
    tm.subscribe((s) => {
      if (s.mode === 'live' && loops < 1) {
        loops += 1;
        tm.play();
      }
    });
    tm.seek(clock.live - 1);
    tm.play(7);
    wait(1);
    // the read that crossed the present returns the restarted position, not a stale one
    expect(tm.now()).toBe(HISTORY_START);
    expect(tm.state()).toMatchObject({ mode: 'history', playing: true });
  });

  it('goLive stops playback and returns to the live clock', () => {
    const { clock, tm, seen, wait } = rig();
    tm.play();
    wait(1);
    tm.goLive();
    expect(tm.state()).toMatchObject({ mode: 'live', playing: false, t: clock.live });
    tm.goLive(); // already live: no extra notification
    expect(seen.map((s) => s.mode)).toEqual(['history', 'live']);
  });
});

describe('subscriptions', () => {
  it('unsubscribe stops notifications', () => {
    const { tm } = rig();
    const fn = vi.fn();
    const off = tm.subscribe(fn);
    tm.seek(isoToDays('2024-01-01'));
    off();
    tm.seek(isoToDays('2024-02-01'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a subscriber that throws does not stop the others', () => {
    const { tm } = rig();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fn = vi.fn();
    tm.subscribe(() => {
      throw new Error('boom');
    });
    tm.subscribe(fn);
    tm.seek(isoToDays('2024-01-01'));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('an unsubscribe during a notification is safe', () => {
    const { tm } = rig();
    const second = vi.fn();
    const off = tm.subscribe(() => off());
    tm.subscribe(second);
    tm.seek(isoToDays('2024-01-01'));
    tm.seek(isoToDays('2024-02-01'));
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('each notification carries the state at that moment', () => {
    const { tm, seen } = rig();
    tm.seek(isoToDays('2024-01-01'));
    tm.setSpeed(7);
    tm.play();
    tm.pause();
    tm.goLive();
    expect(seen.map(({ mode, playing, speed }) => [mode, playing, speed])).toEqual([
      ['history', false, DEFAULT_SPEED],
      ['history', false, 7],
      ['history', true, 7],
      ['history', false, 7],
      ['live', false, 7],
    ]);
  });
});

describe('timeline helpers', () => {
  it('slider bounds run from the start of history to the day after today', () => {
    expect(sliderBounds(isoToDays('2026-09-26T12:00:00Z'))).toEqual({
      min: HISTORY_START,
      max: isoToDays('2026-09-27'),
    });
    // a broken device clock before the history start still gives a valid range
    expect(sliderBounds(isoToDays('2020-01-01'))).toEqual({
      min: HISTORY_START,
      max: HISTORY_START + 1,
    });
  });

  it('track fraction is clamped and safe on an empty span', () => {
    expect(trackFraction(5, 0, 10)).toBe(0.5);
    expect(trackFraction(-5, 0, 10)).toBe(0);
    expect(trackFraction(50, 0, 10)).toBe(1);
    expect(trackFraction(5, 10, 10)).toBe(0);
  });

  it('UTC parts truncate to the minute', () => {
    expect(utcParts(isoToDays('2024-03-01T14:05:59.999Z'))).toEqual({
      date: '2024-03-01',
      time: '14:05',
    });
    expect(utcParts(isoToDays('2024-12-31T23:59:00Z'))).toEqual({
      date: '2024-12-31',
      time: '23:59',
    });
  });

  it('speed presets are matched and cycled', () => {
    expect(speedPreset(7)?.id).toBe('week');
    expect(speedPreset(12)).toBeUndefined();
    expect(nextSpeed(7).id).toBe('month');
    expect(nextSpeed(30.44).id).toBe('quarter');
    expect(nextSpeed(91.31).id).toBe('week');
    expect(nextSpeed(12).id).toBe('week');
  });
});
