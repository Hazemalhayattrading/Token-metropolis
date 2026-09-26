/**
 * Whole-dataset validation: schema checks plus cross-references and a model
 * smoke test. Used by scripts/build-data.ts (refuses to publish on failure)
 * and by the client when loading public/data/*.json.
 */
import { z } from 'zod';
import { USAGE } from '../model/constants';
import { buildPlatformModel, dailyRate, cumulative } from '../model/estimate';
import { isoToDays } from '../model/time';
import {
  MetricSchema,
  ModelSchema,
  PlatformSchema,
  type Metric,
  type Model,
  type Platform,
} from './schema';

export interface Dataset {
  readonly platforms: Platform[];
  readonly metrics: Metric[];
  readonly models: Model[];
}

export type ValidationResult =
  | { ok: true; data: Dataset; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

function zodErrors(file: string, err: z.ZodError): string[] {
  return err.issues.map((i) => `${file}: ${i.path.join('.') || '(root)'} — ${i.message}`);
}

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

export interface ValidateOptions {
  /** "Now" for sanity checks (days since epoch). Defaults to the current time. */
  readonly now?: number;
  /** Exact number of platforms required (15 for the published site). */
  readonly expectedPlatforms?: number;
}

export function validateDataset(
  raw: { platforms: unknown; metrics: unknown; models: unknown },
  opts: ValidateOptions = {},
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const now = opts.now ?? Date.now() / 86_400_000;

  const p = z.array(PlatformSchema).safeParse(raw.platforms);
  const m = z.array(MetricSchema).safeParse(raw.metrics);
  const mo = z.array(ModelSchema).safeParse(raw.models);
  if (!p.success) errors.push(...zodErrors('platforms', p.error));
  if (!m.success) errors.push(...zodErrors('metrics', m.error));
  if (!mo.success) errors.push(...zodErrors('models', mo.error));
  if (!p.success || !m.success || !mo.success) return { ok: false, errors, warnings };

  const platforms = p.data;
  const metrics = m.data;
  const models = mo.data;

  if (opts.expectedPlatforms !== undefined && platforms.length !== opts.expectedPlatforms) {
    errors.push(`platforms: expected ${opts.expectedPlatforms}, found ${platforms.length}`);
  }
  for (const d of duplicates(platforms.map((x) => x.id)))
    errors.push(`platforms: duplicate id "${d}"`);
  for (const d of duplicates(metrics.map((x) => x.id))) errors.push(`metrics: duplicate id "${d}"`);
  for (const d of duplicates(models.map((x) => x.id))) errors.push(`models: duplicate id "${d}"`);

  const byId = new Map(platforms.map((x) => [x.id, x]));
  const usageKeys = new Set(Object.keys(USAGE));

  for (const pl of platforms) {
    for (const d of duplicates(pl.components.map((c) => c.id)))
      errors.push(`${pl.id}: duplicate component "${d}"`);
    for (const comp of pl.components) {
      for (const [k, v] of Object.entries(comp.overrides ?? {})) {
        if (k === 'userWindow') continue;
        if (v && !usageKeys.has(v))
          errors.push(`${pl.id}/${comp.id}: override ${k} → unknown constant "${v}"`);
      }
      const anchoring = metrics.filter((x) => x.platform === pl.id && x.component === comp.id);
      if (anchoring.length === 0)
        errors.push(`${pl.id}/${comp.id}: no metric anchors this component`);
    }
    if (isoToDays(pl.launch.date) > now) errors.push(`${pl.id}: launch date is in the future`);
  }

  for (const x of metrics) {
    const pl = byId.get(x.platform);
    if (!pl) {
      errors.push(`metrics/${x.id}: unknown platform "${x.platform}"`);
      continue;
    }
    const t = isoToDays(x.asOf);
    if (t > now + 1) errors.push(`metrics/${x.id}: asOf ${x.asOf} is in the future`);
    if (isoToDays(x.accessed) > now + 1)
      errors.push(`metrics/${x.id}: accessed ${x.accessed} is in the future`);
    if (x.component) {
      const comp = pl.components.find((c) => c.id === x.component);
      if (!comp) errors.push(`metrics/${x.id}: unknown component "${x.component}" on ${pl.id}`);
      else {
        const start = isoToDays(comp.start ?? pl.launch.date);
        if (t < start)
          errors.push(`metrics/${x.id}: anchors ${pl.id}/${comp.id} before it started`);
        const o = comp.overrides;
        if (x.kind === 'users' && (o?.tokensPerUserDay || o?.requestsPerUserDay)) {
          if (o.userWindow !== x.window)
            errors.push(
              `metrics/${x.id}: ${comp.id} per-user constants are per ${o.userWindow} user, metric is ${x.window}`,
            );
        } else if (x.kind === 'users') {
          const keys = [`requestsPerDau_${comp.profile}`, `tokensPerRequest_${comp.profile}`];
          if (x.window !== 'daily')
            keys.push(`${x.window === 'weekly' ? 'dauPerWau' : 'dauPerMau'}_${comp.profile}`);
          for (const key of keys) {
            const overridden = key.startsWith('requestsPerDau')
              ? o?.requestsPerDau
              : key.startsWith('tokensPerRequest')
                ? o?.tokensPerRequest
                : undefined;
            if (!overridden && !usageKeys.has(key))
              errors.push(`metrics/${x.id}: no constant ${key} for profile ${comp.profile}`);
          }
        }
      }
    }
    if (x.verified === 'snippet')
      warnings.push(`metrics/${x.id}: verified from a search snippet only`);
  }

  for (const x of models) {
    if (!byId.has(x.platform)) errors.push(`models/${x.id}: unknown platform "${x.platform}"`);
    if (isoToDays(x.released) > now + 1) errors.push(`models/${x.id}: release date in the future`);
  }
  for (const pl of platforms) {
    if (!models.some((x) => x.platform === pl.id)) warnings.push(`${pl.id}: no models listed`);
  }

  // Model smoke test: every platform must build and produce sane numbers today.
  if (errors.length === 0) {
    for (const pl of platforms) {
      try {
        const pm = buildPlatformModel(pl, metrics);
        const r = dailyRate(pm, now);
        const c = cumulative(pm, now);
        const sane = [r.low, r.central, r.high, c.low, c.central, c.high].every(
          (v) => Number.isFinite(v) && v >= 0,
        );
        if (!sane || r.central <= 0) errors.push(`${pl.id}: model produced invalid numbers`);
        if (!(r.low <= r.central && r.central <= r.high))
          errors.push(`${pl.id}: unordered daily-rate range`);
      } catch (e) {
        errors.push(`${pl.id}: model failed to build — ${(e as Error).message}`);
      }
    }
  }

  return errors.length
    ? { ok: false, errors, warnings }
    : { ok: true, data: { platforms, metrics, models }, warnings };
}
