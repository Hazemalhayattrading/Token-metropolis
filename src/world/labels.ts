/**
 * HTML labels that follow each campus. They are real <button>s, so the city is
 * navigable by keyboard and screen reader (Tab to an HQ, Enter to fly there).
 * Overlaps are resolved by priority (larger platforms keep full labels; others
 * fall back to name-only, then to a dot).
 */
import { Vector3, type PerspectiveCamera } from 'three';
import { COPY } from '../copy';
import type { Tier } from '../model/types';

export interface LabelSpec {
  id: string;
  name: string;
  accent: string;
}

export interface LabelValue {
  text: string;
  tier: Tier;
  /** Higher wins when labels overlap. */
  priority: number;
}

export interface Labels {
  update(
    camera: PerspectiveCamera,
    positions: ReadonlyMap<string, Vector3>,
    values: ReadonlyMap<string, LabelValue>,
  ): void;
  setSelected(id: string | null): void;
  setHovered(id: string | null): void;
  dispose(): void;
}

type Mode = 'full' | 'compact' | 'dot';

interface El {
  root: HTMLButtonElement;
  value: HTMLSpanElement;
  tier: HTMLSpanElement;
  text: string;
  size: { w: number; h: number };
  mode: Mode;
}

export function createLabels(
  container: HTMLElement,
  specs: readonly LabelSpec[],
  onSelect: (id: string) => void,
): Labels {
  const els = new Map<string, El>();
  for (const s of specs) {
    const root = document.createElement('button');
    root.type = 'button';
    root.className = 'label';
    root.style.setProperty('--accent', s.accent);
    root.dataset.id = s.id;
    const name = document.createElement('span');
    name.className = 'label__name';
    name.textContent = s.name;
    const value = document.createElement('span');
    value.className = 'label__value';
    const tier = document.createElement('span');
    tier.className = 'tier-dot';
    const valueText = document.createElement('span');
    value.append(tier, valueText);
    root.append(name, value);
    root.addEventListener('click', () => onSelect(s.id));
    container.append(root);
    els.set(s.id, {
      root,
      value: valueText,
      tier,
      text: '',
      size: { w: 120, h: 34 },
      mode: 'full',
    });
  }

  let selected: string | null = null;
  let hovered: string | null = null;
  const v = new Vector3();

  function setMode(el: El, mode: Mode): void {
    if (el.mode === mode) return;
    el.mode = mode;
    el.root.classList.toggle('label--compact', mode === 'compact');
    el.root.classList.toggle('label--dot', mode === 'dot');
  }

  return {
    update(camera, positions, values) {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
      // UI chrome (masthead, HUD, controls, panel) is off-limits for labels.
      const origin = container.getBoundingClientRect();
      for (const el of document.querySelectorAll<HTMLElement>('[data-reserve]')) {
        if (el.hidden || el.offsetParent === null) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        placed.push({
          x0: r.left - origin.left,
          y0: r.top - origin.top,
          x1: r.right - origin.left,
          y1: r.bottom - origin.top,
        });
      }
      const items: { id: string; el: El; x: number; y: number; priority: number }[] = [];
      for (const [id, el] of els) {
        const p = positions.get(id);
        const val = values.get(id);
        if (!p || !val || !val.text) {
          el.root.classList.add('label--hidden');
          continue;
        }
        v.copy(p).project(camera);
        const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        el.root.classList.toggle('label--hidden', !visible);
        if (!visible) continue;
        if (el.text !== val.text) {
          el.text = val.text;
          el.value.textContent = val.text;
          setMode(el, 'full');
          el.size = { w: el.root.offsetWidth, h: el.root.offsetHeight };
        }
        if (el.tier.dataset.tier !== val.tier) {
          el.tier.dataset.tier = val.tier;
          el.tier.className = `tier-dot tier-dot--${val.tier}`;
          el.tier.title = COPY.tiers[val.tier];
          el.tier.setAttribute('aria-label', COPY.tiers[val.tier]);
        }
        const boost = id === selected || id === hovered ? 1e30 : 0;
        items.push({
          id,
          el,
          x: (v.x * 0.5 + 0.5) * w,
          y: (-v.y * 0.5 + 0.5) * h,
          priority: val.priority + boost,
        });
      }
      items.sort((a, b) => b.priority - a.priority);
      const overlaps = (x0: number, y0: number, x1: number, y1: number) =>
        placed.some((r) => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0);
      for (const it of items) {
        const { w: lw, h: lh } = it.el.size;
        const candidates: [Mode, number, number][] = [
          ['full', lw, lh],
          ['compact', lw, 22],
          ['dot', 14, 14],
        ];
        let mode: Mode = 'dot';
        let lift = 0;
        search: for (const [m, cw, ch] of candidates) {
          // Try directly above the anchor, then lifted on a longer leader line.
          for (const l of m === 'dot' ? [0] : [0, ch + 6, 2 * (ch + 6)]) {
            const box = [
              it.x - cw / 2 - 3,
              it.y - ch - 9 - l,
              it.x + cw / 2 + 3,
              it.y - 7 - l,
            ] as const;
            const inside = box[1] >= 4 && box[0] >= 0 && box[2] <= w;
            if ((inside && !overlaps(...box)) || m === 'dot') {
              mode = m;
              lift = l;
              placed.push({ x0: box[0], y0: box[1], x1: box[2], y1: box[3] });
              break search;
            }
          }
        }
        setMode(it.el, mode);
        it.el.root.style.setProperty('--lead', `${7 + lift}px`);
        it.el.root.style.transform = `translate(${it.x.toFixed(1)}px, ${(it.y - lift).toFixed(1)}px) translate(-50%, -100%)`;
        const dist = camera.position.distanceTo(positions.get(it.id)!);
        it.el.root.style.setProperty('--fade', String(Math.max(0.45, Math.min(1, 220 / dist))));
      }
    },
    setSelected(id) {
      selected = id;
      for (const [k, el] of els) el.root.classList.toggle('label--selected', k === id);
    },
    setHovered(id) {
      hovered = id;
      for (const [k, el] of els) el.root.classList.toggle('label--hover', k === id);
    },
    dispose() {
      els.forEach((el) => el.root.remove());
    },
  };
}
