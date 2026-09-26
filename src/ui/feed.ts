/**
 * "What's new" (brief §5.3 item 2): the latest model launches up to the date
 * shown, with the ones still inside their 72-hour launch day pinned first and
 * marked "New". A toggle in the control row opens a small popover; scrubbing
 * the time machine updates the list (it is recomputed when the UTC day of the
 * clock changes).
 *
 * Launch toasts: small glass cards when playback (or the live clock) crosses a
 * launch. They stack newest on top (at most three), dismiss themselves, and
 * speak through one visually hidden status line, paced so a burst of launches
 * during fast playback announces only the newest.
 */
import { COPY } from '../copy';
import type { TimelineEvent } from '../data/schema';
import { utcDayStart } from '../model/time';
import type { Clock } from '../state/clock';
import { LAUNCH_WINDOW_DAYS } from '../state/events';
import { announceDelay, feedItems, feedSignature, stackToasts, type FeedItem } from '../state/race';
import { h } from './dom';

/** Strings missing from src/copy.ts (to be moved there by the integrator). */
const EXTRA_COPY = {
  /** Appended, visually hidden, to the toggle's name while the dot is shown. */
  toggleHasNew: (hours: number) => `(includes launches from the last ${hours} hours)`,
  /** Visually hidden hint after each "Source" link. */
  newTab: 'opens in a new tab',
  /** What screen readers hear for a launch toast. */
  toastSpoken: (label: string, platform: string, title: string, date: string) =>
    `${label}: ${platform}, ${title} (${date})`,
} as const;

const FEED_SIZE = 8;
/** Keep the popover this far from the viewport edges. */
const EDGE = 12;
/** Gap between the toggle and the popover (matches the CSS). */
const OFFSET = 8;

let uid = 0;

// ---------------------------------------------------------------------------
// "What's new" feed
// ---------------------------------------------------------------------------

export interface Feed {
  update(): void;
  dispose(): void;
}

interface ItemView {
  readonly li: HTMLLIElement;
  readonly chip: HTMLElement;
}

export function mountFeed(
  root: HTMLElement,
  opts: {
    events: readonly TimelineEvent[];
    clock: Clock;
    platformName(id: string): string;
    accent(id: string): string;
    onSelect(platformId: string): void;
  },
): Feed {
  const n = ++uid;
  const panelId = `feed-panel-${n}`;
  const titleId = `feed-title-${n}`;

  const hint = h('span', { class: 'feed-sr' });
  const toggle = h(
    'button',
    {
      class: 'feed__toggle',
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': panelId,
    },
    COPY.feed.open,
    h('span', { class: 'feed__dot', 'aria-hidden': 'true' }),
    hint,
  );
  const close = h(
    'button',
    { class: 'feed__close', type: 'button', 'aria-label': COPY.feed.close, title: COPY.feed.close },
    '×',
  );
  const list = h('ol', { class: 'feed__list', role: 'list' });
  const empty = h('p', { class: 'feed__empty', hidden: true }, COPY.feed.empty);
  const panel = h(
    'section',
    { class: 'feed__panel', id: panelId, 'aria-labelledby': titleId, tabindex: '-1', hidden: true },
    h(
      'header',
      { class: 'feed__header' },
      h('h2', { class: 'feed__title', id: titleId }, COPY.feed.title),
      close,
    ),
    list,
    empty,
  );
  const wrap = h('div', { class: 'feed' }, toggle, panel);
  root.replaceChildren(wrap);

  const views = new Map<string, ItemView>();
  let items: FeedItem[] = [];
  let lastDay = Number.NaN;
  let lastSig: string | null = null;
  let listDirty = true;
  let isOpen = false;

  function makeItem(e: TimelineEvent): ItemView {
    const chip = h('span', { class: 'feed__new', hidden: true }, COPY.feed.new);
    const platform = h(
      'button',
      { class: 'feed__platform', type: 'button', 'data-platform': e.platform },
      h('span', { class: 'feed__swatch', 'aria-hidden': 'true' }),
      opts.platformName(e.platform),
    );
    platform.style.setProperty('--feed-accent', opts.accent(e.platform));
    const li = h(
      'li',
      { class: 'feed__item', 'data-id': e.id },
      h(
        'p',
        { class: 'feed__meta' },
        h('time', { class: 'feed__date', datetime: e.date }, COPY.time.date(e.date)),
        chip,
      ),
      h(
        'a',
        {
          class: 'feed__source',
          href: e.source.url,
          rel: 'noopener nofollow',
          target: '_blank',
          title: `${e.source.publisher}: ${e.source.title}`,
        },
        COPY.feed.source,
        h('span', { class: 'feed__ext', 'aria-hidden': 'true' }, '↗'),
        h('span', { class: 'feed-sr' }, ` (${EXTRA_COPY.newTab})`),
      ),
      h('p', { class: 'feed__what' }, platform, ' ', h('span', { class: 'feed__event' }, e.title)),
    );
    return { li, chip };
  }

  /** Bring the list in line with `items`, moving only the rows that are out of place. */
  function renderList(): void {
    listDirty = false;
    const hadFocus = list.contains(document.activeElement);
    const keep = new Set(items.map((i) => i.event.id));
    for (const [id, v] of views) {
      if (keep.has(id)) continue;
      v.li.remove();
      views.delete(id);
    }
    let cursor = list.firstElementChild;
    for (const item of items) {
      let v = views.get(item.event.id);
      if (!v) {
        v = makeItem(item.event);
        views.set(item.event.id, v);
      }
      v.chip.hidden = !item.isNew;
      v.li.classList.toggle('feed__item--new', item.isNew);
      if (v.li === cursor) cursor = cursor.nextElementSibling;
      else list.insertBefore(v.li, cursor);
    }
    list.hidden = items.length === 0;
    empty.hidden = items.length > 0;
    // The focused row scrolled out of the feed: keep focus in the popover.
    if (hadFocus && !list.contains(document.activeElement)) panel.focus({ preventScroll: true });
    if (isOpen) updateScrollHint();
  }

  /** Fade the bottom edge while more launches are hidden below. */
  function updateScrollHint(): void {
    const more = list.scrollTop + list.clientHeight < list.scrollHeight - 2;
    list.classList.toggle('feed__list--more', more);
  }

  function recompute(): void {
    const t = opts.clock.now();
    const day = utcDayStart(t);
    if (day === lastDay) return;
    lastDay = day;
    const next = feedItems(opts.events, t, FEED_SIZE);
    const sig = feedSignature(next);
    if (sig === lastSig) return;
    lastSig = sig;
    items = next;
    const anyNew = items.some((i) => i.isNew);
    toggle.classList.toggle('feed__toggle--new', anyNew);
    hint.textContent = anyNew ? ` ${EXTRA_COPY.toggleHasNew(LAUNCH_WINDOW_DAYS * 24)}` : '';
    if (isOpen) renderList();
    else listDirty = true;
  }

  /** Open upwards when there is room (the control row sits low), else downwards; stay on screen. */
  function place(): void {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const footer =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--footer-h')) || 0;
    const r = toggle.getBoundingClientRect();
    const above = r.top - EDGE - OFFSET;
    const below = vh - r.bottom - footer - EDGE - OFFSET;
    const cap = vh * 0.5;
    panel.style.maxHeight = `${Math.round(cap)}px`;
    const natural = panel.offsetHeight;
    const up = above >= natural || above >= below;
    panel.dataset.placement = up ? 'top' : 'bottom';
    panel.style.maxHeight = `${Math.round(Math.max(120, Math.min(cap, up ? above : below)))}px`;
    panel.style.left = '0px';
    const left = wrap.getBoundingClientRect().left;
    const w = panel.offsetWidth;
    // Anchored to the toggle's left edge; if that would leave the screen, centre it instead.
    let dx = left + w > vw - EDGE ? (vw - w) / 2 - left : 0;
    if (left + dx < EDGE) dx = EDGE - left;
    panel.style.left = `${Math.round(dx)}px`;
  }

  const onOutside = (e: PointerEvent) => {
    if (e.target instanceof Node && !wrap.contains(e.target)) closePanel(false);
  };

  function openPanel(): void {
    if (isOpen) return;
    isOpen = true;
    recompute();
    if (listDirty) renderList();
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    place();
    updateScrollHint();
    requestAnimationFrame(() => {
      if (isOpen) panel.classList.add('feed__panel--open');
    });
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', place);
  }

  function closePanel(focusToggle: boolean): void {
    if (!isOpen) return;
    isOpen = false;
    const hadFocus = panel.contains(document.activeElement);
    panel.classList.remove('feed__panel--open');
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', place);
    if (focusToggle || hadFocus) toggle.focus({ preventScroll: true });
  }

  const onToggle = () => (isOpen ? closePanel(false) : openPanel());
  const onClose = () => closePanel(true);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !isOpen) return;
    e.stopPropagation(); // the city also closes its HQ panel on Escape
    closePanel(true);
  };
  const onListClick = (e: MouseEvent) => {
    const btn = e.target instanceof Element ? e.target.closest('.feed__platform') : null;
    const id = btn instanceof HTMLElement ? btn.dataset.platform : undefined;
    if (!id) return;
    closePanel(true);
    opts.onSelect(id);
  };
  toggle.addEventListener('click', onToggle);
  close.addEventListener('click', onClose);
  wrap.addEventListener('keydown', onKey);
  list.addEventListener('click', onListClick);
  list.addEventListener('scroll', updateScrollHint, { passive: true });

  recompute();

  return {
    update: recompute,
    dispose() {
      closePanel(false);
      toggle.removeEventListener('click', onToggle);
      close.removeEventListener('click', onClose);
      wrap.removeEventListener('keydown', onKey);
      list.removeEventListener('click', onListClick);
      list.removeEventListener('scroll', updateScrollHint);
      root.replaceChildren();
    },
  };
}

// ---------------------------------------------------------------------------
// Launch toasts
// ---------------------------------------------------------------------------

export interface Toasts {
  push(e: TimelineEvent): void;
  dispose(): void;
}

const TOAST_MAX = 3;
const TOAST_MS = 4000;
const LEAVE_MS = 300;
/** Let a burst of launches settle before speaking, and speak at most once per cooldown. */
const SETTLE_MS = 250;
const COOLDOWN_MS = 3000;

interface Card {
  readonly el: HTMLElement;
  timer: number;
}

export function mountToasts(
  root: HTMLElement,
  opts: { platformName(id: string): string; accent(id: string): string; reducedMotion: boolean },
): Toasts {
  root.setAttribute('aria-live', 'polite');
  // The cards are for the eyes; the status line speaks (only the newest of a burst).
  const stackEl = h('div', {
    class: `toasts${opts.reducedMotion ? ' toasts--static' : ''}`,
    'aria-hidden': 'true',
  });
  const status = h('p', { class: 'toasts-sr' });
  root.replaceChildren(stackEl, status);

  let stack: Card[] = [];
  const leaving = new Set<number>();
  let pending: TimelineEvent | null = null;
  let announceTimer = 0;
  let lastAnnounce = -Infinity;

  function card(e: TimelineEvent): HTMLElement {
    const el = h(
      'div',
      { class: 'toast' },
      h(
        'p',
        { class: 'toast__head' },
        h('span', { class: 'toast__label' }, COPY.feed.toastLabel),
        h('time', { class: 'toast__date', datetime: e.date }, COPY.time.date(e.date)),
      ),
      h(
        'p',
        { class: 'toast__platform' },
        h('span', { class: 'toast__dot' }),
        opts.platformName(e.platform),
      ),
      h('p', { class: 'toast__title' }, e.title),
    );
    el.style.setProperty('--toast-accent', opts.accent(e.platform));
    return el;
  }

  function remove(c: Card, immediate: boolean): void {
    window.clearTimeout(c.timer);
    if (immediate || opts.reducedMotion) {
      c.el.remove();
      return;
    }
    c.el.classList.add('toast--leave');
    const t = window.setTimeout(() => {
      leaving.delete(t);
      c.el.remove();
    }, LEAVE_MS);
    leaving.add(t);
  }

  function announce(): void {
    announceTimer = 0;
    if (!pending) return;
    const e = pending;
    pending = null;
    lastAnnounce = performance.now();
    status.textContent = EXTRA_COPY.toastSpoken(
      COPY.feed.toastLabel,
      opts.platformName(e.platform),
      e.title,
      COPY.time.date(e.date),
    );
  }

  return {
    push(e) {
      const el = card(e);
      stackEl.prepend(el);
      if (!opts.reducedMotion) {
        el.classList.add('toast--enter');
        void el.offsetWidth; // commit the start state so the entrance transitions
        el.classList.remove('toast--enter');
      }
      const c: Card = { el, timer: 0 };
      c.timer = window.setTimeout(() => {
        stack = stack.filter((x) => x !== c);
        remove(c, false);
      }, TOAST_MS);
      const next = stackToasts(stack, c, TOAST_MAX);
      stack = next.visible;
      for (const d of next.dropped) remove(d, true);

      pending = e;
      if (!announceTimer) {
        announceTimer = window.setTimeout(
          announce,
          announceDelay(lastAnnounce, performance.now(), SETTLE_MS, COOLDOWN_MS),
        );
      }
    },
    dispose() {
      window.clearTimeout(announceTimer);
      for (const t of leaving) window.clearTimeout(t);
      for (const c of stack) window.clearTimeout(c.timer);
      stack = [];
      leaving.clear();
      pending = null;
      root.replaceChildren();
    },
  };
}
