import { describe, expect, it } from 'vitest';
import { COMPUTE, CROSSCHECK, EQUIV } from '../constants';
import {
  energyMWhPerDay,
  gpuEquivalents,
  homesPowered,
  joulesPerToken,
  powerMW,
  promptFootprint,
  waterLitersPerDay,
} from '../derived';
import { equivalents } from '../equivalences';
import { point } from '../range';

describe('tokens → GPUs → power → water', () => {
  it('follows the documented formulas at the central values', () => {
    const tps = point(1e6);
    const gpus = gpuEquivalents(tps, 'reported');
    expect(gpus.range.central).toBeCloseTo(1e6 / COMPUTE.throughputTokensPerSecPerGpu.value, 8);
    expect(gpus.tier).toBe('modeled'); // the throughput transfer is an assumption

    const mw = powerMW(gpus.range, 'derived');
    expect(mw.range.central).toBeCloseTo(
      (gpus.range.central * COMPUTE.kwPerGpu.value * COMPUTE.pue.value) / 1000,
      8,
    );

    const perDay = point(1e6 * 86400);
    const e = energyMWhPerDay(perDay, 'derived');
    expect(e.range.central).toBeCloseTo(mw.range.central * 24, 6);
    const w = waterLitersPerDay(perDay, 'derived');
    expect(w.range.central).toBeCloseTo(e.range.central * 1000 * COMPUTE.wueLitersPerKwh.value, 3);

    const homes = homesPowered(point(1), 'derived');
    expect(homes.range.central).toBeCloseTo(1000 / EQUIV.householdKw.value, 6);
  });

  it('ranges are ordered and wider than the inputs', () => {
    const gpus = gpuEquivalents(point(1e6), 'reported').range;
    expect(gpus.low).toBeLessThan(gpus.central);
    expect(gpus.high).toBeGreaterThan(gpus.central);
  });
});

describe('cross-checks against published per-prompt energy', () => {
  it('published per-prompt figures fall inside our range for a typical prompt size', () => {
    const jpt = joulesPerToken();
    // A typical request (system prompt + history + answer) of ~2,000–3,000 tokens:
    for (const tokens of [2000, 3000]) {
      const wh = promptFootprint(tokens).energyWh.range;
      expect(wh.low).toBeLessThan(CROSSCHECK.geminiMedianPromptWh.value);
      expect(wh.high).toBeGreaterThan(CROSSCHECK.chatgptAverageQueryWh.value);
    }
    expect(jpt.central).toBeGreaterThan(0.05);
    expect(jpt.central).toBeLessThan(2);
  });

  it('water scales with energy', () => {
    const f = promptFootprint(1000);
    expect(f.waterMl.range.central).toBeCloseTo(
      (f.energyWh.range.central / 1000) * COMPUTE.wueLitersPerKwh.value * 1000,
      8,
    );
    expect(f.energyWh.tier).toBe('modeled');
  });

  it('published per-prompt water falls inside our range for a typical prompt', () => {
    const ml = promptFootprint(2500).waterMl.range;
    expect(ml.low).toBeLessThan(CROSSCHECK.geminiMedianPromptWaterMl.value);
    expect(ml.high).toBeGreaterThan(CROSSCHECK.geminiMedianPromptWaterMl.value);
  });
});

describe('equivalences', () => {
  it('Library of Congress ≈ books × words × tokens/word', () => {
    const loc = equivalents(point(1e15)).find((e) => e.id === 'library-of-congress')!;
    const perLoc = EQUIV.locBooks.value * EQUIV.wordsPerBook.value * EQUIV.tokensPerWord.value;
    expect(loc.count.central).toBeCloseTo(1e15 / perLoc, 6);
    expect(loc.count.low).toBeLessThan(loc.count.central);
    expect(loc.template).toContain('{n}');
  });

  it('hides equivalences built on constants pending verification', () => {
    for (const e of equivalents(point(1e15))) {
      const pending = e.refs.some(
        (r) => r.startsWith('EQUIV.') && r !== 'EQUIV.tokensPerWord' && r !== 'EQUIV.wordsPerBook',
      );
      expect(e.displayable).toBe(!pending);
    }
  });
});
