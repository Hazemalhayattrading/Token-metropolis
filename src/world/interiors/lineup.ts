/** Which models stand in the lab's display case (pure; shared with the panel). */
import type { Model } from '../../data/schema';

/** At most this many crystals are shown (the most recent); the panel lists them all. */
export const LAB_MAX = 12;

/** Oldest → newest; ties broken by id so the order is stable. */
export function labLineup(models: readonly Model[], max = LAB_MAX): Model[] {
  const sorted = [...models].sort(
    (a, b) => a.released.localeCompare(b.released) || a.id.localeCompare(b.id),
  );
  return sorted.slice(Math.max(0, sorted.length - max));
}
