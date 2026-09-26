import { describe, expect, it } from 'vitest';
import { COPY } from '../copy';
import {
  cardLayout,
  chipWidth,
  coverCrop,
  displayUrl,
  firstFitting,
  fitFontSize,
  fitText,
  layoutStats,
  MAX_SHARE_STATS,
  SHARE_SIZE,
  shareFileName,
  slugify,
  statRows,
  TIER_COLORS,
  wrapText,
  type Rect,
} from './share';

/** A monospace font: every character (and the ellipsis) is 10 px wide. */
const mono = (s: string) => [...s].length * 10;
/** Width at a font size: half the size per character. */
const at = (s: string, size: number) => [...s].length * size * 0.5;

const inside = (a: Rect, b: Rect) =>
  a.x >= b.x - 1e-9 &&
  a.y >= b.y - 1e-9 &&
  a.x + a.width <= b.x + b.width + 1e-9 &&
  a.y + a.height <= b.y + b.height + 1e-9;
const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width - 1e-9 &&
  b.x < a.x + a.width - 1e-9 &&
  a.y < b.y + b.height - 1e-9 &&
  b.y < a.y + a.height - 1e-9;

describe('fitText', () => {
  it('keeps text that fits (tidying whitespace)', () => {
    expect(fitText('Hello world', 200, mono)).toBe('Hello world');
    expect(fitText('  Hello   world ', 200, mono)).toBe('Hello world');
  });

  it('shortens with an ellipsis, preferring a word boundary', () => {
    const out = fitText('Tokens processed today across the city', 200, mono);
    expect(mono(out)).toBeLessThanOrEqual(200);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toBe('Tokens processed…');
  });

  it('cuts inside a long word when no boundary is close', () => {
    const out = fitText('Supercalifragilistic', 100, mono);
    expect(out).toBe('Supercali…');
    expect(mono(out)).toBeLessThanOrEqual(100);
  });

  it('never leaves dangling punctuation before the ellipsis', () => {
    expect(fitText('Live · 14:32 UTC · 2026-09-26', 90, mono)).toBe('Live…');
    expect(fitText('One, two, three, four', 100, mono)).toBe('One, two…');
  });

  it('handles tiny widths and empty text', () => {
    expect(fitText('Hello', 15, mono)).toBe('…');
    expect(fitText('Hello', 5, mono)).toBe('');
    expect(fitText('', 100, mono)).toBe('');
  });

  it('counts characters, not UTF-16 units', () => {
    const out = fitText('🙂🙂🙂🙂🙂🙂', 40, mono);
    expect(out).toBe('🙂🙂🙂…');
  });
});

describe('fitFontSize', () => {
  it('picks the largest size that fits', () => {
    // 10 characters at size s are 5·s wide: 200 px fits size 40.
    expect(fitFontSize('ABCDEFGHIJ', 200, at, 60, 12)).toBe(40);
    expect(fitFontSize('ABCDEFGHIJ', 1000, at, 60, 12)).toBe(60);
  });

  it('falls back to the minimum', () => {
    expect(fitFontSize('ABCDEFGHIJ', 10, at, 60, 12)).toBe(12);
  });
});

describe('wrapText', () => {
  it('wraps greedily on words', () => {
    expect(wrapText('aaa bbb ccc ddd', 70, mono, 3)).toEqual(['aaa bbb', 'ccc ddd']);
  });

  it('ends the last line with an ellipsis when text is left over', () => {
    const lines = wrapText('aaa bbb ccc ddd eee fff', 70, mono, 2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('aaa bbb');
    expect(lines[1]!.endsWith('…')).toBe(true);
    for (const l of lines) expect(mono(l)).toBeLessThanOrEqual(70);
  });

  it('shortens a single word wider than a line', () => {
    const lines = wrapText('incomprehensibilities ok', 100, mono, 2);
    expect(lines[0]).toBe('incompreh…');
    expect(lines[1]).toBe('ok');
  });

  it('returns nothing for empty text', () => {
    expect(wrapText('   ', 100, mono, 2)).toEqual([]);
  });
});

describe('firstFitting', () => {
  it('returns the first candidate that fits', () => {
    expect(firstFitting(['a long disclaimer here', 'shorter one', 'tiny'], 120, mono)).toBe(
      'shorter one',
    );
  });

  it('shortens the last candidate when none fits', () => {
    expect(firstFitting(['way too long', 'still long'], 60, mono)).toBe('still…');
  });

  it('works on the real disclaimers: the full one, then the short ones', () => {
    const list = [
      COPY.footer.disclaimer,
      COPY.share.disclaimerShort,
      COPY.share.disclaimerShortest,
    ];
    expect(firstFitting(list, 10_000, mono)).toBe(COPY.footer.disclaimer);
    expect(firstFitting(list, mono(COPY.share.disclaimerShort), mono)).toBe(
      COPY.share.disclaimerShort,
    );
    const shortest = firstFitting(list, mono(COPY.share.disclaimerShortest), mono);
    expect(shortest).toBe(COPY.share.disclaimerShortest);
    // The shortened forms keep the two things that must never be lost.
    for (const s of [COPY.share.disclaimerShort, COPY.share.disclaimerShortest]) {
      expect(s).toMatch(/Independent project/);
      expect(s).toMatch(/unless marked Reported/);
    }
  });
});

describe('coverCrop', () => {
  it('crops the sides of a wider image, centred', () => {
    const r = coverCrop(2000, 1000, 1200, 630);
    expect(r.x).toBeCloseTo((2000 - 1000 * (1200 / 630)) / 2, 9);
    expect(r.y).toBe(0);
    expect(r.width).toBeCloseTo(1000 * (1200 / 630), 9);
    expect(r.height).toBeCloseTo(1000, 9);
  });

  it('crops top and bottom of a taller image, centred', () => {
    const r = coverCrop(800, 1600, 1200, 630);
    expect(r.x).toBe(0);
    expect(r.width).toBe(800);
    expect(r.height).toBeCloseTo(800 * (630 / 1200), 9);
    expect(r.y).toBeCloseTo((1600 - r.height) / 2, 9);
  });

  it('keeps the aspect of the destination and stays inside the source', () => {
    for (const [sw, sh] of [
      [1440, 900],
      [390, 844],
      [3000, 3000],
      [1, 1],
    ] as const) {
      const r = coverCrop(sw, sh, 1200, 630);
      expect(r.width / r.height).toBeCloseTo(1200 / 630, 6);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(sw + 1e-9);
      expect(r.y + r.height).toBeLessThanOrEqual(sh + 1e-9);
    }
  });

  it('degrades safely for empty sizes', () => {
    expect(coverCrop(0, 0, 1200, 630)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(coverCrop(100, 50, 0, 630)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });
});

describe('layoutStats', () => {
  const area: Rect = { x: 50, y: 300, width: 1000, height: 90 };

  it('puts up to four stats in one row of equal cells', () => {
    const cells = layoutStats(4, area, { gap: 20, minWidth: 180 });
    expect(cells).toHaveLength(4);
    expect(cells.every((c) => c.y === 300 && c.height === 90)).toBe(true);
    expect(cells[0]!.width).toBeCloseTo((1000 - 60) / 4, 9);
    expect(cells[3]!.x + cells[3]!.width).toBeCloseTo(1050, 9);
    for (let i = 1; i < 4; i++) expect(cells[i]!.x).toBeGreaterThan(cells[i - 1]!.x);
  });

  it('uses rows of two when cells would be too narrow', () => {
    const cells = layoutStats(
      4,
      { x: 0, y: 0, width: 500, height: 200 },
      { gap: 20, minWidth: 180, rowGap: 10 },
    );
    expect(cells.map((c) => [c.x, c.y])).toEqual([
      [0, 0],
      [260, 0],
      [0, 105],
      [260, 105],
    ]);
    const three = layoutStats(
      3,
      { x: 0, y: 0, width: 500, height: 200 },
      { gap: 20, minWidth: 180 },
    );
    expect(three).toHaveLength(3);
    expect(three[2]!.y).toBeGreaterThan(0);
  });

  it('caps the count at four and handles none', () => {
    expect(layoutStats(9, area, { gap: 20, minWidth: 10 })).toHaveLength(MAX_SHARE_STATS);
    expect(layoutStats(0, area, { gap: 20, minWidth: 10 })).toEqual([]);
    expect(layoutStats(-2, area, { gap: 20, minWidth: 10 })).toEqual([]);
    expect(statRows(0, 1000, 20, 100)).toBe(0);
    expect(statRows(4, 1000, 20, 100)).toBe(1);
    expect(statRows(4, 300, 20, 100)).toBe(2);
  });
});

describe('cardLayout', () => {
  it('fits a band with header, stats and footer inside the default card', () => {
    const { width, height } = SHARE_SIZE;
    const L = cardLayout(width, height, 4);
    const card: Rect = { x: 0, y: 0, width, height };
    expect(L.k).toBe(1);
    expect(inside(L.band, card)).toBe(true);
    expect(inside(L.header, L.band)).toBe(true);
    expect(inside(L.footer, L.band)).toBe(true);
    expect(L.stats).toHaveLength(4);
    for (const s of L.stats) {
      expect(inside(s, L.band)).toBe(true);
      expect(overlap(s, L.header)).toBe(false);
      expect(overlap(s, L.footer)).toBe(false);
    }
    for (let i = 1; i < L.stats.length; i++)
      expect(overlap(L.stats[i]!, L.stats[i - 1]!)).toBe(false);
    expect(L.ruleY).toBeGreaterThan(L.stats[0]!.y + L.stats[0]!.height);
    expect(L.ruleY).toBeLessThan(L.footer.y);
    // The rendered view keeps at least the upper third of the card.
    expect(L.band.y).toBeGreaterThan(height / 3);
  });

  it('shrinks the band when there are no stats', () => {
    const four = cardLayout(1200, 630, 4);
    const none = cardLayout(1200, 630, 0);
    expect(none.stats).toEqual([]);
    expect(none.band.height).toBeLessThan(four.band.height);
    expect(none.ruleY).toBeGreaterThan(none.header.y + none.header.height);
  });

  it('scales for other sizes and stacks stats on narrow cards', () => {
    for (const [w, h] of [
      [600, 315],
      [1080, 1080],
      [2400, 1260],
      [720, 1280],
    ] as const) {
      const L = cardLayout(w, h, 4);
      const card: Rect = { x: 0, y: 0, width: w, height: h };
      expect(inside(L.band, card), `${w}×${h}`).toBe(true);
      for (const s of L.stats) expect(inside(s, L.band), `${w}×${h}`).toBe(true);
      expect(inside(L.footer, L.band), `${w}×${h}`).toBe(true);
    }
    expect(cardLayout(2400, 1260, 4).k).toBe(2);
    expect(cardLayout(600, 315, 4).k).toBe(0.5);
  });
});

describe('chipWidth', () => {
  it('adds padding, dot and gap to the label', () => {
    expect(chipWidth('Estimated', mono)).toBe(90 + 32);
    expect(chipWidth('Estimated', mono, 2)).toBe(90 + 64);
  });
});

describe('TIER_COLORS', () => {
  it('matches the tier colours of the stylesheet', () => {
    expect(TIER_COLORS).toEqual({ reported: '#46d98a', derived: '#ffb627', modeled: '#a7b0c0' });
  });
});

describe('file names and urls', () => {
  const when = new Date(Date.UTC(2026, 8, 26, 14, 32, 5));

  it('slugifies to lower-case ASCII words', () => {
    expect(slugify('Tokens processed today')).toBe('tokens-processed-today');
    expect(slugify('Character.AI — Model lab')).toBe('character-ai-model-lab');
    expect(slugify('Déjà vu')).toBe('deja-vu');
    expect(slugify('  ***  ')).toBe('');
    expect(slugify('a-very-long-title-that-keeps-going-and-going', 20)).toBe('a-very-long-title');
  });

  it('names the file after the site, the topic and the UTC time', () => {
    expect(shareFileName('ChatGPT', when)).toBe('token-metropolis-chatgpt-2026-09-26-1432z.png');
    expect(shareFileName('', when)).toBe('token-metropolis-2026-09-26-1432z.png');
    expect(shareFileName('Token Metropolis', when)).toBe('token-metropolis-2026-09-26-1432z.png');
    expect(shareFileName('Microsoft Copilot', new Date(Number.NaN))).toBe(
      'token-metropolis-microsoft-copilot.png',
    );
    expect(shareFileName('x/../../etc', when)).toMatch(/^[a-z0-9-]+\.png$/);
  });

  it('prints urls without scheme, www, query or trailing slash', () => {
    expect(displayUrl('https://example.github.io/Token-metropolis/')).toBe(
      'example.github.io/Token-metropolis',
    );
    expect(displayUrl('http://www.example.org/?utm=1#top')).toBe('example.org');
    expect(displayUrl('example.org')).toBe('example.org');
  });
});
