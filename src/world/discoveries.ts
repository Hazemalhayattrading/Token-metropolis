/**
 * Hidden details in 3D (brief §5.3 item 9). Sixteen small props around the
 * island — on the shore, on and over the sea, in the central plaza — and small
 * props in the interiors: one shared detail in every HQ's view of a kind, plus
 * a few that live in one HQ only. Each detail has an invisible, generous pick
 * target carrying `userData.discoveryId`.
 *
 * Cosmetic only: nothing here reads or implies a number, and nothing depicts a
 * real company's logo, wordmark or mascot. Placement is deterministic — fixed
 * preferred spots, nudged clear of the campuses, variety from hash01 — never
 * Math.random(). With reduced motion nothing moves (the coffee machine's steam
 * still shows how busy its HQ is, frozen).
 *
 * Budget: all island props are two BatchedMeshes — one draw call for every
 * solid (lamps, screens and flames glow through a per-vertex attribute) and one
 * for soft additive light (beams, pools, steam). Each decorated interior adds
 * the same two. No real lights, no textures; each frame is a handful of matrix
 * updates.
 *
 * Spaces: the island group is world space (+y up; island top y = 0; sea level
 * y = −1.2). Interiors are decorated in their parent's local space: offices and
 * power in campus-local space (origin at the tower base, +z towards the city
 * centre), the server hall in the hall diorama's space (16 × 15 floor, rack row
 * 0 at z = −6, always present), the model lab in the display case's space
 * (plinth top y = 0.18, back wall at z ≈ −1.7).
 */
import {
  AdditiveBlending,
  BatchedMesh,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  Vector2,
  Vector3,
  type ColorRepresentation,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DISCOVERIES, type Discovery } from '../state/discoveries';
import { MOON_DIRECTION } from './environment';

// ---------------------------------------------------------------------------
// contract
// ---------------------------------------------------------------------------

export type InteriorKind = 'offices' | 'hall' | 'power' | 'lab';

export interface DiscoveryFrame {
  /** Seconds, for cosmetic animation. */
  time: number;
  /** HQ id → local hour at the HQ [0, 24). */
  hours: ReadonlyMap<string, number>;
  /** HQ id → normalized log load 0..1. */
  loads: ReadonlyMap<string, number>;
  reducedMotion: boolean;
}

export interface InteriorCampus {
  id: string;
  footprint: number;
  bodyHalf: { x: number; z: number };
}

export interface DiscoveryProps {
  /** Island props in world space (add it to the scene). */
  readonly group: Group;
  /** Pick targets of the island props (meshes with `userData.discoveryId`). */
  readonly pickables: readonly Object3D[];
  update(s: DiscoveryFrame): void;
  /**
   * Add the props of one HQ's interior view to `parent` (the interior's group, local space) and
   * return their pick targets. Calling it again for the same parent returns the same targets.
   * The props are released when `parent` is detached from its own parent, or on dispose().
   */
  decorateInterior(view: InteriorKind, parent: Group, campus: InteriorCampus): Object3D[];
  dispose(): void;
}

export interface CampusInput {
  readonly id: string;
  /** The campus group; its position and rotation place the campus. */
  readonly group: Group;
  readonly footprint: number;
}

export interface DiscoveryPropsOptions {
  readonly campuses: readonly CampusInput[];
  readonly islandRadius: number;
  readonly reducedMotion: boolean;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const SEA_Y = -1.2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(Number.isFinite(v) ? v : 0, 0, 1);
const frac = (v: number) => v - Math.floor(v);

/** Deterministic pseudo-random value in [0, 1) for a number. Cosmetic layout only. */
export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** 0 → 1 → 0 as u goes 0 → 1 (smooth), for fading things in and out over a cycle. */
const hump = (u: number) => Math.sin(Math.PI * clamp01(u));

/** Triangle wave 0 → 1 → 0 with period 2 (ping-pong). */
const pingPong = (u: number) => {
  const p = ((u % 2) + 2) % 2;
  return p < 1 ? p : 2 - p;
};

/** Night at an HQ, for the night-shift nap (unknown hour counts as night, so it stays findable). */
export function isNightHour(hour: number | undefined): boolean {
  if (hour === undefined || !Number.isFinite(hour)) return true;
  const h = ((hour % 24) + 24) % 24;
  return h >= 21 || h < 6.5;
}

/** Steam puffs over the office coffee machine: 1 when idle, 6 at the heaviest load. */
export function coffeePuffs(load: number): number {
  return 1 + Math.round(clamp01(load) * 5);
}

/** How fast the coffee machine's steam rises (cycles per second): busier HQ, busier machine. */
export function coffeeRate(load: number): number {
  return 0.22 + 0.6 * clamp01(load);
}

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

/**
 * One material for every solid prop: vertex colours, plus a per-vertex `aGlow` that makes lamps,
 * screens, flames and eyes self-lit (bright enough to catch the bloom). Everything also gets a
 * faint lift so small props do not vanish into the night.
 */
function propMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.06 });
  const uniforms = { uGlow: { value: 2.3 }, uLift: { value: 0.16 } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGlow;\nvarying float vGlow;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uGlow;\nuniform float uLift;\nvarying float vGlow;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (uLift + vGlow * uGlow);',
      );
  };
  m.customProgramCacheKey = () => 'tm-discovery-prop';
  return m;
}

/** Soft additive light (beams, pools, steam, glass): brightness is the vertex colour. */
function lightMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
  });
}

// ---------------------------------------------------------------------------
// geometry kit
// ---------------------------------------------------------------------------

type V3 = readonly [number, number, number];

interface Fade {
  /** Local axis ('r' = distance from the y axis). */
  readonly axis: 'x' | 'y' | 'z' | 'r';
  /** Full brightness at `from`, none at `to`. */
  readonly from: number;
  readonly to: number;
  readonly power?: number;
}

interface Part {
  readonly geo: BufferGeometry;
  /** Omit for geometry that is already coloured (a sub-assembly from `build`). */
  readonly color?: ColorRepresentation;
  readonly at?: V3;
  readonly rot?: V3;
  readonly scale?: number | V3;
  /** Self-illumination (0 = lit by the scene only). */
  readonly glow?: number;
  readonly fade?: Fade;
}

const _m4 = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();
const _v = new Vector3();
const UP = new Vector3(0, 1, 0);
const KEEP = new Set(['position', 'normal', 'color', 'aGlow']);

function fadeAt(f: Fade, x: number, y: number, z: number): number {
  const v = f.axis === 'x' ? x : f.axis === 'y' ? y : f.axis === 'z' ? z : Math.hypot(x, z);
  const t = clamp01((v - f.from) / (f.to - f.from));
  return (1 - t) ** (f.power ?? 1);
}

function prepare(part: Part): BufferGeometry {
  const g = part.geo.clone();
  for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const n = pos.count;
  if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
  if (part.color !== undefined || !g.getAttribute('color')) {
    const colors = new Float32Array(n * 3);
    _c.set(part.color ?? '#ffffff');
    for (let i = 0; i < n; i++) {
      const k = part.fade ? fadeAt(part.fade, pos.getX(i), pos.getY(i), pos.getZ(i)) : 1;
      colors[i * 3] = _c.r * k;
      colors[i * 3 + 1] = _c.g * k;
      colors[i * 3 + 2] = _c.b * k;
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  }
  if (part.glow !== undefined || !g.getAttribute('aGlow')) {
    g.setAttribute(
      'aGlow',
      new Float32BufferAttribute(new Float32Array(n).fill(part.glow ?? 0), 1),
    );
  }
  const [rx, ry, rz] = part.rot ?? [0, 0, 0];
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  const s = part.scale ?? 1;
  if (typeof s === 'number') _s.setScalar(s);
  else _s.set(s[0], s[1], s[2]);
  const [px, py, pz] = part.at ?? [0, 0, 0];
  g.applyMatrix4(_m4.compose(_p.set(px, py, pz), _q, _s));
  return g;
}

/** Merge coloured parts into one indexed geometry (position, normal, color, aGlow). */
function build(parts: readonly Part[]): BufferGeometry {
  const prepared = parts.map(prepare);
  const merged = mergeGeometries(prepared, false);
  prepared.forEach((g) => g.dispose());
  for (const p of parts) p.geo.dispose();
  if (!merged) throw new Error('discoveries: could not merge a prop geometry');
  merged.computeBoundingSphere();
  return merged;
}

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 10, open = false) =>
  new CylinderGeometry(rt, rb, h, seg, 1, open);
const sph = (r: number, ws = 10, hs = 8) => new SphereGeometry(r, ws, hs);
const cone = (r: number, h: number, seg = 10) => new ConeGeometry(r, h, seg);
const tor = (r: number, t: number, rs = 6, ts = 18, arc = TAU) =>
  new TorusGeometry(r, t, rs, ts, arc);
const cap = (r: number, len: number, seg = 8) => new CapsuleGeometry(r, len, 3, seg);
/** A flat disc facing up. */
const disc = (r: number, seg = 20, arc = TAU) =>
  new CircleGeometry(r, seg, 0, arc).rotateX(-Math.PI / 2);

/** A cylinder from a to b. */
function rod(a: V3, b: V3, r: number, seg = 6): BufferGeometry {
  const from = new Vector3(a[0], a[1], a[2]);
  const dir = new Vector3(b[0], b[1], b[2]).sub(from);
  const len = Math.max(dir.length(), 1e-4);
  const g = new CylinderGeometry(r, r, len, seg, 1);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(from.x + (b[0] - a[0]) / 2, from.y + (b[1] - a[1]) / 2, from.z + (b[2] - a[2]) / 2);
  return g;
}

/** Triangles (each listed as 3 points), made two-sided. */
function tris(points: readonly V3[]): BufferGeometry {
  const out: number[] = [];
  for (let i = 0; i + 2 < points.length; i += 3) {
    const [a, b, c] = [points[i]!, points[i + 1]!, points[i + 2]!];
    out.push(...a, ...b, ...c, ...a, ...c, ...b);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

const SKIN = ['#d9b49a', '#b58563', '#8d5a3b', '#f0cfb4', '#c99a74'];
const SHIRTS = ['#5f7fb8', '#b86a5f', '#6fa88a', '#c9a45a', '#8a6fb0', '#4f9fb0', '#d07a4a'];
const C = {
  wood: '#8a5a3b',
  woodDark: '#5a3a26',
  woodLight: '#b08457',
  metal: '#3a414f',
  chrome: '#9aa3b5',
  white: '#e9e6de',
  red: '#c8453a',
  yellow: '#f2c14e',
  cream: '#f1e3c6',
  stone: '#6b7280',
  stoneDark: '#434a56',
  leaf: '#4f8f4a',
  leafDark: '#2f6a3a',
  warm: '#ffd9a0',
  flame: '#ffb347',
  cardboard: '#c49a6c',
  pants: '#2d3342',
} as const;

type Pose = 'stand' | 'sit' | 'run';

/** A small person, feet (or seat) at y = 0, facing +z; `h` is the standing height. */
function person(o: {
  pose: Pose;
  shirt: string;
  skin?: string;
  pants?: string;
  hat?: string;
  h?: number;
}): BufferGeometry {
  const k = (o.h ?? 0.5) / 0.5;
  const skin = o.skin ?? SKIN[0]!;
  const pants = o.pants ?? C.pants;
  const parts: Part[] = [];
  if (o.pose === 'stand') {
    parts.push(
      { geo: cap(0.028, 0.14), color: pants, at: [-0.034, 0.1, 0] },
      { geo: cap(0.028, 0.14), color: pants, at: [0.034, 0.1, 0] },
      { geo: cap(0.058, 0.12), color: o.shirt, at: [0, 0.28, 0] },
      { geo: cap(0.022, 0.13), color: o.shirt, at: [-0.082, 0.27, 0], rot: [0, 0, -0.12] },
      { geo: cap(0.022, 0.13), color: o.shirt, at: [0.082, 0.27, 0], rot: [0, 0, 0.12] },
      { geo: sph(0.052), color: skin, at: [0, 0.43, 0] },
    );
  } else if (o.pose === 'sit') {
    // Seated with the seat at y = 0.15: thighs forward, shins down.
    parts.push(
      { geo: cap(0.028, 0.1), color: pants, at: [-0.035, 0.16, 0.06], rot: [Math.PI / 2, 0, 0] },
      { geo: cap(0.028, 0.1), color: pants, at: [0.035, 0.16, 0.06], rot: [Math.PI / 2, 0, 0] },
      { geo: cap(0.025, 0.1), color: pants, at: [-0.035, 0.08, 0.13] },
      { geo: cap(0.025, 0.1), color: pants, at: [0.035, 0.08, 0.13] },
      { geo: cap(0.058, 0.12), color: o.shirt, at: [0, 0.3, -0.01] },
      { geo: cap(0.022, 0.12), color: o.shirt, at: [-0.08, 0.29, 0.03], rot: [-0.5, 0, 0] },
      { geo: cap(0.022, 0.12), color: o.shirt, at: [0.08, 0.29, 0.03], rot: [-0.5, 0, 0] },
      { geo: sph(0.052), color: skin, at: [0, 0.45, 0] },
    );
  } else {
    parts.push(
      { geo: cap(0.027, 0.14), color: pants, at: [-0.034, 0.1, 0.04], rot: [-0.55, 0, 0] },
      { geo: cap(0.027, 0.14), color: pants, at: [0.034, 0.11, -0.04], rot: [0.55, 0, 0] },
      { geo: cap(0.056, 0.12), color: o.shirt, at: [0, 0.28, 0.02], rot: [0.2, 0, 0] },
      { geo: cap(0.021, 0.12), color: o.shirt, at: [-0.08, 0.28, -0.03], rot: [0.7, 0, 0] },
      { geo: cap(0.021, 0.12), color: o.shirt, at: [0.08, 0.28, 0.06], rot: [-0.7, 0, 0] },
      { geo: sph(0.05), color: skin, at: [0, 0.43, 0.05] },
    );
  }
  if (o.hat) {
    const top = o.pose === 'sit' ? 0.47 : o.pose === 'run' ? 0.45 : 0.45;
    const z = o.pose === 'run' ? 0.05 : 0;
    parts.push({
      geo: new SphereGeometry(0.056, 10, 6, 0, TAU, 0, Math.PI / 2),
      color: o.hat,
      at: [0, top, z],
    });
  }
  const g = build(parts);
  if (k !== 1) g.scale(k, k, k);
  return g;
}

// ---------------------------------------------------------------------------
// batching
// ---------------------------------------------------------------------------

const WHITE = new Color(1, 1, 1);

/** One instance in a PropBatch: its local matrix, visibility and tint. */
class Handle {
  readonly matrix = new Matrix4();
  private mesh: BatchedMesh | null = null;
  private id = -1;
  private shown = true;
  private readonly tintColor = new Color(1, 1, 1);

  attach(mesh: BatchedMesh, id: number): void {
    this.mesh = mesh;
    this.id = id;
    mesh.setMatrixAt(id, this.matrix);
    mesh.setVisibleAt(id, this.shown);
    mesh.setColorAt(id, this.tintColor);
  }

  /** Position, heading (about +y), scale, then pitch (about x) and roll (about z). */
  place(
    x: number,
    y: number,
    z: number,
    yaw = 0,
    scale: number | V3 = 1,
    pitch = 0,
    roll = 0,
  ): this {
    _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
    if (typeof scale === 'number') _s.setScalar(scale);
    else _s.set(scale[0], scale[1], scale[2]);
    this.matrix.compose(_p.set(x, y, z), _q, _s);
    this.mesh?.setMatrixAt(this.id, this.matrix);
    return this;
  }

  show(on: boolean): this {
    if (on === this.shown) return this;
    this.shown = on;
    this.mesh?.setVisibleAt(this.id, on);
    return this;
  }

  /** Multiply the instance's colours (brightness for light, a warm-up for a glow). */
  tint(k: number, color: Color = WHITE): this {
    this.tintColor.copy(color).multiplyScalar(Math.max(0, k));
    this.mesh?.setColorAt(this.id, this.tintColor);
    return this;
  }
}

/** Collects instances, then builds one BatchedMesh (one draw call) for all of them. */
class PropBatch {
  private readonly items: { geo: BufferGeometry; handle: Handle }[] = [];

  add(geo: BufferGeometry): Handle {
    const handle = new Handle();
    this.items.push({ geo, handle });
    return handle;
  }

  build(material: Material, name: string, sortObjects: boolean): BatchedMesh | null {
    if (this.items.length === 0) return null;
    const unique = [...new Set(this.items.map((i) => i.geo))];
    let vertices = 0;
    let indices = 0;
    for (const g of unique) {
      vertices += g.getAttribute('position').count;
      indices += g.index?.count ?? 0;
    }
    const mesh = new BatchedMesh(this.items.length, vertices, indices, material);
    mesh.name = name;
    // Instances move, so the whole-object bounds would go stale; each instance is culled instead.
    mesh.frustumCulled = false;
    mesh.perObjectFrustumCulled = true;
    mesh.sortObjects = sortObjects;
    const ids = new Map<BufferGeometry, number>();
    for (const g of unique) ids.set(g, mesh.addGeometry(g));
    for (const it of this.items) it.handle.attach(mesh, mesh.addInstance(ids.get(it.geo)!));
    unique.forEach((g) => g.dispose()); // the batch holds its own copy of the data
    return mesh;
  }
}

// ---------------------------------------------------------------------------
// pick targets
// ---------------------------------------------------------------------------

interface PickKit {
  readonly geo: SphereGeometry;
  readonly mat: MeshBasicMaterial;
}

/** An invisible ellipsoid carrying the detail's id; generous so a tap finds a tiny prop. */
function pickTarget(kit: PickKit, id: string, radius: number | V3, at: V3): Mesh {
  const m = new Mesh(kit.geo, kit.mat);
  m.name = `discovery:${id}`;
  m.userData.discoveryId = id;
  if (typeof radius === 'number') m.scale.setScalar(radius);
  else m.scale.set(radius[0], radius[1], radius[2]);
  m.position.set(at[0], at[1], at[2]);
  return m;
}

/** A hidden prop must not be pickable: the raycaster skips objects outside its layers. */
function setPickable(m: Mesh, on: boolean): void {
  m.layers.mask = on ? 1 : 0;
}

// ---------------------------------------------------------------------------
// layout (pure, tested)
// ---------------------------------------------------------------------------

/** A campus as seen by the layout: world → campus-local transform and footprint. */
export interface CampusShape {
  readonly toLocal: Matrix4;
  readonly footprint: number;
}

/** Truck loop radius (footprint + 9.5) + half a truck + a little air. */
const TRUCK_CLEAR = 10.4;

/**
 * Whether campus geometry — tower, plaza, truck loop, server halls (behind), cooling towers and
 * substation (to the side) — could stand within `margin` of the world point (x, z).
 */
export function campusCovers(c: CampusShape, x: number, z: number, margin = 0): boolean {
  _v.set(x, 0, z).applyMatrix4(c.toLocal);
  const fp = c.footprint;
  const lx = _v.x;
  const lz = _v.z;
  const loop = fp + TRUCK_CLEAR + margin;
  if (lx * lx + lz * lz < loop * loop) return true;
  if (Math.abs(lx) < 6 + margin && lz < -fp - 2.3 + margin && lz > -fp - 13.9 - margin) return true;
  return (
    lx > fp + 3.7 - margin && lx < fp + 10.7 + margin && lz > -7.4 - margin && lz < 4.3 + margin
  );
}

export interface Spot {
  readonly x: number;
  readonly z: number;
  /** Polar angle (x = cos·r, z = sin·r), radians. */
  readonly angle: number;
  readonly radius: number;
  /** False when no clear spot was found near the preference (the preferred spot is returned). */
  readonly clear: boolean;
}

/**
 * The first clear spot near a preferred polar position: the angle swings out in small steps on
 * alternate sides, trying each radius in order at every step.
 */
export function findSpot(
  blocked: (x: number, z: number) => boolean,
  angle: number,
  radii: readonly number[],
  swing = 0.4,
  step = 0.015,
): Spot {
  for (let k = 0; k * step <= swing + 1e-9; k++) {
    for (const sign of k === 0 ? [1] : [1, -1]) {
      const a = angle + sign * k * step;
      for (const r of radii) {
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (!blocked(x, z)) return { x, z, angle: a, radius: r, clear: true };
      }
    }
  }
  const r = radii[0] ?? 0;
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r, angle, radius: r, clear: false };
}

/** The clear arc around a spot at radius r (for the jogger's laps): [start, end] angles. */
export function clearArc(
  blocked: (x: number, z: number) => boolean,
  angle: number,
  r: number,
  maxHalf: number,
  step = 0.005,
): [number, number] {
  let lo = angle;
  let hi = angle;
  while (hi - angle < maxHalf && !blocked(Math.cos(hi + step) * r, Math.sin(hi + step) * r))
    hi += step;
  while (angle - lo < maxHalf && !blocked(Math.cos(lo - step) * r, Math.sin(lo - step) * r))
    lo -= step;
  return [lo, hi];
}

/** Heading (about +y) that turns local +z towards the world direction (dx, dz). */
const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);

/**
 * Which HQ hosts each HQ-specific detail. Normally its own; if that HQ is missing from the city
 * (the platform list changed), the detail moves to the HQ with the fewest details of that kind,
 * so every detail stays findable.
 */
export function detailHosts(campusIds: readonly string[]): Map<string, string> {
  const present = new Set(campusIds);
  const hosts = new Map<string, string>();
  const load = new Map<string, number>(campusIds.map((id) => [id, 0]));
  for (const d of DISCOVERIES) {
    if (d.platform !== undefined && present.has(d.platform)) {
      hosts.set(d.id, d.platform);
      load.set(d.platform, (load.get(d.platform) ?? 0) + 1);
    }
  }
  const sorted = [...campusIds].sort();
  for (const d of DISCOVERIES) {
    if (d.platform === undefined || present.has(d.platform)) continue;
    let best: string | undefined;
    for (const id of sorted) {
      const taken = DISCOVERIES.some((x) => x.where === d.where && hosts.get(x.id) === id);
      if (taken) continue;
      if (best === undefined || (load.get(id) ?? 0) < (load.get(best) ?? 0)) best = id;
    }
    const host = best ?? d.platform;
    hosts.set(d.id, host);
    load.set(host, (load.get(host) ?? 0) + 1);
  }
  return hosts;
}

// ---------------------------------------------------------------------------
// actors
// ---------------------------------------------------------------------------

interface FrameCtx {
  /** Animation time in seconds (frozen at 0 with reduced motion). */
  t: number;
  rm: boolean;
  /** For interiors: the HQ's local hour and load. */
  hour: number | undefined;
  load: number;
}

interface Scope {
  readonly solid: PropBatch;
  readonly light: PropBatch;
  readonly picks: Mesh[];
  readonly animate: ((f: FrameCtx) => void)[];
  readonly kit: PickKit;
}

function newScope(kit: PickKit): Scope {
  return { solid: new PropBatch(), light: new PropBatch(), picks: [], animate: [], kit };
}

function addPick(s: Scope, id: string, radius: number | V3, at: V3): Mesh {
  const m = pickTarget(s.kit, id, radius, at);
  s.picks.push(m);
  return m;
}

/** Place a static geometry at a point with a heading; returns its handle. */
function put(
  batch: PropBatch,
  geo: BufferGeometry,
  x: number,
  y: number,
  z: number,
  yaw = 0,
): Handle {
  return batch.add(geo).place(x, y, z, yaw);
}

/** A soft pool of light on the ground. */
function pool(r: number, color: ColorRepresentation, k: number): BufferGeometry {
  return build([
    {
      geo: disc(r, 24),
      color: _c.set(color).multiplyScalar(k).getHex(),
      fade: { axis: 'r', from: 0, to: r, power: 1.6 },
    },
  ]);
}

// ---------------------------------------------------------------------------
// island props
// ---------------------------------------------------------------------------

interface IslandCtx {
  readonly s: Scope;
  readonly blocked: (x: number, z: number, margin: number) => boolean;
  /** Reserve a disc so later props keep clear of it. */
  readonly reserve: (x: number, z: number, r: number) => void;
  readonly shore: number;
}

/** Find, reserve and return a spot for a prop of radius `r` near a preferred polar position. */
function spotFor(
  ctx: IslandCtx,
  deg: number,
  radii: readonly number[],
  r: number,
  swing = 0.4,
): Spot {
  const spot = findSpot((x, z) => ctx.blocked(x, z, r), deg * DEG, radii, swing);
  ctx.reserve(spot.x, spot.z, r);
  return spot;
}

function lighthouse(ctx: IslandCtx): { x: number; z: number; top: number } {
  const { s } = ctx;
  const a = -18 * DEG;
  const r = ctx.shore + 9;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  ctx.reserve(x, z, 3.5);
  const body = build([
    {
      geo: new DodecahedronGeometry(2.6, 0),
      color: C.stoneDark,
      at: [0, 0.1, 0],
      scale: [1, 0.5, 1],
    },
    {
      geo: new DodecahedronGeometry(1, 0),
      color: C.stone,
      at: [2.1, -0.3, 1.2],
      scale: [1, 0.6, 1],
    },
    { geo: new DodecahedronGeometry(0.7, 0), color: C.stoneDark, at: [-1.9, -0.4, 1.5] },
    { geo: cyl(1.9, 2.1, 0.3, 18), color: C.stone, at: [0, 1.35, 0] },
    { geo: cyl(0.52, 0.78, 5.2, 16), color: C.white, at: [0, 4.1, 0] },
    { geo: cyl(0.74, 0.745, 0.55, 16), color: C.red, at: [0, 2.6, 0] },
    { geo: cyl(0.635, 0.64, 0.55, 16), color: C.red, at: [0, 4.6, 0] },
    { geo: cyl(0.82, 0.82, 0.12, 16), color: C.metal, at: [0, 6.76, 0] },
    { geo: tor(0.8, 0.018, 4, 24), color: C.chrome, at: [0, 7.02, 0], rot: [Math.PI / 2, 0, 0] },
    { geo: cyl(0.42, 0.42, 0.62, 12), color: '#ffe3a3', glow: 1.7, at: [0, 7.13, 0] },
    { geo: cone(0.56, 0.55, 12), color: C.red, at: [0, 7.72, 0] },
    { geo: sph(0.07), color: C.chrome, at: [0, 8.03, 0] },
    // keeper's hut with a lit window
    { geo: box(0.9, 0.6, 0.7), color: C.white, at: [-1.28, 1.8, 0.2] },
    { geo: cone(0.66, 0.36, 4), color: C.red, at: [-1.28, 2.28, 0.2], rot: [0, Math.PI / 4, 0] },
    { geo: box(0.22, 0.2, 0.02), color: C.warm, glow: 1.3, at: [-1.28, 1.86, 0.56] },
  ]);
  put(s.solid, body, x, SEA_Y, z, yawTo(-x, -z));
  // Two opposite beams sweeping from the lantern: soft cones that fade with distance.
  const L = 17;
  const beamGeo = (turn: number): Part => ({
    geo: cyl(0.08, 1.9, L, 18, true)
      .rotateZ(Math.PI / 2)
      .translate(L / 2, 0, 0)
      .rotateY(turn),
    color: '#ffe7b8',
  });
  const beamParts = [beamGeo(0), beamGeo(Math.PI)];
  // The fade runs along each beam; build them separately so each fades from the lantern out.
  const beams = build(
    beamParts.map((p, i) => ({
      ...p,
      color: _c.set('#ffe7b8').multiplyScalar(0.14).getHex(),
      fade: { axis: 'x', from: 0, to: i === 0 ? L : -L, power: 1.4 },
    })),
  );
  const beam = s.light.add(beams);
  const lampY = SEA_Y + 7.13;
  beam.place(x, lampY, z);
  const halo = s.light.add(
    build([
      {
        geo: sph(1.1, 14, 10),
        color: _c.set('#ffd9a0').multiplyScalar(0.22).getHex(),
        fade: { axis: 'r', from: 0.2, to: 1.1 },
      },
    ]),
  );
  halo.place(x, lampY, z);
  addPick(s, 'lighthouse', [2.2, 5.2, 2.2], [x, SEA_Y + 4.6, z]);
  s.animate.push((f) => {
    beam.place(x, lampY, z, f.rm ? 0.9 : f.t * 0.42);
  });
  return { x, z, top: SEA_Y + 8.1 };
}

function deliveryDrone(ctx: IslandCtx, home: { x: number; z: number; top: number }): void {
  const { s } = ctx;
  const geo = build([
    { geo: box(0.26, 0.08, 0.26), color: '#2a2f3a' },
    { geo: sph(0.11, 10, 6), color: '#4a5263', at: [0, 0.04, 0], scale: [1, 0.45, 1] },
    { geo: box(0.64, 0.025, 0.04), color: '#2a2f3a', rot: [0, Math.PI / 4, 0] },
    { geo: box(0.64, 0.025, 0.04), color: '#2a2f3a', rot: [0, -Math.PI / 4, 0] },
    ...[0, 1, 2, 3].map((i): Part => {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      return {
        geo: cyl(0.1, 0.1, 0.01, 14),
        color: '#a9b3c6',
        glow: 0.15,
        at: [Math.cos(a) * 0.22, 0.04, Math.sin(a) * 0.22],
      };
    }),
    { geo: rod([0, -0.04, 0], [0, -0.24, 0], 0.006), color: '#d6d9e0' },
    { geo: box(0.2, 0.16, 0.2), color: C.cardboard, at: [0, -0.32, 0] },
    { geo: box(0.205, 0.02, 0.05), color: '#8a6a44', at: [0, -0.24, 0] },
    { geo: sph(0.028), color: '#ff3b30', glow: 2.2, at: [-0.14, 0, 0] },
    { geo: sph(0.028), color: '#3bff8a', glow: 2.2, at: [0.14, 0, 0] },
  ]);
  const drone = s.solid.add(geo);
  const pick = addPick(s, 'delivery-drone', 1.3, [home.x, home.top + 2, home.z]);
  const R = 4.3;
  s.animate.push((f) => {
    const a = f.rm ? 2.2 : f.t * 0.27;
    const x = home.x + Math.cos(a) * R;
    const z = home.z + Math.sin(a) * R;
    const y = home.top + 2.1 + (f.rm ? 0 : 0.18 * Math.sin(f.t * 1.3));
    // Tangent of the circle, nose first, with a slight bank into the turn.
    drone.place(x, y, z, yawTo(-Math.sin(a), Math.cos(a)), 1, 0.06, f.rm ? 0 : -0.12);
    pick.position.set(x, y - 0.15, z);
  });
}

function fishingBoat(ctx: IslandCtx): void {
  const { s } = ctx;
  const a = 38 * DEG;
  const r = ctx.shore + 17;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  ctx.reserve(x, z, 2);
  const skin = SKIN[1]!;
  const hull = build([
    { geo: box(0.9, 0.42, 2.0), color: '#a8423a', at: [0, 0.05, 0] },
    { geo: cyl(0.52, 0.52, 0.42, 3), color: '#a8423a', at: [0, 0.05, 1.26] },
    { geo: box(0.94, 0.05, 2.04), color: C.cream, at: [0, 0.28, 0] },
    { geo: box(0.6, 0.45, 0.6), color: C.white, at: [0, 0.52, -0.45] },
    { geo: box(0.5, 0.14, 0.02), color: C.warm, glow: 1.4, at: [0, 0.6, -0.14] },
    { geo: box(0.68, 0.05, 0.68), color: '#3a414f', at: [0, 0.77, -0.45] },
    { geo: rod([0, 0.28, 0.4], [0, 1.65, 0.4], 0.025), color: C.wood },
    { geo: rod([0, 1.6, 0.4], [0, 0.32, 1.45], 0.008), color: '#d6d0c0' },
    { geo: rod([0, 1.6, 0.4], [0, 0.8, -0.8], 0.008), color: '#d6d0c0' },
    { geo: sph(0.06), color: '#ffe0a0', glow: 2.6, at: [0, 1.66, 0.4] },
    { geo: rod([0, 0.3, -0.95], [0, 0.95, -0.95], 0.015), color: C.wood },
    { geo: sph(0.05), color: '#ffe0a0', glow: 2.4, at: [0, 0.98, -0.95] },
    {
      geo: person({ pose: 'stand', shirt: '#e0a23c', skin, hat: '#e0a23c', h: 0.46 }),
      at: [0.22, 0.3, 0.55],
      rot: [0, Math.PI / 2, 0],
    },
  ]);
  const boat = s.solid.add(hull);
  const glow = s.light.add(pool(1.6, '#ffc27a', 0.16));
  const yaw0 = yawTo(Math.sin(a), -Math.cos(a)); // broadside to the island
  addPick(s, 'fishing-boat', 2.1, [x, SEA_Y + 0.6, z]);
  s.animate.push((f) => {
    const t = f.t;
    const bob = f.rm ? 0 : 0.06 * Math.sin(t * 1.1);
    const yaw = yaw0 + (f.rm ? 0 : 0.08 * Math.sin(t * 0.13));
    boat.place(
      x,
      SEA_Y + 0.08 + bob,
      z,
      yaw,
      1,
      f.rm ? 0 : 0.025 * Math.sin(t * 0.7 + 1),
      f.rm ? 0 : 0.045 * Math.sin(t * 0.9),
    );
    glow.place(x, SEA_Y + 0.03, z);
  });
}

function fox(ctx: IslandCtx): void {
  const { s } = ctx;
  const spot = spotFor(ctx, 126, [ctx.shore - 1.1, ctx.shore - 1.8, ctx.shore - 2.6], 0.8);
  const orange = '#d9772b';
  const dark = '#3b2518';
  const body = build([
    {
      geo: sph(1, 12, 10),
      color: orange,
      at: [0, 0.2, -0.02],
      scale: [0.16, 0.2, 0.18],
      rot: [-0.35, 0, 0],
    },
    { geo: sph(1, 10, 8), color: C.cream, at: [0, 0.24, 0.11], scale: [0.09, 0.12, 0.06] },
    { geo: sph(1, 10, 8), color: orange, at: [-0.085, 0.1, -0.08], scale: [0.11, 0.1, 0.14] },
    { geo: sph(1, 10, 8), color: orange, at: [0.085, 0.1, -0.08], scale: [0.11, 0.1, 0.14] },
    { geo: cap(0.024, 0.14), color: dark, at: [-0.05, 0.08, 0.1] },
    { geo: cap(0.024, 0.14), color: dark, at: [0.05, 0.08, 0.1] },
    // the tail curls round on the sand, white-tipped
    {
      geo: tor(0.17, 0.055, 6, 14, Math.PI * 0.95),
      color: orange,
      at: [0.02, 0.05, -0.02],
      rot: [Math.PI / 2, 0, -0.3],
    },
    { geo: sph(0.058), color: C.cream, at: [-0.16, 0.05, 0.1] },
  ]);
  const head = build([
    { geo: sph(0.1, 12, 10), color: orange, at: [0, 0.06, 0.02] },
    { geo: sph(1, 10, 8), color: C.cream, at: [0, 0.02, 0.07], scale: [0.07, 0.05, 0.06] },
    { geo: cone(0.045, 0.13, 8), color: orange, at: [0, 0.04, 0.14], rot: [Math.PI / 2, 0, 0] },
    { geo: sph(0.019), color: '#111111', at: [0, 0.045, 0.205] },
    { geo: cone(0.036, 0.1, 6), color: orange, at: [-0.056, 0.17, 0] },
    { geo: cone(0.036, 0.1, 6), color: orange, at: [0.056, 0.17, 0] },
    { geo: cone(0.018, 0.04, 6), color: dark, at: [-0.056, 0.205, 0] },
    { geo: cone(0.018, 0.04, 6), color: dark, at: [0.056, 0.205, 0] },
    { geo: sph(0.011), color: '#ffcf6b', glow: 0.35, at: [-0.04, 0.085, 0.1] },
    { geo: sph(0.011), color: '#ffcf6b', glow: 0.35, at: [0.04, 0.085, 0.1] },
  ]);
  const yaw = yawTo(Math.cos(spot.angle), Math.sin(spot.angle)); // facing the sea
  const scale = 1.35;
  s.solid.add(body).place(spot.x, 0, spot.z, yaw, scale);
  const h = s.solid.add(head);
  addPick(s, 'fox', 1.1, [spot.x, 0.35, spot.z]);
  // The head sits on the neck (0.36 up, 0.04 forward, before scaling) and looks about slowly.
  const nx = Math.sin(yaw) * 0.04 * scale;
  const nz = Math.cos(yaw) * 0.04 * scale;
  s.animate.push((f) => {
    const look = f.rm ? 0.25 : 0.4 * Math.sin(f.t * 0.31) + 0.1 * Math.sin(f.t * 1.7);
    h.place(spot.x + nx, 0.36 * scale, spot.z + nz, yaw + look, scale);
  });
}

function telescope(ctx: IslandCtx): void {
  const { s } = ctx;
  const spot = spotFor(ctx, 234, [ctx.shore - 1.8, ctx.shore - 2.6, ctx.shore - 3.4], 1.0);
  const moon = MOON_DIRECTION;
  const pivot: V3 = [0, 0.56, 0];
  const tipA: V3 = [pivot[0] - moon.x * 0.3, pivot[1] - moon.y * 0.3, pivot[2] - moon.z * 0.3];
  const tipB: V3 = [pivot[0] + moon.x * 0.5, pivot[1] + moon.y * 0.5, pivot[2] + moon.z * 0.5];
  const legs: Part[] = [0, 1, 2].map((i) => {
    const a = (i / 3) * TAU + 0.4;
    return { geo: rod(pivot, [Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24], 0.012), color: C.metal };
  });
  const gazerYaw = yawTo(moon.x, moon.z);
  const geo = build([
    ...legs,
    { geo: sph(0.035), color: C.metal, at: pivot },
    { geo: rod(tipA, tipB, 0.055, 12), color: C.white },
    {
      geo: rod(
        tipB,
        [tipB[0] + moon.x * 0.06, tipB[1] + moon.y * 0.06, tipB[2] + moon.z * 0.06],
        0.068,
        12,
      ),
      color: '#cfd6e4',
    },
    {
      geo: rod(
        tipA,
        [tipA[0] - moon.x * 0.08, tipA[1] - moon.y * 0.08, tipA[2] - moon.z * 0.08],
        0.022,
      ),
      color: '#222630',
    },
    {
      geo: person({ pose: 'stand', shirt: '#6f7fb8', skin: SKIN[3], hat: '#b8323a' }),
      at: [
        -Math.sin(gazerYaw) * 0.42 + Math.cos(gazerYaw) * 0.18,
        0,
        -Math.cos(gazerYaw) * 0.42 - Math.sin(gazerYaw) * 0.18,
      ],
      rot: [0, gazerYaw, 0],
    },
  ]);
  put(s.solid, geo, spot.x, 0, spot.z);
  addPick(s, 'telescope', 1.1, [spot.x, 0.45, spot.z]);
}

function bench(ctx: IslandCtx): void {
  const { s } = ctx;
  const spot = spotFor(ctx, 54, [ctx.shore - 3.2, ctx.shore - 2.4, ctx.shore - 4], 1.1);
  const legs: Part[] = [
    [-0.4, -0.1],
    [0.4, -0.1],
    [-0.4, 0.1],
    [0.4, 0.1],
  ].map(([lx, lz]) => ({ geo: box(0.04, 0.16, 0.04), color: C.metal, at: [lx!, 0.08, lz!] }));
  const geo = build([
    { geo: box(0.92, 0.04, 0.26), color: C.woodLight, at: [0, 0.16, 0] },
    { geo: box(0.92, 0.18, 0.03), color: C.woodLight, at: [0, 0.3, -0.12], rot: [-0.12, 0, 0] },
    ...legs,
    { geo: box(0.03, 0.03, 0.26), color: C.metal, at: [-0.45, 0.24, 0] },
    { geo: box(0.03, 0.03, 0.26), color: C.metal, at: [0.45, 0.24, 0] },
    {
      geo: person({ pose: 'sit', shirt: '#b86a5f', skin: SKIN[2], hat: '#2d3342' }),
      at: [-0.2, 0.01, 0.01],
      rot: [0, 0, 0.1],
    },
    {
      geo: person({ pose: 'sit', shirt: '#5f7fb8', skin: SKIN[0] }),
      at: [0.18, 0.01, 0.01],
      rot: [0, 0, -0.05],
    },
    // a scarf, and the lamp that lights them
    {
      geo: tor(0.035, 0.014, 5, 12),
      color: '#f2c14e',
      at: [0.18, 0.39, 0.0],
      rot: [Math.PI / 2, 0, 0],
    },
    { geo: rod([0.64, 0, -0.12], [0.64, 1.2, -0.12], 0.022), color: C.metal },
    { geo: cyl(0.07, 0.1, 0.1, 10), color: C.metal, at: [0.64, 1.24, -0.12] },
    { geo: sph(0.05), color: '#ffe0a0', glow: 2.4, at: [0.64, 1.17, -0.12] },
  ]);
  const yaw = yawTo(-Math.cos(spot.angle), -Math.sin(spot.angle)); // facing the skyline
  put(s.solid, geo, spot.x, 0, spot.z, yaw);
  // Lamp pool, offset with the lamp.
  const lx = Math.cos(yaw) * 0.5 + Math.sin(yaw) * -0.05;
  const lz = -Math.sin(yaw) * 0.5 + Math.cos(yaw) * -0.05;
  put(s.light, pool(1.3, '#ffcf8a', 0.18), spot.x + lx, 0.03, spot.z + lz);
  addPick(s, 'bench', 1.3, [spot.x, 0.35, spot.z]);
}

function vendingMachine(ctx: IslandCtx): void {
  const { s } = ctx;
  const spot = spotFor(ctx, 49, [ctx.shore - 4.6, ctx.shore - 5.2, ctx.shore - 3.9], 0.8);
  const geo = build([
    { geo: box(0.42, 0.85, 0.34), color: '#2b4c8c', at: [0, 0.425, 0] },
    { geo: box(0.34, 0.5, 0.02), color: '#9fd4f0', glow: 0.24, at: [0, 0.56, 0.171] },
    { geo: box(0.3, 0.022, 0.022), color: '#ffb627', glow: 0.38, at: [0, 0.44, 0.182] },
    { geo: box(0.3, 0.022, 0.022), color: '#46d98a', glow: 0.38, at: [0, 0.57, 0.182] },
    { geo: box(0.3, 0.022, 0.022), color: '#ff6b6b', glow: 0.38, at: [0, 0.7, 0.182] },
    { geo: box(0.28, 0.08, 0.02), color: '#15213a', at: [0, 0.14, 0.171] },
    { geo: box(0.06, 0.12, 0.02), color: '#9aa3b5', at: [0.13, 0.27, 0.172] },
    { geo: box(0.44, 0.09, 0.36), color: '#dfe7f7', glow: 0.3, at: [0, 0.895, 0] },
  ]);
  const yaw = yawTo(-Math.cos(spot.angle), -Math.sin(spot.angle));
  put(s.solid, geo, spot.x, 0, spot.z, yaw);
  put(
    s.light,
    pool(0.9, '#bfe3ff', 0.12),
    spot.x - Math.cos(spot.angle) * 0.45,
    0.03,
    spot.z - Math.sin(spot.angle) * 0.45,
  );
  addPick(s, 'vending-machine', 1.0, [spot.x, 0.45, spot.z]);
}

function streetMusician(ctx: IslandCtx): { x: number; z: number } {
  const { s } = ctx;
  const spot = spotFor(ctx, 24, [2.3, 1.7, 2.9, 1.1, 3.5], 0.9, 1.2);
  const face = 57 * DEG; // towards the opening view
  const yaw = yawTo(Math.cos(face), Math.sin(face));
  const geo = build([
    { geo: person({ pose: 'stand', shirt: '#8a6fb0', skin: SKIN[1], hat: '#3b3b48' }) },
    {
      geo: sph(1, 12, 8),
      color: C.woodLight,
      at: [0.02, 0.24, 0.075],
      scale: [0.075, 0.095, 0.03],
      rot: [0, 0, 0.6],
    },
    { geo: box(0.022, 0.2, 0.015), color: C.woodDark, at: [-0.075, 0.33, 0.075], rot: [0, 0, 0.9] },
    { geo: box(0.34, 0.04, 0.14), color: '#23262f', at: [0.12, 0.02, 0.26] },
    { geo: box(0.3, 0.012, 0.1), color: '#9c2f3a', at: [0.12, 0.045, 0.26] },
    { geo: cyl(0.018, 0.018, 0.006, 8), color: '#ffcf6b', glow: 0.7, at: [0.08, 0.055, 0.25] },
    { geo: cyl(0.018, 0.018, 0.006, 8), color: '#ffcf6b', glow: 0.7, at: [0.15, 0.055, 0.28] },
    { geo: rod([-0.38, 0, -0.1], [-0.38, 1.15, -0.1], 0.022), color: C.metal },
    { geo: cyl(0.06, 0.09, 0.09, 10), color: C.metal, at: [-0.38, 1.18, -0.1] },
    { geo: sph(0.045), color: '#ffe0a0', glow: 2.4, at: [-0.38, 1.12, -0.1] },
  ]);
  put(s.solid, geo, spot.x, 0, spot.z, yaw);
  put(s.light, pool(1.4, '#ffcf8a', 0.2), spot.x, 0.04, spot.z);
  // Three notes drift up from the guitar and fade.
  const noteGeo = build([
    { geo: sph(1, 8, 6), color: '#ffe2b0', scale: [0.034, 0.026, 0.02], rot: [0, 0, 0.4] },
    { geo: box(0.008, 0.1, 0.008), color: '#ffe2b0', at: [0.03, 0.05, 0] },
    { geo: box(0.04, 0.012, 0.008), color: '#ffe2b0', at: [0.048, 0.095, 0], rot: [0, 0, -0.5] },
  ]);
  const notes = [0, 1, 2].map(() => s.light.add(noteGeo));
  addPick(s, 'street-musician', 1.0, [spot.x, 0.35, spot.z]);
  const gx = spot.x + Math.sin(yaw) * 0.08;
  const gz = spot.z + Math.cos(yaw) * 0.08;
  s.animate.push((f) => {
    notes.forEach((n, i) => {
      const u = f.rm ? (i + 0.5) / 3 : frac(f.t / 3.2 + i / 3);
      const side = Math.sin(u * 5 + i * 2) * 0.12;
      n.place(
        gx + Math.cos(yaw) * side,
        0.4 + u * 0.75,
        gz - Math.sin(yaw) * side,
        yaw,
        0.6 + u * 0.4,
      );
      n.tint(hump(u) * 0.8);
    });
  });
  return { x: spot.x, z: spot.z };
}

function paperPlane(ctx: IslandCtx, centre: { x: number; z: number }): void {
  const { s } = ctx;
  const geo = build([
    {
      geo: tris([
        [0, 0, 0.32],
        [-0.24, 0.03, -0.22],
        [0, 0, -0.22],
        [0, 0, 0.32],
        [0, 0, -0.22],
        [0.24, 0.03, -0.22],
        [0, 0, 0.32],
        [0, -0.07, -0.22],
        [0, 0, -0.22],
      ]),
      color: '#f4f1ea',
      glow: 0.18,
    },
  ]);
  const plane = s.solid.add(geo);
  const pick = addPick(s, 'paper-plane', 1.2, [centre.x, 8, centre.z]);
  const R = 3.3;
  s.animate.push((f) => {
    const a = f.rm ? 0.8 : f.t * 0.36;
    const x = centre.x * 0.5 + Math.cos(a) * R;
    const z = centre.z * 0.5 + Math.sin(a) * R;
    const y = 8.2 + (f.rm ? 0 : 0.45 * Math.sin(f.t * 0.5));
    plane.place(
      x,
      y,
      z,
      yawTo(-Math.sin(a), Math.cos(a)),
      1.4,
      f.rm ? 0 : 0.08 * Math.cos(f.t * 0.5),
      -0.38,
    );
    pick.position.set(x, y, z);
  });
}

function radioDish(ctx: IslandCtx): void {
  const { s } = ctx;
  const spot = spotFor(ctx, 198, [ctx.shore - 3.2, ctx.shore - 4, ctx.shore - 4.8], 2.0);
  const profile: Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const r = (i / 8) * 1.4;
    profile.push(new Vector2(r, 0.24 * r * r - 0.06));
  }
  for (let i = 8; i >= 0; i--) {
    const r = (i / 8) * 1.4;
    profile.push(new Vector2(r, 0.24 * r * r));
  }
  const tilt = 0.62;
  const dish = build([
    { geo: new LatheGeometry(profile, 28), color: '#d8dde6' },
    ...[0, 1, 2].map((i): Part => {
      const a = (i / 3) * TAU;
      return {
        geo: rod([Math.cos(a) * 1.3, 0.4, Math.sin(a) * 1.3], [0, 0.95, 0], 0.012),
        color: '#b9c0cc',
      };
    }),
    { geo: cyl(0.07, 0.05, 0.16, 10), color: '#b9c0cc', at: [0, 1.0, 0] },
    { geo: sph(0.04), color: '#ff3b30', glow: 2.4, at: [0, 1.1, 0] },
  ]);
  dish.rotateX(tilt).translate(0, 1.42, 0);
  const geo = build([
    { geo: cyl(0.55, 0.65, 0.3, 14), color: '#4a505c', at: [0, 0.15, 0] },
    { geo: cyl(0.14, 0.18, 1.0, 10), color: '#c7ccd6', at: [0, 0.8, 0] },
    { geo: box(0.9, 0.08, 0.14), color: '#9aa3b5', at: [0, 1.32, 0] },
    { geo: dish },
  ]);
  const yaw = yawTo(Math.cos(spot.angle), Math.sin(spot.angle)); // looking out to sea and sky
  put(s.solid, geo, spot.x, 0, spot.z, yaw);
  addPick(s, 'radio-dish', 2.0, [spot.x, 1.3, spot.z]);
}

function rooftopGarden(ctx: IslandCtx): void {
  const { s } = ctx;
  const spot = spotFor(ctx, -54, [ctx.shore - 3.6, ctx.shore - 4.4, ctx.shore - 2.9], 2.0);
  const plants: Part[] = [];
  const planters: [number, number][] = [
    [-0.72, 0.45],
    [0.08, 0.45],
    [0.78, -0.42],
  ];
  planters.forEach(([px, pz], i) => {
    plants.push({ geo: box(0.52, 0.14, 0.26), color: C.wood, at: [px, 1.45, pz] });
    for (let k = 0; k < 3; k++) {
      const h = hash01(i * 7 + k);
      plants.push({
        geo: sph(0.1 + 0.05 * h, 8, 6),
        color: k === 1 ? C.leafDark : C.leaf,
        at: [px - 0.16 + k * 0.16, 1.58 + 0.03 * h, pz],
      });
      if (k !== 1)
        plants.push({
          geo: sph(0.028, 6, 5),
          color: '#e0483e',
          glow: 0.35,
          at: [px - 0.16 + k * 0.16 + 0.05, 1.62, pz + 0.07],
        });
    }
  });
  const bulbs: Part[] = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    const bx = -1.05 + u * 2.1;
    bulbs.push({
      geo: sph(0.028, 6, 5),
      color: '#ffe0a0',
      glow: 2.4,
      at: [bx, 1.95 - 0.18 * Math.sin(Math.PI * u), 0.78],
    });
  }
  const geo = build([
    { geo: box(2.2, 1.3, 1.6), color: '#c9b79c', at: [0, 0.65, 0] },
    { geo: box(2.24, 0.1, 1.64), color: '#3b3f4a', at: [0, 0.05, 0] },
    { geo: box(0.34, 0.58, 0.02), color: '#ffcf8a', glow: 0.45, at: [0, 0.29, 0.81] },
    { geo: box(0.46, 0.34, 0.02), color: '#ffcf8a', glow: 1.2, at: [-0.62, 0.76, 0.81] },
    { geo: box(0.46, 0.34, 0.02), color: '#ffcf8a', glow: 1.2, at: [0.62, 0.76, 0.81] },
    { geo: box(2.0, 0.04, 0.42), color: '#b8323a', at: [0, 1.04, 0.98], rot: [0.28, 0, 0] },
    { geo: box(2.3, 0.08, 1.7), color: '#4a4f5a', at: [0, 1.34, 0] },
    ...plants,
    { geo: cyl(0.12, 0.09, 0.2, 10), color: '#b5653f', at: [-0.85, 1.48, -0.5] },
    { geo: sph(0.3, 10, 8), color: C.leafDark, at: [-0.85, 1.85, -0.5] },
    { geo: rod([0.1, 1.38, -0.4], [0.1, 1.95, -0.4], 0.015), color: C.metal },
    { geo: cone(0.46, 0.16, 10), color: C.cream, at: [0.1, 1.98, -0.4] },
    { geo: rod([-1.08, 1.38, 0.78], [-1.08, 2.0, 0.78], 0.015), color: C.metal },
    { geo: rod([1.08, 1.38, 0.78], [1.08, 2.0, 0.78], 0.015), color: C.metal },
    ...bulbs,
  ]);
  const yaw = yawTo(-Math.cos(spot.angle), -Math.sin(spot.angle));
  put(s.solid, geo, spot.x, 0, spot.z, yaw);
  put(
    s.light,
    pool(1.6, '#ffcf8a', 0.16),
    spot.x - Math.cos(spot.angle) * 1.3,
    0.03,
    spot.z - Math.sin(spot.angle) * 1.3,
  );
  addPick(s, 'rooftop-garden', 2.1, [spot.x, 1.1, spot.z]);
}

function campfire(ctx: IslandCtx): void {
  const { s } = ctx;
  const spot = spotFor(ctx, 162, [ctx.shore - 2.4, ctx.shore - 3.2, ctx.shore - 1.8], 1.5);
  const parts: Part[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    parts.push({
      geo: new DodecahedronGeometry(0.07, 0),
      color: i % 2 ? C.stone : C.stoneDark,
      at: [Math.cos(a) * 0.24, 0.035, Math.sin(a) * 0.24],
    });
  }
  for (let i = 0; i < 3; i++) {
    parts.push({
      geo: cyl(0.03, 0.035, 0.36, 7),
      color: C.woodDark,
      at: [0, 0.06, 0],
      rot: [Math.PI / 2 - 0.25, (i / 3) * Math.PI, 0],
    });
  }
  parts.push({ geo: disc(0.17, 16), color: '#ff7a2a', glow: 1.6, at: [0, 0.02, 0] });
  [0, 1, 2].forEach((i) => {
    const a = (i / 3) * TAU + 0.5;
    const px = Math.cos(a) * 0.62;
    const pz = Math.sin(a) * 0.62;
    const face = yawTo(-px, -pz);
    parts.push(
      {
        geo: cyl(0.05, 0.05, 0.4, 8),
        color: C.wood,
        at: [px, 0.05, pz],
        rot: [Math.PI / 2, face + Math.PI / 2, 0],
      },
      {
        geo: person({ pose: 'sit', shirt: SHIRTS[(i * 3) % SHIRTS.length]!, skin: SKIN[i]! }),
        at: [px, -0.05, pz],
        rot: [0, face, 0],
      },
    );
  });
  put(s.solid, build(parts), spot.x, 0, spot.z);
  const flameA = s.solid.add(
    build([{ geo: cone(0.1, 0.34, 8), color: C.flame, glow: 2.4, at: [0, 0.17, 0] }]),
  );
  const flameB = s.solid.add(
    build([{ geo: cone(0.055, 0.22, 7), color: '#fff0a0', glow: 2.8, at: [0, 0.11, 0] }]),
  );
  const glow = s.light.add(pool(1.8, '#ff9a4a', 0.34));
  glow.place(spot.x, 0.03, spot.z);
  addPick(s, 'campfire', 1.4, [spot.x, 0.3, spot.z]);
  s.animate.push((f) => {
    const t = f.t;
    const k1 = f.rm ? 1 : 0.85 + 0.25 * Math.sin(t * 9.1) * Math.sin(t * 5.3 + 1);
    const k2 = f.rm ? 1 : 0.8 + 0.3 * Math.sin(t * 11.7 + 2);
    flameA.place(spot.x, 0.04, spot.z, t * 0.7, [1, k1, 1], f.rm ? 0 : 0.08 * Math.sin(t * 3.1));
    flameB.place(spot.x, 0.04, spot.z, -t, [1, k2, 1]);
    glow.tint(f.rm ? 1 : 0.85 + 0.15 * Math.sin(t * 7.3) * Math.sin(t * 3.7));
  });
}

function pierAngler(ctx: IslandCtx): void {
  const { s } = ctx;
  const spot = spotFor(ctx, 90, [ctx.shore - 1.4], 1.2, 0.3);
  const L = 8.8;
  const posts: Part[] = [];
  for (let z = 2.2; z < L; z += 2) {
    for (const x of [-0.45, 0.45])
      posts.push({ geo: cyl(0.05, 0.05, 1.95, 7), color: C.woodDark, at: [x, -0.87, z] });
  }
  const skin = SKIN[4]!;
  const geo = build([
    { geo: box(1.0, 0.08, L), color: C.wood, at: [0, 0.1, L / 2] },
    { geo: box(1.04, 0.03, 0.1), color: C.woodDark, at: [0, 0.155, L - 0.05] },
    ...posts,
    {
      geo: person({ pose: 'sit', shirt: '#4f9fb0', skin, hat: '#e0a23c' }),
      at: [0.15, 0.0, L - 0.1],
    },
    { geo: rod([0.22, 0.32, L - 0.12], [0.55, 1.35, L + 1.1], 0.012), color: '#2a2a2a' },
    {
      geo: rod([0.55, 1.35, L + 1.1], [0.62, SEA_Y + 0.03, L + 1.55], 0.004),
      color: '#d6d9e0',
      glow: 0.35,
    },
    { geo: sph(0.035), color: '#ff5a4a', glow: 1.2, at: [0.62, SEA_Y + 0.03, L + 1.55] },
    { geo: cyl(0.07, 0.06, 0.12, 10), color: C.chrome, at: [-0.2, 0.2, L - 0.5] },
    { geo: box(0.1, 0.14, 0.1), color: C.metal, at: [-0.34, 0.21, L - 0.15] },
    { geo: sph(0.045), color: '#ffe0a0', glow: 2.6, at: [-0.34, 0.24, L - 0.15] },
  ]);
  const yaw = yawTo(Math.cos(spot.angle), Math.sin(spot.angle)); // out to sea
  put(s.solid, geo, spot.x, 0, spot.z, yaw);
  const ex = spot.x + Math.sin(yaw) * (L - 0.2);
  const ez = spot.z + Math.cos(yaw) * (L - 0.2);
  put(s.light, pool(1.5, '#ffcf8a', 0.18), ex, 0.16, ez);
  for (let d = 0; d <= L; d += 1)
    ctx.reserve(spot.x + Math.sin(yaw) * d, spot.z + Math.cos(yaw) * d, 0.9);
  addPick(s, 'pier-angler', 1.6, [ex, 0.5, ez]);
}

function jogger(ctx: IslandCtx): void {
  const { s } = ctx;
  const r = ctx.shore - 1.7;
  const blocked = (x: number, z: number) => ctx.blocked(x, z, 0.5);
  const spot = findSpot(blocked, 18 * DEG, [r], 0.35);
  const [lo, hi] = clearArc(blocked, spot.angle, r, 7 * DEG);
  const geo = build([
    { geo: person({ pose: 'run', shirt: '#3fb8d8', skin: SKIN[2], pants: '#1f2430' }) },
    {
      geo: tor(0.051, 0.01, 4, 14),
      color: '#e0483e',
      at: [0, 0.445, 0.05],
      rot: [Math.PI / 2 - 0.1, 0, 0],
    },
    { geo: sph(0.009), color: '#f4f7ff', glow: 1.4, at: [0, 0.45, 0.1] },
  ]);
  const runner = s.solid.add(geo);
  const pick = addPick(s, 'jogger', 1.0, [spot.x, 0.3, spot.z]);
  const span = Math.max(hi - lo - 0.04, 0.01);
  const speed = 1.15 / (r * span); // arc fraction per second
  s.animate.push((f) => {
    const u = f.rm ? 0.5 : pingPong(f.t * speed);
    const back = !f.rm && Math.floor((((f.t * speed) % 2) + 2) % 2) === 1;
    const a = lo + 0.02 + u * span;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const dir = back ? -1 : 1;
    const yaw = yawTo(-Math.sin(a) * dir, Math.cos(a) * dir);
    const bob = f.rm ? 0 : 0.022 * Math.abs(Math.sin(f.t * 8.5));
    runner.place(x, bob, z, yaw, 1.05);
    pick.position.set(x, 0.3, z);
  });
}

function hotAirBalloon(ctx: IslandCtx): void {
  const { s } = ctx;
  const pts = [
    [0, 0],
    [0.35, 0.08],
    [0.8, 0.42],
    [1.28, 1.02],
    [1.55, 1.78],
    [1.5, 2.52],
    [1.2, 3.12],
    [0.66, 3.52],
    [0, 3.66],
  ].map(([x, y]) => new Vector2(x!, y!));
  const stripes: Part[] = [];
  const n = 10;
  for (let i = 0; i < n; i++) {
    stripes.push({
      geo: new LatheGeometry(pts, 3, (i / n) * TAU, TAU / n),
      color: i % 2 ? '#f2c14e' : '#e05a47',
      glow: 0.1,
    });
  }
  const envelope = build(stripes);
  const ropes: Part[] = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz): Part => ({
      geo: rod([sx * 0.22, -1.07, sz * 0.22], [sx * 0.32, 0.06, sz * 0.32], 0.01),
      color: '#3a2f25',
    })),
  );
  const basket = build([
    { geo: box(0.5, 0.36, 0.5), color: C.wood, at: [0, -1.25, 0] },
    { geo: box(0.54, 0.05, 0.54), color: C.woodDark, at: [0, -1.07, 0] },
    ...ropes,
    { geo: cyl(0.08, 0.08, 0.1, 10), color: C.metal, at: [0, -0.7, 0] },
    {
      geo: person({ pose: 'stand', shirt: '#d07a4a', skin: SKIN[3], h: 0.4 }),
      at: [0.08, -1.4, 0.05],
      scale: 0.9,
    },
  ]);
  const env = s.solid.add(envelope);
  const bask = s.solid.add(basket);
  const flame = s.solid.add(
    build([{ geo: cone(0.08, 0.3, 8), color: C.flame, glow: 2.6, at: [0, 0.15, 0] }]),
  );
  const R = ctx.shore + 16;
  const Y = 22;
  const a0 = 100 * DEG;
  const pick = addPick(s, 'hot-air-balloon', 3.6, [Math.cos(a0) * R, Y + 1.5, Math.sin(a0) * R]);
  const warm = new Color('#ffb070');
  s.animate.push((f) => {
    const a = f.rm ? a0 : a0 + f.t * 0.011;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const y = Y + (f.rm ? 0 : 0.7 * Math.sin(f.t * 0.21));
    const yaw = f.rm ? 0.3 : f.t * 0.05;
    env.place(x, y, z, yaw);
    bask.place(x, y, z, yaw);
    // Every ~9 s the burner fires for a moment and the envelope warms.
    const burn = f.rm ? 0.3 : clamp01(1 - Math.abs(frac(f.t / 9) - 0.12) / 0.1);
    flame.place(x, y - 0.66, z, 0, [1, 0.4 + 1.3 * burn, 1]).show(burn > 0.02);
    env.tint(1 + 0.45 * burn, warm);
    pick.position.set(x, y + 1.4, z);
  });
}

function messageBottle(ctx: IslandCtx): void {
  const { s } = ctx;
  const a = 246 * DEG;
  const r = ctx.shore + 7;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  const inside = build([
    { geo: cyl(0.034, 0.034, 0.17, 8), color: C.cream, rot: [0, 0, Math.PI / 2] },
    {
      geo: cyl(0.028, 0.03, 0.05, 8),
      color: C.woodLight,
      at: [0.24, 0, 0],
      rot: [0, 0, Math.PI / 2],
    },
  ]);
  const tint = _c.set('#6fe0a8').multiplyScalar(0.26).getHex();
  const glass = build([
    { geo: cyl(0.07, 0.07, 0.28, 12), color: tint, rot: [0, 0, Math.PI / 2] },
    { geo: cyl(0.026, 0.06, 0.07, 12), color: tint, at: [0.175, 0, 0], rot: [0, 0, -Math.PI / 2] },
    { geo: cyl(0.026, 0.026, 0.06, 10), color: tint, at: [0.235, 0, 0], rot: [0, 0, Math.PI / 2] },
  ]);
  const paper = s.solid.add(inside);
  const shell = s.light.add(glass);
  const glint = s.solid.add(build([{ geo: sph(0.022, 6, 5), color: '#ffffff', glow: 3 }]));
  addPick(s, 'message-bottle', 1.2, [x, SEA_Y + 0.1, z]);
  // It floats in the moon's reflection on the sea (the environment draws that).
  const scale = 2;
  s.animate.push((f) => {
    const t = f.t;
    const y = SEA_Y + 0.04 + (f.rm ? 0 : 0.03 * Math.sin(t * 1.3));
    const yaw = f.rm ? 0.7 : 0.7 + 0.25 * Math.sin(t * 0.17);
    const roll = f.rm ? 0.05 : 0.08 * Math.sin(t * 1.1);
    paper.place(x, y, z, yaw, scale, 0, roll);
    shell.place(x, y, z, yaw, scale, 0, roll);
    // A glint of moonlight every few seconds.
    const g = f.rm ? 0.8 : clamp01(1 - Math.abs(frac(t / 4.3) - 0.5) / 0.08);
    glint.place(x, y + 0.07 * scale, z, 0, 0.4 + g).show(g > 0.02);
  });
}

function buildIsland(kit: PickKit, campuses: readonly CampusShape[], islandRadius: number): Scope {
  const s = newScope(kit);
  const reserved: { x: number; z: number; r: number }[] = [];
  const ctx: IslandCtx = {
    s,
    shore: islandRadius,
    blocked: (x, z, margin) =>
      campuses.some((c) => campusCovers(c, x, z, margin)) ||
      reserved.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + margin),
    reserve: (x, z, r) => reserved.push({ x, z, r }),
  };
  const home = lighthouse(ctx);
  deliveryDrone(ctx, home);
  fishingBoat(ctx);
  pierAngler(ctx);
  fox(ctx);
  telescope(ctx);
  bench(ctx);
  vendingMachine(ctx);
  const plaza = streetMusician(ctx);
  paperPlane(ctx, plaza);
  radioDish(ctx);
  rooftopGarden(ctx);
  campfire(ctx);
  jogger(ctx);
  hotAirBalloon(ctx);
  messageBottle(ctx);
  return s;
}

// ---------------------------------------------------------------------------
// interiors
// ---------------------------------------------------------------------------

type Maker = (s: Scope, place: InteriorPlace) => void;

interface InteriorPlace {
  readonly campus: InteriorCampus;
  readonly parent: Group;
  /** Offices: free desks, best first (seat floor point; the desk top is 0.75 above). */
  readonly seats: readonly Vector3[];
  /** Lab: half the width of the display. */
  readonly labHalf: number;
}

/** The office diorama's own occupancy hash (offices.ts): seats hashing above 0.9 are never taken. */
function officeHash(n: number): number {
  const x = Math.sin(n * 91.7 + 17.3) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Desks in an office diorama, read from its instanced desk tops (a 0.06-high box): seat floor
 * points, the never-occupied seats first (best seen — upper floor, front — first), then the rest.
 */
export function officeSeats(parent: Object3D): Vector3[] {
  const found: InstancedMesh[] = [];
  parent.traverse((o) => {
    if (!(o instanceof InstancedMesh) || found.length > 0) return;
    const g = o.geometry;
    if (g instanceof BoxGeometry && Math.abs(g.parameters.height - 0.06) < 1e-6) found.push(o);
  });
  const desks = found[0];
  if (!desks) return [];
  const m = new Matrix4();
  const seats: { p: Vector3; free: boolean; score: number; h: number }[] = [];
  for (let i = 0; i < desks.count; i++) {
    desks.getMatrixAt(i, m);
    const p = new Vector3().setFromMatrixPosition(m);
    p.y -= 0.72;
    const h = officeHash(i);
    seats.push({ p, free: h > 0.9, score: p.y * 10 + p.z * 1.5 + p.x * 0.4, h });
  }
  seats.sort((a, b) =>
    a.free !== b.free ? (a.free ? -1 : 1) : a.free ? b.score - a.score : b.h - a.h,
  );
  return seats.map((x) => x.p);
}

// --- offices -----------------------------------------------------------------

function officeWorker(shirt: string, skin: string): BufferGeometry {
  // Matches the office people (capsule body, sphere head), asleep over the desk.
  return build([
    {
      geo: new CapsuleGeometry(0.13, 0.32, 3, 8),
      color: shirt,
      at: [0, 0.64, -0.3],
      rot: [0.95, 0, 0],
    },
    { geo: sph(0.11, 12, 10), color: skin, at: [0, 0.87, -0.03] },
    {
      geo: new SphereGeometry(0.116, 12, 8, 0, TAU, 0, 1.3),
      color: '#3a2a22',
      at: [0, 0.87, -0.03],
      rot: [-1.1, 0, 0],
    },
    { geo: cap(0.05, 0.28), color: shirt, at: [0, 0.8, 0.03], rot: [0, 0, Math.PI / 2] },
  ]);
}

const nightShift: Maker = (s, p) => {
  const seat = p.seats[1] ?? p.seats[0];
  if (!seat) return;
  const { x, y, z } = seat;
  const i = Math.floor(hash01(x * 3.1 + z) * SHIRTS.length);
  const body = build([
    { geo: officeWorker(SHIRTS[i % SHIRTS.length]!, SKIN[i % SKIN.length]!) },
    { geo: cyl(0.04, 0.035, 0.08, 10), color: C.white, at: [0.3, 0.79, 0.1] },
    { geo: disc(0.034, 10), color: '#3b2518', at: [0.3, 0.832, 0.1] },
    { geo: cyl(0.05, 0.06, 0.02, 10), color: C.metal, at: [-0.34, 0.76, -0.08] },
    { geo: rod([-0.34, 0.76, -0.08], [-0.3, 1.02, -0.02], 0.01), color: C.metal },
    { geo: cone(0.065, 0.075, 12), color: '#d9dee8', at: [-0.27, 1.0, 0.02], rot: [0.5, 0, 0] },
    { geo: sph(0.025), color: '#ffe0a0', glow: 2.4, at: [-0.26, 0.97, 0.04] },
  ]);
  const sleeper = put(s.solid, body, x, y, z);
  const lamp = put(s.light, pool(0.34, '#ffcf8a', 0.3), x - 0.2, y + 0.77, z + 0.05);
  const zGeo = build([
    { geo: box(0.07, 0.012, 0.012), color: '#bcd6ff', at: [0, 0.035, 0] },
    { geo: box(0.1, 0.012, 0.012), color: '#bcd6ff', rot: [0, 0, Math.PI / 4] },
    { geo: box(0.07, 0.012, 0.012), color: '#bcd6ff', at: [0, -0.035, 0] },
  ]);
  const zs = [0, 1, 2].map(() => s.light.add(zGeo));
  const pick = addPick(s, 'night-shift', 0.55, [x, y + 0.82, z - 0.15]);
  s.animate.push((f) => {
    const night = isNightHour(f.hour);
    sleeper.show(night);
    lamp.show(night);
    setPickable(pick, night);
    zs.forEach((h, k) => {
      h.show(night);
      if (!night) return;
      const u = f.rm ? 0.2 + k * 0.3 : frac(f.t / 3.6 + k / 3);
      h.place(x + 0.1 + u * 0.1, y + 1.0 + u * 0.3, z - 0.02, 0.35, 0.55 + u * 0.6, 0, 0.2);
      h.tint(hump(u) * 0.7);
    });
  });
};

const coffeeMachine: Maker = (s, p) => {
  const seat = p.seats[2] ?? p.seats[0];
  if (!seat) return;
  const { x, y, z } = seat;
  const cx = x - 0.3;
  const geo = build([
    { geo: box(0.2, 0.3, 0.2), color: '#2a2f3a', at: [0, 0.9, 0] },
    { geo: box(0.21, 0.03, 0.21), color: C.chrome, at: [0, 1.065, 0] },
    { geo: box(0.06, 0.04, 0.05), color: C.chrome, at: [0, 0.87, 0.11] },
    { geo: box(0.16, 0.02, 0.08), color: C.chrome, at: [0, 0.76, 0.1] },
    { geo: cyl(0.03, 0.025, 0.05, 10), color: C.white, at: [0, 0.795, 0.11] },
    { geo: sph(0.015), color: '#46d98a', glow: 1.1, at: [0.06, 0.99, 0.101] },
  ]);
  put(s.solid, geo, cx, y, z);
  const puffGeo = build([
    {
      geo: new IcosahedronGeometry(0.03, 1),
      color: '#dfe8ff',
      fade: { axis: 'r', from: 0, to: 0.045 },
    },
  ]);
  const puffs = [0, 1, 2, 3, 4, 5].map(() => s.light.add(puffGeo));
  addPick(s, 'coffee-machine', 0.42, [cx, y + 0.92, z + 0.02]);
  s.animate.push((f) => {
    const n = coffeePuffs(f.load);
    const rate = coffeeRate(f.load);
    puffs.forEach((h, k) => {
      h.show(k < n);
      if (k >= n) return;
      const u = f.rm ? (k + 0.5) / n : frac(f.t * rate + k / n);
      h.place(cx + 0.035 * Math.sin(u * 5 + k), y + 0.84 + u * 0.42, z + 0.11, 0, 0.6 + 1.4 * u);
      h.tint(hump(u) * (0.14 + 0.2 * clamp01(f.load)));
    });
  });
};

const officeDog: Maker = (s, p) => {
  const seat = p.seats[0];
  if (!seat) return;
  const { x, y, z } = seat;
  const tan = '#c89b6d';
  const dog = build([
    { geo: cyl(0.26, 0.26, 0.04, 18), color: '#9c3b3b', at: [0, 0.02, 0] },
    { geo: sph(1, 12, 10), color: tan, at: [0, 0.1, 0], scale: [0.16, 0.085, 0.2] },
    { geo: sph(0.07, 10, 8), color: tan, at: [0.1, 0.12, 0.12] },
    { geo: sph(1, 8, 6), color: '#a87c52', at: [0.13, 0.11, 0.18], scale: [0.04, 0.035, 0.05] },
    { geo: sph(0.012), color: '#111111', at: [0.14, 0.115, 0.23] },
    {
      geo: sph(1, 8, 6),
      color: '#6b4a2e',
      at: [0.055, 0.15, 0.1],
      scale: [0.03, 0.05, 0.015],
      rot: [0, 0, 0.5],
    },
    {
      geo: sph(1, 8, 6),
      color: '#6b4a2e',
      at: [0.15, 0.15, 0.1],
      scale: [0.03, 0.05, 0.015],
      rot: [0, 0, -0.5],
    },
    { geo: cap(0.022, 0.14), color: tan, at: [-0.13, 0.06, 0.06], rot: [Math.PI / 2, 0.5, 0] },
  ]);
  const h = put(s.solid, dog, x, y, z - 0.46);
  addPick(s, 'office-dog', 0.45, [x, y + 0.12, z - 0.44]);
  s.animate.push((f) => {
    const breathe = f.rm ? 1 : 1 + 0.045 * Math.sin(f.t * 5.2);
    h.place(x, y, z - 0.46, 0, [1, breathe, 1]);
  });
};

const birthdayCake: Maker = (s, p) => {
  const seat = p.seats[0];
  if (!seat) return;
  const { x, y, z } = seat;
  const base = build([
    { geo: cyl(0.1, 0.1, 0.01, 18), color: C.white, at: [0.27, 0.755, 0.05] },
    { geo: cyl(0.08, 0.08, 0.08, 18), color: '#f2a7c3', at: [0.27, 0.8, 0.05] },
    { geo: cyl(0.082, 0.082, 0.015, 18), color: '#fff6f0', at: [0.27, 0.846, 0.05] },
    ...[0, 1, 2].map((k): Part => ({
      geo: cyl(0.006, 0.006, 0.045, 6),
      color: ['#5fb8ff', '#f2c14e', '#46d98a'][k]!,
      at: [0.24 + k * 0.03, 0.876, 0.05 + (k - 1) * 0.012],
    })),
  ]);
  put(s.solid, base, x, y, z);
  const flames = [0, 1, 2].map((k) =>
    s.solid
      .add(
        build([{ geo: sph(1, 6, 5), color: '#ffd27a', glow: 2.6, scale: [0.009, 0.018, 0.009] }]),
      )
      .place(x + 0.24 + k * 0.03, y + 0.912, z + 0.05 + (k - 1) * 0.012),
  );
  const balloonGeo = (color: string, dx: number, h: number, dz: number) =>
    build([
      { geo: rod([0, 0, 0], [dx, h - 0.08, dz], 0.003), color: '#e8e8e8' },
      { geo: sph(0.07, 12, 10), color, glow: 0.2, at: [dx, h, dz], scale: [1, 1.15, 1] },
    ]);
  const tie: V3 = [x + 0.42, y + 0.76, z - 0.2];
  const balloons = [
    s.solid.add(balloonGeo('#e05a47', -0.05, 0.62, 0.02)),
    s.solid.add(balloonGeo('#5fb8ff', 0.06, 0.7, -0.04)),
    s.solid.add(balloonGeo('#f2c14e', 0.02, 0.55, 0.08)),
  ];
  addPick(s, 'birthday-cake', 0.55, [x + 0.3, y + 1.0, z]);
  s.animate.push((f) => {
    flames.forEach((h, k) => h.tint(f.rm ? 1 : 0.8 + 0.35 * Math.sin(f.t * (13 + k * 3) + k)));
    balloons.forEach((h, k) => {
      const sway = f.rm ? 0 : 0.08 * Math.sin(f.t * (0.8 + k * 0.23) + k * 2);
      h.place(tie[0], tie[1], tie[2], 0, 1, sway * 0.6, sway);
    });
  });
};

const aquarium: Maker = (s, p) => {
  const seat = p.seats[0];
  if (!seat) return;
  const { x, y, z } = seat;
  const ax = x + 0.24;
  const az = z - 0.02;
  put(
    s.solid,
    build([
      { geo: box(0.34, 0.02, 0.18), color: '#2a2f3a', at: [0, 0.76, 0] },
      { geo: box(0.3, 0.03, 0.14), color: '#c9b27a', at: [0, 0.785, 0] },
      { geo: cone(0.012, 0.09, 5), color: C.leaf, at: [-0.1, 0.84, -0.03] },
      { geo: cone(0.012, 0.07, 5), color: C.leafDark, at: [-0.08, 0.83, 0.02] },
      { geo: cone(0.012, 0.1, 5), color: C.leaf, at: [0.11, 0.845, -0.04] },
      { geo: box(0.33, 0.015, 0.17), color: '#2a2f3a', at: [0, 0.977, 0] },
      { geo: box(0.28, 0.006, 0.02), color: '#f4f7ff', glow: 1.8, at: [0, 0.966, 0] },
    ]),
    ax,
    y,
    az,
  );
  put(
    s.light,
    build([{ geo: box(0.32, 0.18, 0.16), color: _c.set('#3f9fd8').multiplyScalar(0.16).getHex() }]),
    ax,
    y + 0.87,
    az,
  );
  const fishGeo = build([
    { geo: sph(1, 8, 6), color: '#ff8a3d', glow: 0.45, scale: [0.03, 0.02, 0.012] },
    {
      geo: cone(0.016, 0.025, 4),
      color: '#ff8a3d',
      glow: 0.45,
      at: [-0.035, 0, 0],
      rot: [0, 0, Math.PI / 2],
    },
  ]);
  const fish = [0, 1].map(() => s.solid.add(fishGeo));
  addPick(s, 'aquarium', 0.42, [ax, y + 0.88, az]);
  s.animate.push((f) => {
    fish.forEach((h, k) => {
      const u = f.rm ? 0.3 + k * 0.4 : pingPong(f.t * (0.18 + k * 0.07) + k * 0.7);
      const back = !f.rm && Math.floor((((f.t * (0.18 + k * 0.07) + k * 0.7) % 2) + 2) % 2) === 1;
      const fx = ax - 0.1 + u * 0.2;
      const fy = y + 0.85 + k * 0.05 + (f.rm ? 0 : 0.008 * Math.sin(f.t * 2 + k));
      h.place(fx, fy, az + (k - 0.5) * 0.05, back ? Math.PI : 0);
    });
  });
};

const pizzaNight: Maker = (s, p) => {
  const seat = p.seats[0];
  if (!seat) return;
  const { x, y, z } = seat;
  const parts: Part[] = [];
  for (let k = 0; k < 4; k++) {
    parts.push({
      geo: box(0.34, 0.045, 0.34),
      color: k % 2 ? '#c49a6c' : '#b88b5c',
      at: [0, 0.0225 + k * 0.047, 0],
      rot: [0, (hash01(k + 3) - 0.5) * 0.3, 0],
    });
  }
  const top = 0.0225 + 3 * 0.047 + 0.023;
  parts.push(
    {
      geo: box(0.34, 0.01, 0.34),
      color: '#dcb98f',
      at: [-0.19, top + 0.16, 0],
      rot: [0, 0, 1.75],
    },
    {
      geo: disc(0.14, 24, TAU * (5 / 6)),
      color: '#f2c14e',
      glow: 0.3,
      at: [0, top + 0.004, 0],
      rot: [0, 0.6, 0],
    },
    ...[0, 1, 2, 3, 4].map((k): Part => {
      const a = 0.9 + k * 1.05;
      return {
        geo: disc(0.018, 8),
        color: '#c8453a',
        at: [Math.cos(a) * 0.08, top + 0.007, Math.sin(a) * 0.08],
      };
    }),
    { geo: cyl(0.025, 0.025, 0.08, 10), color: '#c8453a', at: [0.26, 0.04, 0.1] },
  );
  put(s.solid, build(parts), x, y, z - 0.5);
  addPick(s, 'pizza-night', 0.45, [x, y + 0.16, z - 0.5]);
};

// --- server hall ---------------------------------------------------------------

/** Rack k of row 0 in the hall diorama (hall.ts: 16 racks of 0.62 at a 0.64 pitch, row at z = −6). */
const rackX = (k: number) => -5.12 + (k + 0.5) * 0.64;
const RACK_FACE_Z = -6.525; // the row-0 face towards the hall camera
const RACK_TOP = 2.3;
const HALL_FLOOR = 0.1;

const mopBucket: Maker = (s) => {
  const x = 6.05;
  const z = -6.2;
  const geo = build([
    { geo: cyl(0.2, 0.17, 0.32, 14), color: C.yellow, at: [0, 0.16, 0] },
    { geo: disc(0.18, 14), color: '#5a7a9a', at: [0, 0.3, 0] },
    { geo: box(0.24, 0.1, 0.16), color: '#8792a6', at: [0, 0.37, -0.06] },
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz): Part => ({
        geo: sph(0.03),
        color: '#222222',
        at: [sx * 0.13, 0.02, sz * 0.13],
      })),
    ),
    { geo: rod([0.03, 0.3, 0.02], [-0.12, 1.55, -0.3], 0.018), color: C.woodLight },
    { geo: cyl(0.08, 0.1, 0.14, 10), color: '#e8e4da', at: [0.02, 0.3, 0.02] },
    // a folding "wet floor" sign (no words)
    { geo: box(0.24, 0.36, 0.01), color: C.yellow, at: [0.48, 0.18, 0.2], rot: [0.22, 0.4, 0] },
    { geo: box(0.24, 0.36, 0.01), color: C.yellow, at: [0.52, 0.18, 0.32], rot: [-0.22, 0.4, 0] },
  ]);
  put(s.solid, geo, x, HALL_FLOOR, z);
  addPick(s, 'mop-bucket', 0.62, [x + 0.15, 0.45, z + 0.1]);
};

const serverCat: Maker = (s) => {
  const x = rackX(4);
  const z = -6;
  const ginger = '#e0914a';
  const cat = build([
    { geo: sph(1, 14, 10), color: ginger, at: [0, 0.08, 0], scale: [0.16, 0.08, 0.13] },
    { geo: sph(0.075, 12, 10), color: ginger, at: [0.13, 0.1, 0.06] },
    { geo: sph(0.04, 8, 6), color: C.cream, at: [0.18, 0.07, 0.09] },
    { geo: cone(0.03, 0.06, 6), color: ginger, at: [0.11, 0.17, 0.03], rot: [0, 0, 0.3] },
    { geo: cone(0.03, 0.06, 6), color: ginger, at: [0.17, 0.17, 0.09], rot: [0, 0, -0.3] },
    { geo: box(0.025, 0.004, 0.006), color: '#2a1a10', at: [0.18, 0.11, 0.115], rot: [0, -0.8, 0] },
    { geo: box(0.025, 0.004, 0.006), color: '#2a1a10', at: [0.2, 0.11, 0.08], rot: [0, -0.8, 0] },
    {
      geo: tor(0.14, 0.024, 6, 14, Math.PI * 1.1),
      color: '#c9793a',
      at: [0, 0.03, 0],
      rot: [Math.PI / 2, 0, 2.3],
    },
    {
      geo: tor(0.1, 0.012, 4, 12, Math.PI * 0.8),
      color: '#c9793a',
      at: [-0.02, 0.1, 0],
      rot: [Math.PI / 2, 0, 0.6],
    },
  ]);
  const h = put(s.solid, cat, x, RACK_TOP, z);
  addPick(s, 'server-cat', 0.55, [x, RACK_TOP + 0.15, z]);
  s.animate.push((f) => {
    const breathe = f.rm ? 1 : 1 + 0.05 * Math.sin(f.t * 3.1);
    h.place(x, RACK_TOP, z, 0.4, [1, breathe, 1]);
  });
};

const stickyNote: Maker = (s) => {
  const x = rackX(11);
  const y = 1.66;
  const z = RACK_FACE_Z - 0.008;
  // Built hanging from its top edge (the origin), facing −z (the hall camera).
  const note = build([
    { geo: box(0.222, 0.222, 0.004), color: '#141820', at: [0, -0.1, 0.004] },
    { geo: box(0.2, 0.2, 0.006), color: '#ffc61a', glow: 0.22, at: [0, -0.1, 0] },
    { geo: box(0.13, 0.012, 0.003), color: '#2b4c8c', at: [-0.01, -0.07, -0.004] },
    { geo: box(0.1, 0.012, 0.003), color: '#2b4c8c', at: [-0.025, -0.1, -0.004] },
    { geo: box(0.07, 0.012, 0.003), color: '#2b4c8c', at: [-0.04, -0.13, -0.004] },
  ]);
  const h = s.solid.add(note);
  addPick(s, 'sticky-note', 0.45, [x, y - 0.1, z - 0.1]);
  s.animate.push((f) => {
    // The rack's fans ruffle it.
    const flutter = f.rm
      ? 0.05
      : 0.05 + 0.07 * (0.5 + 0.5 * Math.sin(f.t * 7.3) * Math.sin(f.t * 2.1));
    h.place(x, y, z, 0, 1, flutter, 0.08);
  });
};

const cableSpaghetti: Maker = (s) => {
  const x = rackX(7);
  const z = RACK_FACE_Z;
  const geo = build([
    {
      geo: new TorusKnotGeometry(0.1, 0.012, 64, 5, 2, 3),
      color: '#3d7fd9',
      at: [-0.06, 0.16, -0.22],
      rot: [0.3, 0.2, 0],
      scale: [1.2, 0.8, 1],
    },
    {
      geo: new TorusKnotGeometry(0.09, 0.012, 64, 5, 3, 4),
      color: C.yellow,
      at: [0.1, 0.13, -0.28],
      rot: [1.2, 0.6, 0.3],
      scale: [1, 0.7, 1.1],
    },
    {
      geo: new TorusKnotGeometry(0.08, 0.011, 64, 5, 2, 5),
      color: '#d94f4f',
      at: [0.02, 0.22, -0.18],
      rot: [0.5, 1.4, 0.2],
    },
    { geo: tor(0.08, 0.01, 5, 18), color: '#3d7fd9', at: [-0.1, 1.05, -0.02], rot: [0.3, 0, 0] },
    { geo: tor(0.06, 0.01, 5, 18), color: C.yellow, at: [0.08, 0.92, -0.02], rot: [-0.2, 0, 0.4] },
    { geo: rod([-0.12, 1.3, -0.01], [-0.06, 0.25, -0.22], 0.011), color: '#3d7fd9' },
    { geo: rod([0.1, 1.2, -0.01], [0.1, 0.2, -0.28], 0.011), color: C.yellow },
    { geo: rod([0.02, 1.4, -0.01], [0.02, 0.3, -0.18], 0.01), color: '#d94f4f' },
  ]);
  put(s.solid, geo, x, HALL_FLOOR, z);
  addPick(s, 'cable-spaghetti', 0.55, [x, 0.5, z - 0.2]);
};

const hallBicycle: Maker = (s) => {
  // Parked in the front aisle, parallel to row 0 (between the rack faces and the low wall).
  const x = -3.2;
  const z = -6.93;
  const frame = '#e2574c';
  const RH: V3 = [0, 0.36, -0.38];
  const FH: V3 = [0, 0.36, 0.38];
  const BB: V3 = [0, 0.32, -0.05];
  const ST: V3 = [0, 0.74, -0.14];
  const HT: V3 = [0, 0.72, 0.24];
  const geo = build([
    { geo: tor(0.26, 0.022, 6, 22), color: '#1d2027', at: RH, rot: [0, Math.PI / 2, 0] },
    { geo: tor(0.26, 0.022, 6, 22), color: '#1d2027', at: FH, rot: [0, Math.PI / 2, 0] },
    { geo: sph(0.03), color: C.chrome, at: RH },
    { geo: sph(0.03), color: C.chrome, at: FH },
    { geo: rod(RH, BB, 0.02), color: frame },
    { geo: rod(RH, ST, 0.02), color: frame },
    { geo: rod(BB, ST, 0.024), color: frame },
    { geo: rod(ST, HT, 0.024), color: frame },
    { geo: rod(BB, HT, 0.024), color: frame },
    { geo: rod(HT, FH, 0.02), color: frame },
    { geo: box(0.07, 0.035, 0.15), color: '#1d2027', at: [0, 0.78, -0.16] },
    { geo: rod([0, 0.72, 0.24], [0, 0.82, 0.22], 0.014), color: C.chrome },
    { geo: rod([-0.15, 0.82, 0.22], [0.15, 0.82, 0.22], 0.014), color: '#1d2027' },
    {
      geo: tor(0.06, 0.006, 4, 12),
      color: C.chrome,
      at: [0, 0.32, -0.05],
      rot: [0, Math.PI / 2, 0],
    },
    // a front lamp and a rear reflector, so it can be spotted between the racks
    { geo: sph(0.024, 8, 6), color: '#f4f7ff', glow: 1.6, at: [0, 0.76, 0.3] },
    { geo: box(0.035, 0.045, 0.012), color: '#ff3b30', glow: 1.2, at: [0, 0.62, -0.24] },
  ]);
  s.solid.add(geo).place(x, HALL_FLOOR, z, Math.PI / 2, 1, 0, 0.1);
  addPick(s, 'hall-bicycle', 0.65, [x, 0.55, z]);
};

const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];

const heartLeds: Maker = (s) => {
  const x = rackX(13);
  const y = 1.46;
  const z = RACK_FACE_Z - 0.007;
  const px: Part[] = [];
  HEART.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch !== 'X') return;
      px.push({
        geo: box(0.045, 0.045, 0.006),
        color: '#ff2d55',
        glow: 0.6,
        at: [(c - 3) * 0.06, (2.5 - r) * 0.06, 0],
      });
    });
  });
  // A dark panel behind the lights so the heart reads against the busy rack face.
  put(
    s.solid,
    build([{ geo: box(0.5, 0.44, 0.006), color: '#0e1117', at: [0, -0.03, 0.004] }]),
    x,
    y,
    z,
  );
  const h = s.solid.add(build(px)).place(x, y, z);
  addPick(s, 'heart-leds', 0.5, [x, y, z - 0.1]);
  s.animate.push((f) => {
    if (f.rm) {
      h.tint(0.9);
      return;
    }
    // lub-dub, every 1.1 s
    const u = frac(f.t / 1.1);
    const beat = Math.max(
      Math.exp(-(((u - 0.08) / 0.05) ** 2)),
      0.7 * Math.exp(-(((u - 0.3) / 0.05) ** 2)),
    );
    h.tint(0.45 + 0.65 * beat);
  });
};

// --- power & cooling -------------------------------------------------------------

const nightInspector: Maker = (s, p) => {
  const fp = p.campus.footprint;
  const z = 1.75;
  const x0 = fp + 4.3;
  const x1 = fp + 8.6;
  const worker = build([
    { geo: person({ pose: 'stand', shirt: '#ff8a3d', skin: SKIN[2], hat: C.yellow, h: 0.55 }) },
    {
      geo: tor(0.066, 0.012, 4, 16),
      color: '#fff2c0',
      glow: 1.2,
      at: [0, 0.29, 0],
      rot: [Math.PI / 2, 0, 0],
    },
    {
      geo: cyl(0.016, 0.016, 0.1, 8),
      color: '#2a2f3a',
      at: [0.1, 0.27, 0.06],
      rot: [Math.PI / 2 - 0.4, 0, 0],
    },
    { geo: sph(0.018), color: '#fff6d8', glow: 2.8, at: [0.1, 0.25, 0.11] },
  ]);
  const h = s.solid.add(worker);
  // Torch: a soft cone forward and down, and the spot it lights.
  const L = 1.5;
  const beamGeo = build([
    {
      geo: cyl(0.02, 0.36, L, 14, true)
        .translate(0, -L / 2, 0)
        .rotateX(-(Math.PI / 2 - 0.3)),
      color: _c.set('#fff2c0').multiplyScalar(0.13).getHex(),
      fade: { axis: 'r', from: 0, to: 1.4, power: 1.8 },
    },
  ]);
  const beam = s.light.add(beamGeo);
  const spot = s.light.add(pool(0.42, '#fff2c0', 0.3));
  const pick = addPick(s, 'night-inspector', 0.7, [(x0 + x1) / 2, 0.3, z]);
  const speed = 0.45 / (x1 - x0);
  s.animate.push((f) => {
    const u = f.rm ? 0.5 : pingPong(f.t * speed);
    const back = !f.rm && Math.floor((((f.t * speed) % 2) + 2) % 2) === 1;
    const x = x0 + u * (x1 - x0);
    // Walking: facing along the path; standing still (reduced motion): facing the transformers.
    const yaw = f.rm ? 0 : back ? -Math.PI / 2 + 0.35 : Math.PI / 2 - 0.35;
    const bob = f.rm ? 0 : 0.012 * Math.abs(Math.sin(f.t * 6));
    h.place(x, bob, z, yaw);
    const tx = x + Math.sin(yaw) * 0.1 + Math.cos(yaw) * 0.1;
    const tz = z + Math.cos(yaw) * 0.1 - Math.sin(yaw) * 0.1;
    beam.place(tx, 0.26, tz, yaw);
    spot.place(tx + Math.sin(yaw) * 0.75, 0.03, tz + Math.cos(yaw) * 0.75);
    pick.position.set(x, 0.3, z);
  });
};

const birdsOnWire: Maker = (s, p) => {
  const fp = p.campus.footprint;
  const bird = build([
    { geo: sph(1, 10, 8), color: '#6b4f3a', scale: [0.045, 0.042, 0.06], at: [0, 0.042, 0] },
    { geo: sph(1, 8, 6), color: '#d9c7a8', scale: [0.035, 0.03, 0.04], at: [0, 0.03, 0.02] },
    { geo: sph(0.03, 8, 6), color: '#5a4230', at: [0, 0.09, 0.035] },
    {
      geo: cone(0.011, 0.026, 5),
      color: '#f2a93b',
      at: [0, 0.088, 0.07],
      rot: [Math.PI / 2, 0, 0],
    },
    { geo: box(0.022, 0.006, 0.055), color: '#4a3626', at: [0, 0.035, -0.07], rot: [-0.35, 0, 0] },
  ]);
  const xs = [fp + 1.1, fp + 1.45, fp + 1.95];
  const birds = xs.map(() => s.solid.add(bird));
  addPick(s, 'birds-on-wire', [0.8, 0.4, 0.45], [fp + 1.5, 1.52, 3.4]);
  s.animate.push((f) => {
    birds.forEach((h, k) => {
      const hop = f.rm ? 0 : 0.03 * Math.max(0, Math.sin(f.t * 1.3 + k * 2.1) - 0.93) * 14;
      const turn = f.rm ? 0 : 0.35 * Math.sin(f.t * 0.4 + k * 1.7);
      h.place(xs[k]!, 1.44 + hop, 3.4, (k === 1 ? Math.PI : 0) + turn, 1.2);
    });
  });
};

const owl: Maker = (s, p) => {
  const fp = p.campus.footprint;
  const x = fp + 4.6 + 2 * 1.6;
  const y = 1.38;
  const z = 3.4;
  const brown = '#7a5a3c';
  const body = build([
    { geo: sph(1, 12, 10), color: brown, at: [0, 0.15, 0], scale: [0.11, 0.15, 0.1] },
    { geo: sph(1, 10, 8), color: C.cream, at: [0, 0.13, 0.055], scale: [0.08, 0.11, 0.05] },
    { geo: sph(1, 8, 6), color: '#5e4430', at: [-0.1, 0.15, -0.01], scale: [0.04, 0.12, 0.08] },
    { geo: sph(1, 8, 6), color: '#5e4430', at: [0.1, 0.15, -0.01], scale: [0.04, 0.12, 0.08] },
    { geo: sph(0.02, 6, 5), color: '#f2a93b', at: [-0.035, 0.01, 0.05] },
    { geo: sph(0.02, 6, 5), color: '#f2a93b', at: [0.035, 0.01, 0.05] },
  ]);
  const head = build([
    { geo: sph(0.085, 12, 10), color: brown },
    { geo: sph(1, 10, 8), color: C.cream, at: [0, 0, 0.055], scale: [0.07, 0.06, 0.03] },
    { geo: sph(0.022, 8, 6), color: '#ffb627', glow: 0.9, at: [-0.03, 0.01, 0.08] },
    { geo: sph(0.022, 8, 6), color: '#ffb627', glow: 0.9, at: [0.03, 0.01, 0.08] },
    { geo: sph(0.009, 6, 5), color: '#111111', at: [-0.03, 0.01, 0.1] },
    { geo: sph(0.009, 6, 5), color: '#111111', at: [0.03, 0.01, 0.1] },
    { geo: cone(0.012, 0.03, 5), color: '#b08a3a', at: [0, -0.02, 0.09], rot: [Math.PI, 0, 0] },
    { geo: cone(0.02, 0.06, 5), color: '#5e4430', at: [-0.045, 0.08, 0], rot: [0, 0, 0.25] },
    { geo: cone(0.02, 0.06, 5), color: '#5e4430', at: [0.045, 0.08, 0], rot: [0, 0, -0.25] },
  ]);
  put(s.solid, body, x, y, z, 0.3);
  const h = s.solid.add(head);
  addPick(s, 'owl', 0.55, [x, y + 0.22, z]);
  s.animate.push((f) => {
    const look = f.rm
      ? 0.3
      : 0.3 + 0.9 * Math.sin(f.t * 0.23) * Math.max(0, Math.sin(f.t * 0.11 + 1));
    h.place(x, y + 0.32, z, look);
  });
};

const grazingSheep: Maker = (s, p) => {
  const fp = p.campus.footprint;
  const wool = '#ece7da';
  const dark = '#2d2a2a';
  const bodyGeo = build([
    {
      geo: new IcosahedronGeometry(0.2, 1),
      color: wool,
      at: [0, 0.3, 0],
      scale: [0.9, 0.75, 1.15],
    },
    { geo: new IcosahedronGeometry(0.1, 1), color: wool, at: [0.05, 0.42, -0.06] },
    { geo: new IcosahedronGeometry(0.09, 1), color: wool, at: [-0.06, 0.41, 0.07] },
    { geo: sph(0.045, 8, 6), color: wool, at: [0, 0.34, -0.25] },
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz): Part => ({
        geo: cyl(0.022, 0.02, 0.2, 6),
        color: dark,
        at: [sx * 0.08, 0.1, sz * 0.12],
      })),
    ),
  ]);
  // The head hangs from the neck (the origin) so grazing is a pitch.
  const headGeo = build([
    { geo: sph(1, 10, 8), color: dark, at: [0, -0.01, 0.07], scale: [0.065, 0.075, 0.1] },
    { geo: sph(1, 6, 5), color: dark, at: [-0.065, 0.02, 0.04], scale: [0.04, 0.014, 0.02] },
    { geo: sph(1, 6, 5), color: dark, at: [0.065, 0.02, 0.04], scale: [0.04, 0.014, 0.02] },
    { geo: new IcosahedronGeometry(0.05, 1), color: wool, at: [0, 0.05, 0.02] },
  ]);
  const flock: [number, number, number][] = [
    [fp + 6.8, 0.35, 0.4],
    [fp + 7.7, 0.95, -0.9],
    [fp + 8.35, 0.05, 2.2],
  ];
  const heads = flock.map(([x, z, yaw]) => {
    put(s.solid, bodyGeo, x, 0, z, yaw);
    return s.solid.add(headGeo);
  });
  addPick(s, 'grazing-sheep', [1.3, 0.6, 0.9], [fp + 7.6, 0.3, 0.45]);
  s.animate.push((f) => {
    heads.forEach((h, k) => {
      const [x, z, yaw] = flock[k]!;
      const graze = f.rm ? 0.5 : 0.5 + 0.5 * Math.sin(f.t * 0.6 + k * 2.3);
      h.place(x + Math.sin(yaw) * 0.2, 0.35, z + Math.cos(yaw) * 0.2, yaw, 1, 0.15 + 0.75 * graze);
    });
  });
};

const rubberDuck: Maker = (s, p) => {
  const fp = p.campus.footprint;
  const cx = fp + 7.4;
  const cz = 0.35;
  put(
    s.solid,
    build([
      { geo: tor(0.72, 0.06, 6, 30), color: C.stone, at: [0, 0.05, 0], rot: [Math.PI / 2, 0, 0] },
      { geo: disc(0.7, 30), color: '#1d3b5a', glow: 0.3, at: [0, 0.06, 0] },
      { geo: disc(0.09, 10, TAU * 0.85), color: C.leaf, at: [0.35, 0.065, -0.2] },
      {
        geo: disc(0.07, 10, TAU * 0.85),
        color: C.leafDark,
        at: [-0.3, 0.065, 0.28],
        rot: [0, 2, 0],
      },
    ]),
    cx,
    0,
    cz,
  );
  const duckGeo = build([
    {
      geo: sph(1, 12, 10),
      color: '#ffd23f',
      glow: 0.25,
      at: [0, 0.04, 0],
      scale: [0.075, 0.055, 0.095],
    },
    { geo: sph(0.048, 10, 8), color: '#ffd23f', glow: 0.25, at: [0, 0.11, 0.055] },
    { geo: box(0.04, 0.012, 0.035), color: '#f28a1a', at: [0, 0.1, 0.105] },
    { geo: sph(0.008, 6, 5), color: '#111111', at: [-0.03, 0.125, 0.085] },
    { geo: sph(0.008, 6, 5), color: '#111111', at: [0.03, 0.125, 0.085] },
    {
      geo: cone(0.03, 0.05, 6),
      color: '#ffd23f',
      glow: 0.25,
      at: [0, 0.07, -0.09],
      rot: [-0.9, 0, 0],
    },
  ]);
  const duck = s.solid.add(duckGeo);
  addPick(s, 'rubber-duck', 0.72, [cx, 0.2, cz]);
  s.animate.push((f) => {
    const a = f.rm ? 1.2 : f.t * 0.16;
    const x = cx + Math.cos(a) * 0.32;
    const z = cz + Math.sin(a) * 0.32;
    const bob = f.rm ? 0 : 0.008 * Math.sin(f.t * 2.2);
    duck.place(
      x,
      0.065 + bob,
      z,
      yawTo(-Math.sin(a), Math.cos(a)),
      1.25,
      0,
      f.rm ? 0 : 0.05 * Math.sin(f.t * 1.7),
    );
  });
};

const lostBalloon: Maker = (s, p) => {
  const fp = p.campus.footprint;
  const a = Math.PI / 4;
  const tx = fp + 5.5 + Math.cos(a) * 1.1;
  const tz = -2 + Math.sin(a) * 1.1;
  const ty = 4.2;
  const geo = build([
    { geo: rod([0, 0, 0], [0.05, 0.96, 0.02], 0.006), color: '#f4f4f4', glow: 0.2 },
    { geo: cone(0.03, 0.05, 6), color: '#c23a2e', at: [0.05, 0.98, 0.02], rot: [Math.PI, 0, 0] },
    {
      geo: sph(0.2, 14, 12),
      color: '#e0483e',
      glow: 0.22,
      at: [0.05, 1.2, 0.02],
      scale: [1, 1.18, 1],
    },
  ]);
  const h = s.solid.add(geo);
  addPick(s, 'lost-balloon', 0.6, [tx + 0.05, ty + 1.2, tz]);
  s.animate.push((f) => {
    const t = f.t;
    h.place(
      tx,
      ty,
      tz,
      0,
      1,
      f.rm ? 0.05 : 0.1 * Math.sin(t * 0.5 + 1),
      f.rm ? -0.05 : 0.14 * Math.sin(t * 0.7),
    );
  });
};

// --- model lab -----------------------------------------------------------------------

const PLINTH = 0.18;

const labPlant: Maker = (s, p) => {
  const x = p.labHalf - 0.05;
  const z = -1.2;
  const leaves: Part[] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU + 0.3;
    const h = 0.34 + 0.2 * hash01(k + 11);
    leaves.push({
      geo: cone(0.045, h, 6),
      color: k % 2 ? C.leaf : '#5fa85a',
      at: [Math.sin(a) * 0.04, 0.2 + h / 2, Math.cos(a) * 0.04],
      rot: [0.25, a, 0],
      scale: [1, 1, 0.35],
    });
  }
  const geo = build([
    { geo: cyl(0.13, 0.1, 0.2, 14), color: '#b5653f', at: [0, 0.1, 0] },
    { geo: tor(0.128, 0.018, 5, 18), color: '#9c5435', at: [0, 0.2, 0], rot: [Math.PI / 2, 0, 0] },
    { geo: disc(0.12, 14), color: '#3b2a20', at: [0, 0.19, 0] },
    ...leaves,
  ]);
  put(s.solid, geo, x, PLINTH, z);
  addPick(s, 'lab-plant', 0.45, [x, PLINTH + 0.35, z]);
};

const paperCrane: Maker = (s, p) => {
  const x = -(p.labHalf - 0.3);
  const z = 0.48;
  const geo = build([
    {
      geo: tris([
        // body
        [0, 0.06, 0.1],
        [-0.05, 0.03, 0],
        [0, 0.0, -0.1],
        [0, 0.06, 0.1],
        [0, 0.0, -0.1],
        [0.05, 0.03, 0],
        // wings
        [0, 0.05, 0.04],
        [-0.2, 0.15, -0.02],
        [0, 0.05, -0.05],
        [0, 0.05, 0.04],
        [0, 0.05, -0.05],
        [0.2, 0.15, -0.02],
        // neck + head
        [0, 0.04, 0.08],
        [0, 0.17, 0.16],
        [0.01, 0.05, 0.1],
        [0, 0.17, 0.16],
        [0, 0.15, 0.2],
        [0.005, 0.16, 0.17],
        // tail
        [0, 0.04, -0.08],
        [0, 0.16, -0.17],
        [0.01, 0.05, -0.1],
      ]),
      color: '#efd2da',
      glow: 0.1,
    },
  ]);
  put(s.solid, geo, x, PLINTH, z, 0.5);
  addPick(s, 'paper-crane', 0.35, [x, PLINTH + 0.1, z]);
};

const snowGlobe: Maker = (s, p) => {
  const x = p.labHalf - 0.28;
  const z = 0.48;
  put(
    s.solid,
    build([
      { geo: cyl(0.1, 0.12, 0.08, 16), color: C.woodDark, at: [0, 0.04, 0] },
      { geo: disc(0.1, 16), color: '#e8edf6', glow: 0.06, at: [0, 0.09, 0] },
      { geo: cone(0.04, 0.1, 8), color: C.leafDark, at: [-0.03, 0.15, 0] },
      { geo: box(0.05, 0.04, 0.04), color: '#c8453a', at: [0.04, 0.11, 0.01] },
      {
        geo: cone(0.042, 0.03, 4),
        color: '#f4f7ff',
        at: [0.04, 0.145, 0.01],
        rot: [0, Math.PI / 4, 0],
      },
      { geo: box(0.012, 0.014, 0.004), color: '#ffcf8a', glow: 1.6, at: [0.04, 0.11, 0.032] },
    ]),
    x,
    PLINTH,
    z,
  );
  put(
    s.light,
    build([{ geo: sph(0.12, 18, 14), color: _c.set('#cfe6ff').multiplyScalar(0.12).getHex() }]),
    x,
    PLINTH + 0.2,
    z,
  );
  const flakeGeo = build([{ geo: sph(0.006, 5, 4), color: '#ffffff' }]);
  const flakes = Array.from({ length: 12 }, () => s.light.add(flakeGeo));
  addPick(s, 'snow-globe', 0.35, [x, PLINTH + 0.18, z]);
  s.animate.push((f) => {
    flakes.forEach((h, k) => {
      const r = 0.02 + 0.07 * hash01(k + 5);
      const a = (f.rm ? 0 : f.t * (0.3 + 0.2 * hash01(k))) + k * 1.9;
      const fall = f.rm ? hash01(k + 9) : frac(hash01(k + 9) - f.t * 0.06);
      h.place(x + Math.cos(a) * r, PLINTH + 0.1 + fall * 0.17, z + Math.sin(a) * r);
      h.tint(0.6);
    });
  });
};

const lavaLamp: Maker = (s, p) => {
  const x = -(p.labHalf - 0.1);
  const z = -1.2;
  put(
    s.solid,
    build([
      { geo: cyl(0.05, 0.09, 0.14, 14), color: '#6b7280', at: [0, 0.07, 0] },
      { geo: cyl(0.035, 0.05, 0.07, 14), color: '#6b7280', at: [0, 0.535, 0] },
    ]),
    x,
    PLINTH,
    z,
  );
  put(
    s.light,
    build([
      { geo: cyl(0.045, 0.062, 0.36, 14), color: _c.set('#ff6a3d').multiplyScalar(0.22).getHex() },
    ]),
    x,
    PLINTH + 0.32,
    z,
  );
  const blobGeo = build([{ geo: sph(1, 10, 8), color: '#ff5a3d', glow: 0.9 }]);
  const blobs = [0.036, 0.028, 0.042].map(() => s.solid.add(blobGeo));
  addPick(s, 'lava-lamp', 0.4, [x, PLINTH + 0.3, z]);
  s.animate.push((f) => {
    blobs.forEach((h, k) => {
      const r = [0.036, 0.028, 0.042][k]!;
      const u = f.rm
        ? [0.2, 0.55, 0.85][k]!
        : 0.5 + 0.5 * Math.sin(f.t * (0.3 + k * 0.07) + k * 2.1);
      const stretch = f.rm ? 1 : 1 + 0.25 * Math.abs(Math.cos(f.t * (0.3 + k * 0.07) + k * 2.1));
      h.place(x + (f.rm ? 0 : 0.008 * Math.sin(f.t + k)), PLINTH + 0.17 + u * 0.28, z, 0, [
        r,
        r * stretch,
        r,
      ]);
    });
  });
};

const robotVacuum: Maker = (s, p) => {
  const A = Math.min(p.labHalf * 0.6, 2.2);
  const zc = 1.55;
  const y = 0.12;
  const bot = build([
    { geo: cyl(0.16, 0.17, 0.06, 22), color: '#2a2f3a', at: [0, 0.03, 0] },
    {
      geo: tor(0.1, 0.008, 4, 26),
      color: '#3fd8c8',
      glow: 0.9,
      at: [0, 0.062, 0],
      rot: [Math.PI / 2, 0, 0],
    },
    { geo: tor(0.166, 0.012, 4, 26), color: '#4a5263', at: [0, 0.03, 0], rot: [Math.PI / 2, 0, 0] },
    { geo: cyl(0.03, 0.03, 0.02, 10), color: '#4a5263', at: [0, 0.07, 0.07] },
  ]);
  const h = s.solid.add(bot);
  const led = s.solid.add(build([{ geo: sph(0.012, 6, 5), color: '#46d98a', glow: 2.6 }]));
  const pick = addPick(s, 'robot-vacuum', 0.45, [0, y + 0.05, zc]);
  s.animate.push((f) => {
    // A slow figure of eight in front of the display; parked beside it with reduced motion.
    const w = f.t * 0.22;
    const x = f.rm ? A : A * Math.sin(w);
    const z = f.rm ? zc - 0.1 : zc + 0.5 * Math.sin(w) * Math.cos(w);
    const dx = A * Math.cos(w);
    const dz = 0.5 * Math.cos(2 * w);
    const yaw = f.rm ? -Math.PI / 2 : yawTo(dx, dz);
    h.place(x, y, z, yaw);
    led.place(x + Math.sin(yaw) * 0.07, y + 0.085, z + Math.cos(yaw) * 0.07);
    led.tint(f.rm ? 1 : 0.3 + 0.9 * (frac(f.t / 1.6) < 0.5 ? 1 : 0));
    pick.position.set(x, y + 0.05, z);
  });
};

const hourglass: Maker = (s, p) => {
  const x = -(p.labHalf - 0.3);
  const z = 0.48;
  const posts: Part[] = [0, 1, 2].map((k) => {
    const a = (k / 3) * TAU + 0.3;
    return {
      geo: cyl(0.008, 0.008, 0.33, 6),
      color: C.woodDark,
      at: [Math.cos(a) * 0.075, 0.18, Math.sin(a) * 0.075],
    };
  });
  put(
    s.solid,
    build([
      { geo: cyl(0.09, 0.09, 0.02, 16), color: C.wood, at: [0, 0.01, 0] },
      { geo: cyl(0.09, 0.09, 0.02, 16), color: C.wood, at: [0, 0.35, 0] },
      ...posts,
    ]),
    x,
    PLINTH,
    z,
  );
  const glassColor = _c.set('#cfe6ff').multiplyScalar(0.14).getHex();
  put(
    s.light,
    build([
      { geo: cone(0.062, 0.16, 14), color: glassColor, at: [0, 0.1, 0] },
      { geo: cone(0.062, 0.16, 14), color: glassColor, at: [0, 0.26, 0], rot: [Math.PI, 0, 0] },
    ]),
    x,
    PLINTH,
    z,
  );
  // Sand: the upper heap shrinks, the lower one grows (a 40 s cycle), with a thin stream between.
  const sand = '#e6c27a';
  const upper = s.solid.add(
    build([
      {
        geo: cone(0.05, 0.1, 12),
        color: sand,
        glow: 0.15,
        at: [0, -0.05, 0],
        rot: [Math.PI, 0, 0],
      },
    ]),
  );
  const lower = s.solid.add(
    build([{ geo: cone(0.052, 0.07, 12), color: sand, glow: 0.15, at: [0, 0.035, 0] }]),
  );
  const stream = s.solid.add(
    build([{ geo: cyl(0.003, 0.003, 0.14, 5), color: sand, glow: 0.4, at: [0, 0.07, 0] }]),
  );
  addPick(s, 'hourglass', 0.35, [x, PLINTH + 0.18, z]);
  s.animate.push((f) => {
    const u = f.rm ? 0.4 : frac(f.t / 40);
    const top = Math.cbrt(1 - u);
    const bottom = Math.cbrt(u);
    upper.place(x, PLINTH + 0.18 + 0.1 * top, z, 0, [top, top, top]).show(top > 0.05);
    lower.place(x, PLINTH + 0.02, z, 0, [
      Math.max(bottom, 0.02),
      Math.max(bottom, 0.02),
      Math.max(bottom, 0.02),
    ]);
    stream.place(x, PLINTH + 0.03, z).show(u < 0.985);
  });
};

const MAKERS: Readonly<Record<string, Maker>> = {
  'night-shift': nightShift,
  'coffee-machine': coffeeMachine,
  'office-dog': officeDog,
  'birthday-cake': birthdayCake,
  aquarium,
  'pizza-night': pizzaNight,
  'server-cat': serverCat,
  'sticky-note': stickyNote,
  'cable-spaghetti': cableSpaghetti,
  'mop-bucket': mopBucket,
  'hall-bicycle': hallBicycle,
  'heart-leds': heartLeds,
  'night-inspector': nightInspector,
  'birds-on-wire': birdsOnWire,
  owl,
  'grazing-sheep': grazingSheep,
  'rubber-duck': rubberDuck,
  'lost-balloon': lostBalloon,
  'lab-plant': labPlant,
  'paper-crane': paperCrane,
  'snow-globe': snowGlobe,
  'lava-lamp': lavaLamp,
  'robot-vacuum': robotVacuum,
  hourglass,
};

/** The interior details an HQ's view shows, in DISCOVERIES order (shared first per view). */
export function interiorDetails(
  view: InteriorKind,
  campusId: string,
  hosts: ReadonlyMap<string, string>,
): Discovery[] {
  return DISCOVERIES.filter(
    (d) => d.where === view && (d.platform === undefined || hosts.get(d.id) === campusId),
  );
}

// ---------------------------------------------------------------------------
// the props
// ---------------------------------------------------------------------------

interface Entry {
  readonly root: Group;
  readonly parent: Group;
  readonly view: InteriorKind;
  readonly campusId: string;
  readonly picks: readonly Mesh[];
  readonly meshes: readonly BatchedMesh[];
  readonly animate: readonly ((f: FrameCtx) => void)[];
  attached: boolean;
}

function finish(
  s: Scope,
  root: Group,
  materials: { solid: Material; light: Material },
  name: string,
): BatchedMesh[] {
  const meshes: BatchedMesh[] = [];
  const solid = s.solid.build(materials.solid, `${name}-solid`, true);
  const light = s.light.build(materials.light, `${name}-light`, false);
  if (solid) meshes.push(solid);
  if (light) {
    light.renderOrder = 4;
    meshes.push(light);
  }
  const children = [...meshes, ...s.picks];
  if (children.length > 0) root.add(...children);
  return meshes;
}

export function createDiscoveryProps(opts: DiscoveryPropsOptions): DiscoveryProps {
  const materials = { solid: propMaterial(), light: lightMaterial() };
  const kit: PickKit = {
    geo: new SphereGeometry(1, 12, 8),
    mat: new MeshBasicMaterial({ visible: false }),
  };
  const group = new Group();
  group.name = 'discoveries';

  const shapes: CampusShape[] = opts.campuses.map((c) => {
    c.group.updateMatrixWorld(true);
    return {
      toLocal: c.group.matrixWorld.clone().invert(),
      footprint: Number.isFinite(c.footprint) ? c.footprint : 5,
    };
  });
  const hosts = detailHosts(opts.campuses.map((c) => c.id));

  const island = buildIsland(
    kit,
    shapes,
    Number.isFinite(opts.islandRadius) && opts.islandRadius > 10 ? opts.islandRadius : 62,
  );
  const islandMeshes = finish(island, group, materials, 'discoveries-island');
  const islandPicks: readonly Mesh[] = island.picks;

  const entries = new Map<Group, Entry>();

  const release = (e: Entry) => {
    entries.delete(e.parent);
    e.root.removeFromParent();
    e.meshes.forEach((m) => m.dispose());
  };

  // Frames are reused (no allocation per frame); `last` poses interiors decorated between frames.
  const islandFrame: FrameCtx = { t: 0, rm: opts.reducedMotion, hour: undefined, load: 0 };
  const entryFrame: FrameCtx = { t: 0, rm: opts.reducedMotion, hour: undefined, load: 0 };
  let last: DiscoveryFrame | null = null;
  island.animate.forEach((fn) => fn(islandFrame));

  const pose = (e: Entry, t: number, rm: boolean) => {
    entryFrame.t = t;
    entryFrame.rm = rm;
    entryFrame.hour = last?.hours.get(e.campusId);
    entryFrame.load = clamp01(last?.loads.get(e.campusId) ?? 0);
    for (const fn of e.animate) fn(entryFrame);
  };

  return {
    group,
    pickables: islandPicks,
    update(s) {
      last = s;
      const rm = !!s.reducedMotion;
      const t = rm || !Number.isFinite(s.time) ? 0 : s.time;
      islandFrame.t = t;
      islandFrame.rm = rm;
      for (const fn of island.animate) fn(islandFrame);
      // Deleting the entry being visited is safe while iterating a Map.
      for (const e of entries.values()) {
        const attached = e.parent.parent !== null && e.root.parent === e.parent;
        if (attached) e.attached = true;
        else if (e.attached) {
          release(e); // the interior was disposed
          continue;
        }
        if (e.parent.visible) pose(e, t, rm);
      }
    },
    decorateInterior(view, parent, campus) {
      const existing = entries.get(parent);
      if (existing) {
        if (existing.view === view && existing.campusId === campus.id) return [...existing.picks];
        release(existing);
      }
      const details = interiorDetails(view, campus.id, hosts);
      const s = newScope(kit);
      let labHalf = 2;
      if (view === 'lab') {
        // The display's width follows the lineup; read it from what is already in the case.
        let maxX = 0;
        parent.traverse((o) => {
          if (!(o instanceof Mesh)) return;
          o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox;
          if (!bb) return;
          maxX = Math.max(
            maxX,
            Math.abs(o.position.x) + Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) * o.scale.x,
          );
        });
        labHalf = Math.max(2, maxX - 0.3);
      }
      const place: InteriorPlace = {
        campus: {
          id: campus.id,
          footprint: Number.isFinite(campus.footprint) ? campus.footprint : 5,
          bodyHalf: campus.bodyHalf,
        },
        parent,
        seats: view === 'offices' ? officeSeats(parent) : [],
        labHalf,
      };
      for (const d of details) MAKERS[d.id]?.(s, place);
      const root = new Group();
      root.name = `discoveries-${view}-${campus.id}`;
      const meshes = finish(s, root, materials, root.name);
      parent.add(root);
      const entry: Entry = {
        root,
        parent,
        view,
        campusId: campus.id,
        picks: s.picks,
        meshes,
        animate: s.animate,
        attached: parent.parent !== null,
      };
      entries.set(parent, entry);
      // First pose right away (with the latest hours and loads), so nothing shows a frame at the
      // origin or, by day, the night-shift nap.
      const rm = last ? !!last.reducedMotion : opts.reducedMotion;
      pose(entry, rm || !last || !Number.isFinite(last.time) ? 0 : last.time, rm);
      return [...entry.picks];
    },
    dispose() {
      for (const e of [...entries.values()]) release(e);
      group.removeFromParent();
      islandMeshes.forEach((m) => m.dispose());
      group.clear();
      kit.geo.dispose();
      kit.mat.dispose();
      materials.solid.dispose();
      materials.light.dispose();
    },
  };
}
