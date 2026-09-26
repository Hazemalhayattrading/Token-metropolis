import { describe, expect, it } from 'vitest';
import { layoutPlots, ISLAND_RADIUS } from './layout';
import {
  DESK_BANDS,
  deskTier,
  facilityCounts,
  HEIGHT_MAX,
  HEIGHT_MIN,
  logLoad,
  tokensAtLoad,
  towerHeight,
} from './scale';

const IDS = [
  'chatgpt',
  'gemini',
  'claude',
  'meta-ai',
  'copilot',
  'doubao',
  'qwen',
  'deepseek',
  'grok',
  'github-copilot',
  'perplexity',
  'yuanbao',
  'cursor',
  'characterai',
  'kimi',
];

describe('layout', () => {
  it('gives every platform a distinct plot on the island', () => {
    const plots = layoutPlots(IDS);
    expect(plots.size).toBe(15);
    const keys = new Set([...plots.values()].map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`));
    expect(keys.size).toBe(15);
    for (const p of plots.values()) expect(Math.hypot(p.x, p.z)).toBeLessThan(ISLAND_RADIUS - 10);
  });

  it('is stable regardless of input order and handles unknown ids', () => {
    const a = layoutPlots(IDS);
    const b = layoutPlots([...IDS].reverse());
    expect(b.get('claude')).toEqual(a.get('claude'));
    const c = layoutPlots([...IDS.slice(0, 14), 'newcomer']);
    expect(c.get('newcomer')).toEqual(a.get('kimi'));
  });

  it('keeps plots far enough apart for a campus', () => {
    const ps = [...layoutPlots(IDS).values()];
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++)
        expect(Math.hypot(ps[i]!.x - ps[j]!.x, ps[i]!.z - ps[j]!.z)).toBeGreaterThan(20);
  });
});

describe('scale', () => {
  it('log scale keeps small platforms visible and caps the giants', () => {
    expect(towerHeight(1e9, 'log', 1e15)).toBe(HEIGHT_MIN);
    expect(towerHeight(1e16, 'log', 1e16)).toBe(HEIGHT_MAX);
    expect(towerHeight(1e12, 'log', 1e15)).toBeGreaterThan(towerHeight(1e11, 'log', 1e15));
    expect(logLoad(1e12)).toBeCloseTo(0.4, 10);
  });

  it('true scale is proportional to tokens', () => {
    expect(towerHeight(2e14, 'true', 2e14)).toBeCloseTo(HEIGHT_MAX, 10);
    expect(towerHeight(1e14, 'true', 2e14)).toBeCloseTo(HEIGHT_MAX / 2, 10);
    expect(towerHeight(1e9, 'true', 2e14)).toBe(0.35); // still a visible sliver
  });

  it('does not build anything before launch', () => {
    expect(towerHeight(0, 'log', 1e14)).toBe(0);
    expect(facilityCounts(0)).toEqual({ halls: 0, cooling: 0, trucks: 0 });
  });

  it('adds facilities as load grows', () => {
    const small = facilityCounts(2e10);
    const big = facilityCounts(3e14);
    expect(big.halls).toBeGreaterThan(small.halls);
    expect(big.cooling).toBeGreaterThan(small.cooling);
    expect(big.trucks).toBeGreaterThan(small.trucks);
  });
});

describe('desk bands', () => {
  it('inverts logLoad and bands monotonically', () => {
    expect(logLoad(tokensAtLoad(0.3))).toBeCloseTo(0.3, 10);
    expect(deskTier(0)).toBe(0);
    expect(deskTier(DESK_BANDS[0])).toBe(1);
    expect(deskTier(DESK_BANDS[1])).toBe(2);
    expect(deskTier(1)).toBe(2);
  });
});
