/**
 * Data contracts. Everything in data/manual/*.yaml and public/data/*.json is
 * validated against these schemas — the build refuses to publish anything
 * that fails (see scripts/build-data.ts).
 */
import { z } from 'zod';
import { REGION_IDS } from '../model/traffic';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'expected a lowercase slug');
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'expected #rrggbb');
const httpsUrl = z.url({ protocol: /^https$/ });

/**
 * page: read on the source page · snippet: seen in a search summary of the source ·
 * pending: from reference knowledge, not yet checked (listed in TASKS.md).
 */
export const VerificationSchema = z.enum(['page', 'snippet', 'pending']);

export const SourceSchema = z.object({
  title: z.string().min(3),
  publisher: z.string().min(2),
  url: httpsUrl,
  /** When the source was published (if known). */
  published: isoDate.optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const PROFILES = ['assistant', 'companion', 'search', 'coding', 'api'] as const;
export type Profile = (typeof PROFILES)[number];

export const RegionMixSchema = z
  .object(
    Object.fromEntries(REGION_IDS.map((r) => [r, z.number().min(0).max(1)])) as Record<
      (typeof REGION_IDS)[number],
      z.ZodNumber
    >,
  )
  .refine((m) => Math.abs(Object.values(m).reduce((a, b) => a + b, 0) - 1) < 0.005, {
    message: 'regional shares must sum to 1',
  });

export const FractionRangeSchema = z
  .object({
    value: z.number().min(0).max(0.99),
    low: z.number().min(0).max(0.99),
    high: z.number().min(0).max(0.99),
    note: z.string().min(3),
  })
  .refine((r) => r.low <= r.value && r.value <= r.high, {
    message: 'expected low <= value <= high',
  });

export const ComponentSchema = z.object({
  id: slug,
  label: z.string().min(3),
  profile: z.enum(PROFILES),
  /** Start of this component's curve; defaults to the platform launch date. */
  start: isoDate.optional(),
  /**
   * Share of this component's tokens that are actually served by another
   * listed platform's models (e.g. a coding tool calling a lab's API).
   * Used only to de-duplicate the global total.
   */
  routedShare: FractionRangeSchema,
  /** Optional per-component constant overrides (keys of constants.ts). */
  overrides: z
    .object({
      tokensPerRequest: z.string().optional(),
      requestsPerDau: z.string().optional(),
      /**
       * Platform-calibrated per-user constants (e.g. derived from a day where both
       * tokens and users were published). They replace the generic stickiness ×
       * requests-per-DAU chain and apply only to users metrics of `userWindow`.
       */
      userWindow: z.enum(['daily', 'weekly', 'monthly']).optional(),
      requestsPerUserDay: z.string().optional(),
      tokensPerUserDay: z.string().optional(),
      pricePerMillionTokens: z.string().optional(),
      tokenRevenueShare: z.string().optional(),
      scope: z.string().optional(),
    })
    .strict()
    .refine((o) => !(o.requestsPerUserDay && o.tokensPerUserDay), {
      message: 'use either requestsPerUserDay or tokensPerUserDay, not both',
    })
    .refine((o) => !(o.requestsPerUserDay || o.tokensPerUserDay) || o.userWindow, {
      message: 'per-user overrides need a userWindow',
    })
    .optional(),
});
export type Component = z.infer<typeof ComponentSchema>;

export const ACCELERATORS = [
  'nvidia-ampere',
  'nvidia-hopper',
  'nvidia-blackwell',
  'google-tpu',
  'aws-trainium',
  'huawei-ascend',
  'amd-instinct',
  'mixed',
] as const;

export const PlatformSchema = z.object({
  id: slug,
  name: z.string().min(2).max(60),
  parent: z.string().min(2),
  /** One sentence: exactly which products/APIs this HQ's numbers cover. */
  scope: z.string().min(10),
  profile: z.enum(PROFILES),
  hq: z.object({
    address: z.string().optional(),
    city: z.string().min(2),
    country: z.string().min(2),
    /** Approximate campus location (the 3D island is stylized; this feeds the world map and day/night). */
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    timezone: z.string().regex(/^[A-Za-z_]+\/[A-Za-z_/]+$/),
    source: SourceSchema.optional(),
    verified: VerificationSchema,
    note: z.string().optional(),
  }),
  launch: z.object({
    date: isoDate,
    /** How precise the date is; the UI shows "2023" for year precision. */
    precision: z.enum(['day', 'month', 'year']).default('day'),
    what: z.string().min(3),
    source: SourceSchema,
    verified: VerificationSchema,
    note: z.string().optional(),
  }),
  regionalMix: z.object({
    shares: RegionMixSchema,
    asOf: z.string().min(4),
    basis: z.enum(['published', 'assumption']),
    note: z.string().min(3),
    source: SourceSchema.optional(),
  }),
  components: z.array(ComponentSchema).min(1),
  hardware: z.object({
    accelerator: z.enum(ACCELERATORS),
    note: z.string().min(3),
    sources: z.array(SourceSchema),
  }),
  statusPage: z
    .object({
      url: httpsUrl,
      json: httpsUrl.nullable(),
      rss: httpsUrl.nullable().default(null),
      provider: z.enum(['statuspage.io', 'incident.io', 'other', 'none']),
      /**
       * For a page shared with other services (e.g. githubstatus.com): only notices about these
       * components (their names on the page) belong to this HQ; notices naming none are skipped.
       */
      components: z.array(z.string().min(1)).min(1).optional(),
      verified: VerificationSchema,
      note: z.string().optional(),
    })
    .optional(),
  feeds: z.array(z.object({ url: httpsUrl, type: z.enum(['rss', 'atom', 'html']) })).default([]),
  identity: z.object({
    palette: z.object({ primary: hexColor, secondary: hexColor, accent: hexColor, glow: hexColor }),
    architecture: z.string().min(10),
    motif: z.string().min(3),
  }),
});
export type Platform = z.infer<typeof PlatformSchema>;

export const METRIC_KINDS = ['tokens', 'requests', 'users', 'revenue', 'other'] as const;
export const PERIODS = [
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
] as const;
export const USER_WINDOWS = ['daily', 'weekly', 'monthly'] as const;

export const MetricSchema = z
  .object({
    id: slug,
    platform: slug,
    /** Component this figure anchors; omit for context-only figures (shown, not used in the curve). */
    component: slug.optional(),
    kind: z.enum(METRIC_KINDS),
    /** Human description, e.g. "tokens processed per month". */
    metric: z.string().min(3),
    value: z.number().positive(),
    /** For tokens/requests: the period the value covers. */
    period: z.enum(PERIODS).optional(),
    /** For users: DAU / WAU / MAU. */
    window: z.enum(USER_WINDOWS).optional(),
    /** How the source phrased it — widens the range accordingly. */
    qualifier: z.enum(['exact', 'about', 'over', 'under', 'range']).default('exact'),
    low: z.number().positive().optional(),
    high: z.number().positive().optional(),
    /** Date the figure describes. */
    asOf: isoDate,
    scope: z.string().min(3),
    quote: z.string().min(3),
    sourceKind: z.enum(['primary', 'third-party']),
    source: SourceSchema,
    accessed: isoDate,
    verified: z.enum(['page', 'snippet']),
    note: z.string().optional(),
  })
  .superRefine((m, ctx) => {
    if ((m.kind === 'tokens' || m.kind === 'requests') && !m.period)
      ctx.addIssue({ code: 'custom', message: `${m.id}: ${m.kind} metrics need a period` });
    if (m.kind === 'users' && !m.window)
      ctx.addIssue({ code: 'custom', message: `${m.id}: users metrics need a window` });
    if (m.kind === 'revenue' && m.period !== 'year')
      ctx.addIssue({
        code: 'custom',
        message: `${m.id}: revenue metrics must be annualized (period: year)`,
      });
    if (m.qualifier === 'range' && (m.low === undefined || m.high === undefined))
      ctx.addIssue({ code: 'custom', message: `${m.id}: qualifier "range" needs low and high` });
    if (m.low !== undefined && m.low > m.value)
      ctx.addIssue({ code: 'custom', message: `${m.id}: low must be <= value` });
    if (m.high !== undefined && m.high < m.value)
      ctx.addIssue({ code: 'custom', message: `${m.id}: high must be >= value` });
    if (m.component && m.kind === 'other')
      ctx.addIssue({
        code: 'custom',
        message: `${m.id}: "other" metrics cannot anchor a component`,
      });
  });
export type Metric = z.infer<typeof MetricSchema>;

export const MODALITIES = ['text', 'image', 'audio', 'video', 'pdf', 'code'] as const;

export const ModelSchema = z.object({
  id: slug,
  platform: slug,
  name: z.string().min(1),
  released: isoDate,
  contextWindowTokens: z.number().int().positive().nullable(),
  modalities: z.array(z.enum(MODALITIES)).min(1),
  flagship: z.boolean(),
  /** own = built by the platform's company; offered = another company's model made available here. */
  origin: z.enum(['own', 'offered']),
  /** The company that built the model. Required for offered models (own models are the platform's parent). */
  maker: z.string().min(2).optional(),
  /** primary = the maker's own publication (blog, docs, repository); third-party = anyone else. */
  sourceKind: z.enum(['primary', 'third-party']),
  /** How precise `released` is; month precision is shown as YYYY-MM. */
  datePrecision: z.enum(['day', 'month']).default('day'),
  /**
   * release = the maker's launch/availability date; first-seen = the earliest date the model was seen
   * on some surface (a repository commit, another product adding it) when no launch date was reached.
   */
  dateKind: z.enum(['release', 'first-seen']).default('release'),
  source: SourceSchema,
  verified: VerificationSchema,
  note: z.string().optional(),
});
export type Model = z.infer<typeof ModelSchema>;

export const PlatformsFileSchema = z.array(PlatformSchema).length(15);
export const MetricsFileSchema = z.array(MetricSchema).min(1);
export const ModelsFileSchema = z.array(ModelSchema).min(1);

// ---------------------------------------------------------------------------
// Published-only files (written by scripts, read by the client)
// ---------------------------------------------------------------------------

export const EventSchema = z.object({
  id: z.string().min(3),
  date: isoDate,
  platform: slug,
  kind: z.enum(['model-launch', 'model-available']),
  title: z.string().min(3),
  /** Month-precision dates are shown as YYYY-MM and get no launch-day animation. */
  datePrecision: z.enum(['day', 'month']).default('day'),
  /** first-seen: the day the model was first seen somewhere, not its launch (no celebration). */
  dateKind: z.enum(['release', 'first-seen']).default('release'),
  source: SourceSchema,
});
export type TimelineEvent = z.infer<typeof EventSchema>;

export const IncidentSchema = z.object({
  id: z.string().min(3),
  platform: slug,
  /** Status-page impact, normalized. */
  impact: z.enum(['none', 'minor', 'major', 'critical', 'maintenance']),
  title: z.string().min(3),
  started: z.string().min(10),
  resolved: z.string().min(10).nullable(),
  url: httpsUrl,
  /** The page's own status for it: a "monitoring" incident has a fix in place. */
  status: z.enum(['investigating', 'identified', 'monitoring', 'maintenance']).optional(),
  /**
   * When the pipeline last read this notice on the page (ISO time). The site shows a notice only
   * while this is recent: a page that stops answering cannot leave it up.
   */
  checked: z.string().min(10).optional(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const MetaSchema = z.object({
  schemaVersion: z.literal(1),
  lastUpdated: z.string().min(10),
  contentHash: z.string().min(8),
  counts: z.object({ platforms: z.number(), metrics: z.number(), models: z.number() }),
  pendingConstants: z.array(z.string()),
});
export type Meta = z.infer<typeof MetaSchema>;
