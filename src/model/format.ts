/** Plain, locale-independent number formatting for formulas and tests. */

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Compact, locale-independent number for formulas: 1.3 quadrillion, 6B, 2.5k. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  const units: [number, string][] = [
    [1e15, ' quadrillion'],
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ];
  for (const [v, s] of units) {
    if (abs >= v) {
      const x = n / v;
      return trimZeros(x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)) + s;
    }
  }
  return abs >= 10
    ? n.toFixed(0)
    : abs >= 1
      ? trimZeros(n.toFixed(2))
      : trimZeros(n.toPrecision(2));
}

/** Plain number with thousands separators (at most 2 decimals): 1,440 · 30.44 · 0.25. */
export function plain(n: number): string {
  const fixed = trimZeros(n.toFixed(Math.abs(n) >= 100 ? 0 : 2));
  const [int, dec] = fixed.split('.');
  const withSep = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec ? `${withSep}.${dec}` : withSep;
}
