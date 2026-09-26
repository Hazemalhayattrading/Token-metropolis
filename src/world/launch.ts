/**
 * Launch day in 3D (brief §5.3 item 2). While a platform is inside the 72-hour
 * window after a model launch, its HQ celebrates: searchlight beams sweep up
 * from the front plaza, a ring of drones circles the crown with blinking
 * lights, and a crowd gathers on the plaza. When playback crosses a launch, a
 * ring of light runs out over the ground from the tower and the crown flashes.
 *
 * Cosmetic only — nothing here feeds a number. Layout variety comes from a hash
 * of the index (deterministic), never from Math.random().
 *
 * Budget: at most six draw calls while visible (beams, glows, drone bodies,
 * crowd, plaza wash, burst ring), no real lights (the beams are soft additive
 * gradients), and zero cost when idle (the group is hidden).
 *
 * Space: campus-local. Origin at the tower base centre, +y up, +z towards the
 * city centre (the front plaza). The crown sits at y = height.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type BufferGeometry,
  type IUniform,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// contract
// ---------------------------------------------------------------------------

export interface LaunchFxState {
  /** Inside the 72 h launch window at the time shown (live or scrubbed). */
  active: boolean;
  /** 0..1: remaining fraction of the short real-time pulse fired when playback crosses a launch. */
  burst: number;
  /** Seconds, for cosmetic animation. */
  time: number;
  /** Current tower height in world units (the crown sits at y = height). */
  height: number;
  reducedMotion: boolean;
}

export interface LaunchFx {
  readonly group: Group;
  update(s: LaunchFxState): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// tuning
// ---------------------------------------------------------------------------

export const MAX_BEAMS = 4;
export const MAX_DRONES = 16;
export const MAX_CROWD = 60;
/** Angular half-width of the crowd's crescent on the front plaza (radians from +z). */
export const CROWD_SPREAD = 1.1;
/** Lamps stand this far beyond the tower footprint (brief: footprint + 2..4). */
const LAMP_OFFSET = 3;
/** Crowd ring on the plaza: footprint + 1.5 .. footprint + 5. */
const CROWD_INNER = 1.5;
const CROWD_OUTER = 5;
const CROWD_SPACING = 0.3;
const CROWD_LAMP_CLEARANCE = 0.8;
/** How far the burst ring travels beyond the tower (world units). */
const RING_REACH = 16;
/** How fast the effect fades in and out (1/s): ~95 % in one second. */
const FADE_RATE = 3;
const DRONE_SPEED = 0.32; // rad/s
/** Ground-level effects float just above the flat plaza slabs of the typologies (tops ≤ 0.1). */
const GROUND_Y = 0.14;
const LAMP_Y = 0.2;
/** Figures stand on bare ground (y = 0) or sink their feet into a plaza slab (≤ 0.1). */
const CROWD_Y = 0.03;
/** Peak additive intensity of one beam face; two faces overlap, so the core adds ~2×. */
const BEAM_INTENSITY = 0.16;

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(Number.isFinite(v) ? v : 0, 0, 1);
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Deterministic pseudo-random value in [0, 1) for a number. Cosmetic layout only. */
export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Frame-rate independent exponential approach of `current` towards `target` (snaps when close). */
export function approach(current: number, target: number, dt: number, rate: number): number {
  if (!(dt > 0)) return current;
  const next = current + (target - current) * (1 - Math.exp(-dt * rate));
  return Math.abs(target - next) < 1e-3 ? target : next;
}

/** Three beams for slim towers, four for broad ones. */
export function beamCount(footprint: number): 3 | 4 {
  return footprint >= 5 ? 4 : 3;
}

/** 8 drones for the slimmest tower, 16 for the broadest. */
export function droneCount(footprint: number): number {
  return clamp(Math.round(footprint * 2), 8, MAX_DRONES);
}

/** Target crowd size (the layout may place fewer if the plaza is too small). */
export function crowdCount(footprint: number): number {
  return clamp(Math.round(30 + footprint * 4), 24, MAX_CROWD);
}

export interface Lamp {
  x: number;
  z: number;
  /** Angle of the lamp around the tower, from +z towards +x (radians). */
  angle: number;
}

const LAMP_ANGLES: Record<3 | 4, readonly number[]> = {
  3: [-0.72, 0, 0.72],
  4: [-0.98, -0.33, 0.33, 0.98],
};

/** Searchlight positions: a shallow arc across the front plaza. */
export function lampLayout(footprint: number): Lamp[] {
  const r = footprint + LAMP_OFFSET;
  return LAMP_ANGLES[beamCount(footprint)].map((angle) => ({
    x: Math.sin(angle) * r,
    z: Math.cos(angle) * r,
    angle,
  }));
}

export interface BeamAim {
  /** Lean away from vertical (radians). */
  tilt: number;
  /** Direction of the lean, from +z towards +x (radians). */
  azimuth: number;
}

/**
 * Where beam `i` points. Beams lean outwards (away from the tower) and sweep
 * slowly across each other; with reduced motion they hold a still, symmetric fan.
 */
export function beamAim(
  lampAngle: number,
  i: number,
  time: number,
  reducedMotion: boolean,
): BeamAim {
  const fan = lampAngle * 1.35;
  if (reducedMotion) return { tilt: 0.28, azimuth: fan };
  return {
    tilt: 0.28 + 0.1 * Math.sin(time * 0.23 + i * 2.7),
    azimuth: fan + 0.6 * Math.sin(time * 0.19 + i * 1.9),
  };
}

/** Unit direction of a beam from its aim. */
export function beamDirection(aim: BeamAim, out = new Vector3()): Vector3 {
  const s = Math.sin(aim.tilt);
  return out.set(s * Math.sin(aim.azimuth), Math.cos(aim.tilt), s * Math.cos(aim.azimuth));
}

/** Beams reach well above the crown, fading out long before their end. */
export function beamLength(height: number): number {
  return clamp(Math.max(0, height) * 1.1 + 24, 30, 72);
}

export interface DronePose {
  x: number;
  y: number;
  z: number;
  /** Rotation about +y so the drone faces along its orbit. */
  heading: number;
}

/**
 * Drone `i` of `n`: two counter-rotating rings around the crown, at
 * height + 2.2..3.7. With reduced motion they hover in place.
 */
export function dronePose(
  i: number,
  n: number,
  footprint: number,
  height: number,
  time: number,
  reducedMotion: boolean,
  out: DronePose = { x: 0, y: 0, z: 0, heading: 0 },
): DronePose {
  const ring = i % 2;
  const inRing = Math.max(1, ring === 0 ? Math.ceil(n / 2) : Math.floor(n / 2));
  const j = Math.floor(i / 2);
  const dir = ring === 0 ? 1 : -1;
  const t = reducedMotion ? 0 : time;
  const radius = footprint + 1.3 + ring * 0.9 + (hash01(i + 17) - 0.5) * 0.3;
  const a = (j / inRing) * TAU + ring * (Math.PI / inRing) + dir * t * DRONE_SPEED;
  const bob = reducedMotion ? 0 : 0.15 * Math.sin(t * 1.3 + i * 2.1);
  out.x = Math.sin(a) * radius;
  out.z = Math.cos(a) * radius;
  out.y = Math.max(0, height) + 2.35 + ring * 1.2 + bob;
  // Tangent of the orbit: d/da (sin a, cos a) = (cos a, -sin a), flipped for the second ring.
  out.heading = Math.atan2(dir * Math.cos(a), -dir * Math.sin(a));
  return out;
}

/** 1 while a light is on, 0 while off: on for `duty` of every `period` seconds, offset by `phase` (0..1). */
export function blink(time: number, period: number, duty: number, phase: number): number {
  const f = (((time / period + phase) % 1) + 1) % 1;
  return f < duty ? 1 : 0;
}

export interface Figure {
  x: number;
  z: number;
  /** Bob phase (radians). */
  phase: number;
  /** Height variation around 1. */
  scale: number;
  /** 0..1, picks the figure's colour. */
  tint: number;
}

/**
 * Where the crowd stands: a crescent on the front plaza (radius footprint + 1.5..5,
 * within ±CROWD_SPREAD of +z), densest near the tower and the centre line, at
 * least CROWD_SPACING apart and clear of the lamps. Deterministic.
 */
export function crowdLayout(
  footprint: number,
  count: number,
  avoid: readonly { x: number; z: number }[] = [],
): Figure[] {
  const r0 = footprint + CROWD_INNER;
  const r1 = footprint + CROWD_OUTER;
  const out: Figure[] = [];
  const target = clamp(Math.floor(count), 0, MAX_CROWD);
  for (let k = 0; out.length < target && k < target * 40; k++) {
    const u = hash01(k * 3.17 + 0.5) * 2 - 1;
    const v = hash01(k * 5.31 + 1.7);
    const a = CROWD_SPREAD * Math.sign(u) * Math.abs(u) ** 1.4;
    const r = r0 + (r1 - r0) * v ** 1.5;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const clear =
      avoid.every((p) => Math.hypot(p.x - x, p.z - z) >= CROWD_LAMP_CLEARANCE) &&
      out.every((f) => Math.hypot(f.x - x, f.z - z) >= CROWD_SPACING);
    if (!clear) continue;
    out.push({
      x,
      z,
      phase: hash01(k * 9.1 + 2.2) * TAU,
      scale: 0.9 + 0.2 * hash01(k * 2.9 + 4.4),
      tint: hash01(k * 6.7 + 8.8),
    });
  }
  return out;
}

/** A little cheering hop (world units, ≥ 0). None with reduced motion. */
export function crowdHop(time: number, phase: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return 0.035 * Math.max(0, Math.sin(time * 2.4 + phase)) ** 2;
}

export interface RingShape {
  /** Radius of the bright rim (world units). */
  radius: number;
  /** Softness of the rim (world units). */
  width: number;
  /** 0..1. */
  alpha: number;
}

/**
 * The ground ring of a launch burst: it leaves the tower's edge as the pulse
 * starts (burst = 1) and runs outwards, fading, until the pulse ends. With
 * reduced motion it stays put and only fades.
 */
export function burstRing(burst: number, footprint: number, reducedMotion: boolean): RingShape {
  const b = clamp01(burst);
  if (b <= 0) return { radius: 0, width: 0, alpha: 0 };
  if (reducedMotion) return { radius: footprint + 2.5, width: 0.8, alpha: 0.55 * b };
  const p = 1 - b;
  return {
    radius: footprint * 0.9 + RING_REACH * p ** 0.6,
    width: 0.45 + 1.4 * p,
    alpha: 0.85 * b ** 1.4,
  };
}

/**
 * Brightness of the crown flash for a burst: a brief bright pop in the first
 * ~40 % of the pulse. With reduced motion, a gentle glow that simply fades.
 */
export function crownFlash(burst: number, reducedMotion: boolean): number {
  const b = clamp01(burst);
  if (reducedMotion) return 0.45 * b;
  const k = smoothstep(0.62, 1, b);
  return 1.25 * k * k;
}

// ---------------------------------------------------------------------------
// shaders
// ---------------------------------------------------------------------------

/**
 * Fog for additive light: attenuate towards black instead of mixing towards the
 * fog colour (which would add fog colour on top of the scene).
 */
const FOG_FACTOR = /* glsl */ `
  float tmFogFactor() {
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

function additive(
  uniforms: Record<string, IUniform>,
  vertexShader: string,
  fragmentShader: string,
  doubleSided = false,
): ShaderMaterial {
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: true,
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...uniforms },
    vertexShader,
    fragmentShader,
  });
  if (doubleSided) mat.side = DoubleSide;
  return mat;
}

/** Searchlight beams: an open cone, bright at the lamp and along the axis, fading up and out. */
function beamMaterial(color: Color): ShaderMaterial {
  return additive(
    {
      uColor: { value: color },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
    },
    /* glsl */ `
      #include <fog_pars_vertex>
      varying float vAlong;
      varying float vFacing;
      varying float vSeed;
      void main() {
        vec3 s = max(vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz),
          length(instanceMatrix[2].xyz)), vec3(1e-4));
        mat4 m = modelMatrix * instanceMatrix;
        vec4 world = m * vec4(position, 1.0);
        // Inverse-transpose for a rotation × non-uniform scale: M · S⁻² · n.
        vec3 n = normalize(mat3(m) * (normal / (s * s)));
        vFacing = abs(dot(n, normalize(cameraPosition - world.xyz)));
        vAlong = position.y;
        vSeed = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uTime;
      varying float vAlong;
      varying float vFacing;
      varying float vSeed;
      ${FOG_FACTOR}
      void main() {
        // Grazing view through the cone edge = little "air" lit; face-on = the full depth.
        float body = pow(vFacing, 1.5);
        float fall = pow(1.0 - vAlong, 1.7) * smoothstep(0.0, 0.03, vAlong);
        float dust = 0.88 + 0.12 * sin(vAlong * 38.0 - uTime * 1.1 + vSeed);
        // Beams stay a landmark across the island, so fog only dims them partly.
        float a = body * fall * dust * uIntensity * mix(0.4, 1.0, tmFogFactor());
        vec3 col = mix(uColor, vec3(1.0), 0.35 * (1.0 - vAlong));
        gl_FragColor = vec4(col, a);
      }
    `,
    true,
  );
}

/**
 * Camera-facing soft glows, one quad per instance: position and size come from
 * the instance matrix (uniform scale; 0 hides it), colour × brightness from the
 * instance colour. Used for the drone lights, the lamp heads and the crown flash.
 */
function glowMaterial(): ShaderMaterial {
  return additive(
    {},
    /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vUv = position.xy;
        float size = length(instanceMatrix[0].xyz);
        vec4 mvPosition = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
        // Pull the quad towards the camera so nearby geometry does not slice it.
        float pull = clamp(min(size * 0.6, -mvPosition.z * 0.5), 0.0, 4.0);
        mvPosition.xyz += normalize(-mvPosition.xyz) * pull;
        mvPosition.xy += position.xy * size;
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
        float glow = (exp(-d2 * 22.0) + 0.32 * exp(-d2 * 5.0)) * (1.0 - d2);
        gl_FragColor = vec4(vColor * tmFogFactor(), glow);
      }
    `,
  );
}

/** Expanding ground ring: a bright rim with a faint wake inside it (unit plane, scaled to fit). */
function ringMaterial(color: Color): ShaderMaterial {
  return additive(
    {
      uColor: { value: color },
      uR: { value: 0.5 },
      uW: { value: 0.05 },
      uAlpha: { value: 0 },
    },
    /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vPlane;
      void main() {
        vPlane = position.xz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uColor;
      uniform float uR;
      uniform float uW;
      uniform float uAlpha;
      varying vec2 vPlane;
      ${FOG_FACTOR}
      void main() {
        float d = length(vPlane);
        float x = (d - uR) / max(uW, 1e-3);
        float rim = exp(-x * x);
        float wake = smoothstep(uR - 0.45, uR, d) * step(d, uR) * 0.22;
        float a = (rim + wake) * (1.0 - smoothstep(0.92, 1.0, d)) * uAlpha * tmFogFactor();
        gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.45 * rim), a);
      }
    `,
  );
}

/**
 * Light spilled on the front plaza: a faint wash over the crowd's crescent and a
 * pool at the foot of each lamp. The plane is built in campus-local coordinates.
 */
function poolMaterial(
  color: Color,
  lamps: readonly Vector2[],
  bounds: Vector4,
  crowd: Vector4,
): ShaderMaterial {
  return additive(
    {
      uColor: { value: color },
      uAlpha: { value: 0 },
      uLamps: { value: lamps },
      uBounds: { value: bounds },
      uCrowd: { value: crowd },
    },
    /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vLocal;
      void main() {
        vLocal = position.xz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform vec2 uLamps[${MAX_BEAMS}];
      uniform vec4 uBounds; // xMin, xMax, zMin, zMax
      uniform vec4 uCrowd;  // inner radius, outer radius, angular half-width
      varying vec2 vLocal;
      ${FOG_FACTOR}
      void main() {
        float r = length(vLocal);
        float ang = abs(atan(vLocal.x, vLocal.y));
        float band = smoothstep(uCrowd.x - 1.4, uCrowd.x + 0.4, r)
          * (1.0 - smoothstep(uCrowd.y - 0.6, uCrowd.y + 1.4, r));
        float fan = 1.0 - smoothstep(uCrowd.z * 0.6, uCrowd.z + 0.4, ang);
        float spots = 0.0;
        for (int i = 0; i < ${MAX_BEAMS}; i++) {
          vec2 q = vLocal - uLamps[i];
          spots += exp(-dot(q, q) * 2.4);
        }
        float edge = min(min(vLocal.x - uBounds.x, uBounds.y - vLocal.x),
          min(vLocal.y - uBounds.z, uBounds.w - vLocal.y));
        float a = (band * fan * 0.075 + spots * 0.2) * smoothstep(0.0, 0.8, edge)
          * uAlpha * tmFogFactor();
        gl_FragColor = vec4(uColor, a);
      }
    `,
  );
}

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

/** A small quadcopter: a hub and two crossed arms with rotor pods. */
function droneGeometry(): BufferGeometry {
  const hub = new BoxGeometry(0.16, 0.07, 0.16);
  const armA = new BoxGeometry(0.52, 0.03, 0.05);
  armA.rotateY(Math.PI / 4);
  const armB = new BoxGeometry(0.52, 0.03, 0.05);
  armB.rotateY(-Math.PI / 4);
  const pods = [0, 1, 2, 3].map((k) => {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const pod = new BoxGeometry(0.1, 0.03, 0.1);
    pod.translate(Math.cos(a) * 0.2, 0.02, Math.sin(a) * 0.2);
    return pod;
  });
  const parts = [hub, armA, armB, ...pods];
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

const CROWD_TONES = ['#c7ccd8', '#8e97ab', '#5f6882', '#b49a80', '#7f93b8', '#d9c9b0'].map(
  (c) => new Color(c),
);

// ---------------------------------------------------------------------------
// the effect
// ---------------------------------------------------------------------------

export function createLaunchFx(opts: { accent: string; footprint: number }): LaunchFx {
  const fp = clamp(Number.isFinite(opts.footprint) ? opts.footprint : 5, 1, 20);
  const accent = new Color(opts.accent);
  const white = new Color(1, 1, 1);

  const group = new Group();
  group.name = 'launch-fx';
  group.visible = false;

  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];

  const lamps = lampLayout(fp);
  const nDrones = droneCount(fp);
  const figures = crowdLayout(fp, crowdCount(fp), lamps);

  // --- 1. searchlight beams --------------------------------------------------
  const beamGeo = new CylinderGeometry(1, 0.12, 1, 24, 1, true);
  beamGeo.translate(0, 0.5, 0); // base at the lamp, unit length up +y
  const beamMat = beamMaterial(accent.clone());
  const beams = new InstancedMesh(beamGeo, beamMat, lamps.length);
  beams.frustumCulled = false;
  beams.renderOrder = 5;

  // --- 2. glows: crown flash, lamp heads, drone lights -----------------------
  const FLASH = 0;
  const LAMP0 = 1;
  const LIGHT0 = LAMP0 + lamps.length;
  const glowGeo = new PlaneGeometry(2, 2);
  const glowMat = glowMaterial();
  const glows = new InstancedMesh(glowGeo, glowMat, LIGHT0 + nDrones * 2);
  glows.frustumCulled = false;
  glows.renderOrder = 6;
  const flashColor = accent.clone().lerp(white, 0.55);
  const lampColor = accent.clone().lerp(white, 0.5);
  const red = new Color('#ff3b30');
  const strobe = new Color('#f4f7ff');

  // --- 3. drone bodies ---------------------------------------------------------
  const droneGeo = droneGeometry();
  const droneMat = new MeshStandardMaterial({
    color: '#1b202b',
    roughness: 0.45,
    metalness: 0.6,
  });
  const drones = new InstancedMesh(droneGeo, droneMat, nDrones);
  drones.frustumCulled = false;

  // --- 4. crowd ------------------------------------------------------------------
  const crowdGeo = new CapsuleGeometry(0.052, 0.146, 3, 6);
  crowdGeo.translate(0, 0.125, 0); // stand on the ground; ~0.25 tall
  const crowdMat = new MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.85,
    emissive: accent.clone().lerp(white, 0.5),
    emissiveIntensity: 0.09, // a touch of the searchlights' spill; tones still read
  });
  const crowd = new InstancedMesh(crowdGeo, crowdMat, Math.max(1, figures.length));
  crowd.frustumCulled = false;
  const tint = new Color();
  figures.forEach((f, i) => {
    // About one in five wears the house colour.
    if (f.tint < 0.22) tint.copy(accent).lerp(white, 0.15);
    else tint.copy(CROWD_TONES[Math.floor(f.tint * CROWD_TONES.length) % CROWD_TONES.length]!);
    crowd.setColorAt(i, tint);
  });
  crowd.count = 0;

  // --- 5. plaza wash ---------------------------------------------------------------
  const outerR = fp + CROWD_OUTER + 1.5;
  const fanEdge = Math.min(Math.PI / 2, CROWD_SPREAD + 0.4);
  const bounds = new Vector4(
    -outerR * Math.sin(fanEdge),
    outerR * Math.sin(fanEdge),
    Math.max(0.2, (fp + 0.3) * Math.cos(fanEdge)),
    outerR,
  );
  const poolGeo = new PlaneGeometry(bounds.y - bounds.x, bounds.w - bounds.z);
  poolGeo.rotateX(-Math.PI / 2);
  poolGeo.translate((bounds.x + bounds.y) / 2, GROUND_Y, (bounds.z + bounds.w) / 2);
  const lampSpots = Array.from({ length: MAX_BEAMS }, (_, i) => {
    const l = lamps[i];
    return l ? new Vector2(l.x, l.z) : new Vector2(1e4, 1e4); // unused slots sit far away
  });
  const poolMat = poolMaterial(
    accent.clone().lerp(white, 0.2),
    lampSpots,
    bounds,
    new Vector4(fp + CROWD_INNER, fp + CROWD_OUTER, CROWD_SPREAD, 0),
  );
  const pool = new Mesh(poolGeo, poolMat);
  pool.renderOrder = 3;

  // --- 6. burst ring -----------------------------------------------------------------
  const ringGeo = new PlaneGeometry(2, 2);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = ringMaterial(accent.clone());
  const ring = new Mesh(ringGeo, ringMat);
  ring.position.y = GROUND_Y + 0.01;
  ring.renderOrder = 3;
  ring.visible = false;

  pool.name = 'launch-pool';
  ring.name = 'launch-ring';
  crowd.name = 'launch-crowd';
  drones.name = 'launch-drones';
  beams.name = 'launch-beams';
  glows.name = 'launch-glows';
  group.add(pool, ring, crowd, drones, beams, glows);
  geometries.push(beamGeo, glowGeo, droneGeo, crowdGeo, poolGeo, ringGeo);
  materials.push(beamMat, glowMat, droneMat, crowdMat, poolMat, ringMat);
  const instanced = [beams, glows, drones, crowd];

  // Every glow starts hidden (zero size) and black, so the colour attribute exists from the first
  // frame (the shader is compiled with instance colours).
  const dummy = new Object3D();
  const hidden = new Object3D();
  hidden.scale.setScalar(0);
  hidden.updateMatrix();
  const black = new Color(0, 0, 0);
  for (let i = 0; i < glows.count; i++) {
    glows.setMatrixAt(i, hidden.matrix);
    glows.setColorAt(i, black);
  }

  const UP = new Vector3(0, 1, 0);
  const dir = new Vector3();
  const quat = new Quaternion();
  const pos = new Vector3();
  const scl = new Vector3();
  const col = new Color();
  const pose: DronePose = { x: 0, y: 0, z: 0, heading: 0 };

  function setGlow(i: number, x: number, y: number, z: number, size: number, c: Color, k: number) {
    if (k <= 0.002 || size <= 0) {
      glows.setMatrixAt(i, hidden.matrix);
      return;
    }
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(size);
    dummy.updateMatrix();
    glows.setMatrixAt(i, dummy.matrix);
    glows.setColorAt(i, col.copy(c).multiplyScalar(k));
  }

  let presence = 0;
  let lastTime: number | null = null;

  return {
    group,
    update(s) {
      // Fade in/out over about a second. A frozen or rewound clock still fades (nominal frame).
      const raw = lastTime === null ? 0 : s.time - lastTime;
      const dt = raw > 0 ? Math.min(raw, 0.1) : 1 / 60;
      lastTime = s.time;
      presence = approach(presence, s.active ? 1 : 0, dt, FADE_RATE);
      const burst = clamp01(s.burst);
      const on = presence > 0.001;
      group.visible = on || burst > 0;
      if (!group.visible) return;

      const rm = s.reducedMotion;
      const t = Number.isFinite(s.time) ? s.time : 0;
      const h = Math.max(0, Number.isFinite(s.height) ? s.height : 0);

      // Beams rise as they fade in (not with reduced motion) and sweep slowly.
      beams.visible = on;
      pool.visible = on;
      drones.visible = on;
      crowd.visible = on;
      if (on) {
        const length = beamLength(h) * (rm ? 1 : 0.3 + 0.7 * Math.sqrt(presence));
        const width = 0.9 + beamLength(h) * 0.02;
        lamps.forEach((lamp, i) => {
          beamDirection(beamAim(lamp.angle, i, t, rm), dir);
          quat.setFromUnitVectors(UP, dir);
          pos.set(lamp.x, LAMP_Y, lamp.z);
          scl.set(width, length, width);
          dummy.matrix.compose(pos, quat, scl);
          beams.setMatrixAt(i, dummy.matrix);
        });
        beams.instanceMatrix.needsUpdate = true;
        beamMat.uniforms.uIntensity!.value = BEAM_INTENSITY * presence;
        beamMat.uniforms.uTime!.value = rm ? 0 : t;
        poolMat.uniforms.uAlpha!.value = presence;

        // Drones rise from the crown as the show starts, then circle it.
        const lift = rm ? 0 : (1 - presence) * 2;
        drones.count = nDrones;
        for (let i = 0; i < nDrones; i++) {
          dronePose(i, nDrones, fp, h, t, rm, pose);
          dummy.position.set(pose.x, pose.y - lift, pose.z);
          dummy.rotation.set(0, pose.heading, 0);
          dummy.scale.setScalar(presence);
          dummy.updateMatrix();
          drones.setMatrixAt(i, dummy.matrix);
          // Aviation-style lights: a slow red beacon under, a short white strobe on top.
          const beacon = rm ? 0.8 : 0.25 + 0.9 * blink(t, 1.1, 0.5, hash01(i + 3));
          const flash = rm ? 0.45 : 1.5 * blink(t, 1.4, 0.1, hash01(i + 53));
          setGlow(
            LIGHT0 + i * 2,
            pose.x,
            pose.y - lift - 0.05,
            pose.z,
            0.2,
            red,
            beacon * presence,
          );
          setGlow(
            LIGHT0 + i * 2 + 1,
            pose.x,
            pose.y - lift + 0.06,
            pose.z,
            0.24,
            strobe,
            flash * presence,
          );
        }
        drones.instanceMatrix.needsUpdate = true;

        // The crowd gathers (and disperses) with the fade; a few hop now and then.
        const shown = Math.ceil(figures.length * presence);
        crowd.count = shown;
        for (let i = 0; i < shown; i++) {
          const f = figures[i]!;
          dummy.position.set(f.x, CROWD_Y + crowdHop(t, f.phase, rm), f.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, f.scale, 1);
          dummy.updateMatrix();
          crowd.setMatrixAt(i, dummy.matrix);
        }
        crowd.instanceMatrix.needsUpdate = true;

        lamps.forEach((lamp, i) =>
          setGlow(LAMP0 + i, lamp.x, 0.5, lamp.z, 0.6, lampColor, 1.1 * presence),
        );
      } else {
        for (let i = LAMP0; i < glows.count; i++) glows.setMatrixAt(i, hidden.matrix);
      }

      // Burst: a brief crown flash and a ring of light running out over the ground.
      const flashK = crownFlash(burst, rm);
      const flashSize = fp * 1.7 * (rm ? 1 : 0.8 + 0.5 * (1 - burst));
      setGlow(FLASH, 0, h + 1.6, 0, flashSize, flashColor, flashK);
      glows.instanceMatrix.needsUpdate = true;
      if (glows.instanceColor) glows.instanceColor.needsUpdate = true;

      const shape = burstRing(burst, fp, rm);
      ring.visible = shape.alpha > 0.002;
      if (ring.visible) {
        const outer = shape.radius + shape.width * 2.5;
        ring.scale.set(outer, 1, outer);
        ringMat.uniforms.uR!.value = shape.radius / outer;
        ringMat.uniforms.uW!.value = shape.width / outer;
        ringMat.uniforms.uAlpha!.value = shape.alpha;
      }
    },
    dispose() {
      group.visible = false;
      instanced.forEach((m) => m.dispose());
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
