/**
 * The time machine: a Clock that either follows live time or shows a moment in
 * the city's history (Nov 2022 → now), optionally playing it forward at a
 * cinematic speed. DOM-free and deterministic: the live clock and the real-time
 * source are injected, so tests drive it with fake clocks.
 *
 * Playback is computed, never accumulated: while playing, t = t0 + elapsed × speed
 * from an anchor that is reset on every seek, speed change or resume. That keeps
 * t exact after dropped frames and lets several readers share one position.
 */
import { daysToMs, isoToDays } from '../model/time';
import type { Clock } from './clock';

/** First moment the time machine can show: 2022-11-01T00:00Z (days since epoch). */
export const HISTORY_START = isoToDays('2022-11-01');

/** A seek this close to the present (1 minute, in days) snaps back to live mode. */
export const LIVE_SNAP_DAYS = 1 / 1440;

export interface Speed {
  readonly id: 'week' | 'month' | 'quarter';
  readonly daysPerSecond: number;
}

/** Playback speeds; their labels are COPY.time.speeds[id]. */
export const SPEEDS: readonly Speed[] = Object.freeze<Speed[]>([
  { id: 'week', daysPerSecond: 7 },
  { id: 'month', daysPerSecond: 30.44 },
  { id: 'quarter', daysPerSecond: 91.31 },
]);

/** Default playback speed: one month per second (the whole history in about 47 s). */
export const DEFAULT_SPEED = SPEEDS[1]!.daysPerSecond;

export type TimeMode = 'live' | 'history';

export interface TimeState {
  readonly mode: TimeMode;
  readonly t: number;
  readonly playing: boolean;
  /** Days per second. */
  readonly speed: number;
}

export interface TimeMachine extends Clock {
  /**
   * Live mode: the live clock. History: the frozen t, or the playback position
   * (clamped to the present) while playing. Reaching the present switches to
   * live mode, stops playing and notifies subscribers.
   */
  now(): number;
  state(): TimeState;
  /** Clamp to [HISTORY_START, live now]; within LIVE_SNAP_DAYS of now → live. Keeps playing if playing. */
  seek(t: number): void;
  /** Play from the current t (from HISTORY_START when live or at the end), optionally at a new speed. */
  play(speed?: number): void;
  pause(): void;
  /** Change the playback speed without a jump in t. */
  setSpeed(daysPerSecond: number): void;
  goLive(): void;
  /** Fires on mode/playing/speed changes, seeks and reaching live — not every frame. */
  subscribe(fn: (s: TimeState) => void): () => void;
  /**
   * Extra (optional in the type so a hand-rolled TimeMachine that follows the contract still
   * fits; createTimeMachine always provides it): the live clock's time, whatever the mode.
   */
  liveNow?(): number;
}

const isSpeed = (d: number): boolean => Number.isFinite(d) && d > 0;

export function createTimeMachine(
  live: Clock,
  perfNow: () => number = () => performance.now(),
): TimeMachine {
  let mode: TimeMode = 'live';
  let playing = false;
  let speed = DEFAULT_SPEED;
  /** History anchor in model days, and the real time (ms) it was taken at. */
  let t0 = HISTORY_START;
  let p0 = 0;
  /** A state change subscribers have not heard about yet. */
  let dirty = false;
  const subscribers = new Set<(s: TimeState) => void>();

  /** Current position. Applies "playback reached the present" as a side effect (sets dirty). */
  const read = (): number => {
    if (mode === 'live') return live.now();
    if (!playing) return t0;
    const end = live.now();
    const t = t0 + (Math.max(0, perfNow() - p0) / 1000) * speed;
    if (t < end) return t;
    mode = 'live';
    playing = false;
    dirty = true;
    return end;
  };

  /** Re-anchor playback at `t` from this instant. */
  const anchor = (t: number) => {
    t0 = t;
    p0 = perfNow();
  };

  const snapshot = (): TimeState => {
    const t = read();
    return { mode, t, playing, speed };
  };

  /** Notify once the state is final; a subscriber may call back into the machine safely. */
  const flush = () => {
    if (!dirty) return;
    dirty = false;
    const s = snapshot();
    for (const fn of [...subscribers]) {
      try {
        fn(s);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const now = (): number => {
    const t = read();
    if (!dirty) return t;
    flush();
    return read();
  };

  return {
    now,

    state() {
      const t = now();
      return { mode, t, playing, speed };
    },

    seek(target) {
      if (!Number.isFinite(target)) return;
      read();
      const end = live.now();
      const t = Math.min(Math.max(target, HISTORY_START), end);
      if (end - t <= LIVE_SNAP_DAYS) {
        mode = 'live';
        playing = false;
      } else {
        mode = 'history';
        anchor(t);
      }
      dirty = true;
      flush();
    },

    play(newSpeed) {
      const t = read();
      const changedSpeed = newSpeed !== undefined && isSpeed(newSpeed) && newSpeed !== speed;
      if (playing && !changedSpeed) {
        flush();
        return;
      }
      if (changedSpeed) speed = newSpeed;
      const atEnd = mode === 'live' || live.now() - t <= LIVE_SNAP_DAYS;
      mode = 'history';
      anchor(atEnd ? HISTORY_START : t);
      playing = true;
      dirty = true;
      flush();
    },

    pause() {
      const t = read();
      if (playing) {
        t0 = t;
        playing = false;
        dirty = true;
      }
      flush();
    },

    setSpeed(daysPerSecond) {
      if (!isSpeed(daysPerSecond)) return;
      const t = read();
      if (daysPerSecond !== speed) {
        if (playing) anchor(t);
        speed = daysPerSecond;
        dirty = true;
      }
      flush();
    },

    goLive() {
      read();
      if (mode !== 'live' || playing) {
        mode = 'live';
        playing = false;
        dirty = true;
      }
      flush();
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    liveNow: () => live.now(),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers for the timeline UI (kept here so they are unit-tested)
// ---------------------------------------------------------------------------

/** Scrubber bounds in whole days: min = HISTORY_START, max = the day after today (the "live" end). */
export function sliderBounds(liveNow: number): { min: number; max: number } {
  const min = Math.floor(HISTORY_START);
  return { min, max: Math.max(min + 1, Math.floor(liveNow) + 1) };
}

/** Position of t along [min, max] as 0..1 (clamped; 0 when the span is empty). */
export function trackFraction(t: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return Math.min(1, Math.max(0, (t - min) / (max - min)));
}

/** "2024-03-01" and "14:05" (UTC, truncated to the minute) for a time in days since epoch. */
export function utcParts(t: number): { date: string; time: string } {
  const iso = new Date(daysToMs(t)).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** The preset matching a speed, if any. */
export function speedPreset(daysPerSecond: number): Speed | undefined {
  return SPEEDS.find((s) => s.daysPerSecond === daysPerSecond);
}

/** The next preset after the current speed, cycling (a custom speed goes to the first preset). */
export function nextSpeed(daysPerSecond: number): Speed {
  const i = SPEEDS.findIndex((s) => s.daysPerSecond === daysPerSecond);
  return SPEEDS[(i + 1) % SPEEDS.length]!;
}
