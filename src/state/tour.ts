/**
 * Cinematic tour / attract mode (brief §5.3 item 8): after 30 s without input the camera flies a
 * curated tour of the city with captions — made for a TV. This module picks the stops and writes
 * their captions (pure), and detects idleness; the integrator flies the camera and shows the
 * captions (src/ui/tour.ts). Every caption that states a number carries the tier of that number.
 */
import { COPY } from '../copy';
import { dailyRate, globalDailyRate, rateTier, type PlatformModel } from '../model/estimate';
import { atLeastDerived, weakest } from '../model/tier';
import { daysToMs } from '../model/time';
import type { Tier } from '../model/types';
import { humanNumber } from '../ui/format';
import type { City } from './city';
import { daylight, localHour, localTimeLabel } from './localtime';

export interface TourStop {
  readonly kind: 'overview' | 'hq';
  /** Platform id of an "hq" stop. */
  readonly id?: string;
  /** How long to hold the caption once the camera has arrived (seconds). */
  readonly holdSeconds: number;
  readonly caption: string;
  /** Present exactly when the caption states an estimate: its tier (a clock time is not one). */
  readonly tier?: Tier;
}

/** Idle time before the tour starts (brief: 30 s). */
export const TOUR_IDLE_MS = 30_000;
/** The window the "fastest-growing" stop compares over (days). */
export const GROWTH_WINDOW_DAYS = 90;
/** An HQ counts as in daytime from this much daylight (0.5 ≈ 06:30–19:00 local; see localtime.ts). */
const DAYTIME = 0.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Long enough to read the caption from a sofa: a 3.5 s settle plus ~16 characters a second,
 * 6–10 s, plus `extra` for the opening and the finale. Tenths of a second.
 */
export function holdFor(caption: string, extra = 0): number {
  return Math.round((clamp(3.5 + caption.length / 16, 6, 10) + extra) * 10) / 10;
}

/** humanNumber ("270 trillion"), kept on one line in the large caption type (a no-break space). */
export function captionNumber(n: number): string {
  return humanNumber(n).replace(' ', '\u00a0');
}

interface Row {
  readonly pm: PlatformModel;
  /** Central daily rate at t (tokens/day). */
  readonly rate: number;
}

const byId = (a: Row, b: Row) =>
  a.pm.platform.id < b.pm.platform.id ? -1 : a.pm.platform.id > b.pm.platform.id ? 1 : 0;

/** "56" (percent, below 2×) or "3.2" / "12" (times), or null when there is no growth to show. */
function growthLabel(ratio: number): { kind: 'percent' | 'multiple'; value: string } | null {
  if (!(ratio < 2)) {
    return { kind: 'multiple', value: ratio < 10 ? ratio.toFixed(1) : String(Math.round(ratio)) };
  }
  const pct = Math.round((ratio - 1) * 100);
  return pct >= 1 ? { kind: 'percent', value: String(pct) } : null;
}

/**
 * The tour at time `t` (days since the epoch): an opening overview; the three largest HQs by daily
 * tokens; the smallest; the fastest-growing over the last 90 days (skipped when no HQ grew or no
 * comparison is possible); an HQ in daytime at its local time (skipped when every HQ is in night);
 * and a closing overview with the city total. 6–8 stops whenever at least four HQs have launched;
 * fewer early in the time machine's history (only the opening when nothing has launched).
 */
export function tourStops(city: City, t: number): TourStop[] {
  const stops: TourStop[] = [];
  const overview = (caption: string, extra: number, tier?: Tier) =>
    stops.push({
      kind: 'overview',
      caption,
      holdSeconds: holdFor(caption, extra),
      ...(tier && { tier }),
    });
  const hq = (id: string, caption: string, tier?: Tier) =>
    stops.push({ kind: 'hq', id, caption, holdSeconds: holdFor(caption), ...(tier && { tier }) });

  overview(COPY.tour.opening, 1);
  if (!Number.isFinite(t)) return stops;

  const rows: Row[] = city.platforms
    .map((pm) => ({ pm, rate: dailyRate(pm, t).central }))
    .filter((r) => Number.isFinite(r.rate) && r.rate > 0)
    .sort((a, b) => b.rate - a.rate || byId(a, b));
  if (rows.length === 0) return stops;

  // The three largest, then the smallest (a contrast only once there is a fourth HQ).
  rows.slice(0, 3).forEach((r, i) => {
    const lead = COPY.tour.ranks[i]!;
    const text = COPY.tour.ranked(lead, r.pm.platform.name, captionNumber(r.rate));
    hq(r.pm.platform.id, text, rateTier(r.pm, t));
  });
  const last = rows[rows.length - 1]!;
  if (rows.length >= 4) {
    const text = COPY.tour.smallest(last.pm.platform.name, captionNumber(last.rate));
    hq(last.pm.platform.id, text, rateTier(last.pm, t));
  }

  // Fastest-growing: today's daily rate against the one 90 days earlier (both must exist).
  const t0 = t - GROWTH_WINDOW_DAYS;
  let fastest: { row: Row; ratio: number } | null = null;
  for (const row of rows) {
    const before = dailyRate(row.pm, t0).central;
    if (!(Number.isFinite(before) && before > 0)) continue;
    const ratio = row.rate / before;
    if (!Number.isFinite(ratio)) continue;
    if (!fastest || ratio > fastest.ratio) fastest = { row, ratio };
  }
  const growth = fastest && growthLabel(fastest.ratio);
  if (fastest && growth) {
    const { pm } = fastest.row;
    const text =
      growth.kind === 'percent'
        ? COPY.tour.growthPercent(pm.platform.name, growth.value)
        : COPY.tour.growthMultiple(pm.platform.name, growth.value);
    // A ratio of two estimates is a calculation: at best Estimated, never Reported.
    hq(pm.platform.id, text, atLeastDerived(weakest(rateTier(pm, t), rateTier(pm, t0))));
  }

  // Daytime somewhere: prefer the HQ the tour has visited least (ideally not at all), then the most
  // daylight, then the largest. A clock time is not an estimate, so this caption has no tier (as
  // in the HQ panel).
  const ms = daysToMs(t);
  const visits = (id: string) => stops.filter((s) => s.id === id).length;
  const day = rows
    .map((r) => ({
      r,
      light: daylight(localHour(r.pm.platform.hq.timezone, ms)),
      seen: visits(r.pm.platform.id),
    }))
    .filter((d) => d.light >= DAYTIME)
    .sort(
      (a, b) => a.seen - b.seen || b.light - a.light || b.r.rate - a.r.rate || byId(a.r, b.r),
    )[0];
  if (day) {
    const p = day.r.pm.platform;
    hq(p.id, COPY.tour.daytime(p.name, p.hq.city, localTimeLabel(p.hq.timezone, ms)));
  }

  // The city total, counted once (routed tokens removed, as in the HUD). A sum is a calculation,
  // so at best Estimated; never better than the weakest launched HQ; and Modeled when routing
  // shares (judgement calls) de-duplicate it.
  const total = globalDailyRate(city.platforms, t).central;
  const routed = rows.some((r) => r.pm.components.some((c) => c.routed.high > 0));
  const tier = atLeastDerived(
    weakest(...rows.map((r) => rateTier(r.pm, t)), routed ? 'modeled' : 'reported'),
  );
  overview(COPY.tour.closing(captionNumber(total)), 1.5, tier);
  return stops;
}

// ---------------------------------------------------------------------------
// Idle detection
// ---------------------------------------------------------------------------

export interface IdleTimer {
  /** True after the timeout fired, until the next activity. */
  readonly idle: boolean;
  dispose(): void;
}

/** What counts as someone using the page. */
const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
/**
 * Pointer moves shorter than this (CSS pixels, from the last counted position) are not activity:
 * browsers send moves when the content changes under a still cursor, e.g. when a caption appears.
 */
const MOVE_EPSILON = 4;
/** setTimeout's longest delay; longer ones fire at once. */
const MAX_DELAY = 2_147_483_647;

/**
 * Calls `onIdle` once when no pointer, key, wheel or touch activity has reached `target` (default:
 * window) for `timeoutMs`, then `onActive` on the next activity, after which the countdown starts
 * again. Listens in the capture phase, so no component can swallow the activity.
 * `timeoutMs: Infinity` never goes idle.
 */
export function createIdleTimer(opts: {
  timeoutMs: number;
  onIdle(): void;
  onActive(): void;
  target?: EventTarget;
}): IdleTimer {
  const target = opts.target ?? window;
  const ms = opts.timeoutMs;
  const delay = ms === Infinity ? null : clamp(Number.isFinite(ms) ? ms : 0, 0, MAX_DELAY);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle = false;
  let disposed = false;
  let anchor: { x: number; y: number } | null = null;

  const fire = () => {
    timer = undefined;
    if (disposed || idle) return;
    idle = true;
    opts.onIdle();
  };
  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = delay === null ? undefined : setTimeout(fire, delay);
  };

  /** Whether a pointer move went somewhere (moves without coordinates always count). */
  const moved = (e: Event): boolean => {
    const { clientX: x, clientY: y } = e as Partial<PointerEvent>;
    if (typeof x !== 'number' || typeof y !== 'number') return true;
    if (!anchor) {
      // First sighting: a baseline. While idle it is not activity (it may be a synthetic move).
      anchor = { x, y };
      return !idle;
    }
    if (Math.hypot(x - anchor.x, y - anchor.y) < MOVE_EPSILON) return false;
    anchor = { x, y };
    return true;
  };

  const onActivity = (e: Event) => {
    if (disposed || (e.type === 'pointermove' && !moved(e))) return;
    arm();
    if (idle) {
      idle = false;
      opts.onActive();
    }
  };

  const listen = { capture: true, passive: true } as const;
  for (const type of ACTIVITY) target.addEventListener(type, onActivity, listen);
  arm();

  return {
    get idle() {
      return idle;
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      for (const type of ACTIVITY) target.removeEventListener(type, onActivity, listen);
    },
  };
}
