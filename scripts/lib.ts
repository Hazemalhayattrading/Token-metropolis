/** File helpers shared by the data scripts (build-data.ts, update-data.ts). */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANUAL = join(ROOT, 'data', 'manual');
/** Files the daily pipeline owns (committed, validated by the data build). */
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

/** The parsed JSON in `file`, or `fallback` when the file does not exist. */
export function readJson(file: string, fallback: unknown): unknown {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : fallback;
}

/** Write through a temporary file, so a crash never leaves a half-written file behind. */
export function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}
