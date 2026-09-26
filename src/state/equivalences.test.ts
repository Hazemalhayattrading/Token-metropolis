import { describe, expect, it } from 'vitest';
import { EQUIV } from '../model/constants';
import { arrivalEquivalences } from './equivalences';

describe('arrival equivalences', () => {
  const tokens = { low: 0.8e12, central: 1e12, high: 1.3e12 };

  it('gives words, energy and water with ordered ranges and honest tiers', () => {
    const eq = arrivalEquivalences(tokens, 'modeled');
    expect(eq.map((e) => e.id)).toEqual(['words', 'energy', 'water']);
    for (const e of eq) {
      expect(e.value.low).toBeLessThanOrEqual(e.value.central);
      expect(e.value.central).toBeLessThanOrEqual(e.value.high);
      expect(e.tier).toBe('modeled');
    }
    expect(eq[0]!.value.central).toBeCloseTo(1e12 / EQUIV.tokensPerWord.value, -6);
  });

  it('never claims more than the input tier, and returns nothing for no tokens', () => {
    expect(arrivalEquivalences(tokens, 'reported')[0]!.tier).toBe('derived');
    expect(arrivalEquivalences({ low: 0, central: 0, high: 0 }, 'modeled')).toEqual([]);
  });
});
