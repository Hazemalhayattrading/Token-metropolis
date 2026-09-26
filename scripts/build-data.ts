/**
 * Compile data/manual/*.yaml → public/data/*.json.
 *
 * Refuses to publish anything invalid: if validation fails, public/data is
 * left untouched and the process exits non-zero. `meta.json.lastUpdated`
 * only changes when the published content changes, so the daily workflow
 * can commit only real updates.
 *
 * Usage: tsx scripts/build-data.ts [--check]   (--check validates without writing)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { validateDataset, type Dataset } from '../src/data/validate';
import { CONSTANT_INDEX } from '../src/model/constants';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL = join(ROOT, 'data', 'manual');
const OUT = join(ROOT, 'public', 'data');
const checkOnly = process.argv.includes('--check');

function readYaml(name: string): unknown {
  const file = join(MANUAL, name);
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  return parse(readFileSync(file, 'utf8'));
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildEvents(data: Dataset) {
  const names = new Map(data.platforms.map((p) => [p.id, p.name]));
  return data.models
    .map((m) => ({
      id: `launch-${m.id}`,
      date: m.released,
      platform: m.platform,
      kind: m.origin === 'own' ? ('model-launch' as const) : ('model-available' as const),
      title:
        m.origin === 'own'
          ? `${m.name} released`
          : `${m.name} available in ${names.get(m.platform)}`,
      source: m.source,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));
}

function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
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
    'events.json': buildEvents(data),
  };
  // incidents.json is owned by the daily pipeline; seed it if missing.
  const incidentsFile = join(OUT, 'incidents.json');
  const incidents = existsSync(incidentsFile)
    ? (JSON.parse(readFileSync(incidentsFile, 'utf8')) as unknown)
    : [];

  const hash = createHash('sha256');
  for (const name of Object.keys(files).sort()) hash.update(stableJson(files[name]));
  hash.update(stableJson(incidents));
  const contentHash = hash.digest('hex').slice(0, 16);

  const metaFile = join(OUT, 'meta.json');
  const previous = existsSync(metaFile)
    ? (JSON.parse(readFileSync(metaFile, 'utf8')) as { contentHash?: string; lastUpdated?: string })
    : {};
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
