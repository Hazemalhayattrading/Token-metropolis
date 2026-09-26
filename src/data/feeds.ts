/**
 * The daily pipeline's normalizers (brief §4): public, key-free feeds → the site's schemas.
 * Pure functions (no network, no file system), so every rule is unit-tested; the fetching and
 * writing live in scripts/update-data.ts.
 *
 * - Status pages: the Statuspage-compatible `summary.json` that statuspage.io and incident.io
 *   pages publish → IncidentSchema. Only what the page itself reports as unresolved is kept:
 *   open incidents and maintenance in progress. Nothing is inferred from RSS wording.
 * - OpenRouter's public models list → "first seen" timeline events for the HQs' own model
 *   families. A first sighting is not a launch date, so these events are never celebrated.
 */
import { z } from 'zod';
import {
  EventSchema,
  IncidentSchema,
  type Incident,
  type Model,
  type Platform,
  type TimelineEvent,
} from './schema';

// ---------------------------------------------------------------------------
// Status pages
// ---------------------------------------------------------------------------

/** One entry of a summary.json `incidents` or `scheduled_maintenances` list (lenient). */
const StatusEntry = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  status: z.string(),
  impact: z.string().nullish(),
  created_at: z.string().nullish(),
  started_at: z.string().nullish(),
  scheduled_for: z.string().nullish(),
  resolved_at: z.string().nullish(),
  shortlink: z.string().nullish(),
});

/** The part of a Statuspage-compatible summary.json the pipeline reads. */
export const StatusSummarySchema = z.object({
  incidents: z.array(z.unknown()),
  scheduled_maintenances: z.array(z.unknown()).default([]),
});

const OPEN_INCIDENT = new Set(['investigating', 'identified', 'monitoring', 'update']);
const MAINTENANCE_UNDER_WAY = new Set(['in_progress', 'verifying']);
const IMPACTS: ReadonlySet<string> = new Set(['none', 'minor', 'major', 'critical', 'maintenance']);

const TITLE_MAX = 200;

/** A status-page id or name made safe for our ids. */
function idPart(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'x'
  );
}

function httpsOrNull(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export interface StatusResult {
  incidents: Incident[];
  /** Entries the page lists that could not be read (skipped, never guessed). */
  skipped: number;
}

/**
 * Unresolved incidents and maintenance under way from one status page's summary.json.
 * Throws if the document is not a status summary at all (the caller keeps the previous data).
 */
export function normalizeStatusSummary(
  platform: string,
  pageUrl: string,
  json: unknown,
): StatusResult {
  const summary = StatusSummarySchema.parse(json);
  const incidents: Incident[] = [];
  let skipped = 0;
  const add = (raw: unknown, maintenance: boolean) => {
    const parsed = StatusEntry.safeParse(raw);
    if (!parsed.success) {
      skipped++;
      return;
    }
    const e = parsed.data;
    const status = e.status.toLowerCase();
    if (!(maintenance ? MAINTENANCE_UNDER_WAY : OPEN_INCIDENT).has(status)) return;
    const impact = maintenance
      ? 'maintenance'
      : IMPACTS.has(String(e.impact)) && e.impact !== 'maintenance'
        ? (e.impact as Incident['impact'])
        : 'none'; // an unknown impact claims nothing (the site shows "none" as no incident)
    const started = maintenance
      ? (e.scheduled_for ?? e.started_at ?? e.created_at)
      : (e.started_at ?? e.created_at);
    const incident = {
      id: `${platform}-${maintenance ? 'maint-' : ''}${idPart(e.id)}`,
      platform,
      impact,
      title: e.name.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX),
      started: started ?? '',
      resolved: null,
      url: httpsOrNull(e.shortlink) ?? pageUrl,
    };
    const valid = IncidentSchema.safeParse(incident);
    if (valid.success) incidents.push(valid.data);
    else skipped++;
  };
  for (const raw of summary.incidents) add(raw, false);
  for (const raw of summary.scheduled_maintenances) add(raw, true);
  return { incidents, skipped };
}

/**
 * The incidents to publish: fresh results for every page that answered, and the previous
 * entries of pages that could not be read (the brief: keep the previous data, never publish a
 * guess). The site ignores an open incident older than three days, so a page that stays
 * unreachable cannot leave a notice up for long.
 */
export function mergeIncidents(
  previous: readonly Incident[],
  fresh: ReadonlyMap<string, readonly Incident[]>,
  failed: ReadonlySet<string>,
): Incident[] {
  const kept = previous.filter((i) => failed.has(i.platform) && !fresh.has(i.platform));
  const all = [...kept, ...[...fresh.values()].flat()];
  const byId = new Map(all.map((i) => [i.id, i]));
  return [...byId.values()].sort(
    (a, b) => a.platform.localeCompare(b.platform) || a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------
// OpenRouter models → "first seen" events
// ---------------------------------------------------------------------------

/**
 * OpenRouter author prefix → the HQ whose own model family it is. Only unambiguous pairs:
 * models from companies without an HQ here, and other companies' models offered inside an HQ
 * (e.g. OpenAI models in GitHub Copilot), are not guessed.
 */
export const OPENROUTER_AUTHORS: Readonly<Record<string, string>> = {
  openai: 'chatgpt',
  anthropic: 'claude',
  google: 'gemini',
  'meta-llama': 'meta-ai',
  'x-ai': 'grok',
  deepseek: 'deepseek',
  qwen: 'qwen',
  moonshotai: 'kimi',
  perplexity: 'perplexity',
  'bytedance-seed': 'doubao',
  tencent: 'yuanbao',
};

/** Google publishes open Gemma models too; only Gemini models belong to the Gemini HQ. */
const FAMILY_FILTER: Readonly<Record<string, RegExp>> = { google: /gemini/i };

const OpenRouterModel = z.object({
  id: z.string().regex(/^[a-z0-9._-]+\/[a-z0-9._:-]+$/i),
  name: z.string().min(1),
  created: z.number().int().positive(),
});
export const OpenRouterListSchema = z.object({ data: z.array(z.unknown()) });

/** Lower-case letters and digits only, for comparing model names across sources. */
export function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * A "first seen" event recorded by the pipeline, with the model's name (data/auto/sightings.json).
 * The site gets the event only; the name lets the data build drop a sighting once the curated
 * list has the model.
 */
export const SightingSchema = EventSchema.extend({ model: z.string().min(1) });
export type Sighting = z.infer<typeof SightingSchema>;

/**
 * Whether the curated list already has this model: same HQ, one name containing the other
 * (letters and digits only), dates within 120 days.
 */
export function isCurated(
  platform: string,
  name: string,
  day: number,
  models: readonly Pick<Model, 'platform' | 'name' | 'released'>[],
): boolean {
  const key = nameKey(name);
  if (!key) return false;
  return models.some((c) => {
    if (c.platform !== platform) return false;
    const k = nameKey(c.name);
    if (!k || !(key.includes(k) || k.includes(key))) return false;
    return Math.abs(daysOfIso(c.released) - day) <= 120;
  });
}

export interface SeenOptions {
  /** Days since the epoch: "now". */
  readonly today: number;
  /** Only models added to OpenRouter in the last `windowDays` days become events. */
  readonly windowDays: number;
  readonly platforms: readonly Pick<Platform, 'id'>[];
  /** The curated models: a model already listed there needs no "first seen" event. */
  readonly models: readonly Pick<Model, 'platform' | 'name' | 'released'>[];
  /** Sightings already recorded by earlier runs (kept; never duplicated). */
  readonly known: readonly Pick<TimelineEvent, 'id'>[];
}

export interface SeenResult {
  events: Sighting[];
  /** Entries that could not be read. */
  skipped: number;
}

const isoOfDays = (days: number) => new Date(days * 86_400_000).toISOString().slice(0, 10);
const daysOfIso = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/**
 * New "first seen on OpenRouter" events: models from the HQs' own families that OpenRouter added
 * within the window, that the curated list does not already have (same HQ, one name containing
 * the other, dates within 120 days), and that no earlier run recorded. Variants of one model
 * (`:free`, `:thinking`, …) count once.
 */
export function newModelSightings(json: unknown, o: SeenOptions): SeenResult {
  const list = OpenRouterListSchema.parse(json);
  const platformIds = new Set(o.platforms.map((p) => p.id));
  const knownIds = new Set(o.known.map((e) => e.id));
  const events: Sighting[] = [];
  let skipped = 0;
  for (const raw of list.data) {
    const parsed = OpenRouterModel.safeParse(raw);
    if (!parsed.success) {
      skipped++;
      continue;
    }
    const m = parsed.data;
    const base = m.id.split(':')[0]!;
    const [author, slugPart] = base.split('/') as [string, string];
    const platform = OPENROUTER_AUTHORS[author];
    if (!platform || !platformIds.has(platform)) continue;
    const family = FAMILY_FILTER[author];
    if (family && !family.test(base)) continue;
    const created = m.created / 86_400;
    if (!(created <= o.today + 1 && created >= o.today - o.windowDays)) continue;
    const id = `seen-${idPart(base)}`;
    if (knownIds.has(id)) continue;
    // "OpenAI: GPT-5 Mini" → "GPT-5 Mini"; drop a variant suffix such as " (free)".
    const name = m.name
      .replace(/^[^:]{1,40}:\s*/, '')
      .replace(/\s*\((free|beta|thinking|extended)\)\s*$/i, '')
      .trim();
    if (isCurated(platform, name || slugPart, created, o.models)) continue;
    const event = {
      id,
      date: isoOfDays(Math.floor(created)),
      platform,
      kind: 'model-launch' as const,
      title: `${name} first seen on OpenRouter`,
      datePrecision: 'day' as const,
      dateKind: 'first-seen' as const,
      source: {
        title: `${name} — OpenRouter model page`,
        publisher: 'OpenRouter',
        url: `https://openrouter.ai/${base}`,
      },
      model: name || slugPart,
    };
    const valid = SightingSchema.safeParse(event);
    if (valid.success) {
      events.push(valid.data);
      knownIds.add(id);
    } else skipped++;
  }
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));
  return { events, skipped };
}
