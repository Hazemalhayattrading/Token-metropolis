/**
 * Boot: load and validate data → build the model → mount the HUD and data view
 * → start the 3D world, or the 2D dashboard when WebGL is unavailable.
 */
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import './styles/main.css';
import { COPY } from './copy';
import { DataUnavailableError, loadData } from './data/load';
import { buildCity } from './state/city';
import { liveClock } from './state/clock';
import { renderDataTable } from './ui/data-table';
import { byId, h } from './ui/dom';
import { mountHud } from './ui/hud';
import { createPanel } from './ui/panel';
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

/** Scale toggle (log ↔ true scale): a segmented control with aria-pressed buttons. */
function mountControls(onScale: (mode: ScaleMode) => void): void {
  const make = (mode: ScaleMode, label: string) => {
    const b = h(
      'button',
      { class: 'segmented__option', type: 'button', 'aria-pressed': String(mode === 'log') },
      label,
    );
    b.addEventListener('click', () => {
      for (const el of group.querySelectorAll('button'))
        el.setAttribute('aria-pressed', String(el === b));
      onScale(mode);
    });
    return b;
  };
  const group = h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': COPY.controls.scale },
    make('log', COPY.controls.log),
    make('true', COPY.controls.true),
  );
  byId('controls').replaceChildren(group);
}

async function boot(): Promise<void> {
  setState('loading');
  applyStaticCopy();
  try {
    const data = await loadData(import.meta.env.BASE_URL);
    const city = buildCity(data.dataset);
    const arrivedAt = liveClock.now();
    const hud = mountHud(city, data, liveClock, arrivedAt);
    renderDataTable(byId('data-table'), city, liveClock.now());

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (hasWebGL()) {
      const { createWorld } = await import('./world/world');
      const panel = createPanel(city, liveClock, () => world.select(null));
      const world = createWorld(byId<HTMLCanvasElement>('scene'), city, liveClock, {
        reducedMotion,
        labels: byId('labels'),
        onFrame: () => {
          hud.update();
          panel.update();
        },
        onSelect: (id) => {
          if (id) panel.show(id);
          else panel.hide();
          document.documentElement.classList.toggle('panel-open', id !== null);
          const el = byId('panel');
          const stage = byId('scene').getBoundingClientRect();
          const r = el.getBoundingClientRect();
          const mobile = window.matchMedia('(max-width: 720px)').matches;
          world.setInsets(
            id === null
              ? { left: 0, bottom: 0 }
              : mobile
                ? { left: 0, bottom: stage.bottom - r.top }
                : { left: r.right - stage.left, bottom: 0 },
          );
        },
      });
      mountControls((mode) => world.setScale(mode));
      world.start();
    } else {
      document.documentElement.classList.add('no-webgl');
      byId('data-view').prepend(h('p', { class: 'notice', role: 'status' }, COPY.noWebgl));
      setInterval(hud.update, 250);
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
