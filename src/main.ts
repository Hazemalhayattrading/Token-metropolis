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
      const world = createWorld(byId<HTMLCanvasElement>('scene'), city, liveClock, {
        reducedMotion,
        onFrame: hud.update,
      });
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
