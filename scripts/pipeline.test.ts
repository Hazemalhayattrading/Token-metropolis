import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { validateDataset } from '../src/data/validate';
import { readYaml } from './lib';
import { OPENROUTER_MODELS, runUpdate, type Level, type UpdateEnv } from './pipeline';

const result = validateDataset(
  {
    platforms: readYaml('platforms.yaml'),
    metrics: readYaml('metrics.yaml'),
    models: readYaml('models.yaml'),
  },
  { expectedPlatforms: 15 },
);
if (!result.ok) throw new Error(result.errors.join('\n'));
const data = result.data;
const byId = new Map(data.platforms.map((p) => [p.id, p]));
const feedOf = (id: string) => byId.get(id)!.statusPage!.json!;

const NOW = Date.parse('2026-09-26T12:00:00Z');
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
      if (r === undefined) return emptySummary;
      return r;
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tm-pipeline-'));
  notes = [];
});

describe('runUpdate', () => {
  it('publishes open notices and new sightings, then reports no change on a repeat run', async () => {
    const responses = {
      [feedOf('claude')]: { incidents: [openIncident], scheduled_maintenances: [] },
      [OPENROUTER_MODELS]: models,
    };
    const first = await runUpdate(data, env(responses));
    expect(first).toMatchObject({ incidentsChanged: true, sightingsChanged: true, failed: [] });
    expect(read('incidents.json')).toMatchObject([
      { id: 'claude-inc1', platform: 'claude', impact: 'major', url: 'https://stspg.io/inc1' },
    ]);
    expect(read('auto/sightings.json')).toMatchObject([
      { id: 'seen-x-ai-grok-9', platform: 'grok', dateKind: 'first-seen', model: 'Grok 9' },
    ]);
    // Grok's status page publishes RSS only: noted, never guessed from.
    expect(notes.some(([, m]) => m.startsWith('Grok: no JSON status feed'))).toBe(true);

    const second = await runUpdate(data, env(responses));
    expect(second).toMatchObject({ incidentsChanged: false, sightingsChanged: false });
  });

  it('keeps the previous notices of a page that fails, and clears those of a page that answers', async () => {
    writeFileSync(
      join(dir, 'incidents.json'),
      JSON.stringify([{ ...base('claude-old', 'claude') }, { ...base('chatgpt-old', 'chatgpt') }]),
    );
    const r = await runUpdate(
      data,
      env({ [feedOf('claude')]: new Error('HTTP 503'), [OPENROUTER_MODELS]: { data: [] } }),
    );
    expect(r.failed).toEqual(['claude']);
    expect(read('incidents.json').map((i) => (i as { id: string }).id)).toEqual(['claude-old']);
    expect(notes).toContainEqual([
      'warn',
      expect.stringContaining('Claude: status page unavailable (HTTP 503)'),
    ]);
  });

  it('treats a page that answers with something else as unavailable', async () => {
    writeFileSync(join(dir, 'incidents.json'), JSON.stringify([base('cursor-old', 'cursor')]));
    const r = await runUpdate(data, env({ [feedOf('cursor')]: '<html>maintenance</html>' }));
    expect(r.failed).toEqual(['cursor']);
    expect(read('incidents.json')).toHaveLength(1);
  });

  it('never writes when the model list is unusable, and keeps earlier sightings', async () => {
    const sightings = join(dir, 'auto', 'sightings.json');
    await runUpdate(data, env({ [OPENROUTER_MODELS]: models }));
    const before = readFileSync(sightings, 'utf8');
    const r = await runUpdate(data, env({ [OPENROUTER_MODELS]: { error: 'rate limited' } }));
    expect(r.sightingsChanged).toBe(false);
    expect(readFileSync(sightings, 'utf8')).toBe(before);
    expect(notes).toContainEqual([
      'warn',
      expect.stringContaining('OpenRouter models list unavailable'),
    ]);
  });

  it('refuses to touch a sightings file that does not validate', async () => {
    const sightings = join(dir, 'auto', 'sightings.json');
    mkdirSync(join(dir, 'auto'));
    writeFileSync(sightings, '[{"id": 1}]');
    const r = await runUpdate(data, env({ [OPENROUTER_MODELS]: models }));
    expect(r.sightingsChanged).toBe(false);
    expect(readFileSync(sightings, 'utf8')).toBe('[{"id": 1}]');
    expect(notes.some(([level]) => level === 'error')).toBe(true);
  });

  it('rebuilds an incidents file that does not validate', async () => {
    writeFileSync(join(dir, 'incidents.json'), '{"not": "a list"}');
    const r = await runUpdate(data, env({}));
    expect(r.incidentsChanged).toBe(true);
    expect(read('incidents.json')).toEqual([]);
  });

  it('writes nothing in a dry run', async () => {
    const r = await runUpdate(data, env({ [OPENROUTER_MODELS]: models }, { dryRun: true }));
    expect(r.sightingsChanged).toBe(true);
    expect(existsSync(join(dir, 'auto', 'sightings.json'))).toBe(false);
    expect(existsSync(join(dir, 'incidents.json'))).toBe(false);
  });
});

function base(id: string, platform: string) {
  return {
    id,
    platform,
    impact: 'minor',
    title: 'Something happened',
    started: '2026-09-26T09:00:00Z',
    resolved: null,
    url: 'https://status.example.com',
  };
}
