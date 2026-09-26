/**
 * One token's flight (brief §5.3 item 4): a small glowing mote with a short,
 * tapering trail lifts off from a point in front of the camera ("your screen"),
 * flies a raised arc into the chosen HQ over ~2.2 s with eased timing, and lands
 * with a brief flash, a ring of light and a soft afterglow on the spot (the rack
 * it lit). launch() resolves on arrival, so the caller can light a real rack at
 * that moment. Flights may overlap.
 *
 * Reduced motion: no travel — a short, gentle flash and afterglow at the
 * destination, and the promise resolves after ~300 ms.
 *
 * Cosmetic only: nothing here feeds a number, and nothing is random.
 *
 * Budget: three draw calls while any flight is visible (camera-facing glow
 * sprites for motes, flashes and afterglows; trail ribbons; landing rings), none
 * when idle (the group is hidden). Additive blending, no depth writes,
 * intensities kept moderate: only the mote's core and the first instant of the
 * flash cross the bloom threshold.
 *
 * Space: world. The integrator adds `group` to the scene (not to a campus).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Camera,
  type IUniform,
} from 'three';

export interface TokenFlight {
  readonly group: Group;
  launch(from: Vector3, to: Vector3, opts?: LaunchOptions): Promise<void>;
  update(dt: number, time: number): void;
  dispose(): void;
}

export interface LaunchOptions {
  /** CSS colour of the mote (e.g. the HQ's accent); a warm light by default. */
  color?: string;
  /** Scale of the mote, flash, ring and afterglow (1 = a campus seen from the city overview). */
  size?: number;
  /** The soft glow left at the destination after landing (default true). */
  afterglow?: boolean;
}

// ---------------------------------------------------------------------------
// tuning
// ---------------------------------------------------------------------------

/** Travel time from `from` to `to`. */
export const FLIGHT_SECONDS = 2.2;
/** Reduced motion: the promise resolves this long after launch. */
export const REDUCED_SECONDS = 0.3;
/** After landing, the flash and the ring play out over this long. */
export const LANDING_SECONDS = 0.9;
/** Reduced motion: length of the gentle flash (it outlives the promise a little). */
export const REDUCED_FLASH_SECONDS = 0.7;
/** The afterglow at the destination holds, then fades, over this long after landing. */
export const AFTERGLOW_SECONDS = 2.4;
/** Flights in the air at once; launching one more retires the oldest (its promise resolves). */
export const MAX_FLIGHTS = 8;
/** Points along each trail ribbon. */
export const TRAIL_POINTS = 24;
/** The trail covers this fraction of the flight time behind the mote (longer when it flies faster). */
const TRAIL_SPAN = 0.16;

/** The arc rises above the chord by half the control point's lift (quadratic Bézier). */
const ARC_LIFT = 0.3;
const ARC_MIN_LIFT = 2;
const ARC_MAX_LIFT = 24;

const DEFAULT_COLOR = '#ffd9a0';
const MOTE_SIZE = 0.6;
const MOTE_INTENSITY = 1.5;
/** Half-width of the trail at the mote (world units; tapers towards the tail). */
const TRAIL_WIDTH = 0.2;
const TRAIL_INTENSITY = 0.85;
const FLASH_SIZE = 3;
const FLASH_INTENSITY = 1.2;
const REDUCED_FLASH_INTENSITY = 0.8;
const RING_START = 0.4;
const RING_REACH = 5;
const RING_INTENSITY = 0.85;
const AFTERGLOW_SIZE = 1;
const AFTERGLOW_INTENSITY = 0.75;
/** Sprites and trails stay within these fractions of the view height on screen (in the shaders). */
const GLOW_MIN_FRACTION = 0.013;
const GLOW_MAX_FRACTION = 0.05;
const TRAIL_MIN_FRACTION = 0.004;
const TRAIL_MAX_FRACTION = 0.02;

const GLOWS_PER_FLIGHT = 3; // mote or flash, afterglow, spare
const TRAIL_VERTS = TRAIL_POINTS * 2;
const TRAIL_INDICES = (TRAIL_POINTS - 1) * 6;

// ---------------------------------------------------------------------------
// pure helpers (unit-tested)
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Cubic ease-in-out on [0, 1] (the camera director's curve): a gentle lift-off and landing. */
export function easeInOut(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Cubic ease-out on [0, 1]. */
export function easeOut(t: number): number {
  return 1 - (1 - clamp01(t)) ** 3;
}

/** Control point of the raised arc: above the chord's midpoint, lifted more for longer flights. */
export function arcControl(from: Vector3, to: Vector3, out = new Vector3()): Vector3 {
  const lift = Math.min(ARC_MAX_LIFT, Math.max(ARC_MIN_LIFT, from.distanceTo(to) * ARC_LIFT));
  out.addVectors(from, to).multiplyScalar(0.5);
  out.y += lift;
  return out;
}

/** Point at u ∈ [0, 1] on the quadratic Bézier from → control → to. */
export function arcPoint(
  from: Vector3,
  control: Vector3,
  to: Vector3,
  u: number,
  out = new Vector3(),
): Vector3 {
  const t = clamp01(u);
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return out.set(
    a * from.x + b * control.x + c * to.x,
    a * from.y + b * control.y + c * to.y,
    a * from.z + b * control.z + c * to.z,
  );
}

/** Direction of travel (the derivative, not normalized) at u ∈ [0, 1] on the same Bézier. */
export function arcTangent(
  from: Vector3,
  control: Vector3,
  to: Vector3,
  u: number,
  out = new Vector3(),
): Vector3 {
  const t = clamp01(u);
  const a = 2 * (1 - t);
  const b = 2 * t;
  return out.set(
    a * (control.x - from.x) + b * (to.x - control.x),
    a * (control.y - from.y) + b * (to.y - control.y),
    a * (control.z - from.z) + b * (to.z - control.z),
  );
}

export interface FlightPhase {
  /** 0 → 1 over the travel (always 1 with reduced motion). */
  readonly travel: number;
  /** 0 → 1 over the landing flash and ring (with reduced motion: over the whole flash). */
  readonly landing: number;
  /** 0 → 1 over the afterglow at the destination. */
  readonly afterglow: number;
  /** The token has arrived: launch() resolves. */
  readonly landed: boolean;
  /** Nothing of this flight is visible any more. */
  readonly done: boolean;
}

/** Where a flight stands `elapsed` seconds after launch. */
export function flightPhase(elapsed: number, reducedMotion: boolean): FlightPhase {
  const e = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  if (reducedMotion) {
    return {
      travel: 1,
      landing: clamp01(e / REDUCED_FLASH_SECONDS),
      afterglow: clamp01(e / AFTERGLOW_SECONDS),
      landed: e >= REDUCED_SECONDS,
      done: e >= Math.max(REDUCED_SECONDS, REDUCED_FLASH_SECONDS, AFTERGLOW_SECONDS),
    };
  }
  return {
    travel: clamp01(e / FLIGHT_SECONDS),
    landing: clamp01((e - FLIGHT_SECONDS) / LANDING_SECONDS),
    afterglow: clamp01((e - FLIGHT_SECONDS) / AFTERGLOW_SECONDS),
    landed: e >= FLIGHT_SECONDS,
    // Compared with the total, not `e - FLIGHT_SECONDS`, so the boundary is exact in floating point.
    done: e >= FLIGHT_SECONDS + Math.max(LANDING_SECONDS, AFTERGLOW_SECONDS),
  };
}

/** Brightness of the afterglow: rises under the flash, holds, then fades out. */
export function afterglowLevel(p: number): number {
  return smoothstep(0, 0.12, p) * (1 - smoothstep(0.4, 1, p));
}

/**
 * A world-space point `distance` units in front of a perspective camera, under the given client
 * (CSS pixel) position on the canvas whose bounding rect is `rect` — e.g. the centre of the button
 * that sent the token, so the flight starts "from your screen".
 */
export function screenToWorld(
  camera: Camera,
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  clientX: number,
  clientY: number,
  distance = 6,
  out = new Vector3(),
): Vector3 {
  const x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
  const y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
  camera.updateMatrixWorld();
  const origin = new Vector3().setFromMatrixPosition(camera.matrixWorld);
  out.set(x, y, 0.5).unproject(camera).sub(origin).normalize();
  return out.multiplyScalar(distance).add(origin);
}

// ---------------------------------------------------------------------------
// shaders
// ---------------------------------------------------------------------------

/** Fog for additive light: attenuate towards black (mixing towards the fog colour would add it). */
const FOG_FACTOR = /* glsl */ `
  float tfFogFactor() {
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        return exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        return 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
      #endif
    #else
      return 1.0;
    #endif
  }
`;

/** One view height in world units at a view-space depth (perspective: 2 · depth / P[1][1]). */
const VIEW_HEIGHT = /* glsl */ `
  float tfViewHeight(float depth) {
    return 2.0 * depth / projectionMatrix[1][1];
  }
`;

function additive(
  uniforms: Record<string, IUniform>,
  vertexShader: string,
  fragmentShader: string,
): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: true,
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...uniforms },
    vertexShader,
    fragmentShader,
  });
}

/**
 * Camera-facing soft glows, one quad per instance: position and size from the instance matrix
 * (uniform scale; 0 hides it), colour × brightness from the instance colour. The on-screen size
 * is clamped to a band of the view height so the mote stays visible from the overview and never
 * swells into a blob right in front of the lens.
 */
function glowMaterial(): ShaderMaterial {
  return additive(
    {
      uMinFrac: { value: GLOW_MIN_FRACTION },
      uMaxFrac: { value: GLOW_MAX_FRACTION },
    },
    /* glsl */ `
      #include <fog_pars_vertex>
      uniform float uMinFrac;
      uniform float uMaxFrac;
      varying vec2 vUv;
      varying vec3 vColor;
      ${VIEW_HEIGHT}
      void main() {
        vUv = position.xy;
        float size = length(instanceMatrix[0].xyz);
        vec4 mvPosition = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
        float depth = max(-mvPosition.z, 1e-3);
        float viewH = tfViewHeight(depth);
        float s = size > 0.0 ? clamp(size, uMinFrac * viewH, uMaxFrac * viewH) : 0.0;
        // Pull the quad towards the camera so nearby geometry does not slice it.
        float pull = clamp(min(s * 0.6, depth * 0.5), 0.0, 4.0);
        mvPosition.xyz += normalize(-mvPosition.xyz) * pull;
        mvPosition.xy += position.xy * s;
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    /* glsl */ `
      #include <fog_pars_fragment>
      varying vec2 vUv;
      varying vec3 vColor;
      ${FOG_FACTOR}
      void main() {
        float d2 = dot(vUv, vUv);
        if (d2 >= 1.0) discard;
        float core = exp(-d2 * 24.0);
        float glow = (core + 0.3 * exp(-d2 * 5.0)) * (1.0 - d2);
        // A whiter core with the colour in the halo, at the same brightness.
        float peak = max(vColor.r, max(vColor.g, vColor.b));
        vec3 col = mix(vColor, vec3(peak), 0.55 * core);
        gl_FragColor = vec4(col * tfFogFactor(), glow);
      }
    `,
  );
}

/**
 * Trail ribbons: a strip along the arc, turned to face the camera in the vertex shader (the side
 * vector is the travel direction × the view ray), tapering and fading from the mote to the tail.
 */
function trailMaterial(): ShaderMaterial {
  return additive(
    {
      uMinFrac: { value: TRAIL_MIN_FRACTION },
      uMaxFrac: { value: TRAIL_MAX_FRACTION },
    },
    /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec3 aTangent;
      attribute float aSide;
      attribute float aAlong;
      attribute float aWidth;
      attribute vec3 aColor;
      uniform float uMinFrac;
      uniform float uMaxFrac;
      varying float vSide;
      varying float vAlong;
      varying vec3 vColor;
      ${VIEW_HEIGHT}
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vec3 t = (modelViewMatrix * vec4(aTangent, 0.0)).xyz;
        vec3 c = cross(t, normalize(-mvPosition.xyz));
        float l = length(c);
        vec3 side = l > 1e-6 ? c / l : vec3(0.0, 1.0, 0.0);
        float viewH = tfViewHeight(max(-mvPosition.z, 1e-3));
        float w = aWidth > 0.0 ? clamp(aWidth, uMinFrac * viewH, uMaxFrac * viewH) : 0.0;
        mvPosition.xyz += side * aSide * w * (1.0 - 0.85 * aAlong);
        vSide = aSide;
        vAlong = aAlong;
        vColor = aColor;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    /* glsl */ `
      #include <fog_pars_fragment>
      varying float vSide;
      varying float vAlong;
      varying vec3 vColor;
      ${FOG_FACTOR}
      void main() {
        float across = exp(-vSide * vSide * 3.5);
        float along = pow(1.0 - vAlong, 1.6);
        float peak = max(vColor.r, max(vColor.g, vColor.b));
        vec3 col = mix(vColor, vec3(peak), 0.4 * across * (1.0 - vAlong));
        gl_FragColor = vec4(col * tfFogFactor(), across * along);
      }
    `,
  );
}

/** Landing ring on a horizontal unit plane (scaled to fit): a bright rim with a faint wake inside. */
function ringMaterial(): ShaderMaterial {
  const mat = additive(
    {},
    /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vPlane;
      varying vec3 vColor;
      void main() {
        vPlane = position.xz;
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    /* glsl */ `
      #include <fog_pars_fragment>
      varying vec2 vPlane;
      varying vec3 vColor;
      ${FOG_FACTOR}
      void main() {
        float d = length(vPlane);
        if (d >= 1.0) discard;
        float x = (d - 0.8) / 0.09;
        float rim = exp(-x * x);
        float wake = smoothstep(0.3, 0.8, d) * step(d, 0.8) * 0.2;
        float a = (rim + wake) * (1.0 - smoothstep(0.9, 1.0, d));
        float peak = max(vColor.r, max(vColor.g, vColor.b));
        gl_FragColor = vec4(mix(vColor, vec3(peak), 0.35 * rim) * tfFogFactor(), a);
      }
    `,
  );
  mat.side = DoubleSide;
  return mat;
}

// ---------------------------------------------------------------------------
// the effect
// ---------------------------------------------------------------------------

interface Flight {
  readonly from: Vector3;
  readonly control: Vector3;
  readonly to: Vector3;
  readonly color: Color;
  readonly size: number;
  readonly afterglow: boolean;
  /** Launch number: a deterministic phase for the mote's shimmer. */
  readonly seed: number;
  elapsed: number;
  resolve: (() => void) | null;
}

/** A ribbon strip per flight slot: static side/along attributes and a fixed index buffer. */
function trailGeometry(): BufferGeometry {
  const n = MAX_FLIGHTS * TRAIL_VERTS;
  const geo = new BufferGeometry();
  const dynamic = (size: number) =>
    new BufferAttribute(new Float32Array(n * size), size).setUsage(DynamicDrawUsage);
  const side = new Float32Array(n);
  const along = new Float32Array(n);
  const index: number[] = [];
  for (let f = 0; f < MAX_FLIGHTS; f++) {
    for (let k = 0; k < TRAIL_POINTS; k++) {
      const v = (f * TRAIL_POINTS + k) * 2;
      side[v] = -1;
      side[v + 1] = 1;
      along[v] = along[v + 1] = k / (TRAIL_POINTS - 1);
      if (k < TRAIL_POINTS - 1) index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
  }
  geo.setAttribute('position', dynamic(3));
  geo.setAttribute('aTangent', dynamic(3));
  geo.setAttribute('aColor', dynamic(3));
  geo.setAttribute('aWidth', dynamic(1));
  geo.setAttribute('aSide', new BufferAttribute(side, 1));
  geo.setAttribute('aAlong', new BufferAttribute(along, 1));
  geo.setIndex(index);
  geo.setDrawRange(0, 0);
  return geo;
}

export function createTokenFlight(opts: { reducedMotion: boolean }): TokenFlight {
  const rm = opts.reducedMotion;
  const group = new Group();
  group.name = 'token-flight';
  group.visible = false;

  const glowGeo = new PlaneGeometry(2, 2);
  const glowMat = glowMaterial();
  const glows = new InstancedMesh(glowGeo, glowMat, MAX_FLIGHTS * GLOWS_PER_FLIGHT);
  glows.name = 'token-flight-glows';
  glows.frustumCulled = false; // positions change every frame, anywhere in the world
  glows.renderOrder = 8;

  const trailGeo = trailGeometry();
  const trailMat = trailMaterial();
  const trails = new Mesh(trailGeo, trailMat);
  trails.name = 'token-flight-trails';
  trails.frustumCulled = false;
  trails.renderOrder = 7;

  const ringGeo = new PlaneGeometry(2, 2);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = ringMaterial();
  const rings = new InstancedMesh(ringGeo, ringMat, MAX_FLIGHTS);
  rings.name = 'token-flight-rings';
  rings.frustumCulled = false;
  rings.renderOrder = 7;

  // Create the colour attribute up front, so the shaders compile with it from the first frame.
  const black = new Color(0, 0, 0);
  for (let i = 0; i < glows.count; i++) glows.setColorAt(i, black);
  for (let i = 0; i < rings.count; i++) rings.setColorAt(i, black);
  glows.count = 0;
  rings.count = 0;
  group.add(rings, trails, glows);

  const tPos = trailGeo.getAttribute('position') as BufferAttribute;
  const tTan = trailGeo.getAttribute('aTangent') as BufferAttribute;
  const tCol = trailGeo.getAttribute('aColor') as BufferAttribute;
  const tWidth = trailGeo.getAttribute('aWidth') as BufferAttribute;

  const flights: Flight[] = [];
  const m = new Matrix4();
  const p = new Vector3();
  const tan = new Vector3();
  const col = new Color();
  let launches = 0;
  let disposed = false;

  function glow(i: number, at: Vector3, size: number, c: Color, k: number): number {
    m.makeScale(size, size, size).setPosition(at);
    glows.setMatrixAt(i, m);
    glows.setColorAt(i, col.copy(c).multiplyScalar(k));
    return i + 1;
  }

  function ring(i: number, f: Flight, landing: number): number {
    const radius = (RING_START + RING_REACH * easeOut(landing)) * f.size;
    const k = RING_INTENSITY * (1 - landing) ** 1.4;
    // A hair above the destination, so a ring landing on a roof does not z-fight with it.
    m.makeScale(radius, radius, radius).setPosition(f.to.x, f.to.y + 0.05 * f.size, f.to.z);
    rings.setMatrixAt(i, m);
    rings.setColorAt(i, col.copy(f.color).multiplyScalar(k));
    return i + 1;
  }

  /** Fill trail slot `slot` for flight `f`; the ribbon collapses onto `to` after landing. */
  function trail(slot: number, f: Flight, ph: FlightPhase): void {
    const raw = f.elapsed / FLIGHT_SECONDS; // keeps growing after arrival, so the tail catches up
    const k = TRAIL_INTENSITY * smoothstep(0, 0.08, ph.travel) * (1 - ph.landing) ** 2;
    col.copy(f.color).multiplyScalar(k);
    const width = TRAIL_WIDTH * f.size;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const u = easeInOut(raw - (i / (TRAIL_POINTS - 1)) * TRAIL_SPAN);
      arcPoint(f.from, f.control, f.to, u, p);
      arcTangent(f.from, f.control, f.to, u, tan);
      const v = (slot * TRAIL_POINTS + i) * 2;
      for (const j of [v, v + 1]) {
        tPos.setXYZ(j, p.x, p.y, p.z);
        tTan.setXYZ(j, tan.x, tan.y, tan.z);
        tCol.setXYZ(j, col.r, col.g, col.b);
        tWidth.setX(j, width);
      }
    }
  }

  /** Write one flight's sprites from instance `g`; returns the next free instance. */
  function sprites(f: Flight, ph: FlightPhase, time: number, g: number): number {
    if (f.afterglow && ph.landed) {
      const k = AFTERGLOW_INTENSITY * afterglowLevel(ph.afterglow);
      if (k > 0.002) g = glow(g, f.to, AFTERGLOW_SIZE * f.size, f.color, k);
    }
    if (rm) {
      // A gentle flash that fades in and out on the spot; nothing moves.
      const k = smoothstep(0, 0.2, ph.landing) * (1 - smoothstep(0.45, 1, ph.landing));
      return k > 0.002
        ? glow(g, f.to, FLASH_SIZE * 0.7 * f.size, f.color, REDUCED_FLASH_INTENSITY * k)
        : g;
    }
    if (!ph.landed) {
      const fadeIn = smoothstep(0, 0.06, ph.travel);
      const shimmer = 1 + 0.08 * Math.sin(time * 14 + f.seed * 2.39);
      arcPoint(f.from, f.control, f.to, easeInOut(ph.travel), p);
      return glow(g, p, MOTE_SIZE * fadeIn * shimmer * f.size, f.color, MOTE_INTENSITY * fadeIn);
    }
    // Landing: a flash that pops and fades as it spreads.
    const k = FLASH_INTENSITY * smoothstep(0, 0.06, ph.landing) * (1 - ph.landing) ** 2;
    if (k <= 0.002) return g;
    const size = FLASH_SIZE * (0.5 + 0.6 * easeOut(ph.landing)) * f.size;
    return glow(g, f.to, size, f.color, k);
  }

  return {
    group,
    launch(from, to, o = {}) {
      const finite = [from.x, from.y, from.z, to.x, to.y, to.z].every(Number.isFinite);
      if (disposed || !finite) return Promise.resolve();
      if (flights.length >= MAX_FLIGHTS) flights.shift()?.resolve?.();
      const size = o.size !== undefined && o.size > 0 && Number.isFinite(o.size) ? o.size : 1;
      return new Promise<void>((resolve) => {
        flights.push({
          from: from.clone(),
          control: arcControl(from, to),
          to: to.clone(),
          color: new Color(o.color ?? DEFAULT_COLOR),
          size,
          afterglow: o.afterglow ?? true,
          seed: launches++,
          elapsed: 0,
          resolve,
        });
        group.visible = true;
      });
    },
    update(dt, time) {
      if (flights.length === 0) {
        if (group.visible) {
          group.visible = false;
          glows.count = 0;
          rings.count = 0;
          trailGeo.setDrawRange(0, 0);
        }
        return;
      }
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      let g = 0;
      let r = 0;
      let t = 0;
      for (let i = 0; i < flights.length;) {
        const f = flights[i]!;
        f.elapsed += step;
        const ph = flightPhase(f.elapsed, rm);
        if (ph.landed && f.resolve) {
          const resolve = f.resolve;
          f.resolve = null;
          resolve();
        }
        if (ph.done) {
          flights.splice(i, 1);
          continue;
        }
        g = sprites(f, ph, time, g);
        if (!rm && ph.landing < 1) {
          trail(t++, f, ph);
          if (ph.landed) r = ring(r, f, ph.landing);
        }
        i++;
      }
      glows.count = g;
      rings.count = r;
      trailGeo.setDrawRange(0, t * TRAIL_INDICES);
      glows.instanceMatrix.needsUpdate = true;
      rings.instanceMatrix.needsUpdate = true;
      if (glows.instanceColor) glows.instanceColor.needsUpdate = true;
      if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
      if (t > 0) {
        for (const a of [tPos, tTan, tCol, tWidth]) {
          a.clearUpdateRanges();
          a.addUpdateRange(0, t * TRAIL_VERTS * a.itemSize);
          a.needsUpdate = true;
        }
      }
    },
    dispose() {
      disposed = true;
      // Nobody should wait forever on a flight that will never land.
      for (const f of flights) f.resolve?.();
      flights.length = 0;
      group.removeFromParent();
      group.clear();
      glows.dispose();
      rings.dispose();
      glowGeo.dispose();
      trailGeo.dispose();
      ringGeo.dispose();
      glowMat.dispose();
      trailMat.dispose();
      ringMat.dispose();
    },
  };
}
