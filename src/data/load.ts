/**
 * Load the published dataset: fetch → validate with the same schemas the build
 * uses → cache the last good copy. If the network or validation fails, fall
 * back to the cached copy and say so; never render unvalidated data.
 */
import { z } from 'zod';
import {
  EventSchema,
  IncidentSchema,
  MetaSchema,
  type Incident,
  type Meta,
  type TimelineEvent,
} from './schema';
import { validateDataset, type Dataset } from './validate';

const FILES = ['platforms', 'metrics', 'models', 'events', 'incidents', 'meta'] as const;
type FileName = (typeof FILES)[number];
type RawBundle = Record<FileName, unknown>;

const CACHE_KEY = 'token-metropolis:data:v1';
const TIMEOUT_MS = 12_000;

export interface LoadedData {
  readonly dataset: Dataset;
  readonly events: TimelineEvent[];
  readonly incidents: Incident[];
  readonly meta: Meta;
  /** Where the data came from; "cache" means the network copy failed and an older copy is shown. */
  readonly origin: 'network' | 'cache';
  readonly problem?: string;
}

export class DataUnavailableError extends Error {
  override readonly name = 'DataUnavailableError';
}

function parseBundle(raw: RawBundle): Omit<LoadedData, 'origin' | 'problem'> {
  const result = validateDataset(
    { platforms: raw.platforms, metrics: raw.metrics, models: raw.models },
    { expectedPlatforms: 15 },
  );
  if (!result.ok) throw new Error(`invalid dataset: ${result.errors.slice(0, 3).join('; ')}`);
  return {
    dataset: result.data,
    events: z.array(EventSchema).parse(raw.events),
    incidents: z.array(IncidentSchema).parse(raw.incidents),
    meta: MetaSchema.parse(raw.meta),
  };
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function fetchBundle(base: string): Promise<RawBundle> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const entries = await Promise.all(
      FILES.map(
        async (f) => [f, await fetchJson(`${base}data/${f}.json`, controller.signal)] as const,
      ),
    );
    return Object.fromEntries(entries) as RawBundle;
  } finally {
    clearTimeout(timer);
  }
}

function readCache(): RawBundle | null {
  try {
    const s = localStorage.getItem(CACHE_KEY);
    return s ? (JSON.parse(s) as RawBundle) : null;
  } catch {
    return null;
  }
}

function writeCache(raw: RawBundle): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(raw));
  } catch {
    // storage full, disabled or private mode — the site works without it
  }
}

export async function loadData(base: string): Promise<LoadedData> {
  let problem: string;
  try {
    const raw = await fetchBundle(base);
    const parsed = parseBundle(raw);
    writeCache(raw);
    return { ...parsed, origin: 'network' };
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
  }
  const cached = readCache();
  if (cached) {
    try {
      return { ...parseBundle(cached), origin: 'cache', problem };
    } catch {
      // fall through: the cached copy is from an incompatible version
    }
  }
  throw new DataUnavailableError(problem);
}
