/**
 * Island layout. Plots are fixed per platform id, so campuses never move when
 * the data changes (time machine, daily updates). Neighbours are chosen so
 * similar accent colours sit far apart. Unknown ids take the spare plots.
 */

export interface Plot {
  readonly x: number;
  readonly z: number;
  /** Rotation of the campus (radians) so it faces the island centre. */
  readonly facing: number;
  readonly ring: 'inner' | 'outer';
}

export const ISLAND_RADIUS = 62;
const INNER_RADIUS = 19;
const OUTER_RADIUS = 42;

const INNER = ['chatgpt', 'claude', 'gemini', 'doubao', 'meta-ai'];
const OUTER = [
  'copilot',
  'deepseek',
  'grok',
  'kimi',
  'characterai',
  'github-copilot',
  'yuanbao',
  'perplexity',
  'qwen',
  'cursor',
];

function plotAt(radius: number, angle: number, ring: Plot['ring']): Plot {
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  // Face the centre: local +Z points towards (0, 0).
  return { x, z, facing: Math.atan2(-x, -z), ring };
}

/** Plot for each platform id, in the order given. */
export function layoutPlots(ids: readonly string[]): Map<string, Plot> {
  const inner = INNER.map((_, i) =>
    plotAt(INNER_RADIUS, (i / INNER.length) * Math.PI * 2 - Math.PI / 2, 'inner'),
  );
  const outer = OUTER.map((_, i) =>
    plotAt(
      OUTER_RADIUS,
      (i / OUTER.length) * Math.PI * 2 - Math.PI / 2 + Math.PI / OUTER.length,
      'outer',
    ),
  );
  const out = new Map<string, Plot>();
  const spare: Plot[] = [];
  INNER.forEach((id, i) => (ids.includes(id) ? out.set(id, inner[i]!) : spare.push(inner[i]!)));
  OUTER.forEach((id, i) => (ids.includes(id) ? out.set(id, outer[i]!) : spare.push(outer[i]!)));
  for (const id of ids) {
    if (out.has(id)) continue;
    const p = spare.shift();
    if (!p) throw new Error(`No plot left for ${id}`);
    out.set(id, p);
  }
  return out;
}
