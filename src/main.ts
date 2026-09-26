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
import { COPY } from './copy';
import { DataUnavailableError, loadData } from './data/load';
import { buildCity } from './state/city';
import { liveClock } from './state/clock';
import { createTimeMachine } from './state/timemachine';
import { renderDataTable } from './ui/data-table';
import { byId, h } from './ui/dom';
import { mountHud } from './ui/hud';
import { mountFeed, mountToasts } from './ui/feed';
import { createPanel } from './ui/panel';
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

/**
 * The control row: scale toggle (log ↔ true scale, a segmented control with aria-pressed
 * buttons), the race toggle, and a slot for the "What's new" feed.
 */
function mountControls(
  onScale: ((mode: ScaleMode) => void) | null,
  onRace: () => void,
): { raceButton: HTMLButtonElement; feedSlot: HTMLElement } {
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
  const feedSlot = h('div', { class: 'feed-slot' });
  byId('controls').replaceChildren(...(onScale ? [group] : []), raceButton, feedSlot);
  return { raceButton, feedSlot };
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

    if (hasWebGL()) {
      const { createWorld } = await import('./world/world');
      const panelEl = byId('panel');
      // Recentre the scene in the screen area the panel leaves free.
      const updateInsets = () => {
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
      const world = createWorld(byId<HTMLCanvasElement>('scene'), city, tm, {
        reducedMotion,
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
        },
        onSelect: (id) => {
          // Toggle the class first, so controls hidden under the panel are visible again before
          // the panel hands focus back to them.
          document.documentElement.classList.toggle('panel-open', id !== null);
          if (id) panel.show(id);
          else panel.hide();
          if (id && mobile.matches && race.open) setRace(false);
          updateInsets();
        },
        onModel: (id) => {
          if (panel.view === 'lab') panel.selectModel(id);
        },
        onViewChange: (view) => panel.showView(view),
      });
      new ResizeObserver(updateInsets).observe(panelEl);
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
      };
      controls = mountControls(
        (mode) => world.setScale(mode),
        () => setRace(!race.open),
      );
      const feed = mountFeed(controls.feedSlot, {
        events: data.events,
        clock: tm,
        platformName,
        accent,
        onSelect: (id) => openHq(id),
      });
      world.start();
    } else {
      document.documentElement.classList.add('no-webgl');
      byId('data-view').prepend(h('p', { class: 'notice', role: 'status' }, COPY.noWebgl));
      controls = mountControls(null, () => setRace(!race.open));
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
