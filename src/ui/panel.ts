/**
 * The HQ info panel: every number with its tier badge, range, formula and
 * source (brief §2.2). Desktop: side panel. Mobile: bottom sheet.
 *
 * Tabs fly the camera into the campus (brief §5.2): Overview, Offices,
 * Server hall, Power & cooling, Model lab. Each tab says plainly what the
 * scene shows and what it does not.
 */
import { COPY } from '../copy';
import type { Model } from '../data/schema';
import { COMPUTE, isDisplayable, TRAFFIC } from '../model/constants';
import { gpuEquivalents, powerMW, waterLitersPerDay } from '../model/derived';
import {
  between,
  cumulative,
  cumulativeTier,
  dailyRate,
  firstAnchor,
  instantTier,
  latestAnchor,
  rateTier,
  tokensPerSecond,
  trafficNowRange,
} from '../model/estimate';
import { tierOfBasis } from '../model/tier';
import { daysToIso, daysToMs, utcDayStart } from '../model/time';
import type { Constant, Estimate, Range, Tier } from '../model/types';
import type { PlatformModel } from '../model/estimate';
import type { City } from '../state/city';
import type { Clock } from '../state/clock';
import { localTimeLabel } from '../state/localtime';
import { isLiquidCooled } from '../world/hardware';
import type { InteriorView } from '../world/interiors';
import { LAB_MAX, labLineup, releasedBy } from '../world/interiors/lineup';
import { DESK_BANDS, deskTier, logLoad, tokensAtLoad } from '../world/scale';
import { tierBadge, uncheckedBadge } from './badge';
import { byId, h } from './dom';
import { describeValue, fullNumber, humanNumber } from './format';
import { createGauge, decadeScale, type Gauge } from './gauge';

export interface PanelCallbacks {
  onClose(): void;
  onView(view: InteriorView): void;
  onModel(id: string | null): void;
}

export interface Panel {
  show(id: string): void;
  hide(): void;
  update(): void;
  /** Reflect a model picked in the 3D lab. */
  selectModel(id: string | null): void;
  /** Switch tabs without asking the world to fly (e.g. the world fell back to the overview). */
  showView(view: InteriorView): void;
  readonly openId: string | null;
  readonly view: InteriorView;
}

const VIEWS: readonly InteriorView[] = ['overview', 'offices', 'hall', 'power', 'lab'];
const METHODOLOGY_URL =
  'https://github.com/Hazemalhayattrading/Token-metropolis/blob/main/METHODOLOGY.md';

interface Row {
  label: HTMLElement;
  value: HTMLElement;
  range: HTMLElement;
  badge: HTMLElement;
}

function row(label: string, unit: string): { el: HTMLElement; row: Row } {
  const labelEl = h('span', { class: 'metric__label' }, label);
  const value = h('span', { class: 'metric__value' });
  const range = h('span', { class: 'metric__range' });
  const badge = h('span', { class: 'metric__badge' });
  const el = h(
    'div',
    { class: 'metric' },
    h('div', { class: 'metric__head' }, labelEl, badge),
    h('div', { class: 'metric__body' }, value, h('span', { class: 'metric__unit' }, unit)),
    range,
  );
  return { el, row: { label: labelEl, value, range, badge } };
}

function setLabel(r: Row | undefined, text: string): void {
  if (r && r.label.textContent !== text) r.label.textContent = text;
}

/** A platform not launched at the date shown: no number, so no tier (as in the race). */
function setWaiting(r: Row | undefined): void {
  if (!r) return;
  r.value.textContent = COPY.race.notLaunched;
  r.range.textContent = '';
  if (r.badge.dataset.tier !== 'none') {
    r.badge.dataset.tier = 'none';
    r.badge.replaceChildren();
  }
}

function setBadge(el: HTMLElement, tier: Tier): void {
  if (el.dataset.tier === tier) return;
  el.dataset.tier = tier;
  el.replaceChildren(tierBadge(tier));
}

function setRow(
  r: Row,
  value: string,
  range: Range | null,
  tier: Tier,
  fmt: (n: number) => string = humanNumber,
): void {
  r.value.textContent = value;
  r.range.textContent = range ? COPY.panel.range(fmt(range.low), fmt(range.high)) : '';
  setBadge(r.badge, tier);
}

const mwText = (n: number) => (n < 10 ? n.toFixed(n < 1 ? 2 : 1) : fullNumber(Math.round(n)));

function link(url: string, text: string): HTMLAnchorElement {
  return h('a', { href: url, rel: 'noopener nofollow', target: '_blank' }, text);
}

/** One model-input constant: value, range, tier, how it was checked, sources. */
function constantCard(label: string, c: Constant, fmt: (n: number) => string): HTMLElement {
  const sources = h('p', { class: 'constant__sources' });
  c.source.forEach((s, i) => {
    if (i > 0) sources.append(' · ');
    sources.append(link(s.url, s.title));
  });
  return h(
    'div',
    { class: 'constant' },
    h(
      'div',
      { class: 'metric__head' },
      h('span', { class: 'metric__label' }, label),
      tierBadge(tierOfBasis(c.basis)),
    ),
    h(
      'p',
      { class: 'constant__value' },
      h('strong', {}, fmt(c.value)),
      ' ',
      h('span', { class: 'metric__unit' }, c.unit),
    ),
    h('p', { class: 'metric__range' }, COPY.panel.range(fmt(c.low), fmt(c.high))),
    h('p', { class: 'constant__note' }, c.note),
    sources,
    h(
      'p',
      { class: 'constant__checked' },
      c.verified === 'page' ? COPY.power.checkedPage : COPY.power.checkedSnippet,
    ),
  );
}

export interface PanelOptions {
  /** Whether the time machine shows the past (labels and the header change). */
  history?: () => boolean;
  /** Real time, to cap "today" totals in history at the present. */
  live?: Clock;
}

export function createPanel(
  city: City,
  clock: Clock,
  cb: PanelCallbacks,
  popts: PanelOptions = {},
): Panel {
  const history = popts.history ?? (() => false);
  const live = popts.live ?? clock;
  const root = byId('panel');
  let openId: string | null = null;
  let view: InteriorView = 'overview';
  let selectedModel: string | null = null;
  let rows: Record<string, Row> = {};
  let gauges: { power?: Gauge; water?: Gauge } = {};
  let tabs: HTMLButtonElement[] = [];
  let panes: HTMLElement[] = [];
  let modelButtons: HTMLButtonElement[] = [];
  let modelDetail: HTMLElement | null = null;
  let hardwareLine: HTMLElement | null = null;
  let lastSlow = 0;
  let lastFast = 0;
  let returnFocus: HTMLElement | null = null;
  let lastT = Number.NaN;
  let labelKey = '';
  let sourceKey = '';
  let sourceBlock: HTMLElement | null = null;
  let labModels = -1;
  let labList: HTMLElement | null = null;
  let historyChip: HTMLElement | null = null;

  const close = h(
    'button',
    { class: 'panel__close', type: 'button', 'aria-label': COPY.panel.close },
    '×',
  );
  close.addEventListener('click', cb.onClose);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cb.onClose();
  });

  function setView(next: InteriorView, focus = false, notify = true): void {
    const changed = next !== view;
    view = next;
    tabs.forEach((t, i) => {
      const on = VIEWS[i] === next;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
      if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    panes.forEach((p, i) => (p.hidden = VIEWS[i] !== next));
    root.dataset.view = next;
    if (changed) {
      lastSlow = 0;
      lastFast = 0;
      if (notify) cb.onView(next);
    }
  }

  function tablist(): HTMLElement {
    tabs = VIEWS.map((v) => {
      const t = h(
        'button',
        {
          class: 'tabs__tab',
          type: 'button',
          role: 'tab',
          id: `tab-${v}`,
          'aria-controls': `pane-${v}`,
          'aria-selected': String(v === 'overview'),
          tabindex: v === 'overview' ? 0 : -1,
          'data-view': v,
        },
        COPY.views[v],
      );
      t.addEventListener('click', () => setView(v));
      return t;
    });
    const list = h(
      'div',
      { class: 'tabs', role: 'tablist', 'aria-label': COPY.views.label },
      ...tabs,
    );
    list.addEventListener('keydown', (e) => {
      const i = VIEWS.indexOf(view);
      const n = VIEWS.length;
      const next =
        e.key === 'ArrowRight'
          ? (i + 1) % n
          : e.key === 'ArrowLeft'
            ? (i - 1 + n) % n
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? n - 1
                : -1;
      if (next < 0) return;
      e.preventDefault();
      setView(VIEWS[next]!, true);
    });
    return list;
  }

  function pane(v: InteriorView, ...children: (Node | null)[]): HTMLElement {
    const p = h(
      'section',
      {
        class: 'pane',
        role: 'tabpanel',
        id: `pane-${v}`,
        'aria-labelledby': `tab-${v}`,
        tabindex: 0,
      },
      ...children,
    );
    p.hidden = v !== 'overview';
    return p;
  }

  // --- panes ------------------------------------------------------------------

  /**
   * The latest published figure at the date shown, the formula behind today's value and how old
   * that figure is. Rebuilt whenever the time machine moves to a different latest figure; before a
   * platform's first figure it shows that first figure and says the values are modeled back from it.
   */
  function renderSource(pm: PlatformModel, t: number): void {
    if (!sourceBlock) return;
    const latest = latestAnchor(pm, t);
    const anchor = latest ?? firstAnchor(pm);
    const key = anchor ? `${anchor.refs[0] ?? ''}@${anchor.t}:${latest ? 'l' : 'f'}` : 'none';
    const extrapolatedDays = latest ? Math.max(0, t - latest.t) : 0;
    const fullKey = `${key}:${extrapolatedDays > 14 ? Math.round(extrapolatedDays) : 0}`;
    if (fullKey === sourceKey) return;
    sourceKey = fullKey;
    const metric = anchor
      ? city.dataset.metrics.find((m) => m.id === (anchor.refs[0] ?? ''))
      : undefined;
    const parts: (Node | null)[] = [
      h('h3', { class: 'panel__section' }, COPY.panel.latest),
      !latest && anchor ? h('p', { class: 'panel__note' }, COPY.time.beforeFirstFigure) : null,
      metric && anchor
        ? h(
            'div',
            { class: 'source' },
            h(
              'p',
              { class: 'source__figure' },
              describeValue(metric),
              ' ',
              tierBadge(metric.sourceKind === 'primary' ? 'reported' : 'derived'),
            ),
            h('p', { class: 'source__quote' }, `“${metric.quote}”`),
            h(
              'p',
              { class: 'source__meta' },
              `${metric.scope} · ${daysToIso(anchor.t)} · `,
              link(metric.source.url, metric.source.publisher),
              metric.verified === 'snippet' ? ` · ${COPY.panel.snippet}` : '',
            ),
          )
        : h('p', {}, '—'),
      h('h3', { class: 'panel__section' }, COPY.panel.how),
      h('p', { class: 'panel__formula' }, anchor?.formula ?? '—'),
      extrapolatedDays > 14
        ? h('p', { class: 'panel__note' }, COPY.panel.extrapolated(Math.round(extrapolatedDays)))
        : null,
    ];
    sourceBlock.replaceChildren(...parts.filter((x): x is Node => x !== null));
  }

  function overviewPane(id: string): HTMLElement {
    const pm = city.byId.get(id)!;
    const today = row(COPY.panel.today, COPY.panel.tokens);
    const now = row(COPY.panel.now, COPY.panel.perSecond);
    const perDay = row(COPY.panel.perDay, COPY.panel.tokens);
    const total = row(COPY.panel.sinceLaunch, COPY.panel.tokens);
    const gpus = row(COPY.panel.gpus, COPY.panel.gpuUnit);
    const power = row(COPY.panel.power, 'MW');
    const water = row(COPY.panel.water, COPY.panel.waterUnit);
    Object.assign(rows, {
      today: today.row,
      now: now.row,
      perDay: perDay.row,
      total: total.row,
      gpus: gpus.row,
      power: power.row,
      water: water.row,
    });
    sourceBlock = h('div', { class: 'panel__source-block' });
    sourceKey = '';
    renderSource(pm, clock.now());

    return pane(
      'overview',
      h('p', { class: 'panel__scope' }, pm.platform.scope),
      h('div', { class: 'panel__grid' }, today.el, now.el, perDay.el, total.el),
      h('h3', { class: 'panel__section' }, COPY.panel.infrastructure),
      h('div', { class: 'panel__grid' }, gpus.el, power.el, water.el),
      h('p', { class: 'panel__note' }, COPY.panel.infraNote),
      sourceBlock,
      h(
        'p',
        { class: 'panel__note' },
        h('a', { href: METHODOLOGY_URL, rel: 'noopener' }, COPY.hud.methodLink),
      ),
    );
  }

  function officesPane(): HTMLElement {
    const perDay = row(COPY.panel.perDay, COPY.panel.tokens);
    const traffic = row(COPY.offices.traffic, COPY.offices.trafficUnit);
    rows.offPerDay = perDay.row;
    rows.offTraffic = traffic.row;
    const shapeNote = h('p', { class: 'panel__note' }, COPY.offices.trafficNote, ' ');
    shapeNote.append(h('a', { href: METHODOLOGY_URL, rel: 'noopener' }, COPY.hud.methodLink));
    hardwareLine = h('p', { class: 'panel__lead', id: 'offices-hardware' });
    const band = (x: number) => humanNumber(tokensAtLoad(x), 'short');
    return pane(
      'offices',
      h('p', { class: 'panel__lead' }, COPY.offices.intro),
      h('p', { class: 'panel__honesty' }, COPY.offices.honesty),
      h('div', { class: 'panel__grid' }, perDay.el, traffic.el),
      shapeNote,
      h('h3', { class: 'panel__section' }, COPY.offices.hardwareLabel),
      hardwareLine,
      h(
        'p',
        { class: 'panel__note' },
        COPY.offices.bands(band(DESK_BANDS[0]), band(DESK_BANDS[1])),
      ),
      h('p', { class: 'panel__note' }, COPY.offices.typing),
    );
  }

  function hallPane(id: string): HTMLElement {
    const hw = city.byId.get(id)!.platform.hardware;
    const now = row(COPY.panel.now, COPY.panel.perSecond);
    const gpus = row(COPY.panel.gpus, COPY.panel.gpuUnit);
    rows.hallNow = now.row;
    rows.hallGpus = gpus.row;
    const sources = h('p', { class: 'constant__sources' });
    hw.sources.forEach((s, i) => {
      if (i > 0) sources.append(' · ');
      sources.append(link(s.url, s.title));
    });
    return pane(
      'hall',
      h('p', { class: 'panel__lead' }, COPY.hall.intro),
      h('p', { class: 'panel__honesty' }, COPY.hall.honesty),
      h('div', { class: 'panel__grid' }, now.el, gpus.el),
      h('h3', { class: 'panel__section' }, COPY.hall.accelerator),
      h('p', { class: 'panel__lead' }, h('strong', {}, COPY.hall.classes[hw.accelerator])),
      h('p', { class: 'panel__note' }, hw.note),
      h(
        'p',
        { class: 'panel__note' },
        isLiquidCooled(hw.accelerator) ? COPY.hall.liquid : COPY.hall.air,
      ),
      hw.sources.length > 0
        ? h('p', { class: 'panel__note' }, `${COPY.hall.sources}: `, sources)
        : null,
    );
  }

  function powerPane(): HTMLElement {
    // One log scale per gauge spanning every HQ, so the needles compare. It is built from each
    // HQ's daily-average range widened by the largest possible traffic swing, so the decades do
    // not change with the time of day.
    const t = clock.now();
    let mwLo = Infinity;
    let mwHi = 0;
    let wLo = Infinity;
    let wHi = 0;
    for (const pm of city.platforms) {
      const day = dailyRate(pm, t);
      if (!(day.central > 0)) continue;
      const tier = rateTier(pm, t);
      const swing = Math.max(
        ...pm.components.map((c) => {
          const k = TRAFFIC[c.component.profile];
          return k.a1.high + k.a2.high + k.w.high;
        }),
      );
      const avg = { low: day.low / 86_400, central: day.central / 86_400, high: day.high / 86_400 };
      const mw = powerMW(gpuEquivalents(avg, tier).range, tier).range;
      const w = waterLitersPerDay(day, tier).range;
      mwLo = Math.min(mwLo, mw.low * Math.max(0.05, 1 - swing));
      mwHi = Math.max(mwHi, mw.high * (1 + swing));
      wLo = Math.min(wLo, w.low);
      wHi = Math.max(wHi, w.high);
    }
    const ps = decadeScale(mwLo, mwHi);
    const ws = decadeScale(wLo, wHi);
    const power = createGauge({
      label: COPY.power.powerGauge,
      unit: 'MW',
      ...ps,
      tickLabel: (v) => (v < 1 ? String(v) : humanNumber(v, 'short')),
    });
    const waterGauge = createGauge({
      label: COPY.power.waterGauge,
      unit: COPY.panel.waterUnit,
      ...ws,
      tickLabel: (v) => humanNumber(v, 'short'),
    });
    gauges = { power, water: waterGauge };
    const water = waterLitersPerDay({ low: 1, central: 1, high: 1 }, 'modeled');
    const powerF = powerMW({ low: 1, central: 1, high: 1 }, 'modeled');
    const plain = (n: number) => String(n);
    return pane(
      'power',
      h('p', { class: 'panel__lead' }, COPY.power.intro),
      h(
        'div',
        { class: 'panel__grid panel__grid--gauges' },
        power.el,
        isDisplayable(water.refs) ? waterGauge.el : null,
      ),
      h('h3', { class: 'panel__section' }, COPY.power.formula),
      h(
        'p',
        { class: 'panel__formula' },
        `MW = ${powerF.formula}`,
        h('br', {}),
        `${COPY.panel.water} = ${water.formula}`,
      ),
      h('p', { class: 'panel__note' }, COPY.panel.infraNote),
      h('h3', { class: 'panel__section' }, COPY.power.inputs),
      h(
        'div',
        { class: 'constants' },
        constantCard(COPY.power.labels.throughput, COMPUTE.throughputTokensPerSecPerGpu, (n) =>
          fullNumber(n),
        ),
        constantCard(COPY.power.labels.kw, COMPUTE.kwPerGpu, plain),
        constantCard(COPY.power.labels.pue, COMPUTE.pue, plain),
        constantCard(COPY.power.labels.wue, COMPUTE.wueLitersPerKwh, plain),
      ),
    );
  }

  /** Reported only for a checked figure from the maker's own publication (as for metrics). */
  function factBadge(m: Model): HTMLSpanElement {
    if (m.verified === 'pending') return uncheckedBadge();
    return tierBadge(m.sourceKind === 'primary' ? 'reported' : 'derived');
  }

  function modelDate(m: Model): string {
    return m.datePrecision === 'month' ? m.released.slice(0, 7) : m.released;
  }

  function modelDetails(m: Model | undefined, parent: string): Node[] {
    if (!m) return [h('p', { class: 'panel__note' }, COPY.lab.choose)];
    const checked = m.verified === 'snippet' ? COPY.panel.snippet : null;
    return [
      h('h4', { class: 'lab-detail__name' }, m.name),
      h(
        'dl',
        { class: 'lab-detail__facts' },
        h('dt', {}, m.dateKind === 'first-seen' ? COPY.lab.firstSeen : COPY.lab.released),
        h('dd', {}, modelDate(m), ' ', factBadge(m)),
        h('dt', {}, COPY.lab.context),
        h(
          'dd',
          {},
          m.contextWindowTokens === null
            ? COPY.lab.notPublished
            : `${fullNumber(m.contextWindowTokens)} ${COPY.lab.contextUnit}`,
          m.contextWindowTokens === null ? null : ' ',
          m.contextWindowTokens === null ? null : factBadge(m),
        ),
        h('dt', {}, COPY.lab.modalities),
        h('dd', {}, m.modalities.join(', ')),
        h('dt', {}, COPY.lab.origin),
        h(
          'dd',
          {},
          m.origin === 'own' ? COPY.lab.own(m.maker ?? parent) : COPY.lab.offered(m.maker ?? '—'),
        ),
        h('dt', {}, COPY.lab.source),
        h('dd', {}, link(m.source.url, `${m.source.publisher} — ${m.source.title}`)),
      ),
      m.note ? h('p', { class: 'panel__note' }, m.note) : null,
      checked ? h('p', { class: 'panel__note' }, checked) : null,
      m.verified === 'pending' ? h('p', { class: 'panel__note' }, COPY.lab.pending) : null,
    ].filter((x): x is HTMLHeadingElement | HTMLDListElement | HTMLParagraphElement => x !== null);
  }

  /** The lab lists the models released by the date shown (the display case holds the newest). */
  function renderLabList(id: string, t: number): void {
    if (!labList) return;
    const models = releasedBy(
      city.dataset.models.filter((m) => m.platform === id),
      t,
    );
    if (models.length === labModels) return;
    labModels = models.length;
    const all = [...labLineup(models, Infinity)].reverse();
    modelButtons = all.map((m) => {
      const b = h(
        'button',
        { class: 'lab-list__item', type: 'button', 'aria-pressed': 'false', 'data-model': m.id },
        h('span', { class: 'lab-list__name' }, m.name),
        h(
          'span',
          { class: 'lab-list__meta' },
          modelDate(m),
          m.flagship ? ` · ${COPY.lab.flagship}` : '',
          m.origin === 'offered' ? ` · ${COPY.lab.offeredTag}` : '',
        ),
      );
      b.addEventListener('click', () => {
        const next = selectedModel === m.id ? null : m.id;
        selectModel(next);
        cb.onModel(next);
      });
      return b;
    });
    const parts: (Node | null)[] = [
      models.length > LAB_MAX
        ? h('p', { class: 'panel__note' }, COPY.lab.capped(LAB_MAX, models.length))
        : null,
      models.length === 0 ? h('p', { class: 'panel__note' }, COPY.lab.empty) : null,
      h('h3', { class: 'panel__section' }, COPY.lab.list),
      h(
        'ul',
        { class: 'lab-list', 'aria-label': COPY.lab.list },
        ...modelButtons.map((b) => h('li', {}, b)),
      ),
    ];
    labList.replaceChildren(...parts.filter((x): x is Node => x !== null));
    // A selected model that is not released at this date is deselected.
    if (selectedModel && !models.some((m) => m.id === selectedModel)) {
      selectModel(null);
      cb.onModel(null);
    } else {
      for (const b of modelButtons)
        b.setAttribute('aria-pressed', String(b.dataset.model === selectedModel));
    }
  }

  function labPane(id: string): HTMLElement {
    const p = city.byId.get(id)!.platform;
    modelDetail = h('div', { class: 'lab-detail', 'aria-live': 'polite' });
    labList = h('div', { class: 'lab-list-block' });
    labModels = -1;
    modelButtons = [];
    renderLabList(id, clock.now());
    return pane(
      'lab',
      h('p', { class: 'panel__lead' }, COPY.lab.intro(p.name)),
      modelDetail,
      labList,
    );
  }

  function selectModel(id: string | null): void {
    selectedModel = id;
    for (const b of modelButtons) b.setAttribute('aria-pressed', String(b.dataset.model === id));
    if (!openId || !modelDetail) return;
    const p = city.byId.get(openId)!.platform;
    const m = city.dataset.models.find((x) => x.id === id && x.platform === openId);
    modelDetail.replaceChildren(...modelDetails(m, p.parent));
    if (id) modelDetail.scrollIntoView({ block: 'nearest' });
  }

  function render(id: string): void {
    const p = city.byId.get(id)!.platform;
    rows = {};
    gauges = {};
    view = 'overview';
    selectedModel = null;
    const panesEls = [overviewPane(id), officesPane(), hallPane(id), powerPane(), labPane(id)];
    panes = panesEls;
    root.dataset.view = 'overview';
    root.replaceChildren(
      h(
        'div',
        { class: 'panel__inner', style: `--accent: ${p.identity.palette.accent}` },
        h(
          'header',
          { class: 'panel__header' },
          h('h2', { class: 'panel__title', id: 'panel-title' }, p.name),
          h(
            'p',
            { class: 'panel__meta' },
            `${p.parent} · ${p.hq.city} · `,
            h('span', { id: 'panel-localtime' }),
          ),
          (historyChip = h('p', { class: 'panel__history', hidden: true })),
          close,
        ),
        tablist(),
        ...panesEls,
      ),
    );
    selectModel(null);
    lastSlow = 0;
    lastFast = 0;
    labelKey = '';
  }

  /**
   * Labels that depend on the date shown: live wording, or the date in history (a whole-day
   * total, "so far" when that day is today); interior tabs are disabled before launch.
   */
  function relabel(t: number, launched: boolean): void {
    const past = history();
    const dayIso = daysToIso(t);
    const soFar = utcDayStart(t) + 1 > live.now();
    const key = `${past}:${dayIso}:${soFar}:${launched}`;
    if (key === labelKey) return;
    labelKey = key;
    setLabel(
      rows.today,
      past
        ? soFar
          ? COPY.time.panelDaySoFar(dayIso)
          : COPY.time.panelDay(dayIso)
        : COPY.panel.today,
    );
    const nowLabel = past ? COPY.time.rateLabelHistory : COPY.panel.now;
    setLabel(rows.now, nowLabel);
    setLabel(rows.hallNow, nowLabel);
    setLabel(rows.power, past ? COPY.time.powerHistory : COPY.panel.power);
    gauges.power?.setLabel(past ? COPY.time.powerHistory : COPY.power.powerGauge);
    if (historyChip) {
      historyChip.hidden = !past;
      historyChip.textContent = past ? COPY.time.historyChip(dayIso) : '';
      historyChip.title = COPY.time.historyNote;
    }
    tabs.forEach((tab, i) => {
      if (VIEWS[i] === 'overview') return;
      tab.disabled = !launched;
      tab.title = launched ? '' : COPY.time.notLaunched;
    });
  }

  function update(): void {
    if (!openId) return;
    const nowMs = performance.now();
    if (nowMs - lastFast < 80) return;
    lastFast = nowMs;
    const pm = city.byId.get(openId)!;
    const t = clock.now();
    // A jump of the time shown (seek, playback) refreshes every number at once.
    if (!(Math.abs(t - lastT) < 0.25)) lastSlow = 0;
    lastT = t;
    const day = dailyRate(pm, t);
    const launched = day.central > 0;
    relabel(t, launched);
    const tier = rateTier(pm, t);
    // Anything depending on the time-of-day curve is at best Modeled (see instantTier).
    const iTier = instantTier(pm, t);
    const tps = tokensPerSecond(pm, t);
    // Right after a render or a tab switch every pane is filled, so no number
    // ever sits without its badge; after that only the visible pane ticks.
    const all = lastSlow === 0;
    const on = (v: InteriorView) => all || view === v;
    if (on('overview')) {
      // Live: since 00:00 UTC. History: the whole UTC day shown (up to now if it is today).
      const dayStart = utcDayStart(t);
      const end = history() ? Math.min(dayStart + 1, live.now()) : t;
      const today = between(pm, dayStart, end);
      if (launched) {
        setRow(rows.today!, fullNumber(today.central), today, iTier);
        setRow(rows.now!, humanNumber(tps.central), tps, iTier);
      } else {
        setWaiting(rows.today);
        setWaiting(rows.now);
      }
    }
    if (on('hall')) setRow(rows.hallNow!, humanNumber(tps.central), tps, iTier);
    if (nowMs - lastSlow < 2000) return;
    lastSlow = nowMs;
    if (on('overview')) renderSource(pm, t);
    if (on('lab')) renderLabList(pm.platform.id, t);
    const g: Estimate = gpuEquivalents(tps, tier);
    const mw = powerMW(g.range, tier);
    const w = waterLitersPerDay(day, tier);
    const waterOk = isDisplayable(w.refs);
    if (on('overview')) {
      if (launched) {
        setRow(rows.perDay!, humanNumber(day.central), day, tier);
        const cum = cumulative(pm, t);
        setRow(rows.total!, humanNumber(cum.central), cum, cumulativeTier(pm, t));
        setRow(rows.gpus!, humanNumber(g.range.central), g.range, g.tier);
        setRow(rows.power!, mwText(mw.range.central), mw.range, mw.tier, mwText);
        if (waterOk) setRow(rows.water!, humanNumber(w.range.central), w.range, w.tier);
      } else {
        for (const k of ['perDay', 'total', 'gpus', 'power', 'water']) setWaiting(rows[k]);
      }
    }
    if (on('offices')) {
      setRow(rows.offPerDay!, humanNumber(day.central), day, tier);
      // The traffic curve is a modeled shape (TRAFFIC constants).
      const tr = trafficNowRange(pm, t);
      setRow(rows.offTraffic!, tr.central.toFixed(2), tr, iTier, (n) => n.toFixed(2));
      if (hardwareLine)
        hardwareLine.textContent = COPY.offices.hardware[deskTier(logLoad(day.central))];
    }
    if (on('hall')) setRow(rows.hallGpus!, humanNumber(g.range.central), g.range, g.tier);
    if (on('power')) {
      gauges.power?.set(
        mw.range,
        mw.tier,
        mwText(mw.range.central),
        COPY.panel.range(mwText(mw.range.low), mwText(mw.range.high)),
      );
      if (waterOk)
        gauges.water?.set(
          w.range,
          w.tier,
          humanNumber(w.range.central),
          COPY.panel.range(humanNumber(w.range.low), humanNumber(w.range.high)),
        );
    }
    // Local time at the HQ for the time shown (live or history).
    const lt = document.getElementById('panel-localtime');
    if (lt)
      lt.textContent = COPY.panel.localTime(localTimeLabel(pm.platform.hq.timezone, daysToMs(t)));
  }

  return {
    get openId() {
      return openId;
    },
    get view() {
      return view;
    },
    show(id) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && !root.contains(active)) returnFocus = active;
      openId = id;
      render(id);
      update();
      root.hidden = false;
      root.setAttribute('aria-labelledby', 'panel-title');
      requestAnimationFrame(() => root.classList.add('panel--open'));
    },
    hide() {
      const id = openId;
      openId = null;
      view = 'overview';
      // Never strand keyboard focus on a panel that is about to disappear: go back to where the
      // visitor came from (usually the HQ's label), else to the city canvas.
      if (root.contains(document.activeElement)) {
        const candidates = [
          returnFocus,
          document.querySelector<HTMLElement>(`.label[data-id="${id ?? ''}"]`),
          byId('scene'),
        ];
        for (const el of candidates) {
          if (!el?.isConnected) continue;
          el.focus({ preventScroll: true });
          if (document.activeElement === el) break;
        }
      }
      returnFocus = null;
      root.classList.remove('panel--open');
      root.hidden = true;
    },
    showView(v) {
      setView(v, false, false);
    },
    selectModel,
    update,
  };
}
