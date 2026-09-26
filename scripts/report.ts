/**
 * Print the model's current estimates per platform (for review and docs).
 * Usage: tsx scripts/report.ts [ISO date or timestamp]   (defaults to now)
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { validateDataset } from '../src/data/validate';
import {
  buildPlatformModel,
  cumulative,
  cumulativeTier,
  dailyRate,
  globalCumulative,
  globalDailyRate,
  latestAnchor,
  rateTier,
  tokensPerSecond,
} from '../src/model/estimate';
import { gpuEquivalents, powerMW, waterLitersPerDay, promptFootprint } from '../src/model/derived';
import { equivalents } from '../src/model/equivalences';
import { compact } from '../src/model/format';
import { daysToIso, isoToDays } from '../src/model/time';
import type { Range } from '../src/model/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => parse(readFileSync(join(ROOT, 'data', 'manual', f), 'utf8')) as unknown;
const arg = process.argv[2];
const now = arg ? isoToDays(arg) : Date.now() / 86_400_000;

const result = validateDataset(
  { platforms: read('platforms.yaml'), metrics: read('metrics.yaml'), models: read('models.yaml') },
  { now },
);
if (!result.ok) {
  console.error(result.errors.join('\n'));
  process.exit(1);
}
const { platforms, metrics } = result.data;
const models = platforms.map((p) => buildPlatformModel(p, metrics));

const r = (x: Range) => `${compact(x.central)} (${compact(x.low)}–${compact(x.high)})`;
const rows = models
  .map((pm) => ({ pm, rate: dailyRate(pm, now) }))
  .sort((a, b) => b.rate.central - a.rate.central);

console.info(`Estimates at ${new Date(now * 86_400_000).toISOString()}\n`);
console.info(
  [
    '#',
    'platform',
    'tokens/day',
    'tier',
    'since launch',
    'tier',
    'tokens/s now',
    'GPU-eq',
    'MW',
    'latest anchor',
  ].join(' | '),
);
rows.forEach(({ pm, rate }, i) => {
  const tps = tokensPerSecond(pm, now);
  const tier = rateTier(pm, now);
  const gpus = gpuEquivalents(tps, tier);
  const mw = powerMW(gpus.range, tier);
  const a = latestAnchor(pm, now);
  console.info(
    [
      i + 1,
      pm.platform.name,
      r(rate),
      tier,
      compact(cumulative(pm, now).central),
      cumulativeTier(pm, now),
      compact(tps.central),
      compact(gpus.range.central),
      mw.range.central.toFixed(0),
      a ? `${daysToIso(a.t)} ${a.tier}: ${a.formula}` : '—',
    ].join(' | '),
  );
});

const g = globalDailyRate(models, now);
console.info(`\nGlobal (de-duplicated) tokens/day: ${r(g)}`);
console.info(`Global tokens since Nov 2022: ${compact(globalCumulative(models, now).central)}`);
console.info(`Global water/day (L): ${r(waterLitersPerDay(g, 'modeled').range)}`);
for (const e of equivalents(g))
  console.info(
    `  ${e.template.replace('{n}', compact(e.count.central))}${e.displayable ? '' : '  [hidden: pending verification]'}`,
  );
const p = promptFootprint(2000);
console.info(
  `\nA 2,000-token request: ${p.energyWh.range.central.toFixed(3)} Wh (${p.energyWh.range.low.toFixed(3)}–${p.energyWh.range.high.toFixed(3)}), ${p.waterMl.range.central.toFixed(2)} mL water`,
);
