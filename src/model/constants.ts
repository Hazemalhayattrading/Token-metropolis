/**
 * Every constant and assumption in the model, in one place.
 * Each entry: { value, low, high, unit, basis, source, accessed, verified, note }.
 *
 * basis:     exact (definition) · published (sourced figure) · assumption (our judgement → "Modeled")
 * verified:  page · snippet (search summary only) · judgement (nothing external to check) · pending
 * low/high:  read as a ~90% plausible interval. See METHODOLOGY.md.
 *
 * Research log: all sources accessed 2026-09-25 unless `accessed` is null.
 */
import type { Basis, Constant, SourceRef, Verification } from './types';

const ACCESSED = '2026-09-25';

// Literal logarithms (Math.log may differ in the last bit between JS engines; see detmath.ts).
const LN2 = 0.6931471805599453;
const LN10 = 2.302585092994046;

interface Def {
  value: number;
  low: number;
  high: number;
  unit: string;
  basis: Basis;
  verified: Verification;
  source: readonly SourceRef[];
  note: string;
}

function c(d: Def): Constant {
  if (!(d.low <= d.value && d.value <= d.high))
    throw new RangeError(`constant out of order: ${d.note}`);
  if (d.verified !== 'judgement' && d.source.length === 0)
    throw new RangeError(`constant needs a source unless it is a judgement: ${d.note}`);
  // A judgement may cite context sources; those were accessed during research.
  const accessed = d.verified === 'pending' || d.source.length === 0 ? null : ACCESSED;
  return { ...d, accessed };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------
const S = {
  deepseekInference: {
    title: 'DeepSeek — Day 6: One More Thing, DeepSeek-V3/R1 Inference System Overview',
    url: 'https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md',
  },
  inferenceXIssue: {
    title: 'SemiAnalysis InferenceX issue #293 — token throughput per MW counts input + output',
    url: 'https://github.com/SemiAnalysisAI/InferenceX/issues/293',
  },
  mlperfDeepseekR1: {
    title: 'MLCommons inference reference — DeepSeek-R1',
    url: 'https://github.com/mlcommons/inference/tree/master/language/deepseek-r1',
  },
  coreweaveMlperf5: {
    title: 'CoreWeave — MLPerf Inference v5.0 results (GB200, H200)',
    url: 'https://www.coreweave.com/blog/coreweave-delivers-breakthrough-ai-performance-with-nvidia-gb200-and-h200-gpus-in-mlperf-inference-v5-0',
  },
  mlperf6: {
    title: 'MLPerf Inference v6.0 benchmark results (Spheron summary)',
    url: 'https://www.spheron.network/blog/mlperf-inference-v6-benchmark-results-2026/',
  },
  dgxH100: {
    title: 'NVIDIA DGX H100 user guide — system specifications',
    url: 'https://docs.nvidia.com/dgx/dgxh100-user-guide/introduction-to-dgxh100.html',
  },
  hpeGb200: {
    title: 'HPE — NVIDIA GB200 NVL72 by HPE (rack power)',
    url: 'https://buy.hpe.com/my/en/options/server-accelerators/nvidia-ai-accelerated-computing/nvidia-ai-accelerated-computing/nvidia-gb200-nvl72-by-hpe/p/1014890104',
  },
  googleInferencePaper: {
    title: 'Measuring the environmental impact of delivering AI at Google scale (arXiv 2508.15734)',
    url: 'https://arxiv.org/abs/2508.15734',
  },
  googleInferenceBlog: {
    title: 'Google Cloud — Measuring the environmental impact of AI inference (Aug 2025)',
    url: 'https://cloud.google.com/blog/products/infrastructure/measuring-the-environmental-impact-of-ai-inference',
  },
  lbnl2024: {
    title: 'LBNL — 2024 United States Data Center Energy Usage Report',
    url: 'https://eta-publications.lbl.gov/sites/default/files/2024-12/lbnl-2024-united-states-data-center-energy-usage-report_1.pdf',
  },
  google2026Env: {
    title: 'Google — 2026 Environmental Report',
    url: 'https://sustainability.google/google-2026-environmental-report/',
  },
  uptime2026: {
    title: 'Uptime Institute — Global Data Center Survey 2026',
    url: 'https://intelligence.uptimeinstitute.com/resource/uptime-institute-global-data-center-survey-2026',
  },
  aws2024: {
    title: 'Amazon — 2024 Sustainability Report, AWS summary',
    url: 'https://sustainability.aboutamazon.com/2024-amazon-sustainability-report-aws-summary.pdf',
  },
  microsoftDc: {
    title: 'Microsoft — Measuring energy and water efficiency for Microsoft datacenters',
    url: 'https://datacenters.microsoft.com/sustainability/efficiency/',
  },
  altman: {
    title: 'Sam Altman — The Gentle Singularity (June 2025)',
    url: 'https://blog.samaltman.com/the-gentle-singularity',
  },
  claudePricing: {
    title: 'Anthropic — Claude platform docs: Pricing',
    url: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
  tiktoken: {
    title: 'OpenAI — tiktoken README',
    url: 'https://raw.githubusercontent.com/openai/tiktoken/main/README.md',
  },
  openrouterStateOfAi: {
    title: 'OpenRouter × a16z — State of AI: an empirical 100 trillion token study (Dec 2025)',
    url: 'https://openrouter.ai/state-of-ai',
  },
  lmsys: {
    title: 'Zheng et al. — LMSYS-Chat-1M (ICLR 2024)',
    url: 'https://proceedings.iclr.cc/paper_files/paper/2024/file/5f9bfdfe3685e4ccdbc0e7fb29cccf2a-Paper-Conference.pdf',
  },
  wildchat: {
    title: 'Zhao et al. — WildChat: 1M ChatGPT interaction logs in the wild (ICLR 2024)',
    url: 'https://proceedings.iclr.cc/paper_files/paper/2024/file/9421261e06f1a63a352b068f1ac90609-Paper-Conference.pdf',
  },
  claudeCodeCosts: {
    title: 'Anthropic — Claude Code docs: Manage costs effectively',
    url: 'https://code.claude.com/docs/en/costs',
  },
  nberChatgpt: {
    title: 'Chatterji et al. — How People Use ChatGPT (NBER working paper w34255, Sept 2025)',
    url: 'https://www.nber.org/system/files/working_papers/w34255/w34255.pdf',
  },
  questmobileFeb2025: {
    title: 'QuestMobile via 199IT — China AI-native app MAU passes 240M (Feb 2025), DeepSeek #1',
    url: 'https://www.199it.com/archives/1750849.html',
  },
  characterAiInference: {
    title: 'Character.AI — Optimizing AI inference at Character.AI (June 2024)',
    url: 'https://blog.character.ai/optimizing-ai-inference-at-character-ai/',
  },
  demandsageCharacterAi: {
    title: 'DemandSage — Character AI statistics',
    url: 'https://www.demandsage.com/character-ai-statistics/',
  },
  msftFy25q4: {
    title: 'Microsoft FY25 Q4 earnings',
    url: 'https://www.microsoft.com/en-us/investor/events/fy-2025/earnings-fy-2025-q4',
  },
  msftFy26q1: {
    title: 'Microsoft FY26 Q1 earnings',
    url: 'https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q1',
  },
  eiaHousehold: {
    title: 'U.S. EIA — FAQ: How much electricity does an American home use?',
    url: 'https://www.eia.gov/tools/faqs/faq.php?id=97&t=3',
  },
  locGeneral: {
    title: 'Library of Congress — General information',
    url: 'https://www.loc.gov/about/general-information/',
  },
  wikipediaSize: {
    title: 'Wikipedia — Size of Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Wikipedia:Size_of_Wikipedia',
  },
  mehl2007: {
    title: 'Mehl et al. (2007) — Are women really more talkative than men? Science 317:82',
    url: 'https://www.science.org/doi/10.1126/science.1139940',
  },
  unWpp: {
    title: 'United Nations — World Population Prospects 2024',
    url: 'https://population.un.org/wpp/',
  },
} as const satisfies Record<string, SourceRef>;

// ---------------------------------------------------------------------------
// Compute → power → water
// ---------------------------------------------------------------------------
export const COMPUTE = {
  throughputTokensPerSecPerGpu: c({
    value: 5000,
    low: 1500,
    high: 15000,
    unit: 'tokens/s per deployed H100-class GPU (input incl. cache hits + output, 24 h production average)',
    basis: 'assumption',
    verified: 'page',
    source: [S.deepseekInference, S.inferenceXIssue, S.coreweaveMlperf5, S.mlperf6],
    note: 'The biggest uncertainty in the model. DeepSeek disclosed 608B input + 168B output tokens in 24 h on an average of 226.75 nodes × 8 H800 GPUs ≈ 4,950 tokens/s per deployed GPU — the only real-traffic figure published. Larger dense models run lower; Blackwell-class hardware and cache-heavy traffic run several times higher (MLPerf, InferenceMAX).',
  }),
  kwPerGpu: c({
    value: 1.0,
    low: 0.6,
    high: 1.5,
    unit: 'kW average IT power per deployed accelerator, incl. host CPU/memory/network share (excl. PUE)',
    basis: 'assumption',
    verified: 'snippet',
    source: [S.dgxH100, S.hpeGb200, S.googleInferencePaper, S.lbnl2024],
    note: 'Nameplate maxima: DGX H100 10.2 kW / 8 GPUs = 1.28 kW; GB200 NVL72 120–132 kW / 72 = 1.7–1.8 kW. Servers rarely draw rated power (LBNL); Google measured host CPU/DRAM at ~25% and idle capacity at ~10% of AI serving energy.',
  }),
  pue: c({
    value: 1.2,
    low: 1.09,
    high: 1.5,
    unit: 'power usage effectiveness (facility energy ÷ IT energy)',
    basis: 'published',
    verified: 'snippet',
    source: [S.google2026Env, S.aws2024, S.microsoftDc, S.uptime2026],
    note: 'Google 1.09 (2025), AWS 1.15 (2024), Microsoft 1.16 (FY24); the Uptime Institute 2026 survey average is 1.52. Most AI tokens are served from hyperscale halls, so the central value is weighted towards them.',
  }),
  wueLitersPerKwh: c({
    value: 0.4,
    low: 0.15,
    high: 1.1,
    unit: 'litres of on-site water per kWh',
    basis: 'published',
    verified: 'snippet',
    source: [S.aws2024, S.microsoftDc, S.lbnl2024, S.googleInferenceBlog],
    note: 'On-site cooling water only (excludes water used to generate the electricity). AWS 0.15 (2024), Microsoft 0.30 (FY24), US average ~0.36 (LBNL, 2023); Google’s per-prompt figures imply ~1.08 L/kWh (0.26 mL ÷ 0.24 Wh).',
  }),
} as const;

// ---------------------------------------------------------------------------
// Published per-prompt figures the model is tested against (METHODOLOGY §6)
// ---------------------------------------------------------------------------
export const CROSSCHECK = {
  geminiMedianPromptWh: c({
    value: 0.24,
    low: 0.24,
    high: 0.24,
    unit: 'Wh per median Gemini Apps text prompt',
    basis: 'published',
    verified: 'page',
    source: [S.googleInferenceBlog],
    note: 'Google’s comprehensive method: active accelerators, host CPU/RAM, idle machines and PUE.',
  }),
  geminiMedianPromptWaterMl: c({
    value: 0.26,
    low: 0.26,
    high: 0.26,
    unit: 'mL on-site water per median Gemini Apps text prompt',
    basis: 'published',
    verified: 'page',
    source: [S.googleInferenceBlog],
    note: '“About five drops of water.”',
  }),
  chatgptAverageQueryWh: c({
    value: 0.34,
    low: 0.34,
    high: 0.34,
    unit: 'Wh per average ChatGPT query',
    basis: 'published',
    verified: 'snippet',
    source: [S.altman],
    note: 'Stated by OpenAI’s CEO without a methodology.',
  }),
} as const;

// ---------------------------------------------------------------------------
// Usage behaviour by profile (converting users / requests / revenue into tokens)
// ---------------------------------------------------------------------------
const judgement = (
  value: number,
  low: number,
  high: number,
  unit: string,
  note: string,
  source: readonly SourceRef[] = [],
): Constant =>
  c({ value, low, high, unit, basis: 'assumption', verified: 'judgement', source, note });

export const USAGE = {
  // Stickiness — no public benchmark was found for AI apps; these are judgement calls.
  dauPerWau_assistant: judgement(
    0.45,
    0.3,
    0.6,
    'DAU ÷ WAU',
    'Share of weekly users active on a given day (consumer assistants).',
  ),
  dauPerMau_assistant: judgement(
    0.25,
    0.12,
    0.4,
    'DAU ÷ MAU',
    'Share of monthly users active on a given day (consumer assistants).',
  ),
  dauPerWau_companion: judgement(
    0.55,
    0.4,
    0.7,
    'DAU ÷ WAU',
    'Companion chat is a strongly habitual daily activity.',
  ),
  dauPerMau_companion: judgement(
    0.35,
    0.2,
    0.5,
    'DAU ÷ MAU',
    'Companion chat is a strongly habitual daily activity.',
  ),
  dauPerWau_search: judgement(
    0.4,
    0.25,
    0.55,
    'DAU ÷ WAU',
    'Answer engines are used several days a week.',
  ),
  dauPerMau_search: judgement(
    0.2,
    0.1,
    0.35,
    'DAU ÷ MAU',
    'Answer engines are used several days a week.',
  ),
  dauPerWau_coding: judgement(
    0.5,
    0.35,
    0.65,
    'DAU ÷ WAU',
    'Coding assistants are used on workdays; many registered users are occasional.',
  ),
  dauPerMau_coding: judgement(
    0.3,
    0.15,
    0.5,
    'DAU ÷ MAU',
    'Coding assistants are used on workdays; many registered users are occasional.',
  ),

  requestsPerDau_assistant: judgement(
    8,
    4,
    16,
    'requests per daily active user',
    'Messages an active user sends per day. With DAU/WAU 0.45 this gives 3.6 messages per weekly user per day — consistent with OpenAI’s published ~18B messages a week from ~700M weekly users (3.7 per day, July 2025).',
    [S.nberChatgpt],
  ),
  requestsPerDau_embedded: judgement(
    3,
    1,
    8,
    'requests per daily active user',
    'Assistants embedded in messaging and social apps are used in short bursts.',
  ),
  requestsPerDau_companion: judgement(
    60,
    20,
    150,
    'requests per daily active user',
    'Role-play sessions run to dozens of turns.',
  ),
  requestsPerDau_search: judgement(
    5,
    2,
    12,
    'requests per daily active user',
    'Questions per active day in an answer engine.',
  ),
  requestsPerDau_coding: judgement(
    150,
    50,
    400,
    'requests per daily active user',
    'Inline completions plus chat and agent steps in an IDE assistant.',
  ),

  tokensPerRequest_assistant: c({
    value: 2000,
    low: 800,
    high: 6000,
    unit: 'tokens per request (input incl. system prompt + history, output, reasoning)',
    basis: 'assumption',
    verified: 'snippet',
    source: [S.lmsys, S.wildchat, S.claudePricing],
    note: 'Raw user prompts are ~70–300 tokens and replies ~200–500 (LMSYS, WildChat), but apps resend system prompts, memory and history each turn and reasoning adds hidden tokens; Anthropic’s own support-chat example is ~3,700 tokens per conversation.',
  }),
  tokensPerRequest_companion: judgement(
    3000,
    1500,
    8000,
    'tokens per request',
    'Long persona prompts and chat history are resent every turn.',
  ),
  tokensPerRequest_search: c({
    value: 8000,
    low: 3000,
    high: 20000,
    unit: 'tokens per request',
    basis: 'assumption',
    verified: 'page',
    source: [S.claudePricing],
    note: 'Retrieved pages go into the context: an average web page is ~2,500 tokens (Anthropic docs), and an answer typically reads several.',
  }),
  tokensPerRequest_coding: judgement(
    4000,
    1500,
    12000,
    'tokens per request (blend of inline completions and agent/chat calls)',
    'Inline completions carry a few thousand tokens of surrounding code; agent and chat calls are far larger (OpenRouter reports programming prompts 3–4× longer than the >6k average) but rarer.',
    [S.openrouterStateOfAi],
  ),
  tokensPerRequest_api: c({
    value: 6000,
    low: 3000,
    high: 12000,
    unit: 'tokens per API request (prompt + completion)',
    basis: 'published',
    verified: 'snippet',
    source: [S.openrouterStateOfAi],
    note: 'Average prompt grew from ~1.5k to over 6k tokens, completions from ~150 to ~400 (late 2025).',
  }),

  // Platform-calibrated constants: derived from a moment when both tokens and users were published.
  tokensPerMauDay_deepseek: c({
    value: 4000,
    low: 2960,
    high: 5400,
    unit: 'tokens per China monthly active user per day (DeepSeek, all traffic)',
    basis: 'published',
    verified: 'snippet',
    source: [S.deepseekInference, S.questmobileFeb2025],
    note: 'DeepSeek’s published production day (608B input + 168B output = 776B tokens, 27–28 Feb 2025) divided by QuestMobile’s 194M China MAU for February 2025. Captures international and API traffic per China user; the range carries the third-party MAU uncertainty.',
  }),
  requestsPerMauDay_characterai: c({
    value: 62,
    low: 40,
    high: 90,
    unit: 'requests per monthly active user per day (Character.AI)',
    basis: 'published',
    verified: 'snippet',
    source: [S.characterAiInference, S.demandsageCharacterAi],
    note: 'Character.AI’s ~20,000 queries per second (June 2024) = 1.73B per day, divided by the ~28M monthly users estimated for mid-2024.',
  }),
  scope_copilotExGithub: c({
    value: 0.82,
    low: 0.75,
    high: 0.9,
    unit: 'share of the “family of Copilots” MAU not from GitHub Copilot',
    basis: 'published',
    verified: 'page',
    source: [S.msftFy25q4, S.msftFy26q1],
    note: 'Microsoft reported 100M family MAU with 20M GitHub Copilot users (Jul 2025) and 150M with 26M (Oct 2025): 80–83% is not GitHub Copilot, which has its own HQ.',
  }),

  pricePerMillionTokens: c({
    value: 1.0,
    low: 0.3,
    high: 3.0,
    unit: 'USD per million tokens actually paid (blended, after caching discounts)',
    basis: 'assumption',
    verified: 'page',
    source: [S.deepseekInference, S.claudePricing, S.openrouterStateOfAi],
    note: 'DeepSeek’s theoretical revenue works out to $0.72/M tokens; OpenRouter’s median is $0.73/M; frontier models with heavy caching land ~$1–2/M.',
  }),
  pricePerMillionTokens_anthropic: c({
    value: 1.5,
    low: 0.7,
    high: 3.0,
    unit: 'USD per million tokens actually paid for Claude (blended)',
    basis: 'assumption',
    verified: 'page',
    source: [S.claudePricing],
    note: 'List prices per million input/output tokens: Sonnet 5 $2/$10, Opus 5.5 $4/$20, Haiku 4.5 $1/$5, cache reads at 0.05–0.1×. Agentic traffic is mostly cached input, which pulls the blend to roughly $1–2 per million.',
  }),
  tokenRevenueShare: judgement(
    0.6,
    0.35,
    0.85,
    'share of revenue that pays for metered tokens',
    'Revenue also includes flat subscriptions, services and non-token products.',
  ),
  tokenRevenueShare_anthropic: judgement(
    0.8,
    0.6,
    0.95,
    'share of Anthropic revenue that corresponds to token usage at the blended price',
    'Almost all of Anthropic’s revenue is API usage and Claude subscriptions that are consumed as tokens.',
  ),
  tokenRevenueShare_cursor: judgement(
    0.7,
    0.4,
    0.9,
    'share of Cursor revenue spent on model tokens',
    'An AI code editor passes most of its revenue through to model inference.',
  ),
} as const;

// ---------------------------------------------------------------------------
// Daily/weekly traffic shape by profile (see traffic.ts)
// ---------------------------------------------------------------------------
const shapeNote =
  'Judgement. The only published production load curve found is DeepSeek’s: peak 278 nodes vs a 24 h average of 226.75 (peak ÷ average ≈ 1.23), “high load in the day, low at night”.';
const shape = (
  a1: number,
  p1: number,
  a2: number,
  p2: number,
  w: number,
  pw: number,
  what: string,
) => {
  const k = (value: number, low: number, high: number, unit: string) =>
    c({
      value,
      low,
      high,
      unit,
      basis: 'assumption',
      verified: 'page',
      source: [S.deepseekInference],
      note: `${what} ${shapeNote}`,
    });
  return {
    a1: k(a1, a1 * 0.6, a1 * 1.4, 'daily amplitude'),
    p1: k(p1, p1 - 2, p1 + 2, 'local hour of the daily peak'),
    a2: k(a2, 0, a2 * 2, 'half-daily amplitude'),
    p2: k(p2, p2 - 2, p2 + 2, 'local hour of the half-daily peak'),
    w: k(w, 0, w * 2, 'weekly amplitude'),
    pw: k(pw, pw - 1, pw + 1, 'day of the weekly peak (0 = Monday 00:00)'),
  };
};

export const TRAFFIC = {
  assistant: shape(
    0.3,
    15,
    0.06,
    11,
    0.04,
    2.5,
    'Consumer assistants: broad daytime plateau, trough before dawn.',
  ),
  companion: shape(
    0.3,
    21,
    0.05,
    21,
    0.04,
    5.5,
    'Companion chat peaks late evening and at weekends.',
  ),
  search: shape(0.32, 14, 0.06, 11, 0.06, 2.5, 'Answer engines track the working day.'),
  coding: shape(
    0.4,
    14,
    0.1,
    14,
    0.15,
    2.5,
    'Coding tools follow the workday and dip at weekends.',
  ),
  api: shape(
    0.3,
    14,
    0.06,
    14,
    0.1,
    2.5,
    'API traffic mixes business hours with always-on automation.',
  ),
} as const;

// ---------------------------------------------------------------------------
// Growth curve & data-quality parameters (judgement)
// ---------------------------------------------------------------------------
export const GROWTH = {
  seedFraction: judgement(
    0.03,
    0.01,
    0.1,
    'launch-day rate ÷ first anchor',
    'How small a platform was on launch day relative to its first data point.',
  ),
  defaultLogGrowthPerYear: judgement(
    LN2,
    0,
    2 * LN2,
    'ln(multiplier) per year',
    'Used only when a component has a single anchor: doubling per year.',
  ),
  growthSigmaPerYear: judgement(
    LN2 / 1.6448536269514722,
    0,
    1,
    'log-σ per year of extrapolation',
    'After a year of extrapolation the 90% band has widened by ×2 each way.',
  ),
  minLogGrowthPerYear: judgement(
    -LN2,
    -LN2,
    -LN2,
    'ln(multiplier) per year',
    'Fitted decline is clamped at halving per year.',
  ),
  maxLogGrowthPerYear: judgement(
    LN10,
    LN10,
    LN10,
    'ln(multiplier) per year',
    'Fitted growth is clamped at ×10 per year.',
  ),
  dampingDays: judgement(
    365,
    180,
    730,
    'days',
    'Extrapolated growth decays with this e-folding time.',
  ),
  horizonDays: judgement(
    1096,
    1096,
    1096,
    'days',
    'Damped monthly extrapolation segments are generated this far ahead.',
  ),
  reportedFreshnessDays: judgement(
    14,
    14,
    14,
    'days',
    'A value stays “Reported” only within this many days of a reported figure.',
  ),
} as const;

export const UNCERTAINTY = {
  exact: judgement(
    1.03,
    1.03,
    1.03,
    '×/÷ factor',
    'An exact primary figure still carries rounding and definitional slack.',
  ),
  about: judgement(1.1, 1.1, 1.1, '×/÷ factor', '“About / roughly / nearly”.'),
  over: judgement(
    1.15,
    1.15,
    1.15,
    'upper factor',
    '“Over / more than X”: X is used as the central and low value.',
  ),
  thirdParty: judgement(
    1.35,
    1.35,
    1.35,
    '×/÷ factor',
    'Third-party estimates (panels, analysts, press) are widened further.',
  ),
} as const;

// ---------------------------------------------------------------------------
// Equivalences. Pending entries are hidden from the UI until checked (TASKS.md).
// ---------------------------------------------------------------------------
export const EQUIV = {
  tokensPerWord: c({
    value: 1.33,
    low: 1.2,
    high: 1.75,
    unit: 'tokens per English word',
    basis: 'published',
    verified: 'page',
    source: [S.claudePricing, S.tiktoken],
    note: '“1 token is approximately 4 characters or 0.75 words in English” (Anthropic); newer tokenizers produce up to ~30% more tokens.',
  }),
  locBooks: c({
    value: 25_500_000,
    low: 25_000_000,
    high: 27_000_000,
    unit: 'cataloged books in the Library of Congress',
    basis: 'published',
    verified: 'pending',
    source: [S.locGeneral],
    note: 'Pending verification: loc.gov was unreachable during research.',
  }),
  wordsPerBook: judgement(90_000, 60_000, 120_000, 'words per book', 'A typical full-length book.'),
  enWikipediaWords: c({
    value: 4.8e9,
    low: 4.4e9,
    high: 5.2e9,
    unit: 'words in English Wikipedia articles',
    basis: 'published',
    verified: 'pending',
    source: [S.wikipediaSize],
    note: 'Pending verification: wikipedia.org was unreachable during research.',
  }),
  wordsSpokenPerDay: c({
    value: 16_000,
    low: 12_000,
    high: 20_000,
    unit: 'words spoken per person per day',
    basis: 'published',
    verified: 'pending',
    source: [S.mehl2007],
    note: 'Pending verification against the paper.',
  }),
  lifeExpectancyYears: c({
    value: 73.3,
    low: 72,
    high: 74,
    unit: 'years (global life expectancy at birth)',
    basis: 'published',
    verified: 'pending',
    source: [S.unWpp],
    note: 'Pending verification: population.un.org was unreachable during research.',
  }),
  householdKw: c({
    value: 1.2,
    low: 1.1,
    high: 1.3,
    unit: 'kW average US household electricity demand (annual kWh ÷ 8,766 h)',
    basis: 'published',
    verified: 'pending',
    source: [S.eiaHousehold],
    note: 'Pending verification: eia.gov was unreachable during research. EIA reports roughly 10,000–11,000 kWh per year per residential customer.',
  }),
  olympicPoolLiters: c({
    value: 2_500_000,
    low: 2_500_000,
    high: 2_500_000,
    unit: 'litres in a 50 m × 25 m × 2 m pool',
    basis: 'exact',
    verified: 'judgement',
    source: [],
    note: 'Defined by its dimensions: 50 × 25 × 2 m = 2,500 m³.',
  }),
} as const;

export const CONSTANTS = {
  COMPUTE,
  CROSSCHECK,
  USAGE,
  TRAFFIC,
  GROWTH,
  UNCERTAINTY,
  EQUIV,
} as const;

// ---------------------------------------------------------------------------
// Index by dotted key ("COMPUTE.pue", "TRAFFIC.coding.a1") — used by refs.
// ---------------------------------------------------------------------------
function isConstant(x: unknown): x is Constant {
  return typeof x === 'object' && x !== null && 'value' in x && 'verified' in x;
}

function flatten(prefix: string, obj: object, out: Record<string, Constant>): void {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isConstant(v)) out[key] = v;
    else if (typeof v === 'object' && v !== null) flatten(key, v, out);
  }
}

export const CONSTANT_INDEX: Readonly<Record<string, Constant>> = (() => {
  const out: Record<string, Constant> = {};
  flatten('', CONSTANTS, out);
  return out;
})();

export function lookupConstant(key: string): Constant | undefined {
  return CONSTANT_INDEX[key];
}

/** Refs that point at constants still pending verification. */
export function pendingRefs(refs: readonly string[]): string[] {
  return refs.filter((r) => CONSTANT_INDEX[r]?.verified === 'pending');
}

/** A value may be shown in the UI only if none of its constants is pending verification. */
export function isDisplayable(refs: readonly string[]): boolean {
  return pendingRefs(refs).length === 0;
}
