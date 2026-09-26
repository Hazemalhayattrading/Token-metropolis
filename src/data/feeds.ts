/**
 * The daily pipeline's normalizers (brief §4): public, key-free feeds → the site's schemas.
 * Pure functions (no network, no file system), so every rule is unit-tested; the fetching and
 * writing live in scripts/pipeline.ts.
 *
 * - Status pages: the Statuspage-compatible `summary.json` that statuspage.io and incident.io
 *   pages publish → IncidentSchema. Only what the page itself reports as unresolved is kept:
 *   open incidents and maintenance under way. Nothing is inferred from RSS wording.
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
  shortlink: z.string().nullish(),
  components: z.array(z.object({ name: z.string() }).loose()).nullish(),
});

/** The part of a Statuspage-compatible summary.json the pipeline reads. */
export const StatusSummarySchema = z.object({
  incidents: z.array(z.unknown()),
  scheduled_maintenances: z.array(z.unknown()).default([]),
});

const OPEN_INCIDENT: ReadonlySet<string> = new Set(['investigating', 'identified', 'monitoring']);
const MAINTENANCE_UNDER_WAY: ReadonlySet<string> = new Set(['in_progress', 'verifying']);
const INCIDENT_IMPACTS: ReadonlySet<string> = new Set(['none', 'minor', 'major', 'critical']);

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

/** The `status` of a raw entry, lower-cased, if it has one. */
function rawStatus(raw: unknown): string | null {
  const s = (raw as { status?: unknown } | null)?.status;
  return typeof s === 'string' ? s.toLowerCase() : null;
}

export interface StatusOptions {
  /** When the page was read (ISO time), stored on every notice. */
  readonly checked: string;
  /** Keep only notices naming one of these components (a page shared with other services). */
  readonly components?: readonly string[];
}

export interface StatusResult {
  incidents: Incident[];
  /** Open entries the page lists that could not be read (skipped, never guessed). */
  skipped: number;
  /** Open entries about other components of a shared page. */
  otherComponents: number;
}

/**
 * Unresolved incidents and maintenance under way from one status page's summary.json.
 * Throws if the document is not a status summary at all, or if the page lists open entries and
 * none of them can be read (the caller then keeps the previous data rather than publish "no
 * notices" for a page whose format changed).
 */
export function normalizeStatusSummary(
  platform: string,
  pageUrl: string,
  json: unknown,
  o: StatusOptions,
): StatusResult {
  const summary = StatusSummarySchema.parse(json);
  const wanted = o.components?.map((c) => c.toLowerCase());
  const incidents: Incident[] = [];
  let skipped = 0;
  let otherComponents = 0;
  const add = (raw: unknown, maintenance: boolean) => {
    const status = rawStatus(raw);
    // Resolved, post-mortem, scheduled or completed entries are not open: ignored, not skipped.
    if (status !== null && !(maintenance ? MAINTENANCE_UNDER_WAY : OPEN_INCIDENT).has(status))
      return;
    const parsed = StatusEntry.safeParse(raw);
    if (!parsed.success || status === null) {
      skipped++;
      return;
    }
    const e = parsed.data;
    if (wanted) {
      const names = (e.components ?? []).map((c) => c.name.toLowerCase());
      if (!names.some((n) => wanted.includes(n))) {
        otherComponents++;
        return;
      }
    }
    let impact: Incident['impact'];
    if (maintenance) {
      // Maintenance the page itself marks as having no impact is not a notice.
      if (e.impact === 'none') return;
      impact = 'maintenance';
    } else {
      // An unknown impact claims nothing (the site does not show "none").
      impact = INCIDENT_IMPACTS.has(String(e.impact)) ? (e.impact as Incident['impact']) : 'none';
    }
    // The actual start when the page has it (maintenance can start early), else the plan.
    const started = maintenance
      ? (e.started_at ?? e.scheduled_for ?? e.created_at)
      : (e.started_at ?? e.created_at);
    const incident = {
      id: `${platform}-${maintenance ? 'maint-' : ''}${idPart(e.id)}`,
      platform,
      impact,
      title: e.name.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX),
      started: started ?? '',
      resolved: null,
      url: httpsOrNull(e.shortlink) ?? pageUrl,
      status: maintenance ? ('maintenance' as const) : (status as Incident['status']),
      checked: o.checked,
    };
    const valid = IncidentSchema.safeParse(incident);
    if (valid.success) incidents.push(valid.data);
    else skipped++;
  };
  for (const raw of summary.incidents) add(raw, false);
  for (const raw of summary.scheduled_maintenances) add(raw, true);
  if (skipped > 0 && incidents.length === 0)
    throw new Error(`${skipped} open entr${skipped === 1 ? 'y' : 'ies'} could not be read`);
  return { incidents, skipped, otherComponents };
}

/**
 * The incidents to publish: fresh results for every page that answered, and the previous
 * entries of pages that could not be read (the brief: keep the previous data, never publish a
 * guess). Kept entries keep their old `checked` time, so the site stops showing them once they
 * are no longer recent.
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

/**
 * Authors that also publish models outside the HQ's family: Google's open Gemma models are not
 * Gemini; OpenAI's and ByteDance Seed's open-weights releases are not part of ChatGPT or the
 * Doubao family.
 */
const FAMILY: Readonly<Record<string, (slug: string) => boolean>> = {
  google: (s) => /gemini/i.test(s),
  openai: (s) => !/oss/i.test(s),
  'bytedance-seed': (s) => /doubao|seed-\d/i.test(s) && !/oss/i.test(s),
};

const OpenRouterModel = z.object({
  id: z.string().regex(/^[a-z0-9._-]+\/[a-z0-9._:-]+$/i),
  name: z.string().min(1),
  created: z.number().int().positive(),
});
export const OpenRouterListSchema = z.object({ data: z.array(z.unknown()) });

/**
 * A model name as comparable tokens: lower-case words and whole version numbers ("GPT-5.1 Mini"
 * → gpt · 5.1 · mini), without the author prefix ("OpenAI: ") or parenthesised notes.
 */
export function nameTokens(name: string): string[] {
  return (
    name
      .replace(/^[^:]{1,40}:\s*/, '')
      .replace(/\([^)]*\)/g, ' ')
      .toLowerCase()
      .match(/[a-z]+|\d+(?:\.\d+)*/g) ?? []
  );
}

/**
 * The names a curated model stands for: its own, plus one per parenthesised alternative
 * ("GPT-6 (Sol, Luna)" → GPT-6, GPT-6 Sol, GPT-6 Luna).
 */
function curatedNames(name: string): string[][] {
  const base = nameTokens(name);
  const names = [base];
  for (const group of name.match(/\(([^)]*)\)/g) ?? []) {
    for (const alt of group.slice(1, -1).split(/,|\band\b|\//)) {
      const extra = nameTokens(alt);
      if (extra.length > 0) names.push([...base, ...extra]);
    }
  }
  return names;
}

const sameTokens = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((t, i) => t === b[i]);

const daysOfIso = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
const isoOfDays = (days: number) => new Date(days * 86_400_000).toISOString().slice(0, 10);

/**
 * The curated model this sighting is, if any: same HQ, the same name (word for word, versions
 * whole — Opus 5 is not Opus 5.1), dates within 120 days.
 */
export function curatedMatch(
  platform: string,
  name: string,
  day: number,
  models: readonly Pick<Model, 'platform' | 'name' | 'released'>[],
): Pick<Model, 'platform' | 'name' | 'released'> | undefined {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return undefined;
  return models.find(
    (c) =>
      c.platform === platform &&
      Math.abs(daysOfIso(c.released) - day) <= 120 &&
      curatedNames(c.name).some((n) => sameTokens(n, tokens)),
  );
}

/**
 * A "first seen" event recorded by the pipeline, with the model's name (data/auto/sightings.json).
 * The site gets the event only; the name lets the data build drop a sighting once the curated
 * list has the model.
 */
export const SightingSchema = EventSchema.extend({ model: z.string().min(1) });
export type Sighting = z.infer<typeof SightingSchema>;

export interface SeenOptions {
  /** Days since the epoch: "now". */
  readonly today: number;
  /** Only models that OpenRouter first listed in the last `windowDays` days become events. */
  readonly windowDays: number;
  readonly platforms: readonly Pick<Platform, 'id'>[];
  /** The curated models: a model already listed there needs no "first seen" event. */
  readonly models: readonly Pick<Model, 'platform' | 'name' | 'released'>[];
  /** Ids already recorded by earlier runs, or hidden by the owner: never added (again). */
  readonly known: ReadonlySet<string>;
}

export interface SeenResult {
  events: Sighting[];
  /** Entries that could not be read. */
  skipped: number;
  /** Entries in the list (to judge whether `skipped` is a format change). */
  total: number;
  /** New models left out because the curated list already has them. */
  curated: { model: string; match: string }[];
}

/**
 * New "first seen on OpenRouter" events: models of the HQs' own families that OpenRouter first
 * listed within the window, that the curated list does not already have, and that no earlier
 * run recorded. A model's variants (`:free`, `:thinking`, …) are one model, first listed when its
 * earliest variant was.
 */
export function newModelSightings(json: unknown, o: SeenOptions): SeenResult {
  const list = OpenRouterListSchema.parse(json);
  const platformIds = new Set(o.platforms.map((p) => p.id));
  let skipped = 0;
  // Group variants under their base id: the earliest listing dates the model; the base entry's
  // own name (no variant suffix) names it.
  const groups = new Map<string, { created: number; name: string; exact: boolean }>();
  for (const raw of list.data) {
    const parsed = OpenRouterModel.safeParse(raw);
    if (!parsed.success) {
      skipped++;
      continue;
    }
    const m = parsed.data;
    const [base, variant] = m.id.split(':') as [string, string | undefined];
    const g = groups.get(base);
    const exact = variant === undefined;
    if (!g) groups.set(base, { created: m.created, name: m.name, exact });
    else {
      g.created = Math.min(g.created, m.created);
      if (exact && !g.exact) Object.assign(g, { name: m.name, exact });
    }
  }
  const events: Sighting[] = [];
  const curated: SeenResult['curated'] = [];
  for (const [base, g] of groups) {
    const [author, slugPart] = base.split('/') as [string, string];
    const platform = OPENROUTER_AUTHORS[author];
    if (!platform || !platformIds.has(platform)) continue;
    const inFamily = FAMILY[author];
    if (inFamily && !inFamily(slugPart)) continue;
    const created = g.created / 86_400;
    if (!(created <= o.today + 1 && created >= o.today - o.windowDays)) continue;
    const id = `seen-${idPart(base)}`;
    if (o.known.has(id)) continue;
    // "OpenAI: GPT-5 Mini (free)" → "GPT-5 Mini".
    const name =
      g.name
        .replace(/^[^:]{1,40}:\s*/, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim() || slugPart;
    const match = curatedMatch(platform, name, created, o.models);
    if (match) {
      curated.push({ model: name, match: match.name });
      continue;
    }
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
      model: name,
    };
    const valid = SightingSchema.safeParse(event);
    if (valid.success) events.push(valid.data);
    else skipped++;
  }
  events.sort(byDateDesc);
  return { events, skipped, total: list.data.length, curated };
}

/** Newest first, then by id (a stable, total order). */
export function byDateDesc(a: TimelineEvent, b: TimelineEvent): number {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id);
}
