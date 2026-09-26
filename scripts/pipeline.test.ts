import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Platform } from '../src/data/schema';
import { platform } from '../src/model/__tests__/fixtures';
import { OPENROUTER_MODELS, runUpdate, type Level, type UpdateEnv } from './pipeline';

// Hand-made platforms, so the test never depends on the editable curated data.
const statusPage = (id: string, extra: Partial<NonNullable<Platform['statusPage']>> = {}) => ({
  url: `https://status.${id}.test`,
  json: `https://status.${id}.test/api/v2/summary.json`,
  rss: null,
  provider: 'statuspage.io' as const,
  verified: 'page' as const,
  ...extra,
});
const platforms: Platform[] = [
  platform({ id: 'claude', name: 'Claude', statusPage: statusPage('claude') }),
  platform({ id: 'cursor', name: 'Cursor', statusPage: statusPage('cursor') }),
  platform({
    id: 'grok',
    name: 'Grok',
    statusPage: statusPage('grok', {
      json: null,
      rss: 'https://status.grok.test/feed.xml',
      provider: 'other',
    }),
  }),
  platform({
    id: 'github-copilot',
    name: 'GitHub Copilot',
    statusPage: statusPage('github', { components: ['Copilot'] }),
  }),
];
const data = { platforms, models: [], hidden: new Set<string>() };
const feed = (id: string) => `https://status.${id}.test/api/v2/summary.json`;

const NOW = Date.parse('2026-09-26T12:17:00Z');
const emptySummary = { incidents: [], scheduled_maintenances: [] };
const openIncident = {
  id: 'inc1',
  name: 'Elevated errors on Claude.ai',
  status: 'investigating',
  impact: 'major',
  created_at: '2026-09-26T10:00:00Z',
  shortlink: 'https://stspg.io/inc1',
};
const models = {
  data: [{ id: 'x-ai/grok-9', name: 'xAI: Grok 9', created: (NOW - 3 * 86_400_000) / 1000 }],
};

let dir = '';
let notes: [Level, string][] = [];
function env(responses: Record<string, unknown>, extra: Partial<UpdateEnv> = {}): UpdateEnv {
  return {
    fetchJson: async (url) => {
      const r = responses[url];
      if (r instanceof Error) throw r;
      return r === undefined ? emptySummary : r;
    },
    nowMs: NOW,
    incidentsFile: join(dir, 'incidents.json'),
    sightingsFile: join(dir, 'auto', 'sightings.json'),
    dryRun: false,
    note: (level, message) => notes.push([level, message]),
    ...extra,
  };
}
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown[];
const ids = (list: unknown[]) => list.map((i) => (i as { id: string }).id);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tm-pipeline-'));
  notes = [];
});

function old(id: string, platformId: string) {
  return {
    id,
    platform: platformId,
    impact: 'minor',
    title: 'Something happened',
    started: '2026-09-26T09:00:00Z',
    resolved: null,
    url: 'https://status.example.com',
    checked: '2026-09-26T11:17:00.000Z',
  };
}

describe('runUpdate', () => {
  it('publishes open notices (with the time they were read) and new sightings, then settles', async () => {
    const responses = {
      [feed('claude')]: { incidents: [openIncident], scheduled_maintenances: [] },
      [OPENROUTER_MODELS]: models,
    };
    const first = await runUpdate(data, env(responses));
    expect(first).toMatchObject({ incidentsChanged: true, sightingsChanged: true, failed: [] });
    expect(read('incidents.json')).toEqual([
      expect.objectContaining({
        id: 'claude-inc1',
        platform: 'claude',
        impact: 'major',
        status: 'investigating',
        url: 'https://stspg.io/inc1',
        checked: '2026-09-26T12:17:00.000Z',
      }),
    ]);
    expect(read('auto/sightings.json')).toEqual([
      expect.objectContaining({ id: 'seen-x-ai-grok-9', platform: 'grok', model: 'Grok 9' }),
    ]);
    // Grok's page publishes RSS only: noted, never guessed from.
    expect(notes.some(([, m]) => m.startsWith('Grok: no JSON status feed'))).toBe(true);

    const second = await runUpdate(data, env(responses));
    expect(second).toMatchObject({ incidentsChanged: false, sightingsChanged: false });
  });

  it('keeps the previous notices of a page that fails, and clears those of a page that answers', async () => {
    writeFileSync(
      join(dir, 'incidents.json'),
      JSON.stringify([old('claude-old', 'claude'), old('cursor-old', 'cursor')]),
    );
    const r = await runUpdate(data, env({ [feed('claude')]: new Error('HTTP 503') }));
    expect(r.failed).toEqual(['claude']);
    // Kept as it was, old `checked` time included: the site stops showing it once that is stale.
    expect(read('incidents.json')).toEqual([old('claude-old', 'claude')]);
    expect(notes).toContainEqual([
      'warn',
      expect.stringContaining('Claude: status page unavailable (HTTP 503)'),
    ]);
  });

  it('treats a page that answers with something else, or unreadable notices, as unavailable', async () => {
    writeFileSync(join(dir, 'incidents.json'), JSON.stringify([old('cursor-old', 'cursor')]));
    const r = await runUpdate(
      data,
      env({
        [feed('cursor')]: '<html>maintenance</html>',
        [feed('claude')]: { incidents: [{ id: 'x', name: 'Outage', status: 'identified' }] },
      }),
    );
    expect(r.failed).toEqual(['claude', 'cursor']);
    expect(ids(read('incidents.json'))).toEqual(['cursor-old']);
  });

  it('shows only the Copilot notices of the shared GitHub page', async () => {
    const component = (name: string) => [{ id: name, name, status: 'partial_outage' }];
    await runUpdate(
      data,
      env({
        [feed('github')]: {
          incidents: [
            {
              ...openIncident,
              id: 'gh1',
              name: 'Incident with Actions',
              components: component('Actions'),
            },
            {
              ...openIncident,
              id: 'gh2',
              name: 'Incident with Copilot',
              components: component('Copilot'),
            },
          ],
        },
      }),
    );
    expect(ids(read('incidents.json'))).toEqual(['github-copilot-gh2']);
  });

  it('never writes when the model list is unusable, and keeps earlier sightings', async () => {
    const sightings = join(dir, 'auto', 'sightings.json');
    await runUpdate(data, env({ [OPENROUTER_MODELS]: models }));
    const before = readFileSync(sightings, 'utf8');
    const garbage = { data: Array.from({ length: 10 }, (_, i) => ({ id: `bad ${i}` })) };
    for (const response of [{ error: 'rate limited' }, garbage]) {
      const r = await runUpdate(data, env({ [OPENROUTER_MODELS]: response }));
      expect(r.sightingsChanged).toBe(false);
      expect(readFileSync(sightings, 'utf8')).toBe(before);
    }
    const unavailable = notes.filter(
      ([l, m]) => l === 'warn' && m.includes('OpenRouter models list unavailable'),
    );
    expect(unavailable).toHaveLength(2);
  });

  it('does not add a sighting the owner hid', async () => {
    const r = await runUpdate(
      { ...data, hidden: new Set(['seen-x-ai-grok-9']) },
      env({ [OPENROUTER_MODELS]: models }),
    );
    expect(r.sightingsChanged).toBe(true); // the file is created, empty
    expect(read('auto/sightings.json')).toEqual([]);
  });

  it('refuses to touch a sightings file that does not validate or is not JSON', async () => {
    const sightings = join(dir, 'auto', 'sightings.json');
    mkdirSync(join(dir, 'auto'));
    for (const text of ['[{"id": 1}]', '[{"id": "a"},]']) {
      writeFileSync(sightings, text);
      notes = [];
      const r = await runUpdate(data, env({ [OPENROUTER_MODELS]: models }));
      expect(r.sightingsChanged).toBe(false);
      expect(readFileSync(sightings, 'utf8')).toBe(text);
      expect(notes.some(([level]) => level === 'error')).toBe(true);
    }
  });

  it('rebuilds an incidents file that does not validate or is not JSON', async () => {
    for (const text of ['{"not": "a list"}', '[{"id": "x"},]']) {
      writeFileSync(join(dir, 'incidents.json'), text);
      const r = await runUpdate(data, env({}));
      expect(r.incidentsChanged).toBe(true);
      expect(read('incidents.json')).toEqual([]);
    }
  });

  it('writes nothing in a dry run', async () => {
    const r = await runUpdate(data, env({ [OPENROUTER_MODELS]: models }, { dryRun: true }));
    expect(r.sightingsChanged).toBe(true);
    expect(existsSync(join(dir, 'auto', 'sightings.json'))).toBe(false);
    expect(existsSync(join(dir, 'incidents.json'))).toBe(false);
  });
});
