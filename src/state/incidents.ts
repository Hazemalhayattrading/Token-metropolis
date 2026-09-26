/**
 * Incident mode (brief §5.3 item 6): which platforms' official status pages report an unresolved
 * incident at a given moment. public/data/incidents.json is written by the daily data pipeline
 * from each platform's own status feed (IncidentSchema). Nothing here feeds a token number: the
 * estimates never change with incidents. Pure functions, no DOM.
 */
import type { Incident } from '../data/schema';

export type Impact = Incident['impact'];

const SEVERITY: Readonly<Record<Impact, number>> = {
  none: 0,
  maintenance: 1,
  minor: 2,
  major: 3,
  critical: 4,
};

/** critical (4) > major (3) > minor (2) > maintenance (1) > none (0). */
export function incidentSeverity(impact: Impact): number {
  return SEVERITY[impact] ?? 0;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const NO_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/**
 * Milliseconds since the epoch for a status-page timestamp, or null if it cannot be read.
 * A date or a time without a zone is read as UTC, so every visitor sees the same moment.
 */
export function parseInstant(s: string): number | null {
  const v = s.trim();
  const iso = DATE_ONLY.test(v)
    ? `${v}T00:00:00Z`
    : NO_ZONE.test(v)
      ? `${v.replace(' ', 'T')}Z`
      : v;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export interface ActiveOptions {
  /**
   * Ignore unresolved incidents that started more than this long before `tMs` (default: never).
   * A guard against a feed that stopped updating and left an old incident open.
   */
  readonly staleAfterMs?: number;
  /**
   * Show a notice only if the pipeline read it on the status page within this long before `tMs`
   * (its `checked` time). A missing or unreadable `checked` time then claims nothing.
   */
  readonly checkedWithinMs?: number;
}

/**
 * Whether the status page reports `incident` as ongoing at `tMs`: a real incident (impact other
 * than "none") that has started and is unresolved, or resolved later than `tMs`. Timestamps that
 * cannot be read claim nothing: an unreadable start or resolution time is never shown as active.
 */
export function isActiveAt(incident: Incident, tMs: number, opts: ActiveOptions = {}): boolean {
  if (incidentSeverity(incident.impact) <= 0 || !Number.isFinite(tMs)) return false;
  if (opts.checkedWithinMs !== undefined) {
    const checked = incident.checked ? parseInstant(incident.checked) : null;
    if (checked === null || tMs - checked > opts.checkedWithinMs) return false;
  }
  const start = parseInstant(incident.started);
  if (start === null || start > tMs) return false;
  if (incident.resolved === null) return tMs - start < (opts.staleAfterMs ?? Infinity);
  const end = parseInstant(incident.resolved);
  return end !== null && end > tMs;
}

/** Most severe first, then the most recent start, then by id (a stable, total order). */
export function compareIncidents(a: Incident, b: Incident): number {
  const bySeverity = incidentSeverity(b.impact) - incidentSeverity(a.impact);
  if (bySeverity !== 0) return bySeverity;
  const sa = parseInstant(a.started) ?? -Infinity;
  const sb = parseInstant(b.started) ?? -Infinity;
  if (sa !== sb) return sb > sa ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Platform id → the incident its status page reports at `tMs`: started at or before `tMs`,
 * unresolved (or resolved after `tMs`), impact other than "none". When several are open for one
 * platform, the most severe wins, then the most recent. Entries are ordered most severe first.
 */
export function activeIncidents(
  incidents: readonly Incident[],
  tMs: number,
  opts: ActiveOptions = {},
): Map<string, Incident> {
  const best = new Map<string, Incident>();
  for (const incident of incidents) {
    if (!isActiveAt(incident, tMs, opts)) continue;
    const current = best.get(incident.platform);
    if (!current || compareIncidents(incident, current) < 0) best.set(incident.platform, incident);
  }
  return new Map([...best.values()].sort(compareIncidents).map((i) => [i.platform, i]));
}

/** The notices the banner shows: active and not dismissed, most severe (then most recent) first. */
export function visibleIncidents(
  active: ReadonlyMap<string, Incident>,
  dismissed: ReadonlySet<string>,
): Incident[] {
  return [...active.values()].filter((i) => !dismissed.has(i.id)).sort(compareIncidents);
}

/** A compact identity of what the banner shows, to skip re-rendering when nothing changed. */
export function incidentsSignature(list: readonly Incident[]): string {
  return JSON.stringify(
    list.map((i) => [i.id, i.platform, i.impact, i.title, i.started, i.resolved, i.url]),
  );
}

/** "2026-09-26" and "10:05" for an instant, in UTC. */
export function utcParts(ms: number): { date: string; hhmm: string } {
  const iso = new Date(ms).toISOString();
  return { date: iso.slice(0, 10), hhmm: iso.slice(11, 16) };
}
