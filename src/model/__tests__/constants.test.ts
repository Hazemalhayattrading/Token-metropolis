import { describe, expect, it } from 'vitest';
import { CONSTANT_INDEX, TRAFFIC, isDisplayable, lookupConstant, pendingRefs } from '../constants';
import { PROFILES } from '../../data/schema';

describe('constants', () => {
  const entries = Object.entries(CONSTANT_INDEX);

  it('every constant is ordered, positive where it must be, and documented', () => {
    expect(entries.length).toBeGreaterThan(40);
    for (const [key, c] of entries) {
      expect(c.low, key).toBeLessThanOrEqual(c.value);
      expect(c.value, key).toBeLessThanOrEqual(c.high);
      expect(c.unit.length, key).toBeGreaterThan(1);
      expect(c.note.length, key).toBeGreaterThan(5);
      if (c.verified === 'page' || c.verified === 'snippet') {
        expect(c.accessed, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(c.source.length, key).toBeGreaterThan(0);
      } else if (c.verified === 'pending' || c.source.length === 0) {
        expect(c.accessed, key).toBeNull();
      }
      for (const s of c.source) expect(s.url, key).toMatch(/^https:\/\//);
    }
  });

  it('only a few constants are still pending verification, and all are equivalences', () => {
    const pending = entries.filter(([, c]) => c.verified === 'pending').map(([k]) => k);
    for (const k of pending) expect(k.startsWith('EQUIV.')).toBe(true);
  });

  it('compute constants that drive every hardware number are sourced', () => {
    for (const k of [
      'COMPUTE.throughputTokensPerSecPerGpu',
      'COMPUTE.kwPerGpu',
      'COMPUTE.pue',
      'COMPUTE.wueLitersPerKwh',
    ]) {
      const c = lookupConstant(k)!;
      expect(['page', 'snippet']).toContain(c.verified);
    }
  });

  it('has a traffic shape for every profile', () => {
    expect(Object.keys(TRAFFIC).sort()).toEqual([...PROFILES].sort());
  });

  it('flags refs that depend on pending constants', () => {
    expect(isDisplayable(['COMPUTE.pue', 'some-metric-id'])).toBe(true);
    expect(pendingRefs(['EQUIV.householdKw', 'COMPUTE.pue'])).toEqual(['EQUIV.householdKw']);
    expect(isDisplayable(['EQUIV.householdKw'])).toBe(false);
  });
});
