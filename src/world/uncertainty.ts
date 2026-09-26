/**
 * Uncertainty glass (PLAN.md, "Three more original ideas" #1). With "show
 * uncertainty" on, every tower becomes its range: a solid core up to the LOW
 * estimate, a frosted glass case from there up to the HIGH estimate, and a thin
 * light ring at the CENTRAL value (where the tower itself ends). The frost
 * follows the data tier: Reported figures are clear glass with crisp edges,
 * Estimated ones are lightly frosted, Modeled ones are fogged, with soft edges
 * and the ring's light scattered through the frost. The city shows its error
 * bars.
 *
 * Honest by construction: the three heights come straight from the model's
 * range, mapped with the same scale as the towers; nothing here invents a
 * number. The mottling in the glass is cosmetic shader noise, not data.
 *
 * Budget: two meshes sharing one geometry, three draw calls while visible (the
 * case draws its far walls, then its near walls), no real lights, no textures,
 * no per-frame allocations. The integrator owns `group.visible`; the group starts
 * hidden (the toggle is off by default).
 *
 * Space: campus-local. Origin at the tower base centre, +y up.
 */
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Mesh,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector4,
  type IUniform,
} from 'three';
import type { Tier } from '../model/types';
import { approach } from './launch';

// ---------------------------------------------------------------------------
// contract
// ---------------------------------------------------------------------------

export interface GlassState {
  /**
   * Tower heights in world units for the low, central and high estimates (the integrator maps
   * tokens/day → height with the same scale as the towers).
   */
  low: number;
  central: number;
  high: number;
  /** Tier of the figure the heights come from: sets how frosted the glass is. */
  tier: Tier;
  /** Seconds, for easing and the drift of the frost. */
  time: number;
  reducedMotion: boolean;
  /** How fast heights ease (1/s). Default 5, the campus default, so the ring tracks the tower top. */
  ease?: number;
}

export interface UncertaintyGlass {
  readonly group: Group;
  update(s: GlassState): void;
  dispose(): void;
}

export interface UncertaintyGlassOptions {
  /** The campus accent colour (the ring and a tint of the core). */
  accent: string;
  /** Half-extents (x, z) of the tower body's bounding box, campus-local (Campus.bodyHalf). */
  half: { x: number; z: number };
}

// ---------------------------------------------------------------------------
// tuning
// ---------------------------------------------------------------------------

/** Frost per tier: 0 = clear glass, 1 = milk. */
const FROST: Readonly<Record<Tier, number>> = { reported: 0.12, derived: 0.45, modeled: 0.9 };
/** The case is this much wider than the tower body, plus a margin (world units). */
export const CASE_SCALE = 1.15;
export const CASE_MARGIN = 0.15;
/** Thinnest case (world units): a range with no width still reads as a thin band of glass. */
export const MIN_SPAN = 0.2;
/** Below this height (world units) there is nothing to show. */
const EPS = 0.01;
/** Target luminance of the ring (linear). With the white core the shader adds, the brightest
 *  pixels sit just above the bloom threshold (0.84): a thin glow, not a neon tube. */
export const RING_LUMINANCE = 0.8;
/** Height easing (1/s) when the state does not say: the campus default. */
const HEIGHT_RATE = 5;
/** Fade-in when the glass appears (1/s): ~95 % in 0.75 s. */
const FADE_RATE = 4;
/** A change of tier cross-fades the frost (1/s): ~1.2 s. */
const FROST_RATE = 2.5;
/** A pause in updates longer than this (s) means the glass was off screen: it appears afresh. */
const GAP_SECONDS = 1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(Number.isFinite(v) ? v : 0, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const height = (v: number) => (Number.isFinite(v) ? Math.max(0, v) : 0);

// ---------------------------------------------------------------------------
// pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/**
 * How frosted the glass is for a tier (0..1): Reported crisp, Estimated ("derived") lightly
 * frosted, Modeled heavily frosted. Anything else is treated as the least certain.
 */
export function glassFrost(tier: Tier): number {
  return Object.hasOwn(FROST, tier) ? FROST[tier] : FROST.modeled;
}

/** What the frost does to the glass, as shader inputs. Every term moves one way with frost. */
export interface FrostLook {
  /** Opacity of one glass wall seen face-on. */
  veil: number;
  /** How much the veil mottles (0 = even, 0.5 = heavy cloud). */
  mottle: number;
  /** Width of the edge glints (world units; the shader keeps them at least ~1 px wide). */
  edgeWidth: number;
  /** Brightness of the edge glints: crisp and bright on clear glass, dim and blurred in fog. */
  edgeGlow: number;
  /** Half-width of the ring's light scattered in the frost (world units). */
  haloWidth: number;
  /** Strength of that scattered light (none on clear glass). */
  haloGlow: number;
}

export function frostLook(frost: number): FrostLook {
  const f = clamp01(frost);
  return {
    veil: lerp(0.03, 0.34, f ** 1.2),
    mottle: 0.5 * f,
    edgeWidth: lerp(0.04, 0.42, f),
    edgeGlow: lerp(0.75, 0.12, f),
    haloWidth: lerp(0.3, 2, f),
    haloGlow: lerp(0, 0.12, f),
  };
}

/** Low ≤ central ≤ high, finite and ≥ 0, whatever order or garbage came in. */
export function orderedHeights(
  low: number,
  central: number,
  high: number,
): { low: number; central: number; high: number } {
  const a = height(low);
  const b = height(central);
  const c = height(high);
  // Inconsistent input widens the range to cover all three values (never narrows it).
  return { low: Math.min(a, b, c), central: b, high: Math.max(a, b, c) };
}

/** Where each part of the glass sits (campus-local heights, world units). */
export interface GlassLevels {
  /** False when there is nothing to show (all heights ~0). */
  visible: boolean;
  /** Top of the solid core (the core spans 0..core); equals `bottom`. */
  core: number;
  /** The glass case spans bottom..top; at least MIN_SPAN tall and always containing low..high. */
  bottom: number;
  top: number;
  /** Height of the light ring (the central value). */
  ring: number;
}

export function glassLevels(low: number, central: number, high: number): GlassLevels {
  const r = orderedHeights(low, central, high);
  if (r.high <= EPS) return { visible: false, core: 0, bottom: 0, top: 0, ring: 0 };
  let bottom = r.low;
  let top = r.high;
  if (top - bottom < MIN_SPAN) {
    // Widen a (near-)zero range symmetrically so it still reads as a thin band of glass.
    bottom = Math.max(0, (r.low + r.high) / 2 - MIN_SPAN / 2);
    top = bottom + MIN_SPAN;
  }
  return { visible: true, core: bottom, bottom, top, ring: r.central };
}

/** Half-extents of the glass case around a tower body: a little wider than the body. */
export function caseHalf(half: { x: number; z: number }): { x: number; z: number } {
  const size = (v: number) => Math.max(0.5, Number.isFinite(v) ? v : 1) * CASE_SCALE + CASE_MARGIN;
  return { x: size(half.x), z: size(half.z) };
}

/** Relative luminance of a linear colour (Rec. 709). */
export function luminance(c: Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The ring colour for an accent (linear): the accent's hue at a common luminance, so every
 * campus's ring glows about as brightly (a pale accent is not allowed to blow out, a deep one
 * is lifted within limits).
 */
export function ringColor(accent: string, target = RING_LUMINANCE): Color {
  const c = new Color(accent);
  const lum = luminance(c);
  if (lum < 1e-4) return c.setRGB(target, target, target);
  return c.multiplyScalar(clamp(target / lum, 0.5, 2.5));
}

/**
 * The case geometry: a box of half-extents (hx, hz) spanning y ∈ [0, 1], open at the bottom
 * (four walls and a lid, flat normals). The core and the case share it, scaled in y.
 */
export function caseGeometry(hx: number, hz: number): BufferGeometry {
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  // Each face: four corners counter-clockwise seen from outside.
  const face = (corners: readonly (readonly [number, number, number])[], n: readonly number[]) => {
    const base = position.length / 3;
    for (const c of corners) {
      position.push(...c);
      normal.push(...n);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  face(
    [
      [hx, 0, hz],
      [hx, 0, -hz],
      [hx, 1, -hz],
      [hx, 1, hz],
    ],
    [1, 0, 0],
  );
  face(
    [
      [-hx, 0, -hz],
      [-hx, 0, hz],
      [-hx, 1, hz],
      [-hx, 1, -hz],
    ],
    [-1, 0, 0],
  );
  face(
    [
      [-hx, 0, hz],
      [hx, 0, hz],
      [hx, 1, hz],
      [-hx, 1, hz],
    ],
    [0, 0, 1],
  );
  face(
    [
      [hx, 0, -hz],
      [-hx, 0, -hz],
      [-hx, 1, -hz],
      [hx, 1, -hz],
    ],
    [0, 0, -1],
  );
  face(
    [
      [-hx, 1, hz],
      [hx, 1, hz],
      [hx, 1, -hz],
      [-hx, 1, -hz],
    ],
    [0, 1, 0],
  );
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(position, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  geo.setIndex(index);
  return geo;
}

// ---------------------------------------------------------------------------
// shaders
// ---------------------------------------------------------------------------

/**
 * Both parts: the unit geometry (y ∈ [0, 1]) is placed by the mesh transform; `vLocal`
 * rebuilds the campus-local position from the span uniforms so edges and the ring can be
 * measured in world units.
 */
const VERTEX = /* glsl */ `
  #include <fog_pars_vertex>
  uniform float uY0;
  uniform float uY1;
  varying vec3 vLocal;
  varying vec3 vFaceN;
  varying vec3 vWorldPos;
  varying vec3 vWorldN;
  void main() {
    vLocal = vec3(position.x, mix(uY0, uY1, position.y), position.z);
    vFaceN = normal;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    // Normals are axis-aligned and the only non-uniform scale is along y, so this stays exact.
    vWorldN = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

/** Fog, edges and noise shared by both fragment shaders. */
const COMMON = /* glsl */ `
  #include <fog_pars_fragment>
  uniform vec2 uHalf;
  uniform float uY1;
  uniform float uOpacity;
  varying vec3 vLocal;
  varying vec3 vFaceN;
  varying vec3 vWorldPos;
  varying vec3 vWorldN;

  float tmFogAmount() {
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        return 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        return smoothstep(fogNear, fogFar, vFogDepth);
      #endif
    #else
      return 0.0;
    #endif
  }

  vec3 tmFogMix(vec3 c, float k) {
    #ifdef USE_FOG
      return mix(c, fogColor, k);
    #else
      return c;
    #endif
  }

  // 1 on an edge, fading out over w (world units), never thinner than about a pixel (px).
  float tmEdge(float d, float w, float px) {
    return 1.0 - smoothstep(0.0, max(w, px * 1.25), d);
  }

  // Distances from this fragment to its face's edges, and pixel footprints to match.
  // x: to the nearest vertical edge of a wall; y: to the lid's edge; z, w: pixel sizes.
  vec4 tmEdges(vec3 fw) {
    float dx = uHalf.x - abs(vLocal.x);
    float dz = uHalf.y - abs(vLocal.z);
    float side = abs(vFaceN.x) > 0.5 ? dz : dx;
    return vec4(side, min(dx, dz), max(fw.x, fw.z), fw.y);
  }
`;

const NOISE = /* glsl */ `
  float tmHash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float tmNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(tmHash3(i), tmHash3(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(tmHash3(i + vec3(0.0, 1.0, 0.0)), tmHash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(tmHash3(i + vec3(0.0, 0.0, 1.0)), tmHash3(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(tmHash3(i + vec3(0.0, 1.0, 1.0)), tmHash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
`;

/**
 * The frosted case. Premultiplied output: the veil occludes what is behind it (alpha), the
 * edges, ring and scattered light only add. Drawn twice (far walls, then near walls), so the
 * far edges and the far side of the ring are seen through the near veil — crisp through clear
 * glass, lost in the fog through frosted glass.
 */
const CASE_FRAGMENT = /* glsl */ `
  ${COMMON}
  ${NOISE}
  uniform vec3 uTint;
  uniform vec3 uEdgeColor;
  uniform vec3 uRing;
  uniform float uRingY;
  uniform float uTime;
  uniform vec4 uLook; // veil, mottle, edge width, edge glow
  uniform vec2 uHalo; // scattered-light half-width, strength
  void main() {
    vec3 fw = fwidth(vLocal);
    vec4 e = tmEdges(fw);
    float lid = step(0.5, vFaceN.y);
    float wall = 1.0 - lid;
    float edgeTop = mix(tmEdge(uY1 - vLocal.y, uLook.z, e.w), tmEdge(e.y, uLook.z, e.z), lid);
    float edge = max(wall * tmEdge(e.x, uLook.z, e.z), edgeTop);

    vec3 n = normalize(vWorldN);
    vec3 v = normalize(cameraPosition - vWorldPos);
    float fres = pow(1.0 - abs(dot(n, v)), 4.0);

    // Frost: slow, soft mist drifting upwards; mottled in proportion to the frost.
    vec3 q = vLocal * vec3(0.45, 0.8, 0.45) + vec3(0.0, -uTime * 0.06, uTime * 0.025);
    float mist = tmNoise(q) * 0.62 + tmNoise(q * 2.7 + 11.3) * 0.38;
    float veil = uLook.x * (1.0 - uLook.y + 2.0 * uLook.y * mist) + fres * (0.03 + 0.3 * uLook.x);
    float a = clamp(veil, 0.0, 0.9) * uOpacity;

    // The ring on the walls: a crisp line (at least ~1 px tall) with a white-hot centre and a
    // soft glow (at least ~4 px), plus its light scattered in the frost.
    float dy = vLocal.y - uRingY;
    float rw = max(0.05, e.w * 1.1);
    float gw = max(0.22, e.w * 4.0);
    float line = exp(-dy * dy / (rw * rw) * 1.7);
    float ring = wall * (line + 0.28 * exp(-dy * dy / (gw * gw)));
    float halo = uHalo.y * exp(-dy * dy / (uHalo.x * uHalo.x));

    float fogK = tmFogAmount();
    vec3 veilColor = mix(uTint * (0.8 + 0.4 * mist), uEdgeColor, 0.2 * fres);
    // Distance fog only partly swallows the frost, so tiers still read across the island.
    veilColor = tmFogMix(veilColor, fogK * 0.45);
    vec3 glow = uEdgeColor * edge * uLook.w + uRing * (ring + halo) + vec3(0.25 * wall * line * line);
    gl_FragColor = vec4(veilColor * a + glow * (1.0 - 0.45 * fogK) * uOpacity, a);
  }
`;

/**
 * The solid core: an even, tinted fill (no frost, no Fresnel) with a crisp bright rim at its top
 * — the low estimate — and faint front edges. Front faces only, like a solid block.
 */
const CORE_FRAGMENT = /* glsl */ `
  ${COMMON}
  uniform vec3 uFill;
  uniform vec3 uRim;
  uniform float uFillAlpha;
  void main() {
    vec3 fw = fwidth(vLocal);
    vec4 e = tmEdges(fw);
    float lid = step(0.5, vFaceN.y);
    float wall = 1.0 - lid;
    float dTop = mix(uY1 - vLocal.y, e.y, lid);
    float pxTop = mix(e.w, e.z, lid);
    float rim = tmEdge(dTop, 0.06, pxTop) + 0.15 * tmEdge(dTop, 0.45, pxTop);
    float corner = 0.2 * wall * tmEdge(e.x, 0.03, e.z);

    vec3 n = normalize(vWorldN);
    float shade = 0.74 + 0.26 * max(dot(n, normalize(vec3(0.3, 0.85, 0.45))), 0.0);
    float fogK = tmFogAmount();
    vec3 fill = tmFogMix(uFill * shade, fogK * 0.6);
    float a = uFillAlpha * uOpacity;
    vec3 glow = uRim * max(rim, corner) * (1.0 - 0.45 * fogK) * uOpacity;
    gl_FragColor = vec4(fill * a + glow, a);
  }
`;

// ---------------------------------------------------------------------------
// the glass
// ---------------------------------------------------------------------------

export function createUncertaintyGlass(opts: UncertaintyGlassOptions): UncertaintyGlass {
  const accent = new Color(opts.accent);
  const half = caseHalf(opts.half);

  const group = new Group();
  group.name = 'uncertainty-glass';
  group.visible = false;

  const geometry = caseGeometry(half.x, half.z);
  const shared = {
    uHalf: { value: new Vector2(half.x, half.z) },
    uOpacity: { value: 0 },
  } satisfies Record<string, IUniform>;

  const caseU = {
    uY0: { value: 0 },
    uY1: { value: 1 },
    uTint: { value: new Color('#aebfdc').lerp(accent, 0.12).multiplyScalar(0.38) },
    uEdgeColor: { value: new Color('#dfe8ff').lerp(accent, 0.15).multiplyScalar(0.75) },
    uRing: { value: ringColor(opts.accent) },
    uRingY: { value: 0 },
    uTime: { value: 0 },
    uLook: { value: new Vector4() },
    uHalo: { value: new Vector2(1, 0) },
  } satisfies Record<string, IUniform>;
  const caseMat = new ShaderMaterial({
    name: 'uncertainty-case',
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    side: DoubleSide, // transparent + double-sided: three draws the far walls first, then the near
    fog: true,
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...shared, ...caseU },
    vertexShader: VERTEX,
    fragmentShader: CASE_FRAGMENT,
  });

  const coreU = {
    uY0: { value: 0 },
    uY1: { value: 1 },
    uFill: { value: accent.clone().multiplyScalar(0.08).add(new Color('#0a0e18')) },
    // Near-white, so the low line never reads as the (accent) ring of the central value.
    uRim: { value: new Color('#ffffff').lerp(accent, 0.12).multiplyScalar(0.62) },
    uFillAlpha: { value: 0.12 },
  } satisfies Record<string, IUniform>;
  const coreMat = new ShaderMaterial({
    name: 'uncertainty-core',
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    side: FrontSide,
    fog: true,
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...shared, ...coreU },
    vertexShader: VERTEX,
    fragmentShader: CORE_FRAGMENT,
  });

  const core = new Mesh(geometry, coreMat);
  core.name = 'glass-core';
  core.renderOrder = 2;
  core.visible = false;
  const glass = new Mesh(geometry, caseMat);
  glass.name = 'glass-case';
  glass.renderOrder = 3;
  glass.visible = false;
  group.add(core, glass);

  // Eased state: the heights shown (campus-local), the fade and the frost.
  const shown = { low: 0, central: 0, high: 0 };
  let presence = 0;
  let frost = 0;
  let onScreen = false;
  let lastTime: number | null = null;

  function apply(time: number, reducedMotion: boolean): void {
    const lv = glassLevels(shown.low, shown.central, shown.high);
    const on = lv.visible && presence > 0.002;
    glass.visible = on;
    core.visible = on && lv.core > EPS;
    if (!on) return;
    core.scale.y = Math.max(lv.core, EPS);
    coreU.uY1.value = lv.core;
    glass.position.y = lv.bottom;
    glass.scale.y = lv.top - lv.bottom;
    caseU.uY0.value = lv.bottom;
    caseU.uY1.value = lv.top;
    caseU.uRingY.value = lv.ring;
    const look = frostLook(frost);
    caseU.uLook.value.set(look.veil, look.mottle, look.edgeWidth, look.edgeGlow);
    caseU.uHalo.value.set(look.haloWidth, look.haloGlow);
    caseU.uTime.value = reducedMotion ? 0 : time;
    shared.uOpacity.value = presence;
  }

  return {
    group,
    update(s) {
      // Off screen: nothing to do. When it comes back, it appears afresh.
      if (!group.visible) {
        onScreen = false;
        return;
      }
      const time = Number.isFinite(s.time) ? s.time : 0;
      const raw = lastTime === null ? 0 : time - lastTime;
      const appearing = !onScreen || lastTime === null || Math.abs(raw) > GAP_SECONDS;
      // The time since the last update is not motion when the glass was off screen; a frozen or
      // rewound clock still eases (nominal frame).
      const dt = !appearing && raw > 0 ? Math.min(raw, 0.1) : 1 / 60;
      lastTime = time;
      onScreen = true;

      const rm = s.reducedMotion;
      const target = orderedHeights(s.low, s.central, s.high);
      const targetFrost = glassFrost(s.tier);
      if (appearing) {
        // The core stands in place; the case rises from it to the high estimate and the ring
        // settles at the central value (in place with reduced motion). Everything fades in.
        presence = 0;
        frost = targetFrost;
        shown.low = target.low;
        shown.central = rm ? target.central : target.low;
        shown.high = rm ? target.high : target.low;
      }
      const rate = s.ease !== undefined && s.ease > 0 ? s.ease : HEIGHT_RATE;
      if (rm) {
        shown.low = target.low;
        shown.central = target.central;
        shown.high = target.high;
      } else {
        shown.low = approach(shown.low, target.low, dt, rate);
        shown.central = approach(shown.central, target.central, dt, rate);
        shown.high = approach(shown.high, target.high, dt, rate);
      }
      presence = approach(presence, 1, dt, FADE_RATE);
      frost = approach(frost, targetFrost, dt, FROST_RATE);
      apply(time, rm);
    },
    dispose() {
      group.visible = false;
      geometry.dispose();
      caseMat.dispose();
      coreMat.dispose();
    },
  };
}
