import { describe, expect, it } from 'vitest';
import type { Incident, TimelineEvent } from './schema';
import {
  isCurated,
  mergeIncidents,
  nameKey,
  newModelSightings,
  normalizeStatusSummary,
  OPENROUTER_AUTHORS,
} from './feeds';

const PAGE = 'https://status.example.com';

/** A trimmed Statuspage v2 summary.json, as statuspage.io and incident.io pages publish it. */
function summary(incidents: unknown[], maintenances: unknown[] = []) {
  return {
    page: { id: 'p1', name: 'Example', url: PAGE },
    status: { indicator: 'major', description: 'Partial outage' },
    components: [],
    incidents,
    scheduled_maintenances: maintenances,
  };
}

describe('normalizeStatusSummary', () => {
  it('keeps open incidents with their impact, start and link', () => {
    const r = normalizeStatusSummary(
      'chatgpt',
      PAGE,
      summary([
        {
          id: 'abc123',
          name: '  Elevated   error rates ',
          status: 'investigating',
          impact: 'major',
          created_at: '2026-09-26T10:00:00.000Z',
          started_at: '2026-09-26T09:55:00.000Z',
          resolved_at: null,
          shortlink: 'https://stspg.io/abc',
        },
        {
          id: 'def',
          name: 'Slow responses',
          status: 'monitoring',
          impact: 'minor',
          created_at: '2026-09-26T08:00:00Z',
          shortlink: null,
        },
      ]),
    );
    expect(r.skipped).toBe(0);
    expect(r.incidents).toEqual([
      {
        id: 'chatgpt-abc123',
        platform: 'chatgpt',
        impact: 'major',
        title: 'Elevated error rates',
        started: '2026-09-26T09:55:00.000Z',
        resolved: null,
        url: 'https://stspg.io/abc',
      },
      {
        id: 'chatgpt-def',
        platform: 'chatgpt',
        impact: 'minor',
        title: 'Slow responses',
        started: '2026-09-26T08:00:00Z',
        resolved: null,
        url: PAGE, // no usable shortlink: the status page itself
      },
    ]);
  });

  it('drops resolved incidents and maintenance that is only scheduled or finished', () => {
    const r = normalizeStatusSummary(
      'claude',
      PAGE,
      summary(
        [
          { id: '1', name: 'Fixed', status: 'resolved', impact: 'major', created_at: '2026-09-25' },
          {
            id: '2',
            name: 'Written up',
            status: 'postmortem',
            impact: 'critical',
            created_at: 'x',
          },
        ],
        [
          {
            id: 'm1',
            name: 'Later',
            status: 'scheduled',
            impact: 'maintenance',
            scheduled_for: 'a',
          },
          {
            id: 'm2',
            name: 'Done',
            status: 'completed',
            impact: 'maintenance',
            scheduled_for: 'b',
          },
          {
            id: 'm3',
            name: 'Database upgrade',
            status: 'in_progress',
            impact: 'minor',
            scheduled_for: '2026-09-26T06:00:00Z',
          },
        ],
      ),
    );
    expect(r.incidents.map((i) => [i.id, i.impact, i.started])).toEqual([
      ['claude-maint-m3', 'maintenance', '2026-09-26T06:00:00Z'],
    ]);
  });

  it('never guesses: unknown impacts claim nothing, unreadable entries are skipped', () => {
    const r = normalizeStatusSummary(
      'cursor',
      PAGE,
      summary([
        {
          id: 'a',
          name: 'Something',
          status: 'identified',
          impact: 'catastrophic',
          created_at: '2026-09-26T01:00:00Z',
        },
        { id: 'b', status: 'identified' }, // no name
        { id: 'c', name: 'No start time', status: 'identified', impact: 'major' },
        'not an object',
      ]),
    );
    expect(r.incidents.map((i) => [i.id, i.impact])).toEqual([['cursor-a', 'none']]);
    expect(r.skipped).toBe(3);
  });

  it('throws on a document that is not a status summary, so the caller keeps the old data', () => {
    expect(() => normalizeStatusSummary('cursor', PAGE, { hello: 'world' })).toThrow();
    expect(() => normalizeStatusSummary('cursor', PAGE, '<html>')).toThrow();
  });
});

describe('mergeIncidents', () => {
  const inc = (id: string, platform: string): Incident => ({
    id,
    platform,
    impact: 'minor',
    title: 'Something',
    started: '2026-09-26T00:00:00Z',
    resolved: null,
    url: PAGE,
  });

  it('replaces the incidents of pages that answered, keeps those of pages that failed', () => {
    const previous = [inc('a-1', 'a'), inc('b-1', 'b'), inc('c-1', 'c')];
    const fresh = new Map([
      ['a', [inc('a-2', 'a')]],
      ['c', [] as Incident[]], // c answered: nothing open any more
    ]);
    const merged = mergeIncidents(previous, fresh, new Set(['b']));
    expect(merged.map((i) => i.id)).toEqual(['a-2', 'b-1']);
  });

  it('drops incidents of platforms that neither answered nor failed (no status page now)', () => {
    expect(mergeIncidents([inc('z-1', 'z')], new Map(), new Set())).toEqual([]);
  });
});

describe('newModelSightings', () => {
  const today = Date.parse('2026-09-26T00:00:00Z') / 86_400_000;
  const secs = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 1000;
  const platforms = Object.values(OPENROUTER_AUTHORS).map((id) => ({ id }));
  const base = { today, windowDays: 45, platforms, models: [], known: [] };

  it('turns a recent own-family model into a "first seen" event with its OpenRouter page', () => {
    const r = newModelSightings(
      { data: [{ id: 'x-ai/grok-5-mini', name: 'xAI: Grok 5 Mini', created: secs('2026-09-20') }] },
      base,
    );
    expect(r.events).toEqual([
      {
        id: 'seen-x-ai-grok-5-mini',
        date: '2026-09-20',
        platform: 'grok',
        kind: 'model-launch',
        title: 'Grok 5 Mini first seen on OpenRouter',
        datePrecision: 'day',
        dateKind: 'first-seen',
        source: {
          title: 'Grok 5 Mini — OpenRouter model page',
          publisher: 'OpenRouter',
          url: 'https://openrouter.ai/x-ai/grok-5-mini',
        },
        model: 'Grok 5 Mini',
      },
    ]);
  });

  it('skips old models, other companies, Gemma, variants and anything already known', () => {
    const known: TimelineEvent[] = [
      {
        id: 'seen-qwen-qwen4',
        date: '2026-09-01',
        platform: 'qwen',
        kind: 'model-launch',
        title: 'Qwen4 first seen on OpenRouter',
        datePrecision: 'day',
        dateKind: 'first-seen',
        source: {
          title: 'Qwen4',
          publisher: 'OpenRouter',
          url: 'https://openrouter.ai/qwen/qwen4',
        },
      },
    ];
    const r = newModelSightings(
      {
        data: [
          {
            id: 'openai/gpt-3.5-turbo',
            name: 'OpenAI: GPT-3.5 Turbo',
            created: secs('2023-03-01'),
          },
          { id: 'mistralai/mistral-9', name: 'Mistral: 9', created: secs('2026-09-20') },
          { id: 'google/gemma-5', name: 'Google: Gemma 5', created: secs('2026-09-20') },
          { id: 'google/gemini-4-pro', name: 'Google: Gemini 4 Pro', created: secs('2026-09-21') },
          {
            id: 'google/gemini-4-pro:free',
            name: 'Google: Gemini 4 Pro (free)',
            created: secs('2026-09-21'),
          },
          { id: 'qwen/qwen4', name: 'Qwen: Qwen4', created: secs('2026-09-01') },
          { id: 'not a valid id', name: 'x', created: 1 },
        ],
      },
      { ...base, known },
    );
    expect(r.events.map((e) => e.id)).toEqual(['seen-google-gemini-4-pro']);
    expect(r.skipped).toBe(1);
  });

  it('leaves models the curated list already has to the curated list', () => {
    const r = newModelSightings(
      {
        data: [
          {
            id: 'anthropic/claude-opus-5.5',
            name: 'Anthropic: Claude Opus 5.5',
            created: secs('2026-09-22'),
          },
          {
            id: 'anthropic/claude-haiku-5',
            name: 'Anthropic: Claude Haiku 5',
            created: secs('2026-09-23'),
          },
        ],
      },
      {
        ...base,
        models: [{ platform: 'claude', name: 'Claude Opus 5.5', released: '2026-09-22' }],
      },
    );
    expect(r.events.map((e) => e.id)).toEqual(['seen-anthropic-claude-haiku-5']);
  });

  it('knows when the curated list has caught up with a sighting', () => {
    const day = Date.parse('2026-09-20T00:00:00Z') / 86_400_000;
    const models = [{ platform: 'grok', name: 'Grok 5 Mini', released: '2026-09-24' }];
    expect(isCurated('grok', 'Grok 5 Mini', day, models)).toBe(true);
    expect(isCurated('grok', 'Grok 6', day, models)).toBe(false);
    expect(isCurated('claude', 'Grok 5 Mini', day, models)).toBe(false);
    expect(isCurated('grok', 'Grok 5 Mini', day + 400, models)).toBe(false);
  });

  it('throws on a document that is not a model list', () => {
    expect(() => newModelSightings({ models: [] }, base)).toThrow();
  });

  it('compares names on letters and digits only', () => {
    expect(nameKey('GPT-5.1 (Sol)')).toBe('gpt51sol');
  });
});
