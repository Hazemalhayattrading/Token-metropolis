/**
 * Discoveries tracker (brief §5.3 item 9): a subtle chip in the control row —
 * "12/40 details found" with a small progress ring — that opens a list of the
 * forty hidden details: found ones by title (and where), the rest as "?" with
 * their hint. The list can reset progress (after an inline confirmation).
 *
 * celebrate(id) shows a brief toast "Found: <title>" (a polite live region;
 * no motion with prefers-reduced-motion) and gives the chip a short glow.
 * The toast lives in <body>: details inside an HQ are found while the HQ
 * panel is open, when the control row is hidden.
 */
import { COPY } from '../copy';
import {
  DISCOVERIES,
  DISCOVERY_WHERES,
  type Discovery,
  type DiscoveryWhere,
  type Tracker,
} from '../state/discoveries';
import { h } from './dom';

export interface DiscoveryUI {
  /** Re-sync with the tracker (it also listens to the tracker itself). */
  update(): void;
  /** Show the "Found" toast for a detail that was just found. */
  celebrate(id: string): void;
  dispose(): void;
}

export interface DiscoveryUIOptions {
  /** HQ name for a found detail that lives in one HQ ("Server halls · DeepSeek"). */
  platformName?(id: string): string | undefined;
  /** Defaults to the prefers-reduced-motion media query. */
  reducedMotion?: boolean;
  /**
   * "Show me" on a detail not found yet: take the visitor to it (and count it found). The path to
   * the details for keyboard and screen-reader users, who cannot aim at the 3D scene.
   */
  onReveal?(id: string): void;
}

const EDGE = 12;
const OFFSET = 8;
const TOAST_MS = 3400;
const TOAST_LEAVE_MS = 320;
const PULSE_MS = 1400;
const RING_R = 6.25;
const RING_C = 2 * Math.PI * RING_R;

let uid = 0;

const items: Readonly<Record<string, { title: string; hint: string }>> = COPY.discoveries.items;
const copyOf = (id: string) => (Object.hasOwn(items, id) ? items[id] : undefined);

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function ring(): { el: SVGElement; bar: SVGElement } {
  const el = svg('svg', {
    class: 'disc__ring',
    viewBox: '0 0 16 16',
    width: '16',
    height: '16',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const track = svg('circle', { cx: '8', cy: '8', r: String(RING_R), class: 'disc__ring-track' });
  const bar = svg('circle', {
    cx: '8',
    cy: '8',
    r: String(RING_R),
    class: 'disc__ring-bar',
    'stroke-dasharray': `0 ${RING_C}`,
    transform: 'rotate(-90 8 8)',
  });
  el.append(track, bar);
  return { el, bar };
}

/** A small magnifying glass (the toast's mark). */
function lens(): SVGElement {
  const el = svg('svg', {
    class: 'disc-toast__mark',
    viewBox: '0 0 20 20',
    width: '18',
    height: '18',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  el.append(
    svg('circle', { cx: '8.5', cy: '8.5', r: '5.5' }),
    svg('path', { d: 'M12.6 12.6 17 17' }),
  );
  return el;
}

interface Row {
  readonly d: Discovery;
  readonly li: HTMLLIElement;
  readonly mark: HTMLElement;
  readonly sr: HTMLElement;
  readonly text: HTMLElement;
  readonly meta: HTMLElement;
  readonly show: HTMLButtonElement | null;
  found: boolean | null;
}

export function mountDiscoveries(
  root: HTMLElement,
  tracker: Tracker,
  opts: DiscoveryUIOptions = {},
): DiscoveryUI {
  const n = ++uid;
  const panelId = `disc-panel-${n}`;
  const titleId = `disc-title-${n}`;
  const confirmId = `disc-confirm-${n}`;
  const reducedMotion =
    opts.reducedMotion ??
    (() => {
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        return false;
      }
    })();

  // --- chip ---------------------------------------------------------------------------------------
  const { el: ringEl, bar } = ring();
  const chipFull = h('span', { class: 'disc__count-full' });
  const chipShort = h('span', { class: 'disc__count-short' });
  const chipText = h('span', { class: 'disc__count' }, chipFull, chipShort);
  const chip = h(
    'button',
    { class: 'disc__chip', type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId },
    ringEl,
    chipText,
  );

  // --- panel ----------------------------------------------------------------------------------------
  const tally = h('span', { class: 'disc__tally' });
  const close = h(
    'button',
    {
      class: 'disc__close',
      type: 'button',
      'aria-label': COPY.discoveries.close,
      title: COPY.discoveries.close,
    },
    '×',
  );
  const progress = h('span', { class: 'disc__progress-bar' });
  const list = h('div', { class: 'disc__list' });
  const rows: Row[] = [];
  const groupTallies = new Map<DiscoveryWhere, HTMLElement>();
  for (const where of DISCOVERY_WHERES) {
    const ds = DISCOVERIES.filter((d) => d.where === where);
    if (ds.length === 0) continue;
    const groupTally = h('span', { class: 'disc__group-tally' });
    groupTallies.set(where, groupTally);
    const ul = h('ul', { class: 'disc__items', role: 'list' });
    for (const d of ds) {
      const mark = h('span', { class: 'disc__mark', 'aria-hidden': 'true' });
      const sr = h('span', { class: 'disc-sr' });
      const text = h('span', { class: 'disc__text' });
      const meta = h('span', { class: 'disc__meta' });
      const show = opts.onReveal
        ? h(
            'button',
            {
              class: 'disc__show',
              type: 'button',
              'aria-label': COPY.discoveries.revealLabel(copyOf(d.id)?.hint ?? d.id),
            },
            COPY.discoveries.reveal,
          )
        : null;
      show?.addEventListener('click', () => {
        closePanel(true);
        opts.onReveal?.(d.id);
      });
      const li = h(
        'li',
        { class: 'disc__item', 'data-id': d.id },
        mark,
        h('span', { class: 'disc__body' }, sr, text, meta),
        show,
      );
      rows.push({ d, li, mark, sr, text, meta, show, found: null });
      ul.append(li);
    }
    list.append(
      h(
        'section',
        { class: 'disc__group' },
        h('h3', { class: 'disc__group-title' }, COPY.discoveries.where[where], groupTally),
        ul,
      ),
    );
  }
  const reset = h('button', { class: 'disc__reset', type: 'button' }, COPY.discoveries.reset);
  const confirmText = h('p', { class: 'disc__confirm-text', id: confirmId });
  const yes = h('button', { class: 'disc__yes', type: 'button' }, COPY.discoveries.resetYes);
  const no = h('button', { class: 'disc__no', type: 'button' }, COPY.discoveries.resetNo);
  const confirm = h(
    'div',
    { class: 'disc__confirm', role: 'group', 'aria-labelledby': confirmId, hidden: true },
    confirmText,
    h('span', { class: 'disc__confirm-actions' }, no, yes),
  );
  const note = h('p', { class: 'disc-sr', role: 'status', 'aria-live': 'polite' });
  const panel = h(
    'section',
    { class: 'disc__panel', id: panelId, 'aria-labelledby': titleId, tabindex: '-1', hidden: true },
    h(
      'header',
      { class: 'disc__header' },
      h('h2', { class: 'disc__title', id: titleId }, COPY.discoveries.title),
      tally,
      close,
    ),
    h('span', { class: 'disc__progress', 'aria-hidden': 'true' }, progress),
    h('p', { class: 'disc__intro' }, COPY.discoveries.intro),
    h('p', { class: 'disc__honesty' }, COPY.discoveries.honesty),
    list,
    h('footer', { class: 'disc__footer' }, reset, confirm),
    note,
  );
  const wrap = h('div', { class: 'disc' }, chip, panel);
  root.replaceChildren(wrap);

  // --- toast (in <body>) --------------------------------------------------------------------------
  const toastText = h('span', { class: 'disc-toast__text' });
  const toastCount = h('span', { class: 'disc-toast__count' });
  const toastCard = h(
    'div',
    { class: 'disc-toast__card' },
    lens(),
    h('span', { class: 'disc-toast__body' }, toastText, toastCount),
  );
  // The card is for the eyes; an always-present status line speaks (a live region that appears at
  // the moment its text changes is not reliably announced).
  const toast = h(
    'div',
    { class: `disc-toast${reducedMotion ? ' disc-toast--static' : ''}`, 'aria-hidden': 'true' },
    toastCard,
  );
  toast.hidden = true;
  const spoken = h('p', { class: 'disc-sr', role: 'status', 'aria-live': 'polite' });
  document.body.append(toast, spoken);

  let isOpen = false;
  let lastCount = -1;
  let toastTimer = 0;
  let leaveTimer = 0;
  let pulseTimer = 0;

  function whereLabel(d: Discovery): string {
    const where = COPY.discoveries.where[d.where];
    const hq = d.platform ? opts.platformName?.(d.platform) : undefined;
    return hq ? COPY.discoveries.inHq(where, hq) : '';
  }

  function render(): void {
    const count = tracker.count;
    const total = tracker.total;
    lastCount = count;
    chipFull.textContent = COPY.discoveries.chip(count, total);
    chipShort.textContent = COPY.discoveries.chipShort(count, total);
    chip.setAttribute('aria-label', COPY.discoveries.chipLabel(count, total));
    chip.classList.toggle('disc__chip--complete', count >= total && total > 0);
    const f = total > 0 ? count / total : 0;
    bar.setAttribute('stroke-dasharray', `${(f * RING_C).toFixed(2)} ${RING_C.toFixed(2)}`);
    tally.textContent = COPY.discoveries.count(count, total);
    progress.style.width = `${(f * 100).toFixed(1)}%`;
    for (const [where, el] of groupTallies) {
      const ds = DISCOVERIES.filter((d) => d.where === where);
      el.textContent = COPY.discoveries.count(
        ds.filter((d) => tracker.has(d.id)).length,
        ds.length,
      );
    }
    for (const r of rows) {
      const found = tracker.has(r.d.id);
      if (found === r.found) continue;
      r.found = found;
      const c = copyOf(r.d.id);
      r.li.classList.toggle('disc__item--found', found);
      r.mark.textContent = found ? '✓' : COPY.discoveries.unknown;
      r.sr.textContent = `${found ? COPY.discoveries.foundLabel : COPY.discoveries.unknownLabel} `;
      r.text.textContent = found ? (c?.title ?? r.d.id) : (c?.hint ?? '');
      const meta = found ? whereLabel(r.d) : '';
      r.meta.textContent = meta;
      r.meta.hidden = meta === '';
      if (r.show) r.show.hidden = found;
    }
    reset.disabled = count === 0;
    if (count === 0 && !confirm.hidden) hideConfirm(false);
  }

  function update(): void {
    if (tracker.count !== lastCount) render();
  }

  // --- popover placement and open/close (as the "What's new" feed) ------------------------------
  function place(): void {
    const vh = window.innerHeight;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const footer =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--footer-h')) || 0;
    const r = chip.getBoundingClientRect();
    const above = r.top - EDGE - OFFSET;
    const below = vh - r.bottom - footer - EDGE - OFFSET;
    const cap = vh * 0.6;
    panel.style.maxHeight = `${Math.round(cap)}px`;
    const natural = panel.offsetHeight;
    const up = above >= natural || above >= below;
    panel.dataset.placement = up ? 'top' : 'bottom';
    panel.style.maxHeight = `${Math.round(Math.max(160, Math.min(cap, up ? above : below)))}px`;
    panel.style.left = '0px';
    const left = wrap.getBoundingClientRect().left;
    const w = panel.offsetWidth;
    let dx = left + w > vw - EDGE ? (vw - w) / 2 - left : 0;
    if (left + dx < EDGE) dx = EDGE - left;
    panel.style.left = `${Math.round(dx)}px`;
  }

  /** Fade the bottom edge while more details are hidden below. */
  function updateScrollHint(): void {
    list.classList.toggle(
      'disc__list--more',
      list.scrollTop + list.clientHeight < list.scrollHeight - 2,
    );
  }

  const onOutside = (e: PointerEvent) => {
    if (e.target instanceof Node && !wrap.contains(e.target)) closePanel(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !isOpen) return;
    e.stopPropagation(); // the city also closes its HQ panel on Escape
    if (!confirm.hidden) hideConfirm(true);
    else closePanel(true);
  };

  function openPanel(): void {
    if (isOpen) return;
    isOpen = true;
    render();
    panel.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    place();
    updateScrollHint();
    requestAnimationFrame(() => {
      if (isOpen) panel.classList.add('disc__panel--open');
    });
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
  }

  function closePanel(focusChip: boolean): void {
    if (!isOpen) return;
    isOpen = false;
    const hadFocus = panel.contains(document.activeElement);
    hideConfirm(false);
    panel.classList.remove('disc__panel--open');
    panel.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    if (focusChip || hadFocus) chip.focus({ preventScroll: true });
  }

  // --- reset with confirmation ------------------------------------------------------------------------
  function showConfirm(): void {
    confirmText.textContent = COPY.discoveries.resetConfirm(tracker.count);
    confirm.hidden = false;
    reset.hidden = true;
    no.focus({ preventScroll: true }); // the safe choice has focus
  }

  function hideConfirm(focusReset: boolean): void {
    confirm.hidden = true;
    reset.hidden = false;
    if (focusReset) reset.focus({ preventScroll: true });
  }

  const onChip = () => (isOpen ? closePanel(false) : openPanel());
  const onClose = () => closePanel(true);
  const onReset = () => showConfirm();
  const onNo = () => hideConfirm(true);
  const onYes = () => {
    tracker.reset(); // re-renders through the subscription
    hideConfirm(false);
    render();
    note.textContent = '';
    note.textContent = COPY.discoveries.resetDone;
    // The reset button is disabled now (nothing to forget): keep focus in the list.
    panel.focus({ preventScroll: true });
  };
  chip.addEventListener('click', onChip);
  close.addEventListener('click', onClose);
  reset.addEventListener('click', onReset);
  no.addEventListener('click', onNo);
  yes.addEventListener('click', onYes);
  list.addEventListener('scroll', updateScrollHint, { passive: true });
  const unsubscribe = tracker.subscribe(render);

  render();

  // --- toast ---------------------------------------------------------------------------------------------
  function hideToast(): void {
    window.clearTimeout(toastTimer);
    if (reducedMotion) {
      toast.hidden = true;
      return;
    }
    toast.classList.remove('disc-toast--in');
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => (toast.hidden = true), TOAST_LEAVE_MS);
  }

  function celebrate(id: string): void {
    const c = copyOf(id);
    if (!c) return;
    render();
    const all = tracker.count >= tracker.total;
    toastText.textContent = all
      ? COPY.discoveries.allFound(tracker.total)
      : COPY.discoveries.toast(c.title);
    toastCount.textContent = all
      ? COPY.discoveries.toast(c.title)
      : COPY.discoveries.toastProgress(tracker.count, tracker.total);
    // Clear first so the same message is announced again.
    spoken.textContent = '';
    spoken.textContent = `${toastText.textContent}. ${toastCount.textContent}`;
    window.clearTimeout(leaveTimer);
    toast.hidden = false;
    if (!reducedMotion) {
      void toast.offsetWidth; // commit the start state so the entrance transitions
      toast.classList.add('disc-toast--in');
    }
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(hideToast, all ? TOAST_MS * 1.6 : TOAST_MS);
    if (!reducedMotion) {
      chip.classList.remove('disc__chip--pulse');
      void chip.offsetWidth;
      chip.classList.add('disc__chip--pulse');
      window.clearTimeout(pulseTimer);
      pulseTimer = window.setTimeout(() => chip.classList.remove('disc__chip--pulse'), PULSE_MS);
    }
  }

  return {
    update,
    celebrate,
    dispose() {
      closePanel(false);
      unsubscribe();
      window.clearTimeout(toastTimer);
      window.clearTimeout(leaveTimer);
      window.clearTimeout(pulseTimer);
      chip.removeEventListener('click', onChip);
      close.removeEventListener('click', onClose);
      reset.removeEventListener('click', onReset);
      no.removeEventListener('click', onNo);
      yes.removeEventListener('click', onYes);
      list.removeEventListener('scroll', updateScrollHint);
      toast.remove();
      spoken.remove();
      root.replaceChildren();
    },
  };
}
