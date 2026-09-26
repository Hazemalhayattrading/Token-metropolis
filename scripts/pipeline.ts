/**
 * The daily pipeline's core (brief §4), separate from its command line (update-data.ts) so it
 * runs in tests with a fake network and temporary files.
 *
 * 1. Status pages: each HQ's Statuspage-compatible summary.json → incidents.json (open incidents
 *    and maintenance under way, as the page itself reports them).
 * 2. OpenRouter's public models list → sightings.json ("first seen" events for the HQs' own
 *    model families; the data build turns them into timeline events).
 *
 * A source that cannot be reached or does not validate is reported and its previous data is
 * kept: nothing broken or empty is ever written. Files are written only when their content
 * changes.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  byDateDesc,
  mergeIncidents,
  newModelSightings,
  normalizeStatusSummary,
  SightingSchema,
  type Sighting,
} from '../src/data/feeds';
import { IncidentSchema, type Incident, type Model, type Platform } from '../src/data/schema';
import { readJson, stableJson, writeAtomic } from './lib';

export const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';
/** Models added to OpenRouter in the last 45 days can become "first seen" events. */
export const SIGHTING_WINDOW_DAYS = 45;

export type Level = 'info' | 'warn' | 'error';

export interface UpdateEnv {
  fetchJson(url: string): Promise<unknown>;
  /** Now, in milliseconds since the epoch. */
  readonly nowMs: number;
  readonly incidentsFile: string;
  readonly sightingsFile: string;
  readonly dryRun: boolean;
  note(level: Level, message: string): void;
}

export interface UpdateResult {
  readonly incidentsChanged: boolean;
  readonly sightingsChanged: boolean;
  /** Platforms whose status page could not be read (their previous notices were kept). */
  readonly failed: readonly string[];
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Write `value` to `file` only if its JSON differs from what is there. True if it differs. */
function writeIfChanged(file: string, value: unknown, dryRun: boolean): boolean {
  const next = stableJson(value);
  let current = '';
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    // missing file: write it
  }
  if (current === next) return false;
  if (!dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeAtomic(file, next);
  }
  return true;
}

/** Share of unreadable entries above which the model list counts as changed format (unusable). */
const MAX_SKIPPED_SHARE = 0.2;

export async function runUpdate(
  data: {
    readonly platforms: readonly Platform[];
    readonly models: readonly Model[];
    /** Sighting ids the owner hid (data/manual/hidden-sightings.yaml). */
    readonly hidden: ReadonlySet<string>;
  },
  env: UpdateEnv,
): Promise<UpdateResult> {
  const checked = new Date(env.nowMs).toISOString();

  // --- 1. status pages → incidents.json ------------------------------------------------------
  const previousFile = readJson(env.incidentsFile, []);
  const previousParsed = previousFile.ok
    ? z.array(IncidentSchema).safeParse(previousFile.value)
    : null;
  if (!previousParsed?.success)
    env.note(
      'warn',
      'The published incidents.json did not validate; it is rebuilt from the feeds.',
    );
  const previous: Incident[] = previousParsed?.success ? previousParsed.data : [];
  const fresh = new Map<string, Incident[]>();
  const failed = new Set<string>();
  await Promise.all(
    data.platforms.map(async (p) => {
      const page = p.statusPage;
      if (!page || page.provider === 'none') return;
      if (!page.json) {
        env.note('info', `${p.name}: no JSON status feed (${page.url}); RSS is not read.`);
        return;
      }
      try {
        const r = normalizeStatusSummary(p.id, page.url, await env.fetchJson(page.json), {
          checked,
          components: page.components,
        });
        fresh.set(p.id, r.incidents);
        const other = r.otherComponents
          ? `; ${plural(r.otherComponents, 'notice', 'notices')} about other services left out`
          : '';
        env.note(
          'info',
          `${p.name}: ${plural(r.incidents.length, 'open notice', 'open notices')}${other}.`,
        );
        if (r.skipped)
          env.note(
            'warn',
            `${p.name}: ${plural(r.skipped, 'open entry', 'open entries')} on the status page could not be read and ${r.skipped === 1 ? 'was' : 'were'} skipped.`,
          );
      } catch (e) {
        failed.add(p.id);
        env.note(
          'warn',
          `${p.name}: status page unavailable (${reason(e)}); previous notices kept.`,
        );
      }
    }),
  );
  const incidents = z.array(IncidentSchema).parse(mergeIncidents(previous, fresh, failed));
  const incidentsChanged = writeIfChanged(env.incidentsFile, incidents, env.dryRun);

  // --- 2. OpenRouter → sightings.json ---------------------------------------------------------
  let sightingsChanged = false;
  const knownFile = readJson(env.sightingsFile, []);
  const known = knownFile.ok ? z.array(SightingSchema).safeParse(knownFile.value) : null;
  if (!known?.success) {
    env.note(
      'error',
      `data/auto/sightings.json ${knownFile.ok ? 'does not validate' : knownFile.error}; left unchanged. It is written by this pipeline only: restore it from git history (or reset it to []).`,
    );
  } else {
    try {
      const r = newModelSightings(await env.fetchJson(OPENROUTER_MODELS), {
        today: Math.floor(env.nowMs / 86_400_000),
        windowDays: SIGHTING_WINDOW_DAYS,
        platforms: data.platforms,
        models: data.models,
        known: new Set([...known.data.map((k) => k.id), ...data.hidden]),
      });
      if (r.total > 0 && r.skipped / r.total > MAX_SKIPPED_SHARE)
        throw new Error(`${r.skipped} of ${r.total} entries could not be read (format change?)`);
      const next: Sighting[] = [...known.data, ...r.events].sort(byDateDesc);
      sightingsChanged = writeIfChanged(
        env.sightingsFile,
        z.array(SightingSchema).parse(next),
        env.dryRun,
      );
      const names = r.events.length ? ` (${r.events.map((e) => e.model).join(', ')})` : '';
      env.note(
        'info',
        `OpenRouter: ${plural(r.events.length, 'new model sighting', 'new model sightings')}${names}.`,
      );
      if (r.curated.length)
        env.note(
          'info',
          `OpenRouter: already curated, not added: ${r.curated.map((c) => `${c.model} (= ${c.match})`).join(', ')}.`,
        );
      if (r.skipped)
        env.note(
          'warn',
          `OpenRouter: ${plural(r.skipped, 'entry', 'entries')} could not be read and ${r.skipped === 1 ? 'was' : 'were'} skipped.`,
        );
    } catch (e) {
      env.note(
        'warn',
        `OpenRouter models list unavailable (${reason(e)}); previous sightings kept.`,
      );
    }
  }
  return { incidentsChanged, sightingsChanged, failed: [...failed].sort() };
}
