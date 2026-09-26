/** File helpers shared by the data scripts (build-data.ts, update-data.ts). */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANUAL = join(ROOT, 'data', 'manual');
/** Files the hourly pipeline owns (committed, validated by the data build). */
export const AUTO = join(ROOT, 'data', 'auto');
export const OUT = join(ROOT, 'public', 'data');

export function readYaml(name: string): unknown {
  const file = join(MANUAL, name);
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  return parse(readFileSync(file, 'utf8'));
}

/** JSON as the repository stores it: two-space indent, trailing newline (stable diffs). */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * The parsed JSON in `file` (`fallback` when the file does not exist), or an error message when
 * it is not valid JSON — e.g. a stray comma after a hand edit — so callers can handle it like any
 * other invalid file instead of crashing.
 */
export function readJson(
  file: string,
  fallback: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!existsSync(file)) return { ok: true, value: fallback };
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, 'utf8')) as unknown };
  } catch (e) {
    return { ok: false, error: `not valid JSON (${e instanceof Error ? e.message : String(e)})` };
  }
}

/** The parsed YAML in data/manual/`name`, or `fallback` when the file does not exist. */
export function readYamlOr(name: string, fallback: unknown): unknown {
  return existsSync(join(MANUAL, name)) ? readYaml(name) : fallback;
}

/** Write through a temporary file, so a crash never leaves a half-written file behind. */
export function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}
