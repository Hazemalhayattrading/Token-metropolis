import {
  Color,
  DoubleSide,
  FrontSide,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Light,
  type Material,
  type Object3D,
} from 'three';
import { describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Tier } from '../model/types';
import {
  CASE_MARGIN,
  CASE_SCALE,
  MIN_SPAN,
  RING_LUMINANCE,
  caseGeometry,
  caseHalf,
  createUncertaintyGlass,
  frostLook,
  glassFrost,
  glassLevels,
  luminance,
  orderedHeights,
  ringColor,
  type GlassState,
  type UncertaintyGlass,
} from './uncertainty';

const TIERS: readonly Tier[] = ['reported', 'derived', 'modeled'];
const ACCENTS = ['#ffb444', '#5cf2a6', '#a98bff', '#45a6ff', '#6f86ff', '#ffe15a', '#e9eef7'];

describe('glassFrost', () => {
  it('is crisp for Reported, lightly frosted for Estimated, heavily frosted for Modeled', () => {
    const [r, d, m] = TIERS.map(glassFrost) as [number, number, number];
    for (const f of [r, d, m]) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    expect(r).toBeLessThanOrEqual(0.2);
    expect(d).toBeGreaterThan(r + 0.2);
    expect(m).toBeGreaterThan(d + 0.2);
    expect(m).toBeGreaterThanOrEqual(0.7);
  });

  it('treats anything else as the least certain', () => {
    expect(glassFrost('bogus' as Tier)).toBe(glassFrost('modeled'));
  });
});

describe('frostLook', () => {
  it('fogs the glass steadily as frost rises', () => {
    let prev = frostLook(0);
    for (let f = 0.05; f <= 1.0001; f += 0.05) {
      const l = frostLook(f);
      expect(l.veil).toBeGreaterThan(prev.veil);
      expect(l.mottle).toBeGreaterThan(prev.mottle);
      expect(l.edgeWidth).toBeGreaterThan(prev.edgeWidth);
      expect(l.edgeGlow).toBeLessThan(prev.edgeGlow);
      expect(l.haloWidth).toBeGreaterThan(prev.haloWidth);
      expect(l.haloGlow).toBeGreaterThan(prev.haloGlow);
      prev = l;
    }
  });

  it('makes Modeled glass visibly foggier than Reported glass', () => {
    const reported = frostLook(glassFrost('reported'));
    const modeled = frostLook(glassFrost('modeled'));
    expect(modeled.veil).toBeGreaterThan(reported.veil * 3);
    expect(modeled.edgeWidth).toBeGreaterThan(reported.edgeWidth * 3);
    expect(reported.edgeGlow).toBeGreaterThan(modeled.edgeGlow * 2);
    // Clear glass stays clear: it barely veils the tower and scatters no light.
    expect(reported.veil).toBeLessThan(0.1);
    expect(frostLook(0).haloGlow).toBe(0);
    // Even the heaviest frost leaves the tower visible through a single wall.
    expect(frostLook(1).veil).toBeLessThan(0.5);
  });

  it('clamps odd input', () => {
    expect(frostLook(Number.NaN)).toEqual(frostLook(0));
    expect(frostLook(-3)).toEqual(frostLook(0));
    expect(frostLook(7)).toEqual(frostLook(1));
  });
});

describe('orderedHeights', () => {
  it('orders the range and clamps garbage to zero', () => {
    expect(orderedHeights(3, 5, 9)).toEqual({ low: 3, central: 5, high: 9 });
    expect(orderedHeights(9, 5, 3)).toEqual({ low: 3, central: 5, high: 9 });
    // Inconsistent input widens the range to cover all three values.
    expect(orderedHeights(4, 12, 8)).toEqual({ low: 4, central: 12, high: 12 });
    expect(orderedHeights(Number.NaN, -2, Number.POSITIVE_INFINITY)).toEqual({
      low: 0,
      central: 0,
      high: 0,
    });
  });
});

describe('glassLevels', () => {
  const values = [0, 0.005, 0.1, 0.35, 3, 3.05, 7.06, 13.4, 22.7, 39.3, 44, 53];

  it('always contains the range, stays at least MIN_SPAN tall and keeps the ring inside', () => {
    for (const a of values) {
      for (const b of values) {
        for (const c of values) {
          const r = orderedHeights(a, b, c);
          const lv = glassLevels(a, b, c);
          expect(lv.visible).toBe(r.high > 0.01);
          if (!lv.visible) continue;
          expect(lv.core).toBe(lv.bottom);
          expect(lv.bottom).toBeGreaterThanOrEqual(0);
          expect(lv.bottom).toBeLessThanOrEqual(r.low + 1e-9);
          expect(lv.top).toBeGreaterThanOrEqual(r.high - 1e-9);
          expect(lv.top - lv.bottom).toBeGreaterThanOrEqual(MIN_SPAN - 1e-9);
          expect(lv.ring).toBe(r.central);
          expect(lv.ring).toBeGreaterThanOrEqual(lv.bottom);
          expect(lv.ring).toBeLessThanOrEqual(lv.top);
        }
      }
    }
  });

  it('passes a real range through exactly', () => {
    expect(glassLevels(33.2, 36.4, 39.8)).toEqual({
      visible: true,
      core: 33.2,
      bottom: 33.2,
      top: 39.8,
      ring: 36.4,
    });
  });

  it('turns a range with no width into a thin band around it', () => {
    const lv = glassLevels(10, 10, 10);
    expect(lv.visible).toBe(true);
    expect(lv.bottom).toBeCloseTo(10 - MIN_SPAN / 2, 10);
    expect(lv.top).toBeCloseTo(10 + MIN_SPAN / 2, 10);
    expect(lv.ring).toBe(10);
    // True scale floors tiny platforms at 0.35: the band must not dip below the ground.
    const tiny = glassLevels(0.05, 0.05, 0.05);
    expect(tiny.bottom).toBe(0);
    expect(tiny.top).toBeCloseTo(MIN_SPAN, 10);
  });

  it('shows nothing without height', () => {
    expect(glassLevels(0, 0, 0).visible).toBe(false);
    expect(glassLevels(Number.NaN, Number.NaN, Number.NaN).visible).toBe(false);
    const glassOnly = glassLevels(0, 2, 5);
    expect(glassOnly).toMatchObject({ visible: true, core: 0, bottom: 0, top: 5, ring: 2 });
  });
});

describe('caseHalf', () => {
  it('is a little wider than the tower body on both axes', () => {
    for (const [x, z] of [
      [3.15, 1.85],
      [1.8, 1.8],
      [4.49, 1.49],
      [5.7, 5.7],
    ] as const) {
      const h = caseHalf({ x, z });
      expect(h.x).toBeCloseTo(x * CASE_SCALE + CASE_MARGIN, 10);
      expect(h.z).toBeCloseTo(z * CASE_SCALE + CASE_MARGIN, 10);
      expect(h.x).toBeGreaterThan(x * 1.1);
      expect(h.z).toBeGreaterThan(z * 1.1);
    }
  });

  it('survives odd input', () => {
    const h = caseHalf({ x: Number.NaN, z: -4 });
    expect(Number.isFinite(h.x)).toBe(true);
    expect(h.z).toBeGreaterThan(0);
  });
});

describe('ringColor', () => {
  it('gives every accent about the same glow, keeping its hue', () => {
    for (const hex of ACCENTS) {
      const src = new Color(hex);
      const c = ringColor(hex);
      const k = c.r / src.r;
      // Same hue: every channel scaled by the same factor, within the lift limits.
      expect(c.g).toBeCloseTo(src.g * k, 6);
      expect(c.b).toBeCloseTo(src.b * k, 6);
      expect(k).toBeGreaterThanOrEqual(0.5);
      expect(k).toBeLessThanOrEqual(2.5);
      const lum = luminance(c);
      expect(lum).toBeLessThanOrEqual(RING_LUMINANCE + 1e-9);
      // Deep accents are lifted within limits; the rest land on the target.
      if (k < 2.5) expect(lum).toBeCloseTo(RING_LUMINANCE, 6);
      else expect(lum).toBeGreaterThan(RING_LUMINANCE * 0.5);
    }
  });

  it('turns black into a neutral ring', () => {
    const c = ringColor('#000000');
    expect(c.r).toBeCloseTo(RING_LUMINANCE, 10);
    expect(c.g).toBeCloseTo(RING_LUMINANCE, 10);
  });
});

describe('caseGeometry', () => {
  it('is an open-bottomed box of unit height with outward faces', () => {
    const geo = caseGeometry(3, 2);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const index = geo.getIndex()!;
    expect(pos.count).toBe(20);
    expect(index.count).toBe(30);
    const p = new Vector3();
    const n = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nor, i);
      expect(Math.abs(p.x)).toBe(3);
      expect(Math.abs(p.z)).toBe(2);
      expect([0, 1]).toContain(p.y);
      expect(n.length()).toBeCloseTo(1, 10);
      expect(n.y).toBeGreaterThanOrEqual(0); // no floor
    }
    // Every triangle winds counter-clockwise seen from outside (front faces point out).
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let t = 0; t < index.count; t += 3) {
      a.fromBufferAttribute(pos, index.getX(t));
      b.fromBufferAttribute(pos, index.getX(t + 1));
      c.fromBufferAttribute(pos, index.getX(t + 2));
      n.fromBufferAttribute(nor, index.getX(t));
      const faceNormal = b.clone().sub(a).cross(c.clone().sub(a));
      expect(faceNormal.dot(n)).toBeGreaterThan(0);
    }
    geo.dispose();
  });
});

// --- scene graph (no WebGL needed) ------------------------------------------------------------

function mesh(g: UncertaintyGlass, name: string): Mesh {
  const o = g.group.getObjectByName(name);
  if (!(o instanceof Mesh)) throw new Error(`missing ${name}`);
  return o;
}

function uniform(m: Mesh, name: string): unknown {
  const u = (m.material as ShaderMaterial).uniforms[name];
  if (!u) throw new Error(`missing uniform ${name}`);
  return u.value;
}

const BASE: Omit<GlassState, 'time'> = {
  low: 33.2,
  central: 36.4,
  high: 39.8,
  tier: 'modeled',
  reducedMotion: false,
};

function run(g: UncertaintyGlass, s: Partial<GlassState>, seconds: number, from = 0): number {
  let time = from;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    time += 1 / 60;
    g.update({ ...BASE, ...s, time });
  }
  return time;
}

function span(g: UncertaintyGlass): { core: number; bottom: number; top: number; ring: number } {
  const c = mesh(g, 'glass-case');
  return {
    core: mesh(g, 'glass-core').scale.y,
    bottom: c.position.y,
    top: c.position.y + c.scale.y,
    ring: uniform(c, 'uRingY') as number,
  };
}

function shown(): UncertaintyGlass {
  const g = createUncertaintyGlass({ accent: '#a98bff', half: { x: 3.15, z: 1.85 } });
  g.group.visible = true;
  return g;
}

describe('createUncertaintyGlass', () => {
  it('costs two meshes (three draw calls) and uses no real lights', () => {
    const g = createUncertaintyGlass({ accent: '#ffb444', half: { x: 3, z: 2 } });
    const meshes: Mesh[] = [];
    g.group.traverse((o: Object3D) => {
      expect((o as Light).isLight).toBeFalsy();
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(meshes).toHaveLength(2);
    for (const m of meshes) {
      expect(Array.isArray(m.material)).toBe(false);
      const mat = m.material as ShaderMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
      expect(mat.premultipliedAlpha).toBe(true);
      expect(mat.fog).toBe(true);
    }
    // The case is seen through (far walls first); the core is a solid block (front faces only).
    expect((mesh(g, 'glass-case').material as Material).side).toBe(DoubleSide);
    expect((mesh(g, 'glass-core').material as Material).side).toBe(FrontSide);
    // Both parts share one geometry.
    expect(mesh(g, 'glass-case').geometry).toBe(mesh(g, 'glass-core').geometry);
    g.dispose();
  });

  it('starts hidden and costs nothing while the integrator keeps it hidden', () => {
    const g = createUncertaintyGlass({ accent: '#ffb444', half: { x: 3, z: 2 } });
    expect(g.group.visible).toBe(false);
    run(g, {}, 1);
    expect(g.group.visible).toBe(false); // the integrator owns the toggle
    expect(mesh(g, 'glass-case').visible).toBe(false);
    expect(mesh(g, 'glass-core').visible).toBe(false);
    g.dispose();
  });

  it('spans core 0..low, glass low..high and puts the ring at the central value', () => {
    const g = shown();
    run(g, {}, 4);
    const s = span(g);
    expect(s.core).toBeCloseTo(33.2, 2);
    expect(s.bottom).toBeCloseTo(33.2, 2);
    expect(s.top).toBeCloseTo(39.8, 2);
    expect(s.ring).toBeCloseTo(36.4, 2);
    expect(mesh(g, 'glass-core').visible).toBe(true);
    expect(mesh(g, 'glass-case').visible).toBe(true);
    // The shader measures in campus-local heights that match the mesh transforms.
    const c = mesh(g, 'glass-case');
    expect(uniform(c, 'uY0')).toBeCloseTo(s.bottom, 6);
    expect(uniform(c, 'uY1')).toBeCloseTo(s.top, 6);
    expect(uniform(mesh(g, 'glass-core'), 'uY1')).toBeCloseTo(s.core, 6);
    g.dispose();
  });

  it('rises from the core when it appears, then eases to new values', () => {
    const g = shown();
    let t = run(g, {}, 1 / 60);
    let s = span(g);
    expect(s.core).toBeCloseTo(33.2, 6); // the core stands in place
    expect(s.top - s.bottom).toBeLessThan(1); // the glass has only started to rise
    expect(uniform(mesh(g, 'glass-case'), 'uOpacity')).toBeLessThan(0.2);
    t = run(g, {}, 3, t);
    expect(span(g).top).toBeCloseTo(39.8, 2);
    expect(uniform(mesh(g, 'glass-case'), 'uOpacity')).toBe(1);
    // A new range: one frame later it is on its way, a few seconds later it has arrived.
    t = run(g, { low: 20, central: 25, high: 30 }, 1 / 60, t);
    s = span(g);
    expect(s.top).toBeLessThan(39.8);
    expect(s.top).toBeGreaterThan(30);
    run(g, { low: 20, central: 25, high: 30 }, 3, t);
    s = span(g);
    expect(s.core).toBeCloseTo(20, 2);
    expect(s.top).toBeCloseTo(30, 2);
    expect(s.ring).toBeCloseTo(25, 2);
    g.dispose();
  });

  it('holds still with reduced motion: heights snap, only the fade-in remains', () => {
    const g = shown();
    const t = run(g, { reducedMotion: true }, 1 / 60);
    let s = span(g);
    expect(s.core).toBeCloseTo(33.2, 6);
    expect(s.top).toBeCloseTo(39.8, 6);
    expect(s.ring).toBeCloseTo(36.4, 6);
    expect(uniform(mesh(g, 'glass-case'), 'uOpacity')).toBeLessThan(0.2);
    expect(uniform(mesh(g, 'glass-case'), 'uTime')).toBe(0); // the mist does not drift
    run(g, { reducedMotion: true, low: 5, central: 6, high: 9 }, 1 / 60, t);
    s = span(g);
    expect(s.core).toBeCloseTo(5, 6);
    expect(s.top).toBeCloseTo(9, 6);
    g.dispose();
  });

  it('lets the mist drift with full motion', () => {
    const g = shown();
    const t = run(g, {}, 1);
    expect(uniform(mesh(g, 'glass-case'), 'uTime')).toBeCloseTo(t, 6);
    g.dispose();
  });

  it('keeps a range with no width as a thin band of glass', () => {
    const g = shown();
    run(g, { low: 10, central: 10, high: 10 }, 3);
    const s = span(g);
    expect(s.top - s.bottom).toBeCloseTo(MIN_SPAN, 6);
    expect(s.ring).toBeCloseTo(10, 6);
    expect(mesh(g, 'glass-case').visible).toBe(true);
    g.dispose();
  });

  it('hides without height, and shows only glass when the low estimate is zero', () => {
    const g = shown();
    let t = run(g, { low: 0, central: 0, high: 0 }, 1);
    expect(mesh(g, 'glass-case').visible).toBe(false);
    expect(mesh(g, 'glass-core').visible).toBe(false);
    t = run(g, { low: 0, central: 2, high: 6, reducedMotion: true }, 1, t);
    expect(mesh(g, 'glass-case').visible).toBe(true);
    expect(mesh(g, 'glass-core').visible).toBe(false);
    // Shrinking to nothing (e.g. before launch in the time machine) hides it again.
    run(g, { low: 0, central: 0, high: 0 }, 4, t);
    expect(mesh(g, 'glass-case').visible).toBe(false);
    g.dispose();
  });

  it('frosts Modeled glass far more than Reported glass, cross-fading when the tier changes', () => {
    const g = shown();
    const veil = () => (uniform(mesh(g, 'glass-case'), 'uLook') as { x: number }).x;
    let t = run(g, { tier: 'reported' }, 2);
    const reported = veil();
    expect(reported).toBeCloseTo(frostLook(glassFrost('reported')).veil, 6);
    t = run(g, { tier: 'modeled' }, 1 / 60, t);
    expect(veil()).toBeGreaterThan(reported);
    expect(veil()).toBeLessThan(frostLook(glassFrost('modeled')).veil);
    run(g, { tier: 'modeled' }, 6, t);
    expect(veil()).toBeCloseTo(frostLook(glassFrost('modeled')).veil, 3);
    expect(veil()).toBeGreaterThan(reported * 3);
    g.dispose();
  });

  it('appears afresh when shown again after being hidden', () => {
    const g = shown();
    let t = run(g, {}, 3);
    expect(uniform(mesh(g, 'glass-case'), 'uOpacity')).toBe(1);
    g.group.visible = false;
    t = run(g, {}, 0.5, t);
    g.group.visible = true;
    run(g, {}, 1 / 60, t);
    expect(uniform(mesh(g, 'glass-case'), 'uOpacity')).toBeLessThan(0.2);
    g.dispose();
  });

  it('follows a faster ease when asked', () => {
    const slow = shown();
    const fast = shown();
    const ts = run(slow, {}, 3);
    const tf = run(fast, {}, 3);
    run(slow, { low: 5, central: 6, high: 7 }, 0.2, ts);
    run(fast, { low: 5, central: 6, high: 7, ease: 12 }, 0.2, tf);
    expect(Math.abs(span(fast).top - 7)).toBeLessThan(Math.abs(span(slow).top - 7));
    slow.dispose();
    fast.dispose();
  });

  it('survives odd input', () => {
    const g = createUncertaintyGlass({ accent: '#e9eef7', half: { x: Number.NaN, z: 0 } });
    g.group.visible = true;
    expect(() =>
      g.update({
        low: Number.NaN,
        central: Number.POSITIVE_INFINITY,
        high: -4,
        tier: 'bogus' as Tier,
        time: Number.NaN,
        reducedMotion: false,
      }),
    ).not.toThrow();
    // Unordered heights, and a clock that jumps backwards.
    for (const time of [5, 4.9, -3, -2.95]) {
      expect(() => g.update({ ...BASE, low: 12, central: 3, high: 7, time })).not.toThrow();
    }
    const s = span(g);
    expect(Number.isFinite(s.top)).toBe(true);
    expect(s.top).toBeGreaterThan(s.bottom);
    g.dispose();
  });

  it('disposes its geometry and both materials', () => {
    const g = shown();
    run(g, {}, 0.5);
    const spies: MockInstance[] = [];
    const seen = new Set<unknown>();
    g.group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      for (const target of [o.geometry, o.material as Material]) {
        if (seen.has(target)) continue;
        seen.add(target);
        spies.push(vi.spyOn(target, 'dispose'));
      }
    });
    expect(spies).toHaveLength(3);
    g.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
    expect(g.group.visible).toBe(false);
  });
});
