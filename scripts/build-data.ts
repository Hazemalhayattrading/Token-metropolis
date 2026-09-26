/**
 * Compile data/manual/*.yaml (curated) and data/auto/*.json (written by the hourly pipeline,
 * scripts/update-data.ts) → public/data/*.json.
 *
 * Refuses to publish anything invalid: if validation fails, public/data is
 * left untouched and the process exits non-zero. `meta.json.lastUpdated`
 * only changes when the published content changes, so the hourly workflow
 * can commit only real updates.
 *
 * Usage: tsx scripts/build-data.ts [--check]   (--check validates without writing)
 */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { curatedMatch, SightingSchema, type Sighting } from '../src/data/feeds';
import { IncidentSchema, type TimelineEvent } from '../src/data/schema';
import { validateDataset, type Dataset } from '../src/data/validate';
import { CONSTANT_INDEX } from '../src/model/constants';
import { AUTO, OUT, readJson, readYaml, readYamlOr, stableJson, writeAtomic } from './lib';

const checkOnly = process.argv.includes('--check');

const byDateDesc = (a: TimelineEvent, b: TimelineEvent) =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id);

/**
 * Timeline events: one per curated model, plus the pipeline's "first seen" sightings that the
 * curated list does not (yet) have and the owner has not hidden.
 */
function buildEvents(
  data: Dataset,
  sightings: readonly Sighting[],
  hidden: ReadonlySet<string>,
): TimelineEvent[] {
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
    .filter((s) => names.has(s.platform) && !hidden.has(s.id))
    .filter((s) => !curatedMatch(s.platform, s.model, daysOf(s.date), data.models))
    .map(({ model: _model, ...event }) => event);
  const ids = new Set(curated.map((e) => e.id));
  return [...curated, ...seen.filter((e) => !ids.has(e.id))].sort(byDateDesc);
}

const daysOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/** Stop with a readable message, publishing nothing. */
function refuse(label: string, messages: readonly string[]): never {
  for (const m of messages.slice(0, 10)) console.error(`error ${label}: ${m}`);
  console.error(`\n✗ ${label} does not validate. public/data left unchanged.`);
  process.exit(1);
}

/** A pipeline-owned file, validated; exits (publishing nothing) if it is invalid. */
function readAuto<T>(file: string, schema: z.ZodType<T>, label: string): T {
  const raw = readJson(file, []);
  if (!raw.ok) refuse(label, [raw.error]);
  const parsed = schema.safeParse(raw.value);
  if (parsed.success) return parsed.data;
  refuse(
    label,
    parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  );
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
  const hiddenParsed = z.array(z.string()).safeParse(readYamlOr('hidden-sightings.yaml', []) ?? []);
  if (!hiddenParsed.success)
    refuse('data/manual/hidden-sightings.yaml', ['expected a list of ids']);
  const hidden = hiddenParsed.data;

  const files: Record<string, unknown> = {
    'platforms.json': data.platforms,
    'metrics.json': data.metrics,
    'models.json': [...data.models].sort(
      (a, b) => a.platform.localeCompare(b.platform) || a.released.localeCompare(b.released),
    ),
    'events.json': buildEvents(
      data,
      readAuto(join(AUTO, 'sightings.json'), z.array(SightingSchema), 'data/auto/sightings.json'),
      new Set(hidden),
    ),
  };
  // incidents.json is owned by the hourly pipeline (seeded empty if missing), validated here too.
  const incidentsFile = join(OUT, 'incidents.json');
  const incidents = readAuto(incidentsFile, z.array(IncidentSchema), 'public/data/incidents.json');

  // "Data updated" follows the figures, models and events. Status notices come and go by the
  // hour and are timestamped on their own, so they do not move it.
  const hash = createHash('sha256');
  for (const name of Object.keys(files).sort()) hash.update(stableJson(files[name]));
  const contentHash = hash.digest('hex').slice(0, 16);

  const metaFile = join(OUT, 'meta.json');
  const previousMeta = readJson(metaFile, {});
  const previous = (previousMeta.ok ? previousMeta.value : {}) as {
    contentHash?: string;
    lastUpdated?: string;
  };
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
