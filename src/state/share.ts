/**
 * Share card layout (brief §5.3 item 10): the pure half of the card renderer
 * (src/ui/share.ts). Text fitting takes an injected measure function (canvas
 * measureText in the browser, a fake in tests), so every rule here is DOM-free
 * and unit-tested: shortening, wrapping, font sizing, the card's regions, the
 * stat grid, cover-crop geometry and the file name.
 */
import type { Tier } from '../model/types';

/** Width of a string in pixels at the current font. */
export type Measure = (text: string) => number;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The standard link-preview size. */
export const SHARE_SIZE = { width: 1200, height: 630 } as const;
export const MAX_SHARE_STATS = 4;

/** The tier colours of the CSS (src/styles/main.css :root), so the card's chips match the site's. */
export const TIER_COLORS: Readonly<Record<Tier, string>> = {
  reported: '#46d98a',
  derived: '#ffb627',
  modeled: '#a7b0c0',
};

const ELLIPSIS = '…';
const TRAILING = /[\s,;:·•|–—-]+$/u;

/**
 * The text, shortened with an ellipsis if it is wider than maxWidth. The cut falls on a word
 * boundary when that keeps at least 70 % of what fits; an empty string when not even the
 * ellipsis fits.
 */
export function fitText(text: string, maxWidth: number, measure: Measure): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (measure(t) <= maxWidth) return t;
  if (!(measure(ELLIPSIS) <= maxWidth)) return '';
  const chars = [...t];
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(chars.slice(0, mid).join('').replace(TRAILING, '') + ELLIPSIS) <= maxWidth)
      lo = mid;
    else hi = mid - 1;
  }
  let cut = chars.slice(0, lo).join('');
  const space = cut.lastIndexOf(' ');
  if (space > 0 && space >= cut.length * 0.7) cut = cut.slice(0, space);
  cut = cut.replace(TRAILING, '');
  return cut.length > 0 ? cut + ELLIPSIS : ELLIPSIS;
}

/** The largest whole font size in [min, max] at which the text fits maxWidth (min if none does). */
export function fitFontSize(
  text: string,
  maxWidth: number,
  measureAt: (text: string, size: number) => number,
  max: number,
  min: number,
): number {
  const lo = Math.max(1, Math.floor(min));
  for (let size = Math.floor(max); size > lo; size--) {
    if (measureAt(text, size) <= maxWidth) return size;
  }
  return lo;
}

/**
 * Greedy word wrap into at most maxLines lines. If text is left over, the last line ends with an
 * ellipsis; a single word wider than a line is shortened.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: Measure,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let i = 0;
  while (i < words.length && lines.length < maxLines) {
    let line = words[i]!;
    i++;
    while (i < words.length && measure(`${line} ${words[i]!}`) <= maxWidth) {
      line = `${line} ${words[i]!}`;
      i++;
    }
    lines.push(measure(line) <= maxWidth ? line : fitText(line, maxWidth, measure));
  }
  if (i < words.length && lines.length > 0) {
    // The next word did not fit on the last line, so this always ends in an ellipsis.
    const last = lines.length - 1;
    lines[last] = fitText(`${lines[last]!} ${words.slice(i).join(' ')}`, maxWidth, measure);
  }
  return lines;
}

/** The first candidate that fits on one line; otherwise the last candidate, shortened. */
export function firstFitting(
  candidates: readonly string[],
  maxWidth: number,
  measure: Measure,
): string {
  for (const c of candidates) if (measure(c) <= maxWidth) return c;
  return fitText(candidates[candidates.length - 1] ?? '', maxWidth, measure);
}

/**
 * The source rectangle to draw so an sw × sh image covers a dw × dh box (centred, like CSS
 * object-fit: cover).
 */
export function coverCrop(sw: number, sh: number, dw: number, dh: number): Rect {
  if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0))
    return { x: 0, y: 0, width: Math.max(0, sw), height: Math.max(0, sh) };
  const scale = Math.max(dw / sw, dh / sh);
  const width = dw / scale;
  const height = dh / scale;
  return { x: (sw - width) / 2, y: (sh - height) / 2, width, height };
}

/**
 * Split an area into n stat cells of equal width: one row when every cell gets at least
 * minWidth, otherwise rows of two. Cells are laid out left to right, top to bottom.
 */
export function layoutStats(
  n: number,
  area: Rect,
  opts: { gap: number; minWidth: number; rowGap?: number },
): Rect[] {
  const count = Math.max(0, Math.min(MAX_SHARE_STATS, Math.floor(n)));
  if (count === 0) return [];
  const oneRow = (area.width - opts.gap * (count - 1)) / count >= opts.minWidth;
  const cols = oneRow ? count : Math.min(2, count);
  const rows = Math.ceil(count / cols);
  const rowGap = opts.rowGap ?? opts.gap;
  const width = (area.width - opts.gap * (cols - 1)) / cols;
  const height = (area.height - rowGap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, i) => ({
    x: area.x + (i % cols) * (width + opts.gap),
    y: area.y + Math.floor(i / cols) * (height + rowGap),
    width,
    height,
  }));
}

/** Rows the stats need for a card this size (1, or 2 on narrow cards). */
export function statRows(n: number, innerWidth: number, gap: number, minWidth: number): number {
  const count = Math.max(0, Math.min(MAX_SHARE_STATS, Math.floor(n)));
  if (count === 0) return 0;
  return (innerWidth - gap * (count - 1)) / count >= minWidth ? 1 : Math.ceil(count / 2);
}

export interface CardLayout {
  /** Scale relative to the 1200 × 630 design. */
  readonly k: number;
  readonly margin: number;
  readonly pad: number;
  /** The glass band along the bottom. */
  readonly band: Rect;
  /** Site name, title and subtitle. */
  readonly header: Rect;
  /** One cell per stat (empty when there are none). */
  readonly stats: readonly Rect[];
  /** The hairline above the footer. */
  readonly ruleY: number;
  /** Disclaimer (left) and url (right). */
  readonly footer: Rect;
}

/** Design sizes at k = 1. */
const D = {
  margin: 28,
  pad: 26,
  header: 58,
  gap: 20,
  stat: 86,
  statGap: 18,
  statMin: 190,
  ruleGap: 16,
  footer: 18,
};

/**
 * Where everything goes on a card of this size: a glass band along the bottom holding the header,
 * up to four stats and the footer; the rendered view shows above it.
 */
export function cardLayout(width: number, height: number, statCount: number): CardLayout {
  const w = Math.max(200, width);
  const h = Math.max(120, height);
  const k = Math.min(2, Math.max(0.45, Math.min(w / SHARE_SIZE.width, h / SHARE_SIZE.height)));
  const margin = D.margin * k;
  const pad = D.pad * k;
  const bandWidth = w - margin * 2;
  const inner = bandWidth - pad * 2;
  const rows = statRows(statCount, inner, D.statGap * k, D.statMin * k);
  const statsHeight = rows > 0 ? rows * D.stat * k + (rows - 1) * D.gap * 0.6 * k : 0;
  const bandHeight =
    pad +
    D.header * k +
    (rows > 0 ? D.gap * k + statsHeight : 0) +
    D.ruleGap * k * 2 +
    D.footer * k +
    pad * 0.85;
  const band: Rect = {
    x: margin,
    y: h - margin - bandHeight,
    width: bandWidth,
    height: bandHeight,
  };
  const x = band.x + pad;
  const header: Rect = { x, y: band.y + pad, width: inner, height: D.header * k };
  const statsArea: Rect = {
    x,
    y: header.y + header.height + D.gap * k,
    width: inner,
    height: statsHeight,
  };
  const stats =
    rows > 0
      ? layoutStats(statCount, statsArea, {
          gap: D.statGap * k,
          minWidth: D.statMin * k,
          rowGap: D.gap * 0.6 * k,
        })
      : [];
  const ruleY =
    (rows > 0 ? statsArea.y + statsArea.height : header.y + header.height) + D.ruleGap * k;
  const footer: Rect = { x, y: ruleY + D.ruleGap * k, width: inner, height: D.footer * k };
  return { k, margin, pad, band, header, stats, ruleY, footer };
}

/** Width of a drawn tier chip: padding, dot, gap and label. */
export function chipWidth(label: string, measure: Measure, k = 1): number {
  return Math.ceil(measure(label) + (9 + 7 + 6 + 10) * k);
}

/** Lower-case ASCII words joined by hyphens, at most `max` characters, cut at a hyphen. */
export function slugify(text: string, max = 40): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const dash = cut.lastIndexOf('-');
  return (dash > max * 0.5 ? cut.slice(0, dash) : cut).replace(/-+$/, '');
}

/**
 * The file name for a card: token-metropolis[-<title>]-<yyyy-mm-dd>-<hhmm>z.png, in UTC. The title
 * part is dropped when it is empty or just the site name.
 */
export function shareFileName(title: string, at: Date, site = 'Token Metropolis'): string {
  const base = slugify(site, 40) || 'share';
  const topic = slugify(title, 40);
  const valid = Number.isFinite(at.getTime());
  const iso = valid ? at.toISOString() : '';
  const stamp = valid ? `-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}z` : '';
  const middle = topic && topic !== base ? `-${topic}` : '';
  return `${base}${middle}${stamp}.png`;
}

/** A url as printed on the card: no scheme, no "www.", no trailing slash, no query or hash. */
export function displayUrl(url: string): string {
  return url
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}
