/**
 * Time machine bar: play/pause, playback speed, a scrubber from Nov 2022 to
 * now with launch ticks, the date shown, a History badge and a Live button.
 * Everything is rendered inside the given root; the integrator positions it.
 *
 * The bar reads the TimeMachine (it never keeps its own copy of t): state
 * changes arrive through subscribe() and are drawn at once; update(), called
 * every animation frame, redraws the moving parts at most ~15 times a second
 * and skips every DOM write whose value has not changed.
 */
import { COPY } from '../copy';
import type { TimelineEvent } from '../data/schema';
import { liveClock } from '../state/clock';
import { activeLaunches, crossedEvents, eventDay } from '../state/events';
import {
  nextSpeed,
  sliderBounds,
  speedPreset,
  SPEEDS,
  trackFraction,
  utcParts,
  type TimeMachine,
  type TimeState,
} from '../state/timemachine';
import { h } from './dom';

export interface Timeline {
  update(): void;
  dispose(): void;
}

export interface TimelineOptions {
  /** From public/data/events.json (newest first); only model launches get ticks. */
  readonly events: readonly TimelineEvent[];
  readonly reducedMotion: boolean;
  /** HQ accent colour for a platform's launch ticks. */
  readonly accent: (platformId: string) => string;
}

/** ~15 Hz for the moving parts. */
const WRITE_INTERVAL_MS = 1000 / 15;
/** The scrubber's end follows live time, checked at most once a minute. */
const BOUNDS_INTERVAL_MS = 60_000;
/** While playing, the spoken slider value changes at most once a second. */
const VALUETEXT_PLAYING_MS = 1000;

const SVG_NS = 'http://www.w3.org/2000/svg';
const PLAY_PATH = 'M8 5.6v12.8c0 .6.7 1 1.2.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4c-.5-.3-1.2.1-1.2.7z';
const PAUSE_PATH =
  'M7.5 5h2.8a.7.7 0 0 1 .7.7v12.6a.7.7 0 0 1-.7.7H7.5a.7.7 0 0 1-.7-.7V5.7a.7.7 0 0 1 .7-.7zm6.2 0h2.8a.7.7 0 0 1 .7.7v12.6a.7.7 0 0 1-.7.7h-2.8a.7.7 0 0 1-.7-.7V5.7a.7.7 0 0 1 .7-.7z';
const INFO_PATH =
  'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zm0 1.8a7.7 7.7 0 1 1 0 15.4 7.7 7.7 0 0 1 0-15.4zM11.1 10.4h1.8v6.2h-1.8zM12 6.8a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3z';

function icon(cls: string, d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  return svg;
}

interface Tick {
  readonly event: TimelineEvent;
  readonly day: number;
  readonly el: HTMLSpanElement;
  past: boolean;
  active: boolean;
}

function safeDay(e: TimelineEvent): number {
  try {
    return eventDay(e);
  } catch {
    return Number.NaN;
  }
}

let mounts = 0;

export function mountTimeline(root: HTMLElement, tm: TimeMachine, opts: TimelineOptions): Timeline {
  const noteId = `tl-note-${++mounts}`;
  const perf = () => performance.now();

  // --- structure ------------------------------------------------------------

  const playBtn = h(
    'button',
    {
      class: 'tl__play',
      type: 'button',
      'aria-label': COPY.time.play,
    },
    icon('tl__icon tl__icon--play', PLAY_PATH),
    icon('tl__icon tl__icon--pause', PAUSE_PATH),
  );

  const dateEl = h('time', { class: 'tl__date' });
  const timeEl = h('span', { class: 'tl__time' });
  const readout = h('p', { class: 'tl__readout' }, dateEl, timeEl);

  const note = h('p', { class: 'tl__note', id: noteId, hidden: true }, COPY.time.historyNote);
  const badge = h(
    'button',
    {
      class: 'tl__badge',
      type: 'button',
      title: COPY.time.historyNote,
      'aria-describedby': noteId,
      'aria-controls': noteId,
      'aria-expanded': 'false',
      hidden: true,
    },
    icon('tl__badge-icon', INFO_PATH),
    h('span', {}, COPY.time.historyBadge),
  );

  const speedButtons = SPEEDS.map((s) => {
    const b = h(
      'button',
      { class: 'tl__speed-option', type: 'button', 'aria-pressed': 'false' },
      COPY.time.speeds[s.id],
    );
    b.addEventListener('click', () => tm.setSpeed(s.daysPerSecond));
    return b;
  });
  // Wide bars: a segmented control in the top row. Narrow bars (CSS container query): one
  // button in the bottom row that cycles; its labels share one grid cell so its width never
  // changes. Only one of the two groups is displayed, so only one is in the tab order.
  const speedWide = h(
    'div',
    { class: 'tl__speed tl__speed--wide', role: 'group', 'aria-label': COPY.time.speedLabel },
    ...speedButtons,
  );
  const cycleLabels = SPEEDS.map((s) => h('span', {}, COPY.time.speeds[s.id]));
  const cycleBtn = h(
    'button',
    { class: 'tl__speed-cycle', type: 'button', title: COPY.time.speedLabel },
    h('span', { class: 'tl__speed-stack', 'aria-hidden': 'true' }, ...cycleLabels),
  );
  cycleBtn.addEventListener('click', () => tm.setSpeed(nextSpeed(tm.state().speed).daysPerSecond));
  const speedCompact = h(
    'div',
    { class: 'tl__speed tl__speed--compact', role: 'group', 'aria-label': COPY.time.speedLabel },
    cycleBtn,
  );

  const liveBtn = h(
    'button',
    { class: 'tl__live', type: 'button', 'aria-pressed': 'true' },
    h('span', { class: 'tl__live-dot', 'aria-hidden': 'true' }),
    COPY.time.live,
  );

  const fill = h('div', { class: 'tl__fill' });
  const tickLayer = h('div', { class: 'tl__ticks', 'aria-hidden': 'true' });
  const range = h('input', {
    class: 'tl__range',
    type: 'range',
    step: 1,
    'aria-label': COPY.time.slider,
  });
  const track = h(
    'div',
    { class: 'tl__track' },
    h('div', { class: 'tl__rail', 'aria-hidden': 'true' }, fill),
    tickLayer,
    range,
  );

  const announcer = h('p', { class: 'tl__sr', 'aria-live': 'polite' });

  const bar = h(
    'section',
    {
      class: opts.reducedMotion ? 'tl tl--calm' : 'tl',
      'aria-label': COPY.time.label,
      'data-mode': 'live',
    },
    playBtn,
    h(
      'div',
      { class: 'tl__main' },
      h('div', { class: 'tl__row tl__row--top' }, readout, badge, speedWide, liveBtn),
      h('div', { class: 'tl__row tl__row--bottom' }, track, speedCompact),
    ),
    note,
    announcer,
  );
  root.replaceChildren(bar);

  // --- launch ticks (decorative) ---------------------------------------------

  const ticks: Tick[] = [];
  for (const event of opts.events) {
    if (event.kind !== 'model-launch') continue;
    const day = safeDay(event);
    if (!Number.isFinite(day)) continue;
    const el = h('span', { class: 'tl__tick' });
    el.style.setProperty('--tl-c', opts.accent(event.platform));
    ticks.push({ event, day, el, past: false, active: false });
  }
  const launchEvents = ticks.map((tk) => tk.event);
  const tickById = new Map(ticks.map((tk) => [tk.event.id, tk]));
  tickLayer.append(...ticks.map((tk) => tk.el));

  const pulse = (el: HTMLElement | undefined) => {
    if (!el || typeof el.animate !== 'function') return;
    el.animate(
      [
        { scale: '1 1', filter: 'brightness(1)' },
        { scale: '1.5 2.2', filter: 'brightness(1.9)', offset: 0.2 },
        { scale: '1 1', filter: 'brightness(1)' },
      ],
      { duration: 900, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  };

  // --- scrubber bounds (follow live time, at most once a minute) --------------

  let min = 0;
  let max = 1;
  let lastBoundsAt = Number.NEGATIVE_INFINITY;
  let lastValue = Number.NaN;

  const refreshBounds = () => {
    const b = sliderBounds(tm.liveNow ? tm.liveNow() : liveClock.now());
    if (b.min === min && b.max === max) return;
    min = b.min;
    max = b.max;
    range.min = String(min);
    range.max = String(max);
    for (const tk of ticks) {
      const shown = tk.day >= min && tk.day < max;
      tk.el.hidden = !shown;
      if (shown) tk.el.style.left = `${(trackFraction(tk.day, min, max) * 100).toFixed(3)}%`;
    }
    lastValue = Number.NaN; // re-apply the value against the new range
  };

  // --- drawing ----------------------------------------------------------------

  let dragging = false;
  let lastWriteAt = Number.NEGATIVE_INFINITY;
  let lastP = -1;
  let lastDate = '';
  let lastTime = '\u0000';
  let lastStamp = '';
  let lastVt = '';
  let lastVtAt = Number.NEGATIVE_INFINITY;
  let lastTickKey = '';
  let prevT = Number.NaN;

  /** The moving parts: slider value, fill, readout, spoken value, tick states. */
  const write = (s: TimeState, force: boolean) => {
    const nowMs = perf();
    lastWriteAt = nowMs;
    if (nowMs - lastBoundsAt >= BOUNDS_INTERVAL_MS) {
      lastBoundsAt = nowMs;
      refreshBounds();
    }
    const live = s.mode === 'live';

    const value = live ? max : Math.min(max - 1, Math.max(min, Math.floor(s.t)));
    if (!dragging && value !== lastValue) {
      range.value = String(value);
      lastValue = value;
    }

    const p = live ? 1 : trackFraction(s.t, min, max);
    if (Math.abs(p - lastP) >= 0.0002) {
      track.style.setProperty('--tl-p', p.toFixed(4));
      lastP = p;
    }

    const { date, time } = utcParts(s.t);
    const shownDate = COPY.time.date(date);
    if (shownDate !== lastDate) {
      dateEl.textContent = shownDate;
      lastDate = shownDate;
    }
    const timeText = live ? '' : COPY.time.utcTime(time);
    if (timeText !== lastTime) {
      timeEl.textContent = timeText;
      lastTime = timeText;
    }
    const stamp = live ? date : `${date}T${time}Z`;
    if (stamp !== lastStamp) {
      dateEl.dateTime = stamp;
      lastStamp = stamp;
    }

    const vt = live ? COPY.time.valueLive(shownDate) : COPY.time.valueHistory(shownDate, time);
    if (vt !== lastVt && (force || !s.playing || nowMs - lastVtAt >= VALUETEXT_PLAYING_MS)) {
      range.setAttribute('aria-valuetext', vt);
      lastVt = vt;
      lastVtAt = nowMs;
    }

    // Launch days change on whole UTC days, so tick states only need a day-level refresh.
    const tickKey = `${s.mode}:${Math.floor(s.t)}`;
    if (tickKey !== lastTickKey) {
      lastTickKey = tickKey;
      const on = new Set<string>();
      for (const list of activeLaunches(launchEvents, s.t).values())
        for (const e of list) on.add(e.id);
      for (const tk of ticks) {
        const past = tk.day <= s.t;
        const active = on.has(tk.event.id);
        if (past !== tk.past) {
          tk.past = past;
          tk.el.classList.toggle('is-past', past);
        }
        if (active !== tk.active) {
          tk.active = active;
          tk.el.classList.toggle('is-active', active);
        }
      }
    }

    // A launch the playback just passed flashes its tick (natural playback only, not seeks).
    if (!opts.reducedMotion && s.playing && prevT < s.t && s.t - prevT <= s.speed) {
      for (const e of crossedEvents(launchEvents, prevT, s.t)) pulse(tickById.get(e.id)?.el);
    }
    prevT = s.t;
  };

  // --- controls state (on every notification) ---------------------------------

  let lastMode: TimeState['mode'] = 'live';
  let lastPlaying = false;

  const onDocPointer = (e: PointerEvent) => {
    const target = e.target instanceof Node ? e.target : null;
    if (target && (note.contains(target) || badge.contains(target))) return;
    closeNote(false);
  };
  const openNote = () => {
    note.hidden = false;
    badge.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onDocPointer, true);
  };
  function closeNote(restoreFocus: boolean) {
    if (note.hidden) return;
    note.hidden = true;
    badge.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocPointer, true);
    if (restoreFocus && !badge.hidden) badge.focus();
  }

  const sync = (s: TimeState) => {
    const live = s.mode === 'live';
    bar.dataset.mode = s.mode;
    bar.classList.toggle('is-playing', s.playing);

    // The label (Play / Pause) carries the state; aria-pressed would make "Pause, pressed" ambiguous.
    playBtn.dataset.playing = String(s.playing);
    playBtn.setAttribute('aria-label', s.playing ? COPY.time.pause : COPY.time.play);

    liveBtn.setAttribute('aria-pressed', String(live));
    if (live) liveBtn.removeAttribute('title');
    else liveBtn.title = COPY.time.goLive;

    if (live) {
      closeNote(false);
      if (document.activeElement === badge) liveBtn.focus();
      range.removeAttribute('aria-describedby');
    } else {
      range.setAttribute('aria-describedby', noteId);
    }
    badge.hidden = live;

    const preset = speedPreset(s.speed);
    speedButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(SPEEDS[i] === preset)));
    cycleLabels.forEach((l, i) => l.classList.toggle('is-current', SPEEDS[i] === preset));
    cycleBtn.setAttribute(
      'aria-label',
      preset ? COPY.time.speeds[preset.id] : COPY.time.speedLabel,
    );

    if (live && lastMode === 'history' && lastPlaying)
      announcer.textContent = COPY.time.reachedLive;
    else if (!live) announcer.textContent = '';
    lastMode = s.mode;
    lastPlaying = s.playing;
  };

  // --- input ------------------------------------------------------------------

  playBtn.addEventListener('click', () => {
    if (tm.state().playing) tm.pause();
    else tm.play();
  });
  liveBtn.addEventListener('click', () => tm.goLive());
  badge.addEventListener('click', () => (note.hidden ? openNote() : closeNote(false)));
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !note.hidden) {
      e.stopPropagation();
      closeNote(true);
    }
  });

  range.addEventListener('input', () => {
    const v = Number(range.value);
    if (!Number.isFinite(v)) return;
    if (v >= max) tm.goLive();
    else tm.seek(v);
  });

  // Scrubbing pauses playback and resumes it on release (unless released at "live").
  let resumeAfterDrag = false;
  const stopDragListening = () => {
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  };
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    stopDragListening();
    lastValue = Number.NaN;
    if (resumeAfterDrag) {
      resumeAfterDrag = false;
      if (tm.state().mode === 'history') tm.play();
    }
    write(tm.state(), true);
  }
  range.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || dragging) return;
    dragging = true;
    if (tm.state().playing) {
      resumeAfterDrag = true;
      tm.pause();
    }
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  });

  // A hidden tab should not fast-forward history: pause, and resume when visible again.
  let autoPaused = false;
  const onVisibility = () => {
    if (document.hidden) {
      if (tm.state().playing) {
        autoPaused = true;
        tm.pause();
      }
    } else if (autoPaused) {
      autoPaused = false;
      const s = tm.state();
      if (s.mode === 'history' && !s.playing) tm.play();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const unsubscribe = tm.subscribe((s) => {
    sync(s);
    write(s, true);
  });

  const initial = tm.state();
  sync(initial);
  write(initial, true);

  let disposed = false;
  return {
    update() {
      if (disposed || perf() - lastWriteAt < WRITE_INTERVAL_MS) return;
      write(tm.state(), false);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      stopDragListening();
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', onDocPointer, true);
      root.replaceChildren();
    },
  };
}
