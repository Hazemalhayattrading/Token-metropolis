/** The city: every platform's model built once from the validated dataset. */
import type { Dataset } from '../data/validate';
import { buildPlatformModel, dailyRate, type PlatformModel } from '../model/estimate';

export interface City {
  readonly dataset: Dataset;
  readonly platforms: readonly PlatformModel[];
  readonly byId: ReadonlyMap<string, PlatformModel>;
}

export function buildCity(dataset: Dataset): City {
  const platforms = dataset.platforms.map((p) => buildPlatformModel(p, dataset.metrics));
  return { dataset, platforms, byId: new Map(platforms.map((pm) => [pm.platform.id, pm])) };
}

/** Platforms sorted by current daily tokens, largest first. */
export function ranked(city: City, t: number): PlatformModel[] {
  return [...city.platforms].sort((a, b) => dailyRate(b, t).central - dailyRate(a, t).central);
}
