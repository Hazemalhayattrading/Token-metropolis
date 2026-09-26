/**
 * Every user-facing string lives here so the copy can be reviewed and edited in one place.
 * English only (brief §6).
 */
export const COPY = {
  siteName: 'Token Metropolis',
  tagline: 'The world’s biggest AI platforms as a living city, sized by the tokens they process.',
  loading: {
    title: 'Token Metropolis',
    status: 'Switching on the city lights…',
    failed: 'The city’s data could not be loaded.',
    retry: 'Try again',
  },
  hud: {
    todayLabel: 'Tokens processed today',
    todayQualifier: 'all 15 platforms · since 00:00 UTC · estimate',
    arrivedLabel: 'Since you arrived',
    rateLabel: 'Right now',
    perSecond: 'tokens / second',
    range: (low: string, high: string) => `Plausible range ${low} – ${high}`,
    updated: (ago: string) => `Data updated ${ago}`,
    offline: 'Showing the last saved copy of the data — the latest could not be loaded.',
    methodLink: 'How we estimate',
    dataLink: 'Data view',
  },
  tiers: {
    reported: 'Reported',
    derived: 'Estimated',
    modeled: 'Modeled',
  },
  tierHelp: {
    reported: 'Published by the company or a primary source.',
    derived: 'Calculated from published figures.',
    modeled: 'Relies on at least one assumption with no public data.',
  },
  table: {
    caption: 'Estimated tokens per day by platform (central value and plausible range)',
    platform: 'Platform',
    parent: 'Company',
    perDay: 'Tokens per day',
    range: 'Range',
    tier: 'Tier',
    latest: 'Latest published figure',
    scope: 'What is counted',
  },
  footer: {
    disclaimer:
      'Independent project. Not affiliated with, endorsed by, or sponsored by any company shown. Figures are estimates unless marked Reported.',
  },
  panel: {
    close: 'Close',
    today: 'Tokens today (UTC)',
    now: 'Right now',
    perDay: 'Daily rate',
    sinceLaunch: 'Since launch',
    tokens: 'tokens',
    perSecond: 'tokens / second',
    gpus: 'GPU equivalents',
    gpuUnit: 'H100-class, busy now',
    power: 'Power now',
    water: 'Cooling water',
    waterUnit: 'litres / day',
    infrastructure: 'What it takes to serve',
    infraNote:
      'Hardware, power and water are modeled from tokens with one H100-equivalent efficiency figure for every platform — the biggest uncertainty on this site.',
    latest: 'Latest published figure',
    how: 'How this estimate is made',
    snippet: 'checked against a search summary of the source',
    range: (low: string, high: string) => `range ${low} – ${high}`,
    extrapolated: (days: number) =>
      `The latest figure is ${days} days old, so today's value is extrapolated and its range widens with time.`,
    localTime: (time: string) => `${time} local time`,
  },
  controls: {
    scale: 'Building height',
    log: 'Log scale',
    true: 'True scale',
    overview: 'Back to the city',
  },
  noWebgl: 'Your browser can’t show the 3D city, so here is the same data as a dashboard.',
  skipToData: 'Skip to the data table',
} as const;
