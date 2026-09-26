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
    /** Rotating equivalences under "Since you arrived". */
    equivalences: {
      words: 'words',
      energy: 'kWh of electricity',
      water: 'litres of cooling water',
      lead: '≈',
      label: 'In other words',
    },
  },
  tiers: {
    reported: 'Reported',
    derived: 'Estimated',
    modeled: 'Modeled',
  },
  unchecked: 'Not yet checked',
  uncheckedHelp:
    'A published fact we have not yet checked against its source page (see the verification backlog).',
  tierHelp: {
    reported: 'Published by the company or a primary source.',
    derived: 'Calculated from published figures.',
    modeled: 'Relies on at least one assumption with no public data.',
  },
  table: {
    caption: 'Estimated tokens per day by platform (central value and plausible range)',
    asOf: (date: string) => `— today, ${date} (live; the time machine does not change this table)`,
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
  views: {
    label: 'Inside this HQ',
    overview: 'Overview',
    offices: 'Offices',
    hall: 'Server hall',
    power: 'Power & cooling',
    lab: 'Model lab',
  },
  offices: {
    intro:
      'A cutaway of three office floors. More desks fill as the daily rate grows and as the working day starts at the HQ.',
    honesty: 'Desks and people are a visual scale of load, not a staff count.',
    traffic: 'Traffic right now',
    trafficUnit: '× the daily average',
    trafficNote:
      'The time-of-day curve is an assumption — regional waking hours plus the one published production load curve — so this figure is Modeled.',
    hardwareLabel: 'Desk hardware',
    hardware: [
      'Boxy monitors — the lighter load band',
      'Flat screens — a heavy load band',
      'Holographic panels — the heaviest load band',
    ],
    bands: (a: string, b: string) =>
      `Load bands follow the daily rate: below ${a} tokens/day, ${a}–${b}, and above ${b}.`,
    typing:
      'Screens flicker faster when traffic peaks. Lights follow a typical office day in local time.',
  },
  hall: {
    intro:
      'Rows of racks grow with the daily rate; their LEDs blink faster when traffic is above the daily average.',
    honesty: 'Racks are a visual scale of load, not a count of real machines.',
    accelerator: 'Likely accelerator class',
    liquid:
      'The coolant pipes are illustrative: this accelerator class is usually liquid-cooled at scale.',
    air: 'No coolant pipes are drawn: cooling for this hardware varies or is not disclosed.',
    sources: 'Sources',
    classes: {
      'nvidia-ampere': 'NVIDIA Ampere-class GPUs',
      'nvidia-hopper': 'NVIDIA Hopper-class GPUs',
      'nvidia-blackwell': 'NVIDIA Blackwell-class GPUs',
      'google-tpu': 'Google TPUs',
      'aws-trainium': 'AWS Trainium',
      'huawei-ascend': 'Huawei Ascend',
      'amd-instinct': 'AMD Instinct GPUs',
      mixed: 'A mix of accelerators (not disclosed in detail)',
    },
  },
  power: {
    intro:
      'The substation feeds the campus; cooling towers carry the heat away. Both gauges are live, and each log scale spans every HQ so the needles compare.',
    powerGauge: 'Power now',
    waterGauge: 'Cooling water',
    inputs: 'Inputs',
    formula: 'Formula',
    checkedSnippet: 'checked against a search summary of the sources',
    checkedPage: 'checked on the source pages',
    labels: {
      throughput: 'Tokens per second per GPU',
      kw: 'Power per GPU',
      pue: 'PUE (facility overhead)',
      wue: 'WUE (on-site water)',
    },
  },
  lab: {
    intro: (name: string) =>
      `The ${name} lineup: oldest on the left, and the newest glows. Faceted gems are the company's own models; pale stones are other companies' models offered here. Flagships stand taller.`,
    capped: (shown: number, total: number) =>
      `The display case holds the ${shown} most recent of ${total} models; all are listed here.`,
    list: 'Models, newest first',
    choose: 'Select a model to see its details.',
    released: 'Released',
    firstSeen: 'First seen',
    context: 'Context window',
    contextUnit: 'tokens',
    notPublished: 'not published',
    modalities: 'Inputs',
    origin: 'Made by',
    own: (parent: string) => parent,
    offered: (maker: string) => `${maker} — offered on this platform`,
    flagship: 'flagship',
    offeredTag: 'offered',
    source: 'Source',
    pending: 'not yet checked against the source',
    empty: 'No models are listed for this platform yet.',
  },
  time: {
    label: 'Time machine',
    play: 'Play the history of the city',
    pause: 'Pause',
    speedLabel: 'Playback speed',
    speeds: { week: '1 week / s', month: '1 month / s', quarter: '1 quarter / s' },
    slider: 'Date shown',
    live: 'Live',
    goLive: 'Back to live',
    historyBadge: 'History',
    historyNote:
      'Past days are read from the same growth curves as today: figures before a platform’s first published number are modeled, and ranges are wider.',
    date: (iso: string) => iso,
    todayLabelHistory: (date: string) => `Tokens processed on ${date}`,
    todayQualifierHistory: 'all 15 platforms · the whole UTC day · estimate',
    rateLabelHistory: 'At the time shown',
    todayQualifierSoFar: 'all 15 platforms · 00:00 UTC to now · estimate',
    panelDay: (date: string) => `Tokens on ${date}`,
    panelDaySoFar: (date: string) => `Tokens on ${date} so far`,
    powerHistory: 'Power at the time shown',
    historyChip: (date: string) => `History · ${date}`,
    beforeFirstFigure:
      'This date is before the first published figure below; values here are modeled back from it.',
    notLaunched: 'Not launched at the date shown.',
    reachedLive: 'Back to the present.',
    /** Time of day next to the date in history mode. */
    utcTime: (hhmm: string) => `${hhmm} UTC`,
    /** Scrubber value for screen readers (aria-valuetext). */
    valueHistory: (date: string, hhmm: string) => `${date}, ${hhmm} UTC`,
    valueLive: (date: string) => `${date}, live`,
  },
  launch: {
    active: (model: string) => `Launch day: ${model}`,
  },
  race: {
    open: 'Race',
    title: 'The race for tokens',
    subtitle: 'Daily tokens by platform',
    close: 'Close the race',
    scaleNote:
      'Bars share one linear scale (the leader fills the width); thin lines show plausible ranges.',
    notLaunched: 'not launched yet',
    rank: (n: number) => `#${n}`,
    /** Unit after each race value ("1.2T tokens/day"), and spelled out for screen readers. */
    perDay: 'tokens/day',
    perDayLong: 'tokens per day',
  },
  feed: {
    open: 'What’s new',
    title: 'What’s new',
    new: 'New',
    empty: 'No model launches yet at this date.',
    source: 'Source',
    toastLabel: 'Model launch',
    toastLabels: { launch: 'Model launch', available: 'Now available', 'first-seen': 'First seen' },
    close: 'Close what’s new',
    /** Appended, visually hidden, to the toggle's name while the dot is shown. */
    toggleHasNew: (hours: number) => `(includes news from the last ${hours} hours)`,
    /** Visually hidden hint after each "Source" link. */
    newTab: 'opens in a new tab',
    /** What screen readers hear for a launch toast. */
    toastSpoken: (label: string, platform: string, title: string, date: string) =>
      `${label}: ${platform}, ${title} (${date})`,
  },
  // ---- M6: prompt visualizer (src/ui/prompt.ts) — owned by that module's builder
  prompt: {
    /** Label for the control that opens the panel (the integrator's toggle). */
    open: 'Your prompt',
    title: 'Your prompt, visualized',
    intro:
      'Type or paste any text. We count its tokens and send one glowing token into the HQ you choose.',
    close: 'Close your prompt',
    label: 'Your text',
    placeholder: 'Paste an email, a poem, a page of code…',
    chars: (n: string, max: string) => `${n} / ${max} characters`,
    privacy: 'Your text stays in this browser: it is counted here and never sent anywhere.',
    countLabel: 'Tokens',
    tokens: (n: number) => (n === 1 ? 'token' : 'tokens'),
    empty: 'Type or paste some text to count its tokens.',
    loading: 'Counting… (loading the tokenizer)',
    counting: 'Counting…',
    failed:
      'The tokenizer could not be loaded, so this text cannot be counted. Check your connection and try again.',
    failedAgain:
      'The tokenizer is still unavailable. If you are online, reloading the page should fix it.',
    countFailed: 'This text could not be counted.',
    retry: 'Try again',
    /** Tooltip of the count's tier chip: the count is exact for the tokenizer named. */
    countHelp: (tokenizer: string) =>
      `Exact count for the ${tokenizer} tokenizer, computed from your text in this browser.`,
    tokenizerNote: (tokenizer: string) =>
      `Counted with ${tokenizer}, the tokenizer of GPT-4o-class models; Claude, Gemini and others split text differently, so their counts differ.`,
    tokenizerSources: 'Tokenizer:',
    tokenizerSpec: 'OpenAI tiktoken',
    tokenizerLibrary: 'gpt-tokenizer, the JavaScript port used here',
    hqLabel: 'Send it to',
    sameForEveryHq:
      'The figures are the same for every HQ: we use one hardware-efficiency figure for all of them, because none publishes its own.',
    results: 'What this prompt takes',
    energy: 'Energy',
    water: 'On-site cooling water',
    energyUnit: 'Wh',
    waterUnit: 'mL',
    noValue: '—',
    resultsEmpty: 'Energy and water appear here once your text is counted.',
    scope:
      'Only the tokens you typed. A real request also carries instructions and chat history, and the reply adds its own tokens: a typical chat request is 2,000–3,000 tokens in all. Water is on-site cooling only, not the water used to make the electricity.',
    formula: 'How it is calculated',
    energyFormula: (formula: string) => `Energy (Wh) = ${formula}`,
    waterFormula: (formula: string) => `Water (mL) = ${formula}`,
    perToken: 'Energy per token',
    perTokenUnit: 'J',
    perTokenFormula: (kw: string, pue: string, tokensPerSec: string) =>
      `J/token = ${kw} kW per GPU × 1,000 × PUE ${pue} ÷ ${tokensPerSec} tokens/s per GPU`,
    inputs: 'Inputs and sources',
    inputUnits: { throughput: 'tokens/s', kw: 'kW', pue: '', wue: 'L/kWh' },
    sources: 'Sources',
    method: 'How we estimate',
    /** Visually hidden hint after links that open a new tab. */
    newTab: 'opens in a new tab',
    send: (hq: string) => `Send to ${hq}`,
    sendHint: 'Type or paste some text first.',
    sendHintCount: 'Sending needs the token count first.',
    sent: (hq: string) => `Sent. Watch your token fly into ${hq}.`,
    arrived: (hq: string) => `Your token landed in ${hq}’s server hall.`,
    /** What screen readers hear once typing settles (never on every keystroke). */
    spokenCount: (
      count: string,
      unit: string,
      wh: string,
      whRange: string,
      ml: string,
      mlRange: string,
    ) =>
      `${count} ${unit}. Energy about ${wh} watt-hours (${whRange}); on-site water about ${ml} millilitres (${mlRange}). Both modeled.`,
    spokenSent: (count: string, unit: string, hq: string) => `Sent ${count} ${unit} to ${hq}.`,
  },
  // ---- M6: uncertainty glass (src/world/uncertainty.ts) — owned by that module's builder
  glass: {
    /** Toggle button label (pair it with aria-pressed). */
    toggle: 'Show uncertainty',
    /** Tooltip / accessible description of the toggle. */
    tooltip:
      'Turn every tower into its plausible range: a solid core up to the low estimate, frosted glass up to the high estimate, and a light ring at the central value.',
    /** Spoken (aria-live) when the toggle changes. */
    announceOn: 'Uncertainty shown: each tower is now a solid core, a glass case and a light ring.',
    announceOff: 'Uncertainty hidden.',
    legendTitle: 'Reading the glass',
    legend: {
      core: 'Solid core: up to the low end of the plausible range.',
      glass: 'Glass: from the low end up to the high end of the range.',
      ring: 'Light ring: the central estimate, where the tower itself ends.',
      frost:
        'Frost: how firm the evidence is. Clear for Reported, frosted for Estimated, foggy for Modeled.',
    },
    rangeNote:
      'A plausible range is roughly a 90% interval from our model, not a hard limit. The glass uses the same height scale as the towers (log or true).',
  },
  // ---- M6: sound (src/audio/sound.ts) — owned by that module's builder
  sound: {
    /** Toggle button label (pair it with aria-pressed). */
    toggle: 'Sound',
    /** Visible state next to the icon. */
    on: 'Sound on',
    off: 'Sound off',
    /** Tooltip / accessible description of the toggle. */
    tooltip:
      'Ambient city, server hum and launch chimes, synthesized in your browser. Off by default; the volume follows how close you are.',
    /** Shown if setEnabled(true) leaves sound off (no Web Audio, or the browser refused). */
    failed: 'Sound could not start in this browser.',
    /** For an about/help line: the audio is atmosphere, not data. */
    note: 'The city sounds busier and the servers louder when modeled traffic is high; the sound is atmosphere, not a measurement.',
  },
  // ---- M6: incident mode (src/ui/incidents.ts, src/world/alarm.ts) — owned by that module's builder
  incidents: {
    /** Accessible name of the banner. */
    region: 'Status page notices',
    /** Impact levels as the status pages publish them (normalized by the data pipeline). */
    impact: {
      maintenance: 'Maintenance',
      minor: 'Minor impact',
      major: 'Major impact',
      critical: 'Critical impact',
    },
    /** "<HQ>’s official status page reports: “…”" — the HQ name is a button, the rest follows it. */
    possessive: (name: string) => (/s$/i.test(name) ? '’' : '’s'),
    reports: ' official status page reports: ',
    started: (when: string) => `Started ${when}`,
    /** A UTC instant, written like the time machine's labels. */
    when: (date: string, hhmm: string) => `${date}, ${hhmm} UTC`,
    link: 'Status page',
    /** Visually hidden hint after each "Status page" link. */
    newTab: 'opens in a new tab',
    more: (n: number) => `+${n} more`,
    less: 'Show less',
    dismiss: (name: string) => `Dismiss the ${name} status notice`,
    note: 'Copied from the platform’s own status page at our last data update — open it for the current status. Token estimates on this site are not adjusted for incidents.',
    /** What screen readers hear when a new notice appears. */
    spoken: (name: string, impact: string, title: string, when: string) =>
      `${name}${/s$/i.test(name) ? '’' : '’s'} official status page reports ${impact.toLowerCase()}: ${title}. Started ${when}.`,
    spokenMore: (n: number) => `${n} more status ${n === 1 ? 'notice' : 'notices'} listed.`,
  },
  // ---- M6: cinematic tour (src/state/tour.ts, src/ui/tour.ts) — owned by that module's builder
  tour: {
    /** Accessible name of the caption card. */
    region: 'Cinematic tour',
    hint: 'Tour · press any key to explore',
    /** The same hint on touch screens, which have no keys to press. */
    hintTouch: 'Tour · tap anywhere to explore',
    stop: 'Stop',
    stopLabel: 'Stop the tour',
    method: 'How we estimate',
    /** Visually hidden hint after the "How we estimate" link. */
    newTab: 'opens in a new tab',
    opening:
      'Token Metropolis — every tower is an AI platform, sized by the tokens it processes each day.',
    /** Leads for the three largest HQs, largest first. */
    ranks: ['The largest HQ', 'Number two', 'Number three'],
    ranked: (lead: string, name: string, perDay: string) =>
      `${lead}: ${name} — about ${perDay} tokens a day`,
    smallest: (name: string, perDay: string) =>
      `The smallest HQ: ${name} — about ${perDay} tokens a day`,
    /** Growth over the last 90 days, as a percentage (below 2×) or a multiple. */
    growthPercent: (name: string, pct: string) =>
      `Growing fastest: ${name} — up about ${pct}% in 90 days`,
    growthMultiple: (name: string, times: string) =>
      `Growing fastest: ${name} — about ${times}× its daily volume of 90 days ago`,
    daytime: (name: string, city: string, time: string) =>
      `It’s ${time} in ${city}, daytime for ${name}. Every HQ keeps its own local hours.`,
    closing: (perDay: string) => `The whole city: about ${perDay} tokens a day`,
    /** What screen readers hear for a caption that states a number (the tier follows it). */
    spoken: (caption: string, tier: string) => `${caption} (${tier})`,
  },
  // ---- M6: discoveries (src/state/discoveries.ts, src/ui/discoveries.ts) — owned by that module's builder
  discoveries: {
    // (strings for this module go here)
  },
  // ---- M6: share card (src/ui/share.ts) — owned by that module's builder
  share: {
    // (strings for this module go here)
  },
  compare: {
    open: 'Compare',
    title: 'Compare',
    add: 'Add a platform…',
    addLabel: 'Add a platform to compare',
    remove: (name: string) => `Remove ${name} from the comparison`,
    close: 'Close compare',
    hint: 'Pick two or three platforms to see their campuses side by side.',
    scaleNote: 'Towers keep the city’s current scale (log or true).',
    rows: {
      perDay: 'Daily rate',
      now: 'Right now',
      nowHistory: 'At the time shown',
      total: 'Since launch',
      gpus: 'GPU equivalents',
      power: 'Power',
      water: 'Cooling water',
      latest: 'Latest published figure',
    },
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
