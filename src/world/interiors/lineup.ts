/** Which models stand in the lab's display case (pure; shared with the panel). */
import type { Model } from '../../data/schema';
import { daysToIso } from '../../model/time';

/** At most this many crystals are shown (the most recent); the panel lists them all. */
export const LAB_MAX = 12;

/** Oldest → newest; ties broken by id so the order is stable. */
export function labLineup(models: readonly Model[], max = LAB_MAX): Model[] {
  const sorted = [...models].sort(
    (a, b) => a.released.localeCompare(b.released) || a.id.localeCompare(b.id),
  );
  return sorted.slice(Math.max(0, sorted.length - max));
}

/** Models released on or before `t` (month-precision releases count from their month). */
export function releasedBy(models: readonly Model[], t: number): Model[] {
  const iso = daysToIso(t);
  return models.filter((m) =>
    m.datePrecision === 'month' ? m.released.slice(0, 7) <= iso.slice(0, 7) : m.released <= iso,
  );
}
