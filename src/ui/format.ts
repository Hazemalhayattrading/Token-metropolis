/** Number formatting for the UI (English, tabular-friendly). */

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Full digits with separators: 123,456,789. */
export function fullNumber(n: number): string {
  return integer.format(Math.floor(n));
}

const SCALES: [number, string, string][] = [
  [1e15, 'quadrillion', 'Q'],
  [1e12, 'trillion', 'T'],
  [1e9, 'billion', 'B'],
  [1e6, 'million', 'M'],
  [1e3, 'thousand', 'k'],
];

function sig(x: number): string {
  return x >= 100
    ? x.toFixed(0)
    : x >= 10
      ? x.toFixed(1).replace(/\.0$/, '')
      : x.toFixed(2).replace(/\.?0+$/, '');
}

/** "1.3 trillion" (long) or "1.3T" (short). */
export function humanNumber(n: number, style: 'long' | 'short' = 'long'): string {
  const abs = Math.abs(n);
  for (const [v, long, short] of SCALES) {
    if (abs >= v) return style === 'long' ? `${sig(n / v)} ${long}` : `${sig(n / v)}${short}`;
  }
  return sig(n);
}

/** "3 hours ago", "2 days ago". */
export function timeAgo(fromMs: number, nowMs: number): string {
  const s = Math.max(0, (nowMs - fromMs) / 1000);
  const units: [number, string][] = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [secs, name] of units) {
    if (s >= secs) {
      const n = Math.floor(s / secs);
      return `${n} ${name}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

const WINDOW_LABEL = {
  daily: 'daily users',
  weekly: 'weekly users',
  monthly: 'monthly users',
} as const;

/** "180 trillion tokens per day", "$65 billion a year", "900 million weekly users". */
export function describeValue(m: {
  kind: string;
  value: number;
  period?: string | undefined;
  window?: keyof typeof WINDOW_LABEL | undefined;
}): string {
  const v = humanNumber(m.value);
  switch (m.kind) {
    case 'tokens':
      return `${v} tokens per ${m.period ?? 'day'}`;
    case 'requests':
      return `${v} requests per ${m.period ?? 'day'}`;
    case 'users':
      return `${v} ${m.window ? WINDOW_LABEL[m.window] : 'users'}`;
    case 'revenue':
      return `$${v} a year`;
    default:
      return v;
  }
}
