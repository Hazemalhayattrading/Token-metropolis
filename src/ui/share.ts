/**
 * Share card (brief §5.3 item 10): a PNG of the current view with its key
 * numbers — every value keeps its range and its tier chip, drawn in the same
 * colours and words as on the site — plus the disclaimer and the site's url.
 *
 * - composeShareCard: the frame (a 2D canvas copy of the rendered view,
 *   cover-cropped) under a glass band with the site name, title, subtitle, up
 *   to four stats, the disclaimer and the url. Layout rules live in
 *   src/state/share.ts (pure, tested).
 * - mountShareButton: a control-row "Share" button → capture → compose → a
 *   small modal preview with Download PNG, Share… (when the system share sheet
 *   takes files) and Close. Focus stays in the dialog, Escape closes it and
 *   focus returns to the button. Failures show a friendly message; nothing
 *   ever rejects unhandled.
 * - snapshotCanvas: copies a (WebGL) canvas into a 2D canvas right after a
 *   render, for the integrator's capture().
 */
import { COPY } from '../copy';
import type { Tier } from '../model/types';
import {
  cardLayout,
  chipWidth,
  coverCrop,
  displayUrl,
  firstFitting,
  fitFontSize,
  fitText,
  MAX_SHARE_STATS,
  SHARE_SIZE,
  shareFileName,
  TIER_COLORS,
  type Rect,
} from '../state/share';
import { h } from './dom';

export interface ShareStat {
  readonly label: string;
  readonly value: string;
  readonly tier: Tier;
  readonly range?: string;
}

export interface ShareInput {
  /** A 2D canvas holding the current rendered view. */
  readonly frame: HTMLCanvasElement;
  readonly title: string;
  /** E.g. the date and time (UTC) and whether it is live or history. */
  readonly subtitle: string;
  readonly stats: readonly ShareStat[];
  readonly url: string;
}

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------

const DISPLAY = '"Fraunces Variable", Georgia, "Times New Roman", serif';
const UI = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_TIMEOUT_MS = 2500;
/** Small text scales with the card but never below 8 px. */
const small = (base: number, k: number) => Math.max(8, base * k);

/** Site colours, read from the stylesheet's tokens when present (fallbacks match main.css). */
function palette() {
  let css: CSSStyleDeclaration | null = null;
  try {
    css = getComputedStyle(document.documentElement);
  } catch {
    css = null;
  }
  const v = (name: string, fallback: string) => css?.getPropertyValue(name).trim() || fallback;
  return {
    text: v('--text', '#eef1f8'),
    muted: v('--muted', '#9aa6bd'),
    faint: v('--faint', '#8490a8'),
    accent: v('--accent', '#ffc566'),
    bg: v('--bg', '#05070d'),
    tier: {
      reported: v('--tier-reported', TIER_COLORS.reported),
      derived: v('--tier-derived', TIER_COLORS.derived),
      modeled: v('--tier-modeled', TIER_COLORS.modeled),
    } satisfies Record<Tier, string>,
  };
}

/** Wait for the site's fonts (loading the weights the card uses), but never hang on them. */
async function fontsReady(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  const load = async () => {
    await Promise.all(
      [`400 40px ${DISPLAY}`, `400 14px ${UI}`, `500 14px ${UI}`, `600 30px ${UI}`].map((f) =>
        fonts.load(f).catch(() => []),
      ),
    );
    await fonts.ready;
  };
  let timer = 0;
  try {
    await Promise.race([
      load(),
      new Promise<void>((resolve) => (timer = window.setTimeout(resolve, FONT_TIMEOUT_MS))),
    ]);
  } catch {
    // Draw with the fallback fonts.
  } finally {
    window.clearTimeout(timer);
  }
}

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

function roundRect(ctx: Ctx, r: Rect, radius: number): void {
  const rad = Math.max(0, Math.min(radius, r.width / 2, r.height / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(r.x, r.y, r.width, r.height, rad);
    return;
  }
  ctx.moveTo(r.x + rad, r.y);
  ctx.arcTo(r.x + r.width, r.y, r.x + r.width, r.y + r.height, rad);
  ctx.arcTo(r.x + r.width, r.y + r.height, r.x, r.y + r.height, rad);
  ctx.arcTo(r.x, r.y + r.height, r.x, r.y, rad);
  ctx.arcTo(r.x, r.y, r.x + r.width, r.y, rad);
  ctx.closePath();
}

function setSpacing(ctx: Ctx, px: number): void {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

function supportsFilter(ctx: Ctx): boolean {
  if (!('filter' in ctx)) return false;
  const before = ctx.filter;
  ctx.filter = 'blur(1px)';
  const ok = ctx.filter === 'blur(1px)';
  ctx.filter = before;
  return ok;
}

function hasPixels(frame: HTMLCanvasElement | null | undefined): frame is HTMLCanvasElement {
  return !!frame && frame.width > 0 && frame.height > 0;
}

function drawFrame(ctx: Ctx, frame: HTMLCanvasElement, W: number, H: number): void {
  const c = coverCrop(frame.width, frame.height, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(frame, c.x, c.y, c.width, c.height, 0, 0, W, H);
}

/** The view, or (with no usable frame) the night sky of the loader. */
function drawBackground(
  ctx: Ctx,
  frame: HTMLCanvasElement | null,
  W: number,
  H: number,
  bg: string,
): void {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  if (frame) drawFrame(ctx, frame, W, H);
  else {
    const g = ctx.createRadialGradient(W / 2, H * 1.1, 0, W / 2, H * 1.1, Math.max(W, H));
    g.addColorStop(0, '#16204a');
    g.addColorStop(0.6, bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // Keep the band legible over any view: the lower part darkens gently, the corners a little.
  const shade = ctx.createLinearGradient(0, H * 0.35, 0, H);
  shade.addColorStop(0, 'rgba(5, 7, 13, 0)');
  shade.addColorStop(1, 'rgba(5, 7, 13, 0.62)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  const vignette = ctx.createRadialGradient(
    W / 2,
    H / 2,
    Math.min(W, H) * 0.35,
    W / 2,
    H / 2,
    Math.hypot(W, H) * 0.6,
  );
  vignette.addColorStop(0, 'rgba(5, 7, 13, 0)');
  vignette.addColorStop(1, 'rgba(5, 7, 13, 0.4)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
}

/** Frosted glass: the view blurred under the band (where the browser can), a tinted fill, a hairline. */
function drawGlass(
  ctx: Ctx,
  frame: HTMLCanvasElement | null,
  band: Rect,
  k: number,
  W: number,
  H: number,
): void {
  const radius = 18 * k;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
  ctx.shadowBlur = 40 * k;
  ctx.shadowOffsetY = 10 * k;
  roundRect(ctx, band, radius);
  ctx.fillStyle = 'rgba(12, 17, 32, 0.9)';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, band, radius);
  ctx.clip();
  if (frame && supportsFilter(ctx)) {
    ctx.filter = `blur(${Math.round(16 * k)}px) saturate(1.2)`;
    drawFrame(ctx, frame, W, H);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(12, 17, 32, 0.7)';
  } else {
    ctx.fillStyle = 'rgba(12, 17, 32, 0.88)';
  }
  ctx.fillRect(band.x, band.y, band.width, band.height);
  // a soft light along the top edge
  const sheen = ctx.createLinearGradient(0, band.y, 0, band.y + 60 * k);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(band.x, band.y, band.width, 60 * k);
  ctx.restore();

  roundRect(
    ctx,
    { x: band.x + 0.5, y: band.y + 0.5, width: band.width - 1, height: band.height - 1 },
    radius,
  );
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.stroke();
}

/** A tier chip as on the site: a pill in the tier colour with a dot and the tier's word. */
function drawChip(
  ctx: Ctx,
  tier: Tier,
  right: number,
  top: number,
  k: number,
  color: string,
): number {
  const label = COPY.tiers[tier];
  ctx.font = `600 ${small(11.5, k)}px ${UI}`;
  setSpacing(ctx, 0.3 * k);
  const width = chipWidth(label, (t) => ctx.measureText(t).width, k);
  const height = Math.max(13, 20 * k);
  const r: Rect = { x: right - width, y: top, width, height };
  roundRect(ctx, r, height / 2);
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  roundRect(
    ctx,
    { x: r.x + 0.6 * k, y: r.y + 0.6 * k, width: r.width - 1.2 * k, height: r.height - 1.2 * k },
    height / 2,
  );
  ctx.lineWidth = 1.2 * k;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(r.x + 9 * k + 3.5 * k, r.y + height / 2, 3.5 * k, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + (9 + 7 + 6) * k, r.y + height / 2 + 0.5 * k);
  setSpacing(ctx, 0);
  return width;
}

/** Draw the card; resolves with a PNG. */
export async function composeShareCard(
  input: ShareInput,
  size: { width: number; height: number } = SHARE_SIZE,
): Promise<Blob> {
  await fontsReady();
  const W = Math.max(200, Math.round(size.width));
  const H = Math.max(120, Math.round(size.height));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d') as Ctx | null;
  if (!ctx) throw new Error('A 2D canvas is not available.');
  const colors = palette();
  const frame = hasPixels(input.frame) ? input.frame : null;
  const stats = input.stats.slice(0, MAX_SHARE_STATS);
  const L = cardLayout(W, H, stats.length);
  const k = L.k;
  const measure = (t: string) => ctx.measureText(t).width;

  drawBackground(ctx, frame, W, H, colors.bg);
  drawGlass(ctx, frame, L.band, k, W, H);

  // --- header: site name, title (left), subtitle (right) --------------------------------------
  const hd = L.header;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = colors.accent;
  ctx.font = `600 ${small(12.5, k)}px ${UI}`;
  setSpacing(ctx, 1.8 * k);
  ctx.fillText(fitText(COPY.siteName.toUpperCase(), hd.width * 0.6, measure), hd.x, hd.y + 13 * k);
  setSpacing(ctx, 0);

  ctx.font = `500 ${small(15, k)}px ${UI}`;
  const subtitle = fitText(input.subtitle, hd.width * 0.4, measure);
  const subWidth = measure(subtitle);
  const titleMax = hd.width - (subWidth > 0 ? subWidth + 28 * k : 0);
  const titleSize = fitFontSize(
    input.title,
    titleMax,
    (t, s) => {
      ctx.font = `400 ${s}px ${DISPLAY}`;
      return ctx.measureText(t).width;
    },
    36 * k,
    Math.max(12, 22 * k),
  );
  ctx.font = `400 ${titleSize}px ${DISPLAY}`;
  ctx.fillStyle = colors.text;
  const titleBase = hd.y + hd.height - 6 * k;
  ctx.fillText(fitText(input.title, titleMax, measure), hd.x, titleBase);
  ctx.font = `500 ${small(15, k)}px ${UI}`;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'right';
  ctx.fillText(subtitle, hd.x + hd.width, titleBase);

  // --- stats: label + tier chip, value, range ---------------------------------------------------
  stats.forEach((s, i) => {
    const c = L.stats[i];
    if (!c) return;
    if (i > 0 && Math.abs(c.y - L.stats[i - 1]!.y) < 1) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(Math.round(c.x - 9 * k), c.y + 2 * k, 1, c.height - 6 * k);
    }
    const chip = drawChip(ctx, s.tier, c.x + c.width - 4 * k, c.y, k, colors.tier[s.tier]);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `500 ${small(12, k)}px ${UI}`;
    setSpacing(ctx, 0.9 * k);
    ctx.fillStyle = colors.muted;
    ctx.fillText(
      fitText(s.label.toUpperCase(), c.width - chip - 14 * k, measure),
      c.x,
      c.y + 14.5 * k,
    );
    setSpacing(ctx, 0);
    const valueMax = c.width - 6 * k;
    const valueSize = fitFontSize(
      s.value,
      valueMax,
      (t, sz) => {
        ctx.font = `600 ${sz}px ${UI}`;
        return ctx.measureText(t).width;
      },
      34 * k,
      Math.max(11, 18 * k),
    );
    ctx.font = `600 ${valueSize}px ${UI}`;
    ctx.fillStyle = colors.text;
    ctx.fillText(fitText(s.value, valueMax, measure), c.x, c.y + 56 * k);
    if (s.range) {
      ctx.font = `400 ${small(13.5, k)}px ${UI}`;
      ctx.fillStyle = colors.faint;
      ctx.fillText(fitText(s.range, valueMax, measure), c.x, c.y + 79 * k);
    }
  });

  // --- footer: rule, disclaimer (left), url (right) ----------------------------------------------
  const ft = L.footer;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.fillRect(ft.x, Math.round(L.ruleY), ft.width, 1);
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 ${small(13, k)}px ${UI}`;
  const url = fitText(displayUrl(input.url), ft.width * 0.42, measure);
  const urlWidth = measure(url);
  ctx.fillStyle = colors.accent;
  ctx.textAlign = 'right';
  const footBase = ft.y + ft.height - 4 * k;
  ctx.fillText(url, ft.x + ft.width, footBase);
  ctx.font = `400 ${small(12, k)}px ${UI}`;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'left';
  const room = ft.width - (urlWidth > 0 ? urlWidth + 24 * k : 0);
  ctx.fillText(
    firstFitting(
      [COPY.footer.disclaimer, COPY.share.disclaimerShort, COPY.share.disclaimerShortest],
      room,
      measure,
    ),
    ft.x,
    footBase,
  );

  return toPng(canvas);
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))),
        'image/png',
      );
    } catch (e) {
      // e.g. a canvas tainted by a cross-origin image
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Copy a canvas into a new 2D canvas. A WebGL canvas without preserveDrawingBuffer only holds its
 * pixels until the browser presents the frame, so pass `render` to draw a fresh frame first: the
 * copy then happens in the same task, right after it.
 */
export function snapshotCanvas(source: HTMLCanvasElement, render?: () => void): HTMLCanvasElement {
  render?.();
  const out = document.createElement('canvas');
  out.width = Math.max(1, source.width);
  out.height = Math.max(1, source.height);
  out.getContext('2d')?.drawImage(source, 0, 0);
  return out;
}

// ---------------------------------------------------------------------------
// button + dialog
// ---------------------------------------------------------------------------

let uid = 0;

const ICON =
  'M12 3v11m0-11L8 7m4-4 4 4M6 11H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1';

function icon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('share__icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICON);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
const ERROR_MS = 6000;

export function mountShareButton(
  root: HTMLElement,
  opts: { capture(): Promise<ShareInput> },
): { dispose(): void } {
  const n = ++uid;
  const titleId = `share-title-${n}`;
  const noteId = `share-note-${n}`;

  // Both labels share one grid cell, so the button keeps its width while busy.
  const idle = h('span', { class: 'share__label' }, COPY.share.button);
  const busy = h(
    'span',
    { class: 'share__label share__label--busy', 'aria-hidden': 'true' },
    COPY.share.busy,
  );
  const button = h(
    'button',
    {
      class: 'share__button',
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-label': COPY.share.buttonLabel,
      title: COPY.share.buttonLabel,
    },
    icon(),
    h('span', { class: 'share__labels' }, idle, busy),
  );
  const errorText = h('span', { class: 'share__error-text' });
  const dismiss = h(
    'button',
    {
      class: 'share__dismiss',
      type: 'button',
      'aria-label': COPY.share.dismiss,
      title: COPY.share.dismiss,
    },
    '×',
  );
  const bubble = h('div', { class: 'share__error', hidden: true }, errorText, dismiss);
  // The live region stays in the DOM so the message is announced when it appears.
  const live = h('p', { class: 'share-sr', role: 'status', 'aria-live': 'polite' });
  const wrap = h('div', { class: 'share' }, button, bubble, live);
  root.replaceChildren(wrap);

  // --- dialog (in <body>, so no stacking context or hidden control row can trap it) ---------------
  const img = h('img', {
    class: 'share-dialog__img',
    alt: '',
    width: SHARE_SIZE.width,
    height: SHARE_SIZE.height,
    decoding: 'async',
  });
  const download = h(
    'a',
    {
      class: 'share-dialog__action share-dialog__action--primary',
      href: '#',
      download: 'token-metropolis.png',
    },
    COPY.share.download,
  );
  const shareBtn = h(
    'button',
    { class: 'share-dialog__action', type: 'button', hidden: true },
    COPY.share.share,
  );
  const closeBtn = h('button', { class: 'share-dialog__action', type: 'button' }, COPY.share.close);
  const closeX = h(
    'button',
    {
      class: 'share-dialog__close',
      type: 'button',
      'aria-label': COPY.share.close,
      title: COPY.share.close,
    },
    '×',
  );
  const status = h('p', { class: 'share-dialog__status', role: 'status', 'aria-live': 'polite' });
  const dialog = h(
    'dialog',
    { class: 'share-dialog', 'aria-labelledby': titleId, 'aria-describedby': noteId },
    h(
      'div',
      { class: 'share-dialog__inner' },
      h(
        'header',
        { class: 'share-dialog__header' },
        h('h2', { class: 'share-dialog__title', id: titleId }, COPY.share.dialogTitle),
        closeX,
      ),
      h('figure', { class: 'share-dialog__figure' }, img),
      h('p', { class: 'share-dialog__note', id: noteId }, COPY.share.dialogNote),
      status,
      h('div', { class: 'share-dialog__actions' }, download, shareBtn, closeBtn),
    ),
  );
  const reducedMotion = (() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  })();
  if (reducedMotion) dialog.classList.add('share-dialog--static');

  let working = false;
  let disposed = false;
  let isOpen = false;
  let objectUrl: string | null = null;
  let file: File | null = null;
  let shareText = '';
  let errorTimer = 0;

  function setBusy(on: boolean): void {
    working = on;
    button.classList.toggle('share__button--busy', on);
    if (on) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
    idle.setAttribute('aria-hidden', String(on));
    busy.setAttribute('aria-hidden', String(!on));
  }

  function hideError(): void {
    window.clearTimeout(errorTimer);
    bubble.hidden = true;
  }

  function showError(message: string): void {
    errorText.textContent = message;
    bubble.hidden = false;
    // Open downwards when the control row sits in the upper half (phones), and stay on screen.
    const r = button.getBoundingClientRect();
    bubble.dataset.placement = r.top < window.innerHeight / 2 ? 'bottom' : 'top';
    bubble.style.left = '0px';
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const right = bubble.getBoundingClientRect().right;
    if (right > vw - 12) bubble.style.left = `${Math.round(vw - 12 - right)}px`;
    live.textContent = '';
    live.textContent = message;
    window.clearTimeout(errorTimer);
    errorTimer = window.setTimeout(hideError, ERROR_MS);
  }

  function focusables(): HTMLElement[] {
    return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => !el.hidden && el.getClientRects().length > 0,
    );
  }

  const onKey = (e: KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      // The city also closes its HQ panel on Escape: this one is ours.
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
      return;
    }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (list.length === 0) {
      e.preventDefault();
      return;
    }
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialog.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };
  const onCancel = (e: Event) => {
    e.preventDefault();
    closeDialog();
  };
  const onNativeClose = () => {
    if (isOpen) closeDialog();
  };
  // A click on the backdrop (outside the panel) closes the dialog.
  const onDialogClick = (e: MouseEvent) => {
    if (e.target === dialog) closeDialog();
  };

  function openDialog(blob: Blob, input: ShareInput): void {
    releaseUrl();
    const name = shareFileName(input.title, new Date());
    objectUrl = URL.createObjectURL(blob);
    img.src = objectUrl;
    img.alt = COPY.share.previewAlt(input.title, input.subtitle);
    download.href = objectUrl;
    download.download = name;
    status.textContent = '';
    shareText = `${COPY.share.shareText(input.title)} ${input.url}`.trim();
    file = null;
    try {
      const f = new File([blob], name, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (
        typeof nav.canShare === 'function' &&
        typeof nav.share === 'function' &&
        nav.canShare({ files: [f] })
      )
        file = f;
    } catch {
      file = null;
    }
    shareBtn.hidden = file === null;
    if (!dialog.isConnected) document.body.append(dialog);
    isOpen = true;
    document.addEventListener('keydown', onKey, true);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onNativeClose);
    dialog.addEventListener('click', onDialogClick);
    let modal = false;
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
        modal = true;
      } catch {
        modal = false;
      }
    }
    if (!modal) {
      // No top layer: a fixed panel; the keyboard trap above keeps focus inside it.
      dialog.classList.add('share-dialog--fallback');
      dialog.setAttribute('open', '');
    }
    document.documentElement.classList.add('share-open');
    requestAnimationFrame(() => {
      if (isOpen) dialog.classList.add('share-dialog--open');
    });
    download.focus({ preventScroll: true });
  }

  function closeDialog(): void {
    if (!isOpen) return;
    isOpen = false;
    document.removeEventListener('keydown', onKey, true);
    dialog.removeEventListener('cancel', onCancel);
    dialog.removeEventListener('close', onNativeClose);
    dialog.removeEventListener('click', onDialogClick);
    dialog.classList.remove('share-dialog--open');
    if (dialog.open) {
      try {
        dialog.close();
      } catch {
        dialog.removeAttribute('open');
      }
    }
    dialog.removeAttribute('open');
    document.documentElement.classList.remove('share-open');
    if (!disposed && button.isConnected) button.focus({ preventScroll: true });
    // Let a download that was just started pick the url up before it goes.
    const url = objectUrl;
    objectUrl = null;
    if (url) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function releaseUrl(): void {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  async function run(): Promise<void> {
    if (working || disposed) return;
    hideError();
    setBusy(true);
    try {
      const input = await opts.capture();
      const blob = await composeShareCard(input);
      if (disposed) return;
      openDialog(blob, input);
    } catch (e) {
      console.warn('Share card failed:', e);
      if (!disposed) showError(COPY.share.error);
    } finally {
      if (!disposed) setBusy(false);
    }
  }

  async function shareFile(): Promise<void> {
    if (!file) return;
    status.textContent = '';
    try {
      await navigator.share({ files: [file], title: COPY.siteName, text: shareText });
    } catch (e) {
      // Closing the share sheet is not an error.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      console.warn('Share failed:', e);
      status.textContent = COPY.share.shareError;
    }
  }

  const onButton = () => void run();
  const onShare = () => void shareFile();
  const onClose = () => closeDialog();
  button.addEventListener('click', onButton);
  dismiss.addEventListener('click', hideError);
  shareBtn.addEventListener('click', onShare);
  closeBtn.addEventListener('click', onClose);
  closeX.addEventListener('click', onClose);

  return {
    dispose() {
      disposed = true;
      closeDialog();
      window.clearTimeout(errorTimer);
      releaseUrl();
      button.removeEventListener('click', onButton);
      dismiss.removeEventListener('click', hideError);
      shareBtn.removeEventListener('click', onShare);
      closeBtn.removeEventListener('click', onClose);
      closeX.removeEventListener('click', onClose);
      dialog.remove();
      root.replaceChildren();
    },
  };
}
