import { describe, expect, it } from 'vitest';
import type { Model } from '../../data/schema';
import { LAB_MAX, labLineup } from './lineup';

function model(id: string, released: string): Model {
  return {
    id,
    platform: 'p',
    name: id,
    released,
    contextWindowTokens: null,
    modalities: ['text'],
    flagship: false,
    origin: 'own',
    source: { title: 'Source', publisher: 'Pub', url: 'https://example.com/' },
    verified: 'page',
  } as Model;
}

describe('labLineup', () => {
  it('orders oldest to newest with a stable tie-break', () => {
    const out = labLineup([
      model('b', '2024-01-01'),
      model('a', '2024-01-01'),
      model('c', '2023-05-01'),
    ]);
    expect(out.map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps only the most recent models', () => {
    const many = Array.from({ length: LAB_MAX + 5 }, (_, i) =>
      model(`m${i}`, `2025-01-${String(i + 1).padStart(2, '0')}`),
    );
    const out = labLineup(many);
    expect(out).toHaveLength(LAB_MAX);
    expect(out.at(-1)!.id).toBe(`m${LAB_MAX + 4}`);
    expect(out[0]!.id).toBe('m5');
  });
});
