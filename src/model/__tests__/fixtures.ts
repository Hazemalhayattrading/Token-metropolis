import { MetricSchema, PlatformSchema, type Metric, type Platform } from '../../data/schema';

const src = { title: 'Test source', publisher: 'Test', url: 'https://example.com/source' };

export function platform(overrides: Partial<Platform> = {}): Platform {
  return PlatformSchema.parse({
    id: 'testbot',
    name: 'TestBot',
    parent: 'Test Corp',
    scope: 'TestBot consumer app and API',
    profile: 'assistant',
    hq: {
      city: 'Testville',
      country: 'Nowhere',
      lat: 10,
      lon: 20,
      timezone: 'Etc/UTC',
      verified: 'pending',
    },
    launch: { date: '2023-01-01', what: 'Public launch', source: src, verified: 'page' },
    regionalMix: {
      shares: {
        northAmerica: 0.4,
        latinAmerica: 0.1,
        europeAfrica: 0.2,
        southAsiaMiddleEast: 0.1,
        eastAsiaPacific: 0.2,
      },
      asOf: '2026-08',
      basis: 'assumption',
      note: 'test',
    },
    components: [
      {
        id: 'app',
        label: 'Consumer app',
        profile: 'assistant',
        routedShare: { value: 0, low: 0, high: 0, note: 'own models' },
      },
      {
        id: 'api',
        label: 'API',
        profile: 'coding',
        routedShare: { value: 0.3, low: 0.2, high: 0.5, note: 'test' },
      },
    ],
    hardware: { accelerator: 'nvidia-hopper', note: 'test', sources: [] },
    identity: {
      palette: { primary: '#112233', secondary: '#223344', accent: '#334455', glow: '#445566' },
      architecture: 'A test tower of glass',
      motif: 'test',
    },
    ...overrides,
  });
}

export function metric(
  m: Partial<Metric> & Pick<Metric, 'id' | 'kind' | 'value' | 'asOf'>,
): Metric {
  return MetricSchema.parse({
    platform: 'testbot',
    metric: 'test metric',
    scope: 'test',
    quote: 'test quote',
    sourceKind: 'primary',
    source: src,
    accessed: '2026-09-25',
    verified: 'page',
    ...m,
  });
}
