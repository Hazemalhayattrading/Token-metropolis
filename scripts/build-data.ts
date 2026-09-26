/**
 * Compile data/manual/*.yaml (curated) and data/auto/*.json (written by the daily pipeline,
 * scripts/update-data.ts) → public/data/*.json.
 *
 * Refuses to publish anything invalid: if validation fails, public/data is
 * left untouched and the process exits non-zero. `meta.json.lastUpdated`
 * only changes when the published content changes, so the daily workflow
 * can commit only real updates.
 *
 * Usage: tsx scripts/build-data.ts [--check]   (--check validates without writing)
 */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { isCurated, SightingSchema, type Sighting } from '../src/data/feeds';
import { IncidentSchema, type TimelineEvent } from '../src/data/schema';
import { validateDataset, type Dataset } from '../src/data/validate';
import { CONSTANT_INDEX } from '../src/model/constants';
import { AUTO, OUT, readJson, readYaml, stableJson, writeAtomic } from './lib';

const checkOnly = process.argv.includes('--check');

const byDateDesc = (a: TimelineEvent, b: TimelineEvent) =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id);

/**
 * Timeline events: one per curated model, plus the pipeline's "first seen" sightings that the
 * curated list does not (yet) have.
 */
function buildEvents(data: Dataset, sightings: readonly Sighting[]): TimelineEvent[] {
  const names = new Map(data.platforms.map((p) => [p.id, p.name]));
  const curated: TimelineEvent[] = data.models.map((m) => ({
    id: `launch-${m.id}`,
    date: m.released,
    platform: m.platform,
    kind: m.origin === 'own' ? ('model-launch' as const) : ('model-available' as const),
    title:
      m.origin !== 'own'
        ? `${m.name} available in ${names.get(m.platform)}`
        : m.dateKind === 'first-seen'
          ? `${m.name} first seen`
          : `${m.name} released`,
    datePrecision: m.datePrecision,
    dateKind: m.dateKind,
    source: m.source,
  }));
  const seen: TimelineEvent[] = sightings
    .filter((s) => names.has(s.platform))
    .filter(
      (s) =>
        !isCurated(
          s.platform,
          s.model,
          Date.parse(`${s.date}T00:00:00Z`) / 86_400_000,
          data.models,
        ),
    )
    .map(({ model: _model, ...event }) => event);
  const ids = new Set(curated.map((e) => e.id));
  return [...curated, ...seen.filter((e) => !ids.has(e.id))].sort(byDateDesc);
}

/** A pipeline-owned file, validated; exits (publishing nothing) if it is invalid. */
function readAuto<T>(file: string, schema: z.ZodType<T>, label: string): T {
  const parsed = schema.safeParse(readJson(file, []));
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues.slice(0, 10))
    console.error(`error ${label}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  console.error(`\n✗ ${label} does not validate. public/data left unchanged.`);
  process.exit(1);
}

function main(): void {
  const raw = {
    platforms: readYaml('platforms.yaml'),
    metrics: readYaml('metrics.yaml'),
    models: readYaml('models.yaml'),
  };
  const result = validateDataset(raw, { expectedPlatforms: 15 });
  for (const w of result.warnings) console.warn(`warn  ${w}`);
  if (!result.ok) {
    for (const e of result.errors) console.error(`error ${e}`);
    console.error(`\n✗ ${result.errors.length} validation error(s). public/data left unchanged.`);
    process.exit(1);
  }
  const data = result.data;

  const files: Record<string, unknown> = {
    'platforms.json': data.platforms,
    'metrics.json': data.metrics,
    'models.json': [...data.models].sort(
      (a, b) => a.platform.localeCompare(b.platform) || a.released.localeCompare(b.released),
    ),
    'events.json': buildEvents(
      data,
      readAuto(join(AUTO, 'sightings.json'), z.array(SightingSchema), 'data/auto/sightings.json'),
    ),
  };
  // incidents.json is owned by the daily pipeline (seeded empty if missing), validated here too.
  const incidentsFile = join(OUT, 'incidents.json');
  const incidents = readAuto(incidentsFile, z.array(IncidentSchema), 'public/data/incidents.json');

  const hash = createHash('sha256');
  for (const name of Object.keys(files).sort()) hash.update(stableJson(files[name]));
  hash.update(stableJson(incidents));
  const contentHash = hash.digest('hex').slice(0, 16);

  const metaFile = join(OUT, 'meta.json');
  const previous = readJson(metaFile, {}) as { contentHash?: string; lastUpdated?: string };
  const unchanged =
    previous.contentHash === contentHash && typeof previous.lastUpdated === 'string';
  const pendingConstants = Object.entries(CONSTANT_INDEX)
    .filter(([, c]) => c.verified === 'pending')
    .map(([k]) => k);
  const meta = {
    schemaVersion: 1,
    lastUpdated: unchanged ? previous.lastUpdated : new Date().toISOString(),
    contentHash,
    counts: {
      platforms: data.platforms.length,
      metrics: data.metrics.length,
      models: data.models.length,
    },
    pendingConstants,
  };

  const summary = `${meta.counts.platforms} platforms, ${meta.counts.metrics} metrics, ${meta.counts.models} models`;
  if (checkOnly) {
    console.info(`✓ data valid (${summary})${unchanged ? '' : ' — output would change'}`);
    return;
  }
  mkdirSync(OUT, { recursive: true });
  for (const [name, value] of Object.entries(files))
    writeAtomic(join(OUT, name), stableJson(value));
  writeAtomic(incidentsFile, stableJson(incidents));
  writeAtomic(metaFile, stableJson(meta));
  console.info(`✓ public/data written (${summary})${unchanged ? ', content unchanged' : ''}`);
}

main();
