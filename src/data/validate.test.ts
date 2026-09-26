import { describe, expect, it } from 'vitest';
import { metric, platform } from '../model/__tests__/fixtures';
import { validateDataset } from './validate';

const NOW = Date.UTC(2026, 8, 25) / 86_400_000;
const src = { title: 'Test source', publisher: 'Test', url: 'https://example.com/source' };

function dataset() {
  return {
    platforms: [platform()],
    metrics: [
      metric({
        id: 'a',
        component: 'app',
        kind: 'users',
        window: 'weekly',
        value: 1e8,
        asOf: '2025-01-01',
      }),
      metric({
        id: 'b',
        component: 'api',
        kind: 'tokens',
        period: 'day',
        value: 1e12,
        asOf: '2025-06-01',
      }),
    ],
    models: [
      {
        id: 'm1',
        platform: 'testbot',
        name: 'Test-1',
        released: '2024-01-01',
        contextWindowTokens: 128000,
        modalities: ['text'],
        flagship: true,
        source: src,
        verified: 'page',
      },
    ],
  };
}

describe('dataset validation', () => {
  it('accepts a consistent dataset', () => {
    const r = validateDataset(dataset(), { now: NOW });
    expect(r.ok ? [] : r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('refuses schema violations (never publishes broken data)', () => {
    const d = dataset();
    (d.metrics[0] as { value: number }).value = -5;
    const r = validateDataset(d, { now: NOW });
    expect(r.ok).toBe(false);
  });

  it('refuses dangling references', () => {
    const d = dataset();
    d.metrics.push(
      metric({ id: 'c', platform: 'ghost', kind: 'other', value: 1, asOf: '2025-01-01' }),
    );
    d.metrics.push(
      metric({
        id: 'd',
        component: 'nope',
        kind: 'tokens',
        period: 'day',
        value: 1,
        asOf: '2025-01-01',
      }),
    );
    const r = validateDataset(d, { now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('\n')).toContain('unknown platform "ghost"');
      expect(r.errors.join('\n')).toContain('unknown component "nope"');
    }
  });

  it('refuses a component with no anchoring metric', () => {
    const d = dataset();
    d.metrics = d.metrics.filter((m) => m.component !== 'api');
    const r = validateDataset(d, { now: NOW });
    expect(r.ok).toBe(false);
  });

  it('refuses figures dated in the future and unknown override constants', () => {
    const d = dataset();
    d.metrics.push(
      metric({
        id: 'f',
        component: 'api',
        kind: 'tokens',
        period: 'day',
        value: 1,
        asOf: '2027-01-01',
      }),
    );
    d.platforms = [
      platform({
        components: [
          { ...platform().components[0]!, overrides: { tokensPerRequest: 'doesNotExist' } },
          platform().components[1]!,
        ],
      }),
    ];
    const r = validateDataset(d, { now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('\n')).toContain('in the future');
      expect(r.errors.join('\n')).toContain('unknown constant "doesNotExist"');
    }
  });

  it('refuses duplicates and enforces the platform count', () => {
    const d = dataset();
    d.metrics.push({ ...d.metrics[0]! });
    const r = validateDataset(d, { now: NOW, expectedPlatforms: 15 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('\n')).toContain('duplicate id "a"');
      expect(r.errors.join('\n')).toContain('expected 15');
    }
  });

  it('warns about snippet-only verification', () => {
    const d = dataset();
    d.metrics[1] = { ...d.metrics[1]!, verified: 'snippet' };
    const r = validateDataset(d, { now: NOW });
    expect(r.ok).toBe(true);
    expect(r.warnings.join('\n')).toContain('search snippet');
  });
});
