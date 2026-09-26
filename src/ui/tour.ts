/**
 * Tour captions (brief §5.3 item 8): the caption card of the cinematic tour — large display type
 * at the bottom centre, the tier chip of any number a caption states, a small "Tour · press any key
 * to explore" hint, a "How we estimate" link and a Stop button. Captions cross-fade (no movement,
 * and no fade, with reduced motion) and the card eases its height between captions of different
 * lengths. A visually hidden live region (polite) reads each caption once.
 *
 * The integrator flies the camera, calls show() at each stop and hide() when the tour stops (on
 * any input, or the Stop button). hide() keeps the card in the page for a moment after it fades,
 * so a click that began on the card (the link, the Stop button) still lands.
 */
import { COPY } from '../copy';
import type { Tier } from '../model/types';
import { tierBadge } from './badge';
import { h } from './dom';
import { METHODOLOGY_URL } from './links';

export interface TourCaptions {
  show(text: string, tier?: Tier): void;
  hide(): void;
  dispose(): void;
}

/** Card fade-out before it leaves the page (matches the CSS), and the floor with reduced motion. */
const FADE_MS = 600;
const REDUCED_HIDE_MS = 350;
/** Height easing between captions (matches the CSS). */
const HEIGHT_MS = 500;

function prefers(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export function mountTourCaptions(root: HTMLElement, opts: { onStop(): void }): TourCaptions {
  const reduced = prefers('(prefers-reduced-motion: reduce)');
  // A touch screen (a TV remote has no hover either, but it has keys to press).
  const touch = prefers('(hover: none) and (pointer: coarse)');

  const layers = [h('p', { class: 'tour__caption' }), h('p', { class: 'tour__caption' })] as const;
  const stage = h('div', { class: 'tour__stage', 'aria-hidden': 'true' }, ...layers);
  const stop = h(
    'button',
    { class: 'tour__stop', type: 'button', 'aria-label': COPY.tour.stopLabel },
    h('span', { class: 'tour__stop-icon', 'aria-hidden': 'true' }),
    COPY.tour.stop,
  );
  const card = h(
    'section',
    {
      class: `tour${reduced ? ' tour--static' : ''}`,
      'aria-label': COPY.tour.region,
      hidden: true,
    },
    h(
      'div',
      { class: 'tour__card' },
      stage,
      h(
        'div',
        { class: 'tour__bar' },
        h(
          'p',
          { class: 'tour__hint' },
          h('span', { class: 'tour__dot', 'aria-hidden': 'true' }),
          touch ? COPY.tour.hintTouch : COPY.tour.hint,
        ),
        h(
          'div',
          { class: 'tour__actions' },
          h(
            'a',
            { class: 'tour__method', href: METHODOLOGY_URL, target: '_blank', rel: 'noopener' },
            COPY.tour.method,
            h('span', { class: 'tour-sr' }, ` (${COPY.tour.newTab})`),
          ),
          stop,
        ),
      ),
    ),
  );
  // Outside the card, so it is in the page (and heard) even while the card is hidden.
  const live = h('p', { class: 'tour-sr', 'aria-live': 'polite' });
  root.replaceChildren(card, live);

  let front = 0;
  let open = false;
  let hideTimer = 0;
  let heightTimer = 0;
  /** The caption on show (text and tier), so a repeated show() does not fade to itself. */
  let shown = '';

  function fill(el: HTMLElement, text: string, tier: Tier | undefined): void {
    el.replaceChildren(
      h('span', { class: 'tour__text' }, text),
      ...(tier ? [' ', tierBadge(tier)] : []),
    );
  }

  /** Ease the stage from its previous height to the new caption's. */
  function easeHeight(from: number): void {
    const to = stage.offsetHeight;
    window.clearTimeout(heightTimer);
    if (Math.abs(to - from) < 1) {
      stage.style.height = '';
      return;
    }
    stage.style.height = `${from}px`;
    void stage.offsetHeight; // commit the start height so the change transitions
    stage.style.height = `${to}px`;
    heightTimer = window.setTimeout(() => (stage.style.height = ''), HEIGHT_MS + 50);
  }

  const onStop = () => opts.onStop();
  stop.addEventListener('click', onStop);

  return {
    show(text, tier) {
      window.clearTimeout(hideTimer);
      const key = `${tier ?? ''}|${text}`;
      if (open && key === shown) return;
      shown = key;
      const wasOpen = open;
      const from = wasOpen ? stage.offsetHeight : 0;
      const next = layers[front ^ 1]!;
      const prev = layers[front]!;
      fill(next, text, tier);
      next.classList.add('tour__caption--on');
      prev.classList.remove('tour__caption--on');
      front ^= 1;
      if (!wasOpen) {
        card.hidden = false;
        stage.style.height = '';
        void card.offsetWidth; // commit the hidden state so the card fades in
        card.classList.add('tour--open');
        open = true;
      } else if (!reduced) {
        easeHeight(from);
      }
      // Screen readers hear that the tour started (and how to stop it) with its first caption,
      // then silence: a looping tour must not keep talking over what the visitor is reading.
      if (!wasOpen)
        live.textContent = `${COPY.tour.spokenStart} ${tier ? COPY.tour.spoken(text, COPY.tiers[tier]) : text}`;
    },
    hide() {
      if (!open) return;
      open = false;
      shown = '';
      card.classList.remove('tour--open');
      window.clearTimeout(hideTimer);
      window.clearTimeout(heightTimer);
      hideTimer = window.setTimeout(
        () => {
          card.hidden = true;
          stage.style.height = '';
          for (const l of layers) {
            l.classList.remove('tour__caption--on');
            l.replaceChildren();
          }
          live.textContent = '';
        },
        reduced ? REDUCED_HIDE_MS : FADE_MS,
      );
    },
    dispose() {
      window.clearTimeout(hideTimer);
      window.clearTimeout(heightTimer);
      stop.removeEventListener('click', onStop);
      root.replaceChildren();
    },
  };
}
