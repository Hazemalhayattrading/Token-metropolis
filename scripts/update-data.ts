/**
 * The daily data pipeline's command line (brief §4), run by .github/workflows/update-data.yml:
 * reads the curated data, fetches the public feeds (scripts/pipeline.ts) and updates
 * public/data/incidents.json and data/auto/sightings.json when they change. The workflow then
 * runs the data build, which validates everything again and sets meta.json's lastUpdated.
 *
 * Exits 0 when sources were unreachable (their previous data is kept, by design) and non-zero
 * only when something that would be written does not validate.
 *
 * Usage: tsx scripts/update-data.ts [--dry-run]
 */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateDataset } from '../src/data/validate';
import { z } from 'zod';
import { AUTO, OUT, readYaml, readYamlOr } from './lib';
import { runUpdate, type Level } from './pipeline';

const TIMEOUT_MS = 20_000;
const USER_AGENT =
  'token-metropolis-data-pipeline (+https://github.com/Hazemalhayattrading/Token-metropolis)';

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('the response is not JSON');
  }
}

const lines: string[] = [];
function note(level: Level, message: string): void {
  lines.push(`- ${level === 'warn' ? '⚠️ ' : level === 'error' ? '❌ ' : ''}${message}`);
  if (level === 'info') console.info(message);
  // In GitHub Actions these become annotations on the run.
  else if (process.env.GITHUB_ACTIONS)
    console.info(`::${level === 'warn' ? 'warning' : 'error'}::${message}`);
  else console.warn(message);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const result = validateDataset(
    {
      platforms: readYaml('platforms.yaml'),
      metrics: readYaml('metrics.yaml'),
      models: readYaml('models.yaml'),
    },
    { expectedPlatforms: 15 },
  );
  if (!result.ok) {
    for (const e of result.errors) console.error(`error ${e}`);
    console.error('✗ the curated data does not validate; nothing was fetched or written.');
    process.exit(1);
  }
  const hidden = z.array(z.string()).safeParse(readYamlOr('hidden-sightings.yaml', []) ?? []);
  if (!hidden.success) {
    console.error('✗ data/manual/hidden-sightings.yaml must be a list of sighting ids.');
    process.exit(1);
  }
  const r = await runUpdate(
    { ...result.data, hidden: new Set(hidden.data) },
    {
      fetchJson,
      nowMs: Date.now(),
      incidentsFile: join(OUT, 'incidents.json'),
      sightingsFile: join(AUTO, 'sightings.json'),
      dryRun,
      note,
    },
  );
  const changed = r.incidentsChanged || r.sightingsChanged;
  note(
    'info',
    `${changed ? 'Changed' : 'No change'}: incidents.json ${r.incidentsChanged ? 'updated' : 'unchanged'}, ` +
      `sightings.json ${r.sightingsChanged ? 'updated' : 'unchanged'}${dryRun ? ' (dry run: nothing written)' : ''}.`,
  );
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Data update\n\n${lines.join('\n')}\n`);
}

main().catch((e: unknown) => {
  console.error(`✗ update-data failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
