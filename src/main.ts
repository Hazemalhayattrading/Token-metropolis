/**
 * Boot: load and validate data → build the model → mount the HUD and data view
 * → start the 3D world, or the 2D dashboard when WebGL is unavailable.
 */
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import './styles/main.css';
import './styles/timeline.css';
import './styles/race.css';
import './styles/feed.css';
import './styles/compare.css';
import './styles/incidents.css';
import './styles/tour.css';
import './styles/prompt.css';
import './styles/discoveries.css';
import './styles/share.css';
import { createSound } from './audio/sound';
import { COPY } from './copy';
import { DataUnavailableError, loadData } from './data/load';
import { dailyRate } from './model/estimate';
import { buildCity } from './state/city';
import { liveClock } from './state/clock';
import { activeIncidents } from './state/incidents';
import { createTimeMachine } from './state/timemachine';
import { createIdleTimer, TOUR_IDLE_MS, tourStops } from './state/tour';
import { renderDataTable } from './ui/data-table';
import { byId, h } from './ui/dom';
import { mountHud } from './ui/hud';
import { mountCompare } from './ui/compare';
import { mountFeed, mountToasts } from './ui/feed';
import { mountIncidentBanner } from './ui/incidents';
import { mountTourCaptions } from './ui/tour';
import { createPanel } from './ui/panel';
import { mountPrompt } from './ui/prompt';
import { createTracker } from './state/discoveries';
import { shareCardText, type CardView } from './state/sharecard';
import { mountDiscoveries } from './ui/discoveries';
import { mountShareButton, type ShareInput } from './ui/share';
import { mountRace } from './ui/race';
import { mountTimeline } from './ui/timeline';
import type { ScaleMode } from './world/scale';

type AppState = 'loading' | 'ready' | 'error';

function setState(state: AppState): void {
  document.documentElement.dataset.state = state;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

function applyStaticCopy(): void {
  document.title = `${COPY.siteName} — ${COPY.tagline}`;
  byId('site-title').textContent = COPY.siteName;
  byId('site-tagline').textContent = COPY.tagline;
  byId('disclaimer').textContent = COPY.footer.disclaimer;
  byId('skip-link').textContent = COPY.skipToData;
  byId('loader-status').textContent = COPY.loading.status;
}

/** A control-row toggle (aria-pressed); `onToggle` returns the resulting state. */
function toggleButton(
  label: string,
  title: string,
  onToggle: (on: boolean) => boolean | Promise<boolean>,
): HTMLButtonElement {
  const b = h(
    'button',
    { class: 'control-button', type: 'button', 'aria-pressed': 'false', title },
    label,
  );
  b.addEventListener('click', () => {
    const next = b.getAttribute('aria-pressed') !== 'true';
    void Promise.resolve(onToggle(next)).then((on) => b.setAttribute('aria-pressed', String(on)));
  });
  return b;
}

/**
 * The control row: scale toggle (log ↔ true scale, a segmented control with aria-pressed
 * buttons), the race toggle, and a slot for the "What's new" feed.
 */
function mountControls(
  onScale: ((mode: ScaleMode) => void) | null,
  onRace: () => void,
  onCompare: (() => void) | null = null,
): {
  raceButton: HTMLButtonElement;
  compareButton: HTMLButtonElement | null;
  feedSlot: HTMLElement;
} {
  const make = (mode: ScaleMode, label: string) => {
    const b = h(
      'button',
      { class: 'segmented__option', type: 'button', 'aria-pressed': String(mode === 'log') },
      label,
    );
    b.addEventListener('click', () => {
      for (const el of group.querySelectorAll('button'))
        el.setAttribute('aria-pressed', String(el === b));
      onScale?.(mode);
    });
    return b;
  };
  const group = h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': COPY.controls.scale },
    make('log', COPY.controls.log),
    make('true', COPY.controls.true),
  );
  const raceButton = h(
    'button',
    { class: 'control-button', type: 'button', 'aria-pressed': 'false', 'aria-controls': 'race' },
    COPY.race.open,
  );
  raceButton.addEventListener('click', onRace);
  const compareButton = onCompare
    ? h(
        'button',
        {
          class: 'control-button',
          type: 'button',
          'aria-pressed': 'false',
          'aria-controls': 'compare',
        },
        COPY.compare.open,
      )
    : null;
  if (compareButton && onCompare) compareButton.addEventListener('click', onCompare);
  const feedSlot = h('div', { class: 'feed-slot' });
  byId('controls').replaceChildren(
    ...(onScale ? [group] : []),
    raceButton,
    ...(compareButton ? [compareButton] : []),
    feedSlot,
  );
  return { raceButton, compareButton, feedSlot };
}

async function boot(): Promise<void> {
  setState('loading');
  applyStaticCopy();
  try {
    const data = await loadData(import.meta.env.BASE_URL);
    const city = buildCity(data.dataset);
    const arrivedAt = liveClock.now();
    // The time machine is the clock for everything on screen except "since you arrived".
    const tm = createTimeMachine(liveClock);
    const hud = mountHud(city, data, tm, arrivedAt, liveClock, () => tm.state().mode === 'history');
    renderDataTable(byId('data-table'), city, liveClock.now());

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mobile = window.matchMedia('(max-width: 720px)');
    const platformName = (id: string) => city.byId.get(id)?.platform.name ?? id;
    const accent = (id: string) => city.byId.get(id)?.platform.identity.palette.accent ?? '#ffffff';
    const toasts = mountToasts(byId('toasts'), { platformName, accent, reducedMotion });
    const timeline = mountTimeline(byId('timeline'), tm, {
      events: data.events,
      reducedMotion,
      accent,
    });

    // Race mode: a right-hand panel on desktop; on phones it shares the bottom sheet slot with the
    // HQ panel, so opening one closes the other.
    let onRaceOpen: () => void = () => undefined;
    const raceEl = byId('race');
    let controls: ReturnType<typeof mountControls>;
    const setRace = (open: boolean) => {
      if (open) {
        race.show();
        onRaceOpen();
      } else race.hide();
      raceEl.hidden = !open;
      document.documentElement.classList.toggle('race-open', open);
      controls.raceButton.setAttribute('aria-pressed', String(open));
      if (!open && (raceEl.contains(document.activeElement) || !document.activeElement)) {
        // The toggle is hidden while an HQ panel is open: go to the panel instead, else the city.
        const toggleShown =
          controls.raceButton.checkVisibility?.() ?? controls.raceButton.offsetParent !== null;
        const target = toggleShown
          ? controls.raceButton
          : (document.querySelector<HTMLElement>('#panel:not([hidden]) [aria-selected="true"]') ??
            byId('scene'));
        target.focus({ preventScroll: true });
      }
    };
    // Opening an HQ from the race or the feed moves keyboard focus into its panel.
    let openHq: (id: string) => void = () => byId('data-view').focus();
    const race = mountRace(raceEl, city, tm, {
      onClose: () => setRace(false),
      reducedMotion,
      onSelect: (id) => openHq(id),
    });

    // Share card: an image of the view with its key numbers, ranges and tier chips.
    const shareSlot = h('div', { class: 'share-slot' });
    const shareText = (platformId: string | null, view: CardView['view'] = 'overview') =>
      shareCardText(city, {
        t: tm.now(),
        liveNow: liveClock.now(),
        history: tm.state().mode === 'history',
        platformId,
        view,
      });
    const siteUrl = () => location.origin + location.pathname;

    if (hasWebGL()) {
      const { createWorld } = await import('./world/world');
      const panelEl = byId('panel');
      // Recentre the scene in the screen area the panel leaves free.
      const promptEl = byId('prompt');
      const updateInsets = () => {
        // On phones the prompt sheet takes the lower screen: recentre the scene above it.
        if (mobile.matches && !promptEl.hidden) {
          const stage = byId('scene').getBoundingClientRect();
          const r = promptEl.getBoundingClientRect();
          world.setInsets({ left: 0, bottom: Math.max(0, stage.bottom - r.top) });
          return;
        }
        if (panelEl.hidden) {
          world.setInsets({ left: 0, bottom: 0 });
          return;
        }
        const stage = byId('scene').getBoundingClientRect();
        const r = panelEl.getBoundingClientRect();
        world.setInsets(
          mobile.matches
            ? { left: 0, bottom: Math.max(0, stage.bottom - r.top) }
            : { left: Math.max(0, r.right - stage.left), bottom: 0 },
        );
      };
      const panel = createPanel(
        city,
        tm,
        {
          onClose: () => world.select(null),
          onView: (view) => world.setView(view),
          onModel: (id) => world.selectModel(id),
        },
        { history: () => tm.state().mode === 'history', live: liveClock },
      );
      // "Your prompt, visualized": count a prompt's tokens and fly one into an HQ. It is about the
      // present, so opening it returns the time machine to live. On wide screens it sits beside
      // the HQ panel (picking an HQ in the city aims it there); on narrower ones the two share a
      // slot, as the race and the HQ panel do on phones.
      const roomy = window.matchMedia('(min-width: 960px)');
      const promptButton = h(
        'button',
        {
          class: 'control-button',
          type: 'button',
          'aria-pressed': 'false',
          'aria-controls': 'prompt',
        },
        COPY.prompt.open,
      );
      const promptShown = (open: boolean) => {
        promptButton.setAttribute('aria-pressed', String(open));
        document.documentElement.classList.toggle('prompt-open', open);
        updateInsets();
      };
      const prompt = mountPrompt(promptEl, city, {
        reducedMotion,
        onSend: (id, _tokens, origin) => world.sendToken(id, origin),
        onClose: () => promptShown(false),
      });
      const closePrompt = () => {
        if (!prompt.isOpen) return;
        prompt.close();
        promptShown(false);
      };
      // (The control row is hidden while an HQ panel is open: the prompt opens from the city view.)
      promptButton.addEventListener('click', () => {
        if (prompt.isOpen) return closePrompt();
        tm.goLive();
        if (race.open) setRace(false);
        prompt.open();
        promptShown(true);
      });
      const sound = createSound();
      // Hidden details: a per-visitor tracker (this browser only) and the "12/40 found" chip.
      const tracker = createTracker();
      const discSlot = h('div', { class: 'disc-slot' });
      const discoveries = mountDiscoveries(discSlot, tracker, { platformName, reducedMotion });
      const world = createWorld(byId<HTMLCanvasElement>('scene'), city, tm, {
        reducedMotion,
        sound,
        labels: byId('labels'),
        events: data.events,
        onLaunch: (e) => toasts.push(e),
        isPlaying: () => tm.state().playing,
        onFrame: () => {
          hud.update();
          panel.update();
          timeline.update();
          race.update();
          feed.update();
          compare.update();
        },
        onSelect: (id) => {
          // Toggle the class first, so controls hidden under the panel are visible again before
          // the panel hands focus back to them.
          document.documentElement.classList.toggle('panel-open', id !== null);
          if (id) panel.show(id);
          else panel.hide();
          if (id && mobile.matches && race.open) setRace(false);
          if (id && prompt.isOpen) {
            if (roomy.matches) prompt.open(id);
            else closePrompt();
          }
          updateInsets();
        },
        onModel: (id) => {
          if (panel.view === 'lab') panel.selectModel(id);
        },
        onDiscovery: (id) => {
          if (tracker.mark(id)) discoveries.celebrate(id);
        },
        onViewChange: (view) => panel.showView(view),
      });
      new ResizeObserver(updateInsets).observe(panelEl);
      new ResizeObserver(updateInsets).observe(promptEl);
      // Seeks, play/pause and returning to live are jumps, not playback: no launch pulses for them.
      tm.subscribe(() => world.resetTimeline());
      // On phones the race and the HQ panel share the bottom sheet: never both at once.
      mobile.addEventListener('change', () => {
        if (mobile.matches && race.open && !panelEl.hidden) setRace(false);
        updateInsets();
      });
      openHq = (id) => {
        world.select(id);
        requestAnimationFrame(() =>
          panelEl.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(),
        );
      };
      onRaceOpen = () => {
        if (mobile.matches) world.select(null);
        closePrompt();
      };
      // Compare mode: split-screen campuses with a metrics card per column.
      const compareEl = byId('compare');
      // Towers are vertical, so compare always uses columns; on phones they fill the top half and
      // the metrics cards the bottom half.
      const layout = () => 'columns' as const;
      const area = () => (mobile.matches ? 0.5 : 1);
      const setCompareOpen = (open: boolean) => {
        document.documentElement.classList.toggle('compare-open', open);
        controls.compareButton?.setAttribute('aria-pressed', String(open));
        if (open) {
          if (race.open) setRace(false);
          closePrompt();
          const ranked = [...city.platforms]
            .map((pm) => ({ id: pm.platform.id, r: dailyRate(pm, tm.now()).central }))
            .sort((a, b) => b.r - a.r)
            .map((x) => x.id);
          const first = panel.openId ?? ranked[0]!;
          compare.show([first, ranked.find((x) => x !== first)!]);
        } else {
          compare.hide();
          world.setCompare(null, layout(), area());
        }
      };
      const compare = mountCompare(compareEl, city, tm, {
        onChange: (ids) => world.setCompare(ids, layout(), area()),
        onClose: () => setCompareOpen(false),
        history: () => tm.state().mode === 'history',
      });
      mobile.addEventListener('change', () => {
        if (compare.open) world.setCompare(compare.ids, layout(), area());
      });
      controls = mountControls(
        (mode) => world.setScale(mode),
        () => setRace(!race.open),
        () => setCompareOpen(!compare.open),
      );
      const feed = mountFeed(controls.feedSlot, {
        events: data.events,
        clock: tm,
        platformName,
        accent,
        onSelect: (id) => openHq(id),
      });
      // Uncertainty glass and sound: view toggles in the control row.
      const status = byId('sr-status');
      const legend = byId('glass-legend');
      legend.replaceChildren(
        h(
          'details',
          { class: 'glass-legend__box', open: !mobile.matches },
          h('summary', {}, COPY.glass.legendTitle),
          h(
            'ul',
            {},
            h('li', { 'data-part': 'core' }, COPY.glass.legend.core),
            h('li', { 'data-part': 'glass' }, COPY.glass.legend.glass),
            h('li', { 'data-part': 'ring' }, COPY.glass.legend.ring),
            h('li', { 'data-part': 'frost' }, COPY.glass.legend.frost),
          ),
          h('p', {}, COPY.glass.rangeNote),
        ),
      );
      const glassButton = toggleButton(COPY.glass.toggle, COPY.glass.tooltip, (on) => {
        world.setGlass(on);
        legend.hidden = !on;
        status.textContent = on ? COPY.glass.announceOn : COPY.glass.announceOff;
        return on;
      });
      const soundButton = toggleButton(COPY.sound.toggle, COPY.sound.tooltip, async (on) => {
        await sound.setEnabled(on);
        if (on && !sound.enabled) status.textContent = COPY.sound.failed;
        return sound.enabled;
      });
      controls.feedSlot.before(promptButton, glassButton, soundButton);
      controls.feedSlot.after(discSlot, shareSlot);

      // The share card frames what the visitor sees: with the HQ panel open, the part of the
      // frame beside (desktop) or above (phones) the panel, where the view is centred.
      const freeArea = (frame: HTMLCanvasElement): HTMLCanvasElement => {
        if (panelEl.hidden) return frame;
        const stage = byId('scene').getBoundingClientRect();
        const r = panelEl.getBoundingClientRect();
        const k = frame.width / Math.max(1, stage.width);
        const x = mobile.matches ? 0 : Math.round((r.right - stage.left) * k);
        const w = frame.width - x;
        const hgt = mobile.matches ? Math.round((r.top - stage.top) * k) : frame.height;
        if (w < 64 || hgt < 64) return frame;
        const out = document.createElement('canvas');
        out.width = w;
        out.height = hgt;
        out.getContext('2d')?.drawImage(frame, x, 0, w, hgt, 0, 0, w, hgt);
        return out;
      };
      const captureView = async (): Promise<ShareInput> => {
        const id = panelEl.hidden ? null : panel.openId;
        return {
          frame: freeArea(world.captureFrame()),
          ...shareText(id, id ? world.view : 'overview'),
          url: siteUrl(),
        };
      };
      mountShareButton(shareSlot, { capture: captureView });
      mountShareButton(panel.actions, { capture: captureView });

      // Incident mode: official status-page notices. incidents.json is a snapshot of *current*
      // status, so notices follow the live clock only (not the time machine).
      const banner = mountIncidentBanner(byId('incidents'), { platformName, onSelect: openHq });
      const refreshIncidents = () => {
        const live = tm.state().mode === 'live';
        const active = live
          ? activeIncidents(data.incidents, Date.now(), { staleAfterMs: 3 * 86_400_000 })
          : new Map<string, (typeof data.incidents)[number]>();
        banner.update(active);
        world.setIncidents(active);
      };
      refreshIncidents();
      setInterval(refreshIncidents, 1000);

      // Cinematic tour: after 30 s without input (and nothing open), the camera flies a curated
      // loop with captions; any input hands control back.
      const tourEl = byId('tour');
      let tourRun = 0;
      const captions = mountTourCaptions(tourEl, { onStop: () => stopTour() });
      const stopTour = () => {
        if (!document.documentElement.classList.contains('tour-on')) return;
        tourRun++;
        document.documentElement.classList.remove('tour-on');
        captions.hide();
        setTimeout(() => {
          if (!document.documentElement.classList.contains('tour-on')) tourEl.hidden = true;
        }, 700);
      };
      const wait = (ms: number, run: number) =>
        new Promise<boolean>((resolve) => setTimeout(() => resolve(run === tourRun), ms));
      const startTour = async () => {
        const busy =
          !panelEl.hidden ||
          compare.open ||
          race.open ||
          prompt.isOpen ||
          document.documentElement.classList.contains('share-open') ||
          tm.state().playing;
        if (busy || document.hidden) return;
        const run = ++tourRun;
        tm.goLive();
        document.documentElement.classList.add('tour-on');
        tourEl.hidden = false;
        while (run === tourRun) {
          for (const stop of tourStops(city, liveClock.now())) {
            world.tourTo(stop.id ? { kind: stop.kind, id: stop.id } : { kind: stop.kind });
            if (!(await wait(reducedMotion ? 300 : 3200, run))) return;
            captions.show(stop.caption, stop.tier);
            if (!(await wait(stop.holdSeconds * 1000, run))) return;
          }
        }
      };
      createIdleTimer({
        timeoutMs: TOUR_IDLE_MS,
        onIdle: () => void startTour(),
        onActive: stopTour,
      });
      world.start();
    } else {
      document.documentElement.classList.add('no-webgl');
      byId('data-view').prepend(h('p', { class: 'notice', role: 'status' }, COPY.noWebgl));
      controls = mountControls(null, () => setRace(!race.open));
      // Without WebGL there is no rendered view: the card draws its night backdrop instead.
      controls.feedSlot.after(shareSlot);
      mountShareButton(shareSlot, {
        capture: async () => ({
          frame: document.createElement('canvas'),
          ...shareText(null),
          url: siteUrl(),
        }),
      });
      const feed = mountFeed(controls.feedSlot, {
        events: data.events,
        clock: tm,
        platformName,
        accent,
        onSelect: () => byId('data-view').focus(),
      });
      setInterval(() => {
        hud.update();
        timeline.update();
        race.update();
        feed.update();
      }, 250);
    }
    setState('ready');
  } catch (e) {
    setState('error');
    console.error(e instanceof DataUnavailableError ? `Data unavailable: ${e.message}` : e);
    byId('loader-status').textContent = COPY.loading.failed;
    const retry = h('button', { class: 'button', type: 'button' }, COPY.loading.retry);
    retry.addEventListener('click', () => location.reload());
    byId('loader').append(retry);
  }
}

void boot();
