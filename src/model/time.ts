/**
 * Time is handled as fractional days since the Unix epoch (UTC) inside the
 * model. A double holds that with sub-microsecond resolution for centuries.
 */
export const MS_PER_DAY = 86_400_000;
export const SECONDS_PER_DAY = 86_400;
export const DAYS_PER_YEAR = 365.25;
export const DAYS_PER_MONTH = DAYS_PER_YEAR / 12;

export function msToDays(ms: number): number {
  return ms / MS_PER_DAY;
}

export function daysToMs(days: number): number {
  return days * MS_PER_DAY;
}

/** Parse an ISO date ("2025-10-29" or a full timestamp) to days since epoch, UTC. */
export function isoToDays(iso: string): number {
  const ms = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid ISO date: ${iso}`);
  return ms / MS_PER_DAY;
}

/** Start of the UTC day containing `days`. */
export function utcDayStart(days: number): number {
  return Math.floor(days);
}

export function daysToIso(days: number): string {
  return new Date(days * MS_PER_DAY).toISOString().slice(0, 10);
}
