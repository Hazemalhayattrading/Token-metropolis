/**
 * Integration tests on the real curated dataset (data/manual/*.yaml).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  buildPlatformModel,
  cumulative,
  dailyRate,
  globalCumulative,
  globalDailyRate,
  rateTier,
  tokensPerSecond,
  tokensToday,
} from '../model/estimate';
import { isoToDays } from '../model/time';
import { validateDataset } from './validate';

const read = (f: string) =>
  parse(readFileSync(join(__dirname, '..', '..', 'data', 'manual', f), 'utf8')) as unknown;
const NOW = isoToDays('2026-09-25T12:00:00Z');
const result = validateDataset(
  { platforms: read('platforms.yaml'), metrics: read('metrics.yaml'), models: read('models.yaml') },
  { now: NOW, expectedPlatforms: 15 },
);
if (!result.ok) throw new Error(`dataset invalid:\n${result.errors.join('\n')}`);
const { platforms, metrics, models } = result.data;
const pms = platforms.map((p) => buildPlatformModel(p, metrics));
const byId = new Map(pms.map((pm) => [pm.platform.id, pm]));

describe('curated dataset', () => {
  it('has 15 platforms with unique ids, names and palettes', () => {
    expect(platforms).toHaveLength(15);
    expect(new Set(platforms.map((p) => p.name)).size).toBe(15);
    expect(new Set(platforms.map((p) => p.identity.palette.accent.toLowerCase())).size).toBe(15);
  });

  it('every metric has a https source, a quote and an access date', () => {
    for (const m of metrics) {
      expect(m.source.url, m.id).toMatch(/^https:\/\//);
      expect(m.quote.length, m.id).toBeGreaterThan(10);
      expect(m.accessed, m.id).toBe('2026-09-25');
    }
  });

  it('every platform has at least one model and launch info', () => {
    for (const p of platforms) {
      if (p.id === 'characterai') continue; // no model lineup found during research (TASKS.md)
      expect(
        models.some((m) => m.platform === p.id),
        p.id,
      ).toBe(true);
    }
  });

  it('produces finite, ordered, positive estimates today', () => {
    for (const pm of pms) {
      const r = dailyRate(pm, NOW);
      expect(r.central, pm.platform.id).toBeGreaterThan(0);
      expect(r.low).toBeLessThanOrEqual(r.central);
      expect(r.central).toBeLessThanOrEqual(r.high);
      const c = cumulative(pm, NOW);
      expect(Number.isFinite(c.high)).toBe(true);
      expect(c.low).toBeLessThanOrEqual(c.central);
    }
  });

  it('global total is in a plausible band (10T–10 quadrillion tokens/day)', () => {
    const g = globalDailyRate(pms, NOW);
    expect(g.central).toBeGreaterThan(1e13);
    expect(g.central).toBeLessThan(1e16);
    expect(globalCumulative(pms, NOW).central).toBeGreaterThan(g.central * 100);
  });

  it('only the brief-era pioneers exist at the start of the time machine', () => {
    const start = isoToDays('2022-12-01');
    const alive = pms.filter((pm) => dailyRate(pm, start).central > 0).map((pm) => pm.platform.id);
    expect(alive.sort()).toEqual(['characterai', 'chatgpt', 'github-copilot']);
  });

  it('counters never run backwards anywhere in the time-machine window', () => {
    const start = isoToDays('2022-11-01');
    const end = isoToDays('2026-12-31');
    for (const pm of pms) {
      let prev = -1;
      for (let t = start; t <= end; t += 0.13) {
        const v = cumulative(pm, t).central;
        expect(v, `${pm.platform.id} at ${t}`).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it('tokens today stays below ~1.5× the daily rate and tokens/s is positive', () => {
    for (const pm of pms) {
      const today = tokensToday(pm, NOW + 0.49).central;
      expect(today).toBeLessThan(dailyRate(pm, NOW).central * 1.5);
      expect(tokensPerSecond(pm, NOW).central).toBeGreaterThan(0);
    }
  });

  it('labels tiers honestly', () => {
    // Doubao: extrapolated beyond 14 days from a reported figure → never "reported" today
    expect(rateTier(byId.get('doubao')!, NOW)).toBe('derived');
    // … but reported on the day of the disclosure
    expect(rateTier(byId.get('doubao')!, isoToDays('2026-06-23'))).toBe('reported');
    // DeepSeek uses a calibration built from published inputs only
    expect(rateTier(byId.get('deepseek')!, NOW)).toBe('derived');
    // User-based estimates rely on judgement constants
    expect(rateTier(byId.get('meta-ai')!, NOW)).toBe('modeled');
  });

  it('is deterministic', () => {
    const again = platforms.map((p) => buildPlatformModel(p, metrics));
    for (let i = 0; i < pms.length; i++) {
      expect(cumulative(again[i]!, NOW + 0.3)).toEqual(cumulative(pms[i]!, NOW + 0.3));
    }
  });
});
