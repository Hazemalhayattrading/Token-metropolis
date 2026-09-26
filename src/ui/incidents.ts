/**
 * Incident banner (brief §5.3 item 6): when a platform's official status page reports an
 * unresolved incident, a compact glass banner says so — in the status page's own words, with the
 * impact level it published, when the incident started (UTC) and a link to the status page. The
 * HQ name opens that HQ. With several incidents, the most severe is shown and "+N more" expands a
 * short list. Each notice can be dismissed; dismissals last for this browser session only.
 *
 * The banner is about service status only. It states no token figure, and its note says that the
 * estimates elsewhere on the site are not adjusted for incidents.
 *
 * Accessibility: the card is a labelled region; a visually hidden status line (role="status",
 * polite) announces each new notice once, so re-renders and the expanding list stay quiet.
 * The DOM is rebuilt only when the set of notices shown changes (update() runs about once a
 * second), and keyboard focus is carried over to the same control after a rebuild.
 */
import { COPY } from '../copy';
import type { Incident } from '../data/schema';
import { incidentsSignature, parseInstant, utcParts, visibleIncidents } from '../state/incidents';
import { h } from './dom';

export interface IncidentBanner {
  update(active: ReadonlyMap<string, Incident>): void;
  dispose(): void;
}

const STORE_KEY = 'token-metropolis:incidents:dismissed:v1';
const STORE_MAX = 50;
/** Let a live region settle into the page before it speaks (some screen readers miss the first change). */
const SPEAK_DELAY_MS = 150;
/** Titles longer than this (characters) may be clamped by the three-line limit. */
const LONG_TITLE = 100;

let uid = 0;

function readDismissed(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: ReadonlySet<string>): void {
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify([...ids].slice(-STORE_MAX)));
  } catch {
    // Storage blocked or full: the dismissal still holds until the page is reloaded.
  }
}

/** "2026-09-26, 10:05 UTC", or the feed's own text if it cannot be read. */
/** "as of 12:17 UTC": when the pipeline last read the notice on the page (none if unknown). */
function checkedLabel(i: Incident): string {
  const ms = i.checked ? parseInstant(i.checked) : null;
  return ms === null ? '' : COPY.incidents.asOf(utcParts(ms).hhmm);
}

function startedLabel(i: Incident): string {
  const ms = parseInstant(i.started);
  if (ms === null) return i.started;
  const { date, hhmm } = utcParts(ms);
  return COPY.incidents.when(date, hhmm);
}

function impactLabel(i: Incident): string {
  return i.impact === 'none' ? '' : COPY.incidents.impact[i.impact];
}

const isHttps = (url: string) => /^https:\/\//i.test(url);

export function mountIncidentBanner(
  root: HTMLElement,
  opts: { platformName(id: string): string; onSelect(platformId: string): void },
): IncidentBanner {
  const listId = `incidents-list-${++uid}`;
  const card = h('section', {
    class: 'incidents',
    'aria-label': COPY.incidents.region,
    hidden: true,
  });
  const live = h('p', { class: 'incidents-sr', role: 'status', 'aria-live': 'polite' });
  root.replaceChildren(card, live);

  const dismissed = readDismissed();
  let active: ReadonlyMap<string, Incident> = new Map();
  let shown: Incident[] = [];
  let signature: string | null = null;
  let expanded = false;
  const announced = new Set<string>();
  let speakTimer = 0;

  // --- building blocks ---------------------------------------------------------

  function chip(i: Incident): HTMLElement {
    return h(
      'span',
      { class: `incidents__impact incidents__impact--${i.impact}` },
      h('span', { class: 'incidents__dot', 'aria-hidden': 'true' }),
      impactLabel(i),
    );
  }

  /** "[chip] <HQ>’s official status page reports: “title”" — the HQ name is a button. */
  function message(i: Incident, cls: string): HTMLElement {
    const name = opts.platformName(i.platform);
    return h(
      'p',
      { class: cls },
      chip(i),
      ' ',
      h(
        'button',
        {
          class: 'incidents__hq',
          type: 'button',
          'data-action': 'select',
          'data-platform': i.platform,
          'data-focus': `hq:${i.id}`,
        },
        name,
      ),
      `${COPY.incidents.possessive(name)}${COPY.incidents.reports}`,
      // Long titles may be clamped visually: a tooltip carries the full text (screen readers
      // always get it all, so short titles skip the tooltip rather than repeat themselves).
      h(
        'q',
        { class: 'incidents__title', title: i.title.length > LONG_TITLE ? i.title : undefined },
        i.title,
      ),
    );
  }

  function meta(i: Incident, extra: HTMLElement | null): HTMLElement {
    return h(
      'p',
      { class: 'incidents__meta' },
      h('span', {}, COPY.incidents.started(startedLabel(i))),
      i.status === 'monitoring'
        ? h('span', { class: 'incidents__status' }, COPY.incidents.monitoring)
        : null,
      checkedLabel(i) ? h('span', { class: 'incidents__asof' }, checkedLabel(i)) : null,
      isHttps(i.url)
        ? h(
            'a',
            {
              class: 'incidents__link',
              href: i.url,
              target: '_blank',
              rel: 'noopener nofollow',
              'data-focus': `link:${i.id}`,
            },
            COPY.incidents.link,
            h('span', { class: 'incidents__ext', 'aria-hidden': 'true' }, '↗'),
            h('span', { class: 'incidents-sr' }, ` (${COPY.incidents.newTab})`),
          )
        : null,
      extra,
    );
  }

  function dismissButton(i: Incident, cls: string): HTMLElement {
    const label = COPY.incidents.dismiss(opts.platformName(i.platform));
    return h(
      'button',
      {
        class: cls,
        type: 'button',
        'aria-label': label,
        title: label,
        'data-action': 'dismiss',
        'data-id': i.id,
        'data-focus': `dismiss:${i.id}`,
      },
      '×',
    );
  }

  // --- render ------------------------------------------------------------------

  function render(): void {
    const focusKey =
      document.activeElement instanceof HTMLElement && card.contains(document.activeElement)
        ? (document.activeElement.dataset.focus ?? 'card')
        : null;
    const [first, ...rest] = shown;
    if (!first) {
      card.hidden = true;
      card.replaceChildren();
      expanded = false;
      return;
    }
    if (rest.length === 0) expanded = false;

    const more =
      rest.length > 0
        ? h(
            'button',
            {
              class: 'incidents__more',
              type: 'button',
              'aria-expanded': String(expanded),
              'aria-controls': listId,
              'data-action': 'more',
              'data-focus': 'more',
            },
            expanded ? COPY.incidents.less : COPY.incidents.more(rest.length),
          )
        : null;
    const list =
      rest.length > 0
        ? h(
            'ul',
            { class: 'incidents__list', id: listId, role: 'list', hidden: !expanded },
            ...rest.map((i) =>
              h(
                'li',
                { class: `incidents__item incidents__item--${i.impact}` },
                h(
                  'div',
                  { class: 'incidents__item-body' },
                  message(i, 'incidents__msg incidents__msg--item'),
                  meta(i, null),
                ),
                dismissButton(i, 'incidents__dismiss incidents__dismiss--item'),
              ),
            ),
          )
        : null;

    card.className = `incidents incidents--${first.impact}`;
    card.replaceChildren(
      h(
        'div',
        { class: 'incidents__main' },
        h('div', { class: 'incidents__body' }, message(first, 'incidents__msg'), meta(first, more)),
        dismissButton(first, 'incidents__dismiss'),
      ),
      ...(list ? [list] : []),
      h('p', { class: 'incidents__note' }, COPY.incidents.note),
    );
    card.hidden = false;

    if (focusKey) {
      const same = card.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusKey)}"]`);
      const fallback = card.querySelector<HTMLElement>('[data-action="dismiss"]');
      (same ?? fallback)?.focus({ preventScroll: true });
    }
  }

  /** Announce notices not announced before: the most severe new one, and how many more are listed. */
  function announce(): void {
    const fresh = shown.filter((i) => !announced.has(i.id));
    for (const i of shown) announced.add(i.id);
    const top = fresh[0];
    if (!top) return;
    const text = [
      COPY.incidents.spoken(
        opts.platformName(top.platform),
        impactLabel(top),
        top.title,
        startedLabel(top),
      ),
      top.status === 'monitoring' ? COPY.incidents.spokenMonitoring : '',
      shown.length > 1 ? COPY.incidents.spokenMore(shown.length - 1) : '',
    ]
      .filter(Boolean)
      .join(' ');
    window.clearTimeout(speakTimer);
    speakTimer = window.setTimeout(() => (live.textContent = text), SPEAK_DELAY_MS);
  }

  function refresh(): void {
    const next = visibleIncidents(active, dismissed);
    const sig = incidentsSignature(next);
    if (sig === signature) return;
    signature = sig;
    shown = next;
    render();
    announce();
  }

  // --- interaction ---------------------------------------------------------------

  function setExpanded(open: boolean): void {
    expanded = open;
    const button = card.querySelector<HTMLElement>('.incidents__more');
    const list = card.querySelector<HTMLElement>('.incidents__list');
    if (!button || !list) return;
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? COPY.incidents.less : COPY.incidents.more(shown.length - 1);
    list.hidden = !open;
  }

  const onClick = (e: MouseEvent) => {
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-action]') : null;
    if (!el) return;
    switch (el.dataset.action) {
      case 'select':
        if (el.dataset.platform) opts.onSelect(el.dataset.platform);
        break;
      case 'dismiss':
        if (!el.dataset.id) break;
        dismissed.add(el.dataset.id);
        writeDismissed(dismissed);
        refresh();
        break;
      case 'more':
        setExpanded(!expanded);
        break;
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !expanded) return;
    e.stopPropagation(); // the city also closes its HQ panel on Escape
    setExpanded(false);
    card.querySelector<HTMLElement>('.incidents__more')?.focus({ preventScroll: true });
  };
  card.addEventListener('click', onClick);
  card.addEventListener('keydown', onKey);

  return {
    update(next) {
      active = next;
      refresh();
    },
    dispose() {
      window.clearTimeout(speakTimer);
      card.removeEventListener('click', onClick);
      card.removeEventListener('keydown', onKey);
      root.replaceChildren();
    },
  };
}
