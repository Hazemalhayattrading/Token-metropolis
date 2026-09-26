/**
 * "Your prompt, visualized" (brief §5.3 item 4): type or paste text, get its
 * exact token count from a real tokenizer (fetched on first open, as its own
 * chunk), pick an HQ and send a single token into it. The panel shows the
 * energy and on-site water of processing those tokens — Modeled, with ranges,
 * the formula, the energy per token, the inputs and their sources — and says
 * plainly what the count covers and what it does not.
 *
 * The integrator positions `root` (desktop: a centred glass dialog about 480px
 * wide; phones: a full-width bottom sheet). The panel caps its own height and
 * scrolls its body. open() and close() also toggle `root.hidden`.
 *
 * Accessibility: a labelled, non-modal dialog; every control is native and
 * keyboard operable (Ctrl/⌘ + Enter in the text box sends); Escape closes
 * without also reaching the city; the count and results are spoken through one
 * polite status line, only once typing has settled.
 */
import { COPY } from '../copy';
import { COMPUTE, isDisplayable } from '../model/constants';
import { tierOfBasis } from '../model/tier';
import type { Constant, Estimate, Tier } from '../model/types';
import type { City } from '../state/city';
import {
  createTokenizerLoader,
  footprintFor,
  formatQuantity,
  perTokenEnergy,
  PROMPT_MAX_CHARS,
  TOKENIZER_NAME,
  type TokenCounter,
} from '../state/prompt';
import { tierBadge, uncheckedBadge } from './badge';
import { h } from './dom';
import { fullNumber } from './format';

export interface PromptPanel {
  readonly isOpen: boolean;
  /** Show the panel, optionally with an HQ preselected (e.g. the one whose panel is open). */
  open(platformId?: string): void;
  /** Hide the panel (does not call onClose). */
  close(): void;
  dispose(): void;
}

export interface PromptOptions {
  /**
   * The visitor sent the prompt: fly the token and light a rack. `origin` is the centre of the
   * send button in client (CSS) pixels, where the flight should start (see screenToWorld in
   * world/tokenflight.ts).
   *
   * Optional: return the flight's promise (TokenFlight.launch resolves on arrival) and the panel
   * steps aside — it fades almost away, so the token can be seen crossing the city behind it —
   * until shortly after the landing. Returning nothing keeps the panel as it is.
   */
  onSend(
    platformId: string,
    tokens: number,
    origin?: { readonly x: number; readonly y: number },
  ): unknown;
  /** The visitor closed the panel (close button or Escape). The panel has already hidden itself. */
  onClose(): void;
  reducedMotion: boolean;
}

/** Wait this long after the last keystroke before counting. */
const DEBOUNCE_MS = 150;
/** Screen readers hear the count once typing has settled this long, never on every keystroke. */
const ANNOUNCE_MS = 1200;
/** After a landing, the panel stays aside this long so the flash and the lit rack can be seen. */
const ASIDE_LINGER_MS = 900;
const METHODOLOGY_URL =
  'https://github.com/Hazemalhayattrading/Token-metropolis/blob/main/METHODOLOGY.md';
/** OpenAI's tokenizer library, which defines the o200k_base encoding. */
const TIKTOKEN_URL = 'https://github.com/openai/tiktoken';
const GPT_TOKENIZER_URL = 'https://github.com/niieani/gpt-tokenizer';
const TICK_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** One loader for the page: the tokenizer chunk is fetched once, when the panel first opens. */
const tokenizer = createTokenizerLoader();
let uid = 0;

type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

interface MetricView {
  readonly el: HTMLElement;
  readonly value: HTMLElement;
  readonly range: HTMLElement;
  readonly badge: HTMLElement;
}

function isThenable(x: unknown): x is PromiseLike<unknown> {
  return (
    typeof x === 'object' && x !== null && typeof (x as { then?: unknown }).then === 'function'
  );
}

function externalLink(url: string, text: string): HTMLAnchorElement {
  return h(
    'a',
    { href: url, rel: 'noopener nofollow', target: '_blank' },
    text,
    h('span', { class: 'prompt__ext', 'aria-hidden': 'true' }, '↗'),
    h('span', { class: 'prompt-sr' }, ` (${COPY.prompt.newTab})`),
  );
}

function metric(label: string, unit: string): MetricView {
  const value = h('span', { class: 'prompt__value' }, COPY.prompt.noValue);
  const range = h('span', { class: 'prompt__range' });
  const badge = h('span', { class: 'prompt__badge' });
  const el = h(
    'div',
    { class: 'prompt__metric' },
    h(
      'div',
      { class: 'prompt__metric-head' },
      h('span', { class: 'prompt__metric-label' }, label),
      badge,
    ),
    h(
      'p',
      { class: 'prompt__metric-body' },
      value,
      ' ',
      h('span', { class: 'prompt__unit' }, unit),
    ),
    range,
  );
  return { el, value, range, badge };
}

/** A tier chip, the "not yet checked" chip, or nothing; the DOM is only touched on change. */
function setBadge(el: HTMLElement, tier: Tier | 'unchecked' | null, title?: string): void {
  const key = `${tier ?? 'none'}:${title ?? ''}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  if (tier === null) {
    el.replaceChildren();
    return;
  }
  const chip = tier === 'unchecked' ? uncheckedBadge() : tierBadge(tier);
  if (title) chip.title = title;
  el.replaceChildren(chip);
}

/** Central value + range + tier of an estimate; a dash (and no chip) when there is none. */
function setMetric(v: MetricView, e: Estimate | null, unit: string): void {
  if (!e || !isDisplayable(e.refs)) {
    v.value.textContent = COPY.prompt.noValue;
    v.range.textContent = '';
    setBadge(v.badge, e ? 'unchecked' : null);
    return;
  }
  const r = e.range;
  v.value.textContent = formatQuantity(r.central);
  v.range.textContent = `${COPY.panel.range(formatQuantity(r.low), formatQuantity(r.high))} ${unit}`;
  setBadge(v.badge, e.tier);
}

/** One model input (constants.ts): value, range, tier, sources, how it was checked. */
function inputItem(
  label: string,
  c: Constant,
  unit: string,
  fmt: (n: number) => string,
): HTMLLIElement {
  const sources = h('span', { class: 'prompt__sources' });
  c.source.forEach((s, i) => {
    if (i > 0) sources.append(' · ');
    sources.append(externalLink(s.url, s.title));
  });
  const checked =
    c.verified === 'page'
      ? COPY.power.checkedPage
      : c.verified === 'snippet'
        ? COPY.power.checkedSnippet
        : null;
  const u = unit ? ` ${unit}` : '';
  return h(
    'li',
    { class: 'prompt__input' },
    h(
      'div',
      { class: 'prompt__metric-head' },
      h('span', { class: 'prompt__metric-label' }, label),
      c.verified === 'pending' ? uncheckedBadge() : tierBadge(tierOfBasis(c.basis)),
    ),
    h(
      'p',
      { class: 'prompt__input-value' },
      h('strong', {}, `${fmt(c.value)}${u}`),
      ' · ',
      `${COPY.panel.range(fmt(c.low), fmt(c.high))}${u}`,
    ),
    c.source.length > 0
      ? h(
          'p',
          { class: 'prompt__note' },
          `${COPY.prompt.sources}: `,
          sources,
          checked ? ` · ${checked}` : '',
        )
      : null,
  );
}

export function mountPrompt(root: HTMLElement, city: City, opts: PromptOptions): PromptPanel {
  const n = ++uid;
  const id = (name: string) => `prompt-${name}-${n}`;

  // --- header ------------------------------------------------------------------
  const close = h(
    'button',
    {
      class: 'prompt__close',
      type: 'button',
      'aria-label': COPY.prompt.close,
      title: COPY.prompt.close,
    },
    '×',
  );

  // --- the text ------------------------------------------------------------------
  const textarea = h('textarea', {
    id: id('text'),
    class: 'prompt__textarea',
    rows: 5,
    maxlength: PROMPT_MAX_CHARS,
    placeholder: COPY.prompt.placeholder,
    autocomplete: 'off',
    'aria-describedby': `${id('chars')} ${id('privacy')}`,
  });
  const chars = h('span', { class: 'prompt__chars', id: id('chars') });

  // --- the count -----------------------------------------------------------------
  const countNum = h('span', { class: 'prompt__num' });
  const countUnit = h('span', { class: 'prompt__count-unit' });
  const countValue = h(
    'p',
    { class: 'prompt__count-value', hidden: true },
    countNum,
    ' ',
    countUnit,
  );
  const countBadge = h('span', { class: 'prompt__badge' });
  const countState = h('p', { class: 'prompt__state' });
  const retry = h(
    'button',
    { class: 'prompt__retry', type: 'button', hidden: true },
    COPY.prompt.retry,
  );

  // --- the HQ --------------------------------------------------------------------
  const select = h(
    'select',
    { id: id('hq'), class: 'prompt__select', 'aria-describedby': id('same') },
    ...city.platforms.map((pm) => h('option', { value: pm.platform.id }, pm.platform.name)),
  );
  const swatch = h('span', { class: 'prompt__swatch', 'aria-hidden': 'true' });

  // --- results -------------------------------------------------------------------
  const energy = metric(COPY.prompt.energy, COPY.prompt.energyUnit);
  const water = metric(COPY.prompt.water, COPY.prompt.waterUnit);
  const perToken = metric(COPY.prompt.perToken, COPY.prompt.perTokenUnit);
  const pt = perTokenEnergy();
  setMetric(
    perToken,
    { range: pt.joules, tier: pt.tier, formula: '', refs: pt.refs },
    COPY.prompt.perTokenUnit,
  );
  perToken.el.classList.add('prompt__metric--wide');
  const resultsHint = h('p', { class: 'prompt__hint' }, COPY.prompt.resultsEmpty);
  const energyFormula = h('span', { class: 'prompt__formula-line' });
  const waterFormula = h('span', { class: 'prompt__formula-line' });
  const plain = (x: number) => String(x);
  const results = h(
    'section',
    { class: 'prompt__results prompt__results--empty', 'aria-labelledby': id('results') },
    h('h3', { class: 'prompt__section', id: id('results') }, COPY.prompt.results),
    h('div', { class: 'prompt__grid' }, energy.el, water.el),
    resultsHint,
    h('p', { class: 'prompt__note' }, COPY.prompt.scope),
    h('h3', { class: 'prompt__section' }, COPY.prompt.formula),
    h(
      'p',
      { class: 'prompt__formula' },
      energyFormula,
      waterFormula,
      h(
        'span',
        { class: 'prompt__formula-line' },
        COPY.prompt.perTokenFormula(
          plain(pt.kwPerGpu),
          plain(pt.pue),
          fullNumber(pt.tokensPerSecPerGpu),
        ),
      ),
    ),
    perToken.el,
    h(
      'details',
      { class: 'prompt__inputs' },
      h('summary', { class: 'prompt__summary' }, COPY.prompt.inputs),
      h(
        'ul',
        { class: 'prompt__input-list' },
        inputItem(
          COPY.power.labels.throughput,
          COMPUTE.throughputTokensPerSecPerGpu,
          COPY.prompt.inputUnits.throughput,
          fullNumber,
        ),
        inputItem(COPY.power.labels.kw, COMPUTE.kwPerGpu, COPY.prompt.inputUnits.kw, plain),
        inputItem(COPY.power.labels.pue, COMPUTE.pue, COPY.prompt.inputUnits.pue, plain),
        inputItem(
          COPY.power.labels.wue,
          COMPUTE.wueLitersPerKwh,
          COPY.prompt.inputUnits.wue,
          plain,
        ),
      ),
    ),
    h('p', { class: 'prompt__method' }, externalLink(METHODOLOGY_URL, COPY.prompt.method)),
  );

  // --- footer ----------------------------------------------------------------------
  const sendLabel = h('span', { class: 'prompt__send-label' });
  const send = h(
    'button',
    {
      class: 'prompt__send',
      type: 'button',
      'aria-disabled': 'true',
      'aria-keyshortcuts': 'Control+Enter Meta+Enter',
    },
    h('span', { class: 'prompt__mote', 'aria-hidden': 'true' }),
    sendLabel,
  );
  const sendHint = h('p', { class: 'prompt__hint', id: id('send-hint') }, COPY.prompt.sendHint);
  const sent = h('p', { class: 'prompt__sent', hidden: true });
  // One polite status line for everything screen readers should hear.
  const status = h('p', { class: 'prompt-sr', role: 'status', 'aria-atomic': 'true' });

  const body = h(
    'div',
    { class: 'prompt__body' },
    h(
      'div',
      { class: 'prompt__field' },
      h(
        'div',
        { class: 'prompt__field-head' },
        h('label', { class: 'prompt__label', for: id('text') }, COPY.prompt.label),
        chars,
      ),
      textarea,
      h('p', { class: 'prompt__privacy', id: id('privacy') }, COPY.prompt.privacy),
    ),
    h(
      'div',
      { class: 'prompt__count' },
      h(
        'div',
        { class: 'prompt__metric-head' },
        h('span', { class: 'prompt__metric-label' }, COPY.prompt.countLabel),
        countBadge,
      ),
      countValue,
      countState,
      retry,
      h(
        'p',
        { class: 'prompt__note' },
        COPY.prompt.tokenizerNote(TOKENIZER_NAME),
        ' ',
        COPY.prompt.tokenizerSources,
        ' ',
        externalLink(TIKTOKEN_URL, COPY.prompt.tokenizerSpec),
        ' · ',
        externalLink(GPT_TOKENIZER_URL, COPY.prompt.tokenizerLibrary),
      ),
    ),
    h(
      'div',
      { class: 'prompt__field' },
      h('label', { class: 'prompt__label', for: id('hq') }, COPY.prompt.hqLabel),
      h('div', { class: 'prompt__select-wrap' }, swatch, select),
      h('p', { class: 'prompt__note', id: id('same') }, COPY.prompt.sameForEveryHq),
    ),
    results,
  );
  const panel = h(
    'section',
    {
      class: `prompt${opts.reducedMotion ? ' prompt--static' : ''}`,
      role: 'dialog',
      'aria-labelledby': id('title'),
      'aria-describedby': id('intro'),
      tabindex: '-1',
      hidden: true,
    },
    h(
      'header',
      { class: 'prompt__header' },
      h(
        'div',
        { class: 'prompt__heading' },
        h('h2', { class: 'prompt__title', id: id('title') }, COPY.prompt.title),
        h('p', { class: 'prompt__intro', id: id('intro') }, COPY.prompt.intro),
      ),
      close,
    ),
    body,
    h('footer', { class: 'prompt__footer' }, send, sendHint, sent),
    status,
  );
  root.replaceChildren(panel);

  // --- state ---------------------------------------------------------------------------
  let isOpen = false;
  let disposed = false;
  let loadState: LoadState = 'idle';
  let counter: TokenCounter | null = null;
  /** The last count, and the text it was counted for. */
  let count: number | null = null;
  let countedFor: string | null = null;
  let countError = false;
  let countTimer = 0;
  let announceTimer = 0;
  let lastSpoken = '';
  let resultsKey = '';
  let shownCount: number | null = null;
  let returnFocus: HTMLElement | null = null;
  /** Flights in the air that the panel steps aside for. */
  let inFlight = 0;
  let asideTimer = 0;
  let edgeKey = '';

  const coarse = () => window.matchMedia('(pointer: coarse)').matches;
  const hqName = (platformId: string) => city.byId.get(platformId)?.platform.name ?? platformId;

  /** Fade the body's top/bottom edge while there is more to scroll that way (as the race does). */
  function updateEdges(): void {
    const top = body.scrollTop > 2;
    const more = body.scrollTop + body.clientHeight < body.scrollHeight - 2;
    const key = `${top}:${more}`;
    if (key === edgeKey) return;
    edgeKey = key;
    body.classList.toggle('prompt__body--top', top);
    body.classList.toggle('prompt__body--more', more);
  }
  // The body's own box, and its content (the details list opening changes how far it scrolls).
  const edges = typeof ResizeObserver === 'function' ? new ResizeObserver(updateEdges) : null;
  for (const el of [body, ...body.children]) edges?.observe(el);

  // --- announcements -------------------------------------------------------------------
  function say(text: string): void {
    window.clearTimeout(announceTimer);
    lastSpoken = text;
    if (status.textContent === text) {
      // Same words again (e.g. a second send): clear first so screen readers repeat them.
      status.textContent = '';
      requestAnimationFrame(() => {
        if (lastSpoken === text) status.textContent = text;
      });
    } else status.textContent = text;
  }

  function scheduleAnnounce(): void {
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      if (!isOpen || count === null || count <= 0 || textarea.value === '') return;
      const f = footprintFor(count);
      const e = f.energyWh.range;
      const w = f.waterMl.range;
      const spoken = COPY.prompt.spokenCount(
        fullNumber(count),
        COPY.prompt.tokens(count),
        formatQuantity(e.central),
        COPY.panel.range(formatQuantity(e.low), formatQuantity(e.high)),
        formatQuantity(w.central),
        COPY.panel.range(formatQuantity(w.low), formatQuantity(w.high)),
      );
      if (spoken !== lastSpoken) say(spoken);
    }, ANNOUNCE_MS);
  }

  // --- counting --------------------------------------------------------------------------
  function ensureTokenizer(): void {
    if (loadState === 'loading' || loadState === 'ready') return;
    loadState = 'loading';
    render();
    tokenizer.load().then(
      (c) => {
        if (disposed) return;
        counter = c;
        loadState = 'ready';
        countNow();
      },
      () => {
        // Offline, or the chunk is gone after a redeploy. No console noise: the panel says it.
        if (disposed) return;
        loadState = 'failed';
        render();
        if (isOpen && textarea.value !== '') say(failureText());
      },
    );
  }

  function failureText(): string {
    return tokenizer.failures > 1 ? COPY.prompt.failedAgain : COPY.prompt.failed;
  }

  function countNow(): void {
    window.clearTimeout(countTimer);
    countTimer = 0;
    const text = textarea.value;
    if (text === '') {
      count = 0;
      countedFor = '';
      countError = false;
    } else if (counter) {
      try {
        count = counter(text);
        countError = false;
      } catch {
        count = null;
        countError = true;
      }
      countedFor = text;
    }
    render();
    if (count !== null && count > 0) scheduleAnnounce();
  }

  function onInput(): void {
    sent.hidden = true;
    const text = textarea.value;
    if (text === '' || (counter && (countedFor === '' || countedFor === null))) {
      // Emptied, or the first characters after empty: count at once (no stale "0" on screen).
      countNow();
      return;
    }
    // Typing never retries a failed load (offline, that would be a request per keystroke): only
    // "Try again" or reopening the panel does.
    if (!counter && loadState === 'idle') ensureTokenizer();
    window.clearTimeout(countTimer);
    countTimer = window.setTimeout(countNow, DEBOUNCE_MS);
    render();
  }

  // --- rendering ---------------------------------------------------------------------------
  function renderResults(tokens: number | null): void {
    const key = tokens === null ? 'none' : String(tokens);
    if (key === resultsKey) return;
    resultsKey = key;
    const has = tokens !== null && tokens > 0;
    const f = footprintFor(tokens ?? 0);
    setMetric(energy, has ? f.energyWh : null, COPY.prompt.energyUnit);
    setMetric(water, has ? f.waterMl : null, COPY.prompt.waterUnit);
    resultsHint.hidden = has;
    results.classList.toggle('prompt__results--empty', !has);
    energyFormula.textContent = COPY.prompt.energyFormula(f.energyWh.formula);
    waterFormula.textContent = COPY.prompt.waterFormula(f.waterMl.formula);
  }

  function tick(): void {
    if (opts.reducedMotion || typeof countNum.animate !== 'function') return;
    countNum.animate(
      [
        { opacity: 0.35, transform: 'translateY(3px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 260, easing: TICK_EASE },
    );
  }

  function render(): void {
    const text = textarea.value;
    chars.textContent = COPY.prompt.chars(fullNumber(text.length), fullNumber(PROMPT_MAX_CHARS));
    chars.classList.toggle('prompt__chars--near', text.length >= PROMPT_MAX_CHARS * 0.9);
    const empty = text === '';
    const failed = !empty && loadState === 'failed' && !counter;
    // A count lagging the text by one debounce is fine (it is live); the "0" of an emptied box is not.
    const counted = !empty && !failed && !countError && count !== null && !!countedFor;
    const tokens = counted ? count : null;

    countValue.hidden = !counted;
    if (tokens !== null && tokens !== shownCount) {
      const first = shownCount === null;
      shownCount = tokens;
      countNum.textContent = fullNumber(tokens);
      countUnit.textContent = COPY.prompt.tokens(tokens);
      if (!first) tick();
    }
    if (!counted) shownCount = null;
    setBadge(
      countBadge,
      counted ? 'reported' : null,
      counted ? COPY.prompt.countHelp(TOKENIZER_NAME) : undefined,
    );

    const stateText = empty
      ? COPY.prompt.empty
      : failed
        ? failureText()
        : countError
          ? COPY.prompt.countFailed
          : counted
            ? ''
            : loadState === 'loading'
              ? COPY.prompt.loading
              : COPY.prompt.counting;
    if (countState.textContent !== stateText) countState.textContent = stateText;
    countState.hidden = stateText === '';
    countState.classList.toggle(
      'prompt__state--busy',
      !empty && !failed && !countError && !counted,
    );
    countState.classList.toggle('prompt__state--error', failed || countError);
    retry.hidden = !failed;

    renderResults(tokens);

    const canSend = tokens !== null && tokens > 0;
    send.setAttribute('aria-disabled', String(!canSend));
    if (canSend) send.removeAttribute('aria-describedby');
    else send.setAttribute('aria-describedby', id('send-hint'));
    sendHint.hidden = canSend;
    const hint = empty ? COPY.prompt.sendHint : COPY.prompt.sendHintCount;
    if (sendHint.textContent !== hint) sendHint.textContent = hint;
    if (isOpen) updateEdges();
  }

  function syncHq(): void {
    const pm = city.byId.get(select.value);
    const accent = pm?.platform.identity.palette.accent ?? '';
    if (accent) panel.style.setProperty('--prompt-hq', accent);
    else panel.style.removeProperty('--prompt-hq');
    sendLabel.textContent = COPY.prompt.send(hqName(select.value));
    sent.hidden = true;
  }

  // --- actions -----------------------------------------------------------------------------
  function sendNow(): void {
    if (countedFor !== textarea.value && counter) countNow(); // never send a stale count
    const tokens = !countError && countedFor === textarea.value ? count : null;
    if (tokens === null || tokens <= 0) {
      textarea.focus();
      return;
    }
    const platformId = select.value;
    const r = send.getBoundingClientRect();
    const origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const name = hqName(platformId);
    sent.textContent = COPY.prompt.sent(name);
    sent.hidden = false;
    say(COPY.prompt.spokenSent(fullNumber(tokens), COPY.prompt.tokens(tokens), name));
    const flight = opts.onSend(platformId, tokens, origin);
    if (isThenable(flight)) stepAside(flight, name);
  }

  /** Fade almost away while the token flies (the city shows through), back after it lands. */
  function stepAside(flight: PromiseLike<unknown>, name: string): void {
    inFlight++;
    window.clearTimeout(asideTimer);
    panel.classList.add('prompt--aside');
    const landed = () => {
      if (disposed) return;
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight > 0) return;
      sent.textContent = COPY.prompt.arrived(name);
      asideTimer = window.setTimeout(() => {
        if (inFlight === 0) panel.classList.remove('prompt--aside');
      }, ASIDE_LINGER_MS);
    };
    flight.then(landed, landed);
  }

  function hide(): void {
    if (!isOpen) return;
    isOpen = false;
    window.clearTimeout(announceTimer);
    // Never strand keyboard focus inside a panel that is about to disappear.
    if (panel.contains(document.activeElement) && returnFocus?.isConnected) {
      returnFocus.focus({ preventScroll: true });
    }
    returnFocus = null;
    panel.classList.remove('prompt--open');
    panel.hidden = true;
    root.hidden = true;
  }

  function userClose(): void {
    if (!isOpen) return;
    hide();
    opts.onClose();
  }

  // --- events ------------------------------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    e.stopPropagation(); // the city also closes its HQ panel on Escape
    userClose();
  };
  const onTextKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      sendNow();
    }
  };
  const onRetry = () => {
    ensureTokenizer();
    textarea.focus();
  };
  panel.addEventListener('keydown', onKeyDown);
  textarea.addEventListener('input', onInput);
  textarea.addEventListener('keydown', onTextKey);
  select.addEventListener('change', syncHq);
  send.addEventListener('click', sendNow);
  close.addEventListener('click', userClose);
  retry.addEventListener('click', onRetry);
  body.addEventListener('scroll', updateEdges, { passive: true });

  syncHq();
  render();

  return {
    get isOpen() {
      return isOpen;
    },
    open(platformId) {
      if (disposed) return;
      if (platformId !== undefined && city.byId.has(platformId) && platformId !== select.value) {
        select.value = platformId;
        syncHq();
      }
      if (isOpen) return;
      isOpen = true;
      const active = document.activeElement;
      returnFocus = active instanceof HTMLElement && !panel.contains(active) ? active : null;
      root.hidden = false;
      panel.hidden = false;
      ensureTokenizer();
      render();
      updateEdges();
      // Touch screens: focus the dialog, not the text box, so the keyboard does not cover the sheet.
      (coarse() ? panel : textarea).focus({ preventScroll: true });
      if (opts.reducedMotion) panel.classList.add('prompt--open');
      else
        requestAnimationFrame(() => {
          if (isOpen) panel.classList.add('prompt--open');
        });
    },
    close: hide,
    dispose() {
      disposed = true;
      isOpen = false;
      window.clearTimeout(countTimer);
      window.clearTimeout(announceTimer);
      window.clearTimeout(asideTimer);
      edges?.disconnect();
      panel.removeEventListener('keydown', onKeyDown);
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('keydown', onTextKey);
      select.removeEventListener('change', syncHq);
      send.removeEventListener('click', sendNow);
      close.removeEventListener('click', userClose);
      retry.removeEventListener('click', onRetry);
      body.removeEventListener('scroll', updateEdges);
      root.replaceChildren();
    },
  };
}
