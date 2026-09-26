import { describe, expect, it } from 'vitest';
import type { Incident } from './schema';
import {
  curatedMatch,
  mergeIncidents,
  nameTokens,
  newModelSightings,
  normalizeStatusSummary,
  OPENROUTER_AUTHORS,
} from './feeds';

const PAGE = 'https://status.example.com';
const CHECKED = '2026-09-26T12:17:00.000Z';

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
  it('keeps open incidents with their impact, status, start, link and the time they were read', () => {
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
      { checked: CHECKED },
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
        status: 'investigating',
        checked: CHECKED,
      },
      {
        id: 'chatgpt-def',
        platform: 'chatgpt',
        impact: 'minor',
        title: 'Slow responses',
        started: '2026-09-26T08:00:00Z',
        resolved: null,
        url: PAGE, // no usable shortlink: the status page itself
        status: 'monitoring',
        checked: CHECKED,
      },
    ]);
  });

  it('drops resolved incidents and maintenance that is scheduled, finished or without impact', () => {
    const r = normalizeStatusSummary(
      'claude',
      PAGE,
      summary(
        [
          { id: '1', name: 'Fixed', status: 'resolved', impact: 'major', created_at: '2026-09-25' },
          { id: '2', name: 'Written up', status: 'postmortem', impact: 'critical' },
        ],
        [
          { id: 'm1', name: 'Later', status: 'scheduled', impact: 'maintenance' },
          { id: 'm2', name: 'Done', status: 'completed', impact: 'maintenance' },
          { id: 'm4', name: 'Quiet', status: 'in_progress', impact: 'none', scheduled_for: 'x' },
          {
            id: 'm3',
            name: 'Database upgrade',
            status: 'in_progress',
            impact: 'minor',
            scheduled_for: '2026-09-26T06:00:00Z',
            started_at: '2026-09-26T05:40:00Z', // started early: the actual start wins
          },
        ],
      ),
      { checked: CHECKED },
    );
    expect(r.incidents.map((i) => [i.id, i.impact, i.status, i.started])).toEqual([
      ['claude-maint-m3', 'maintenance', 'maintenance', '2026-09-26T05:40:00Z'],
    ]);
    expect(r.skipped).toBe(0); // closed entries are ignored, not "unreadable"
  });

  it('on a shared page, keeps only notices about its components', () => {
    const r = normalizeStatusSummary(
      'github-copilot',
      'https://www.githubstatus.com',
      summary([
        {
          id: 'a',
          name: 'Incident with Actions',
          status: 'investigating',
          impact: 'minor',
          created_at: '2026-09-26T04:00:00Z',
          components: [{ id: 'c1', name: 'Actions', status: 'degraded_performance' }],
        },
        {
          id: 'b',
          name: 'Incident with Copilot',
          status: 'identified',
          impact: 'major',
          created_at: '2026-09-26T04:30:00Z',
          components: [{ id: 'c2', name: 'Copilot', status: 'partial_outage' }],
        },
        {
          id: 'c',
          name: 'Something, somewhere',
          status: 'investigating',
          impact: 'minor',
          created_at: '2026-09-26T04:45:00Z',
        },
      ]),
      { checked: CHECKED, components: ['Copilot'] },
    );
    expect(r.incidents.map((i) => i.id)).toEqual(['github-copilot-b']);
    expect(r.otherComponents).toBe(2); // a notice naming no component is not guessed to be ours
  });

  it('never guesses: an unknown impact claims nothing, unreadable open entries are skipped', () => {
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
      { checked: CHECKED },
    );
    expect(r.incidents.map((i) => [i.id, i.impact])).toEqual([['cursor-a', 'none']]);
    expect(r.skipped).toBe(3);
  });

  it('fails when open entries exist but none can be read (a format change, not "all clear")', () => {
    expect(() =>
      normalizeStatusSummary(
        'cursor',
        PAGE,
        summary([{ id: 'x', name: 'Outage', status: 'investigating', impact: 'major' }]),
        { checked: CHECKED },
      ),
    ).toThrow(/could not be read/);
  });

  it('throws on a document that is not a status summary, so the caller keeps the old data', () => {
    const o = { checked: CHECKED };
    expect(() => normalizeStatusSummary('cursor', PAGE, { hello: 'world' }, o)).toThrow();
    expect(() => normalizeStatusSummary('cursor', PAGE, '<html>', o)).toThrow();
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
  const base = { today, windowDays: 45, platforms, models: [], known: new Set<string>() };

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

  it('dates a model by its earliest variant: a new :free listing of an old model is not news', () => {
    const entry = (id: string, name: string, iso: string) => ({ id, name, created: secs(iso) });
    const r = newModelSightings(
      {
        data: [
          // newest first, as OpenRouter lists them
          entry('deepseek/deepseek-r2:free', 'DeepSeek: R2 (free)', '2026-09-20'),
          entry('deepseek/deepseek-r2', 'DeepSeek: R2', '2026-03-01'),
          entry('qwen/qwen4-max:thinking', 'Qwen: Qwen4 Max (thinking)', '2026-09-22'),
          entry('qwen/qwen4-max', 'Qwen: Qwen4 Max', '2026-09-18'),
        ],
      },
      base,
    );
    expect(r.events.map((e) => [e.id, e.date, e.model])).toEqual([
      ['seen-qwen-qwen4-max', '2026-09-18', 'Qwen4 Max'],
    ]);
  });

  it('skips old models, other companies, Gemma, open-weights releases and known or hidden ids', () => {
    const entry = (id: string, name: string, iso: string) => ({ id, name, created: secs(iso) });
    const r = newModelSightings(
      {
        data: [
          entry('openai/gpt-3.5-turbo', 'OpenAI: GPT-3.5 Turbo', '2023-03-01'),
          entry('mistralai/mistral-9', 'Mistral: 9', '2026-09-20'),
          entry('google/gemma-5', 'Google: Gemma 5', '2026-09-20'),
          entry('openai/gpt-oss-300b', 'OpenAI: gpt-oss-300b', '2026-09-20'),
          entry('bytedance-seed/seed-oss-72b', 'ByteDance: Seed OSS', '2026-09-20'),
          entry('bytedance-seed/seed-2.1', 'ByteDance Seed: Seed 2.1', '2026-09-20'),
          entry('google/gemini-4-pro', 'Google: Gemini 4 Pro', '2026-09-21'),
          entry('qwen/qwen4', 'Qwen: Qwen4', '2026-09-01'),
          entry('anthropic/claude-foo', 'Anthropic: Claude Foo', '2026-09-02'),
          { id: 'not a valid id', name: 'x', created: 1 },
        ],
      },
      { ...base, known: new Set(['seen-qwen-qwen4', 'seen-anthropic-claude-foo']) },
    );
    expect(r.events.map((e) => e.id)).toEqual([
      'seen-google-gemini-4-pro',
      'seen-bytedance-seed-seed-2-1',
    ]);
    expect(r.skipped).toBe(1);
    expect(r.total).toBe(10);
  });

  it('leaves models the curated list already has to it — but not their successors', () => {
    const entry = (id: string, name: string, iso: string) => ({ id, name, created: secs(iso) });
    const r = newModelSightings(
      {
        data: [
          entry('anthropic/claude-opus-5', 'Anthropic: Claude Opus 5', '2026-09-22'),
          entry('anthropic/claude-opus-5.1', 'Anthropic: Claude Opus 5.1', '2026-09-23'),
          entry('openai/gpt-6-luna', 'OpenAI: GPT-6 Luna', '2026-09-22'),
        ],
      },
      {
        ...base,
        models: [
          { platform: 'claude', name: 'Claude Opus 5', released: '2026-09-22' },
          { platform: 'chatgpt', name: 'GPT-6 (Sol, Luna)', released: '2026-09-22' },
        ],
      },
    );
    expect(r.events.map((e) => e.id)).toEqual(['seen-anthropic-claude-opus-5-1']);
    expect(r.curated).toEqual([
      { model: 'Claude Opus 5', match: 'Claude Opus 5' },
      { model: 'GPT-6 Luna', match: 'GPT-6 (Sol, Luna)' },
    ]);
  });

  it('throws on a document that is not a model list', () => {
    expect(() => newModelSightings({ models: [] }, base)).toThrow();
  });
});

describe('curatedMatch', () => {
  const day = Date.parse('2026-09-20T00:00:00Z') / 86_400_000;
  const models = [
    { platform: 'claude', name: 'Claude Sonnet 5', released: '2026-09-10' },
    { platform: 'grok', name: 'Grok 5 Mini', released: '2026-09-24' },
  ];

  it('matches the same model word for word, with whole version numbers', () => {
    expect(curatedMatch('grok', 'Grok 5 Mini', day, models)?.name).toBe('Grok 5 Mini');
    expect(curatedMatch('grok', 'grok-5-mini', day, models)?.name).toBe('Grok 5 Mini');
    expect(curatedMatch('claude', 'Claude Sonnet 5.5', day, models)).toBeUndefined();
    expect(curatedMatch('claude', 'Claude Sonnet 5 Mini', day, models)).toBeUndefined();
    expect(curatedMatch('claude', 'Grok 5 Mini', day, models)).toBeUndefined();
    expect(curatedMatch('grok', 'Grok 5 Mini', day + 400, models)).toBeUndefined();
  });

  it('reads names as words and whole versions', () => {
    expect(nameTokens('OpenAI: GPT-5.1 Mini (free)')).toEqual(['gpt', '5.1', 'mini']);
  });
});
