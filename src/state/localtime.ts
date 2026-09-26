/**
 * Local time at each HQ, and the curves that turn it into light: daylight
 * (a smooth approximation of sunrise/sunset — latitude and season are ignored)
 * and office occupancy (lit windows). Cosmetic; never used for numbers.
 */
const formats = new Map<string, Intl.DateTimeFormat>();

function format(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formats.set(tz, f);
  }
  return f;
}

/** Fractional local hour [0, 24) in an IANA time zone. */
export function localHour(tz: string, ms: number): number {
  let h = 0;
  let m = 0;
  for (const p of format(tz).formatToParts(new Date(ms))) {
    if (p.type === 'hour') h = Number(p.value);
    if (p.type === 'minute') m = Number(p.value);
  }
  return (h % 24) + m / 60;
}

/** "08:42". */
export function localTimeLabel(tz: string, ms: number): string {
  return format(tz).format(new Date(ms));
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 0 at night, 1 in full daylight. */
export function daylight(hour: number): number {
  return smooth(5.5, 7.5, hour) * (1 - smooth(18, 20, hour));
}

/** Share of office desks occupied at a local hour (night shift never goes to zero). */
export function occupancy(hour: number): number {
  const morning = smooth(6.5, 9.5, hour);
  const evening = 1 - smooth(18, 22.5, hour) * 0.75;
  return 0.12 + 0.78 * morning * evening;
}
