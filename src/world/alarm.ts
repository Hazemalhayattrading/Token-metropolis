/**
 * Incident alarm in 3D (brief §5.3 item 6). While an HQ's official status page reports an
 * unresolved incident, rotating beacons on its crown (and, for major and critical incidents, on
 * its front plaza) sweep coloured light over the campus, and its window lights flicker: `flicker`
 * is a 0..1 multiplier the integrator applies to the campus's lit windows.
 *
 * Severity sets the look: maintenance turns slowly in a calm blue and never flickers; a minor
 * incident turns amber; major and critical incidents turn red and faster, with two more beacons on
 * the plaza that sweep light over the ground.
 *
 * Cosmetic only — nothing here feeds a number. The flicker's irregularity comes from an integer
 * hash of short time slots (identical on every engine), never from Math.random().
 *
 * Photosensitivity: the windows dip at most once per slot and never in two slots in a row, so
 * there are never more than three flashes in any second (WCAG 2.3.1); a beacon flashes at most
 * once per second and is small on screen. Reduced motion: the beacons stand still, their glow is
 * steady and the flicker holds at REDUCED_FLICKER.
 *
 * Budget: three draw calls while visible (light blades, glows, ground sweep), no real lights (all
 * light is additive gradients) and no cost while idle (the group is hidden).
 *
 * Space: campus-local. Origin at the tower base centre, +y up, +z towards the city centre (the
 * front plaza). The crown sits at y = height.
 */
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Sphere,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type BufferGeometry,
  type IUniform,
  type Material,
} from 'three';
import { incidentSeverity } from '../state/incidents';
import { approach } from './launch';

// ---------------------------------------------------------------------------
// contract
// ---------------------------------------------------------------------------

export interface AlarmFxState {
  /** The HQ's status page reports an unresolved incident at the time shown. */
  active: boolean;
  /** incidentSeverity(impact): 1 maintenance · 2 minor · 3 major · 4 critical (below 1: no alarm). */
  severity: number;
  /** Seconds, for cosmetic animation. */
  time: number;
  /** Current tower height in world units (the crown sits at y = height). */
  height: number;
  reducedMotion: boolean;
}

export interface AlarmFx {
  readonly group: Group;
  /** 0..1 multiplier for the HQ's window lights (1 when there is no alarm). */
  readonly flicker: number;
  update(s: AlarmFxState): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// tuning
// ---------------------------------------------------------------------------

export type AlarmLevel = 'maintenance' | 'minor' | 'major' | 'critical';

export interface AlarmStyle {
  readonly color: string;
  /** Beacon rotation (turns per second); each beacon has two blades, so it flashes twice a turn. */
  readonly turns: number;
  /** Beacons lit: two on the crown, plus two on the plaza for major and critical incidents. */
  readonly beacons: 2 | 4;
  /** Peak additive intensity of a light blade. */
  readonly blade: number;
  /** Brightness of a beacon head. */
  readonly glow: number;
  /** Window flicker: depth of the slow wander, chance of a dip per slot, dip depth range. */
  readonly wander: number;
  readonly dipChance: number;
  readonly dipDepth: readonly [number, number];
  /** Strength of the light swept over the plaza (0 = none). */
  readonly sweep: number;
}

export const ALARM_STYLES: Readonly<Record<AlarmLevel, AlarmStyle>> = {
  maintenance: {
    color: '#6f98ff',
    turns: 0.12,
    beacons: 2,
    blade: 0.13,
    glow: 0.75,
    wander: 0,
    dipChance: 0,
    dipDepth: [0, 0],
    sweep: 0,
  },
  minor: {
    color: '#ffa620',
    turns: 0.26,
    beacons: 2,
    blade: 0.24,
    glow: 1.15,
    wander: 0.1,
    dipChance: 0.35,
    dipDepth: [0.2, 0.35],
    sweep: 0,
  },
  major: {
    color: '#ff3b22',
    turns: 0.38,
    beacons: 4,
    blade: 0.3,
    glow: 1.35,
    wander: 0.15,
    dipChance: 0.45,
    dipDepth: [0.3, 0.5],
    sweep: 1,
  },
  critical: {
    color: '#ff1f2a',
    turns: 0.5,
    beacons: 4,
    blade: 0.34,
    glow: 1.5,
    wander: 0.2,
    dipChance: 0.5,
    dipDepth: [0.42, 0.56],
    sweep: 1.3,
  },
};

/** Window lights never drop below this share while flickering. */
export const FLICKER_MIN = 0.35;
/** The steady window-light share with reduced motion (maintenance keeps 1). */
export const REDUCED_FLICKER = 0.7;
/** Flicker time slot (seconds): at most one dip per slot, never in two slots in a row. */
export const FLICKER_SLOT = 0.3;
const DIP_MIN = 0.06;
const DIP_MAX = 0.16;
/** Crown beacons float this far above the top of the tower body (clear of most crowns). */
const CROWN_LIFT = 1;
/** Plaza beacons glow at lamp height, just beyond the tower's footprint on the front plaza. */
const BASE_Y = 0.55;
const BASE_OFFSET = 1;
const BASE_ANGLE = 0.55;
/** Ground effects float just above the flat plaza slabs of the typologies (tops ≤ 0.1). */
const GROUND_Y = 0.14;
/** Blade half-width at its far end, as a share of its length (a ~13° cone). */
const BLADE_SPREAD = 0.24;
/** Crown blades lean down over the city, plaza blades up off the ground (radians). */
const CROWN_TILT = 0.12;
const BASE_TILT = -0.1;
/** Fade in/out rate (1/s): ~95 % in one second. */
const FADE_RATE = 3;
/** How fast the colour follows a change of severity (1/s). */
const COLOR_RATE = 4;

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);

// ---------------------------------------------------------------------------
// pure helpers (unit-tested in src/state/incidents.test.ts)
// ---------------------------------------------------------------------------

/** The alarm look for a severity (incidentSeverity scale), or null below maintenance. */
export function alarmLevel(severity: number): AlarmLevel | null {
  if (!(severity >= incidentSeverity('maintenance'))) return null;
  if (severity >= incidentSeverity('critical')) return 'critical';
  if (severity >= incidentSeverity('major')) return 'major';
  if (severity >= incidentSeverity('minor')) return 'minor';
  return 'maintenance';
}

/** 32-bit integer mix (lowbias32): the same bits on every engine. */
function mix32(x: number): number {
  let h = x | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deterministic value in [0, 1) for an integer slot and a channel. */
export function slotHash(slot: number, channel: number): number {
  return mix32(mix32(slot) ^ Math.imul(channel + 1, 0x9e3779b9)) / 4294967296;
}

/** Smooth value noise in [0, 1). */
function valueNoise(x: number, channel: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return slotHash(i, channel) * (1 - u) + slotHash(i + 1, channel) * u;
}

/** Depth (0..1) of the window dip under way at `t`: one short dip in some slots, never two in a row. */
function dipDepth(t: number, s: AlarmStyle): number {
  const k = Math.floor(t / FLICKER_SLOT);
  const candidate = (slot: number) => slotHash(slot, 1) < s.dipChance;
  if (!candidate(k) || candidate(k - 1)) return 0;
  const length = DIP_MIN + (DIP_MAX - DIP_MIN) * slotHash(k, 2);
  const start = k * FLICKER_SLOT + (FLICKER_SLOT - length) * slotHash(k, 3);
  if (t < start || t >= start + length) return 0;
  return s.dipDepth[0] + (s.dipDepth[1] - s.dipDepth[0]) * slotHash(k, 4);
}

function flickerFor(level: AlarmLevel, time: number, reducedMotion: boolean): number {
  if (level === 'maintenance') return 1;
  if (reducedMotion) return REDUCED_FLICKER;
  const s = ALARM_STYLES[level];
  const t = finite(time, 0);
  const wander = 1 - s.wander * valueNoise(t * 0.9, 7);
  return clamp(wander * (1 - dipDepth(t, s)), FLICKER_MIN, 1);
}

/**
 * The window-light multiplier of an HQ in alarm at `time` seconds: an irregular brown-out (a slow
 * wander plus short dips) between FLICKER_MIN and 1. Maintenance and no alarm give 1; reduced
 * motion holds REDUCED_FLICKER. Deterministic: the same inputs always give the same value.
 */
export function alarmFlicker(time: number, severity: number, reducedMotion: boolean): number {
  const level = alarmLevel(severity);
  return level ? flickerFor(level, time, reducedMotion) : 1;
}

export interface Beacon {
  readonly on: 'crown' | 'base';
  readonly x: number;
  /** Above the top of the tower body (crown) or above the ground (base). */
  readonly y: number;
  readonly z: number;
  /** Angle of the first blade at rest (radians, from +z towards +x); the second is opposite. */
  readonly phase: number;
  readonly spin: 1 | -1;
  /** Glow size and blade length (world units). */
  readonly size: number;
  readonly reach: number;
}

const DIAGONAL = Math.SQRT1_2;

/**
 * Where the beacons stand: two on the crown at opposite corners, then two on the front plaza just
 * beyond the tower's footprint (lit only for major and critical incidents).
 */
export function beaconLayout(footprint: number): Beacon[] {
  const fp = clamp(finite(footprint, 5), 1, 20);
  const rc = clamp(fp * 0.42, 1.6, 3);
  const crownSize = clamp(fp * 0.36, 1.7, 2.8);
  const crownReach = clamp(fp * 2.8, 13, 20);
  const rb = fp + BASE_OFFSET;
  const bx = Math.sin(BASE_ANGLE) * rb;
  const bz = Math.cos(BASE_ANGLE) * rb;
  const baseReach = clamp(fp * 1.3, 5.5, 9);
  const baseSize = 1.15;
  return [
    {
      on: 'crown',
      x: rc * DIAGONAL,
      y: CROWN_LIFT,
      z: rc * DIAGONAL,
      phase: 0.4,
      spin: 1,
      size: crownSize,
      reach: crownReach,
    },
    {
      on: 'crown',
      x: -rc * DIAGONAL,
      y: CROWN_LIFT,
      z: -rc * DIAGONAL,
      phase: 2.1,
      spin: 1,
      size: crownSize,
      reach: crownReach,
    },
    { on: 'base', x: bx, y: BASE_Y, z: bz, phase: 1.2, spin: -1, size: baseSize, reach: baseReach },
    { on: 'base', x: -bx, y: BASE_Y, z: bz, phase: 2.9, spin: 1, size: baseSize, reach: baseReach },
  ];
}

// ---------------------------------------------------------------------------
// shaders
// ---------------------------------------------------------------------------

/** Fog for additive light: attenuate towards black instead of mixing towards the fog colour. */
const FOG_FACTOR = /* glsl */ `
  float alarmFogFactor() {
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

/** A light blade: an open cone from the lamp, bright at the lamp and along the axis, fading out. */
function bladeMaterial(color: Color): ShaderMaterial {
  return additive(
    { uColor: { value: color }, uIntensity: { value: 0 } },
    /* glsl */ `
      #include <fog_pars_vertex>
      varying float vAlong;
      varying float vFacing;
      void main() {
        vec3 s = max(vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz),
          length(instanceMatrix[2].xyz)), vec3(1e-4));
        mat4 m = modelMatrix * instanceMatrix;
        vec4 world = m * vec4(position, 1.0);
        vec3 n = normalize(mat3(m) * (normal / (s * s)));
        vFacing = abs(dot(n, normalize(cameraPosition - world.xyz)));
        vAlong = position.z;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uColor;
      uniform float uIntensity;
      varying float vAlong;
      varying float vFacing;
      ${FOG_FACTOR}
      void main() {
        float body = pow(vFacing, 1.4);
        float fall = pow(1.0 - vAlong, 1.6) * smoothstep(0.0, 0.06, vAlong);
        // Alarms stay readable across the island, so fog only dims them partly.
        float a = body * fall * uIntensity * mix(0.5, 1.0, alarmFogFactor());
        gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.2 * (1.0 - vAlong)), a);
      }
    `,
    true,
  );
}

/**
 * Beacon heads: camera-facing soft glows, one quad per instance (position and size from the
 * instance matrix, colour × brightness from the instance colour). Each flares briefly as one of its
 * blades (angle `aAngle`) sweeps past the camera — the look of a rotating beacon.
 */
function glowMaterial(): ShaderMaterial {
  return additive(
    { uFlash: { value: 1 } },
    /* glsl */ `
      #include <fog_pars_vertex>
      attribute float aAngle;
      uniform float uFlash;
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vUv = position.xy;
        float size = length(instanceMatrix[0].xyz);
        vec4 world = modelMatrix * vec4(instanceMatrix[3].xyz, 1.0);
        vec3 toCam = cameraPosition - world.xyz;
        float dist = max(length(toCam), 1e-3);
        vec3 blade = mat3(modelMatrix) * vec3(sin(aAngle), 0.0, cos(aAngle));
        vec2 bh = normalize(blade.xz);
        float ch = length(toCam.xz);
        float facing = ch > 1e-3 ? abs(dot(bh, toCam.xz / ch)) : 0.0;
        float flash = uFlash * pow(facing, 16.0) * mix(1.0, 0.4, abs(toCam.y) / dist);
        vec4 mvPosition = viewMatrix * world;
        // Never smaller than a few pixels' worth, so an alarm reads from across the island.
        float s = max(size, -mvPosition.z * 0.016) * (1.0 + 0.45 * flash);
        // Pull the quad towards the camera so nearby geometry does not slice it.
        float pull = clamp(min(s * 0.6, -mvPosition.z * 0.5), 0.0, 4.0);
        mvPosition.xyz += normalize(-mvPosition.xyz) * pull;
        mvPosition.xy += position.xy * s;
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor * (1.0 + 1.6 * flash);
        #else
          vColor = vec3(1.0 + 1.6 * flash);
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
        float glow = (exp(-d2 * 20.0) + 0.3 * exp(-d2 * 4.5)) * (1.0 - d2);
        gl_FragColor = vec4(vColor * alarmFogFactor(), glow);
      }
    `,
  );
}

/** Light swept over the plaza by the two plaza beacons: two opposite fans each, and a soft pool. */
function sweepMaterial(
  color: Color,
  beacons: Vector4,
  bounds: Vector4,
  reach: number,
): ShaderMaterial {
  return additive(
    {
      uColor: { value: color },
      uAlpha: { value: 0 },
      uBeacons: { value: beacons },
      uAngles: { value: new Vector2() },
      uReach: { value: reach },
      uBounds: { value: bounds },
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
      uniform vec4 uBeacons; // x0, z0, x1, z1
      uniform vec2 uAngles;
      uniform float uReach;
      uniform vec4 uBounds; // xMin, xMax, zMin, zMax
      varying vec2 vLocal;
      ${FOG_FACTOR}
      float lobe(vec2 q, float a) {
        float d = length(q);
        float c = dot(q, vec2(sin(a), cos(a))) / max(d, 1e-3);
        float fan = pow(max(c, 0.0), 10.0) + pow(max(-c, 0.0), 10.0);
        float fall = exp(-d * d / (uReach * uReach * 0.35));
        return fan * fall * smoothstep(0.15, 0.9, d) + exp(-d * d * 2.5) * 0.6;
      }
      void main() {
        float l = lobe(vLocal - uBeacons.xy, uAngles.x) + lobe(vLocal - uBeacons.zw, uAngles.y);
        float edge = min(min(vLocal.x - uBounds.x, uBounds.y - vLocal.x),
          min(vLocal.y - uBounds.z, uBounds.w - vLocal.y));
        float a = l * 0.3 * smoothstep(0.0, 1.0, edge) * uAlpha * alarmFogFactor();
        gl_FragColor = vec4(uColor, a);
      }
    `,
  );
}

// ---------------------------------------------------------------------------
// the effect
// ---------------------------------------------------------------------------

export function createAlarmFx(opts: { footprint: number }): AlarmFx {
  const fp = clamp(finite(opts.footprint, 5), 1, 20);
  const beacons = beaconLayout(fp);
  const crownReach = beacons[0]!.reach;
  const base = beacons.filter((b) => b.on === 'base');
  const baseReach = base[0]!.reach;

  const group = new Group();
  group.name = 'alarm-fx';
  group.visible = false;

  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  /** The alarm colour shown now (it eases towards the colour of a new severity); shared by all parts. */
  const current = new Color(ALARM_STYLES.minor.color);

  // One conservative bounding sphere (campus-local) for the blades and glows, so an alarm
  // off-screen is culled; refreshed when the tower height changes.
  const cullSphere = new Sphere(new Vector3(), fp + crownReach);
  let cullHeight = -1;

  // --- 1. light blades: two opposite blades per beacon ---------------------------
  const bladeGeo = new ConeGeometry(1, 1, 18, 1, true);
  bladeGeo.translate(0, -0.5, 0); // apex at the origin, open end at y = -1 …
  bladeGeo.rotateX(-Math.PI / 2); // … turned to open along +z (unit length)
  const bladeMat = bladeMaterial(current);
  const blades = new InstancedMesh(bladeGeo, bladeMat, beacons.length * 2);
  blades.boundingSphere = cullSphere;
  blades.renderOrder = 5;
  blades.count = 0;

  // --- 2. beacon heads -----------------------------------------------------------
  const glowGeo = new PlaneGeometry(2, 2);
  const angles = new InstancedBufferAttribute(new Float32Array(beacons.length), 1);
  glowGeo.setAttribute('aAngle', angles);
  const glowMat = glowMaterial();
  const glows = new InstancedMesh(glowGeo, glowMat, beacons.length);
  glows.boundingSphere = cullSphere;
  glows.renderOrder = 6;
  const black = new Color(0, 0, 0);
  for (let i = 0; i < beacons.length; i++) glows.setColorAt(i, black); // compile with colours
  glows.count = 0;

  // --- 3. light swept over the plaza --------------------------------------------------
  const b0 = base[0]!;
  const b1 = base[1]!;
  const bounds = new Vector4(
    Math.min(b0.x, b1.x) - baseReach,
    Math.max(b0.x, b1.x) + baseReach,
    Math.min(b0.z, b1.z) - baseReach,
    Math.max(b0.z, b1.z) + baseReach,
  );
  const sweepGeo = new PlaneGeometry(bounds.y - bounds.x, bounds.w - bounds.z);
  sweepGeo.rotateX(-Math.PI / 2);
  sweepGeo.translate((bounds.x + bounds.y) / 2, GROUND_Y, (bounds.z + bounds.w) / 2);
  const sweepMat = sweepMaterial(current, new Vector4(b0.x, b0.z, b1.x, b1.z), bounds, baseReach);
  const sweep = new Mesh(sweepGeo, sweepMat);
  sweep.renderOrder = 3;
  sweep.visible = false;

  blades.name = 'alarm-blades';
  glows.name = 'alarm-glows';
  sweep.name = 'alarm-sweep';
  group.add(sweep, blades, glows);
  geometries.push(bladeGeo, glowGeo, sweepGeo);
  materials.push(bladeMat, glowMat, sweepMat);

  const dummy = new Object3D();
  const euler = new Euler(0, 0, 0, 'YXZ');
  const quat = new Quaternion();
  const pos = new Vector3();
  const scl = new Vector3();
  const white = new Color(1, 1, 1);
  const target = new Color();
  const glowColor = new Color();

  let presence = 0;
  let level: AlarmLevel = 'minor';
  let spun = 0;
  let flicker = 1;
  let lastTime: number | null = null;

  return {
    group,
    get flicker() {
      return flicker;
    },
    update(s) {
      // Fade in/out over about a second. A frozen or rewound clock still fades (nominal frame).
      const raw = lastTime === null ? 0 : s.time - lastTime;
      const dt = raw > 0 ? Math.min(raw, 0.1) : 1 / 60;
      lastTime = s.time;
      const next = s.active ? alarmLevel(s.severity) : null;
      const fresh = presence <= 0.001;
      if (next) level = next; // keep the last look while fading out
      presence = approach(presence, next ? 1 : 0, dt, FADE_RATE);
      group.visible = presence > 0.001;
      if (!group.visible) {
        flicker = 1;
        return;
      }

      const style = ALARM_STYLES[level];
      const rm = s.reducedMotion;
      const t = finite(s.time, 0);
      const h = Math.max(0, finite(s.height, 0));
      flicker = 1 - presence * (1 - flickerFor(level, t, rm));

      target.set(style.color);
      if (fresh) current.copy(target);
      else current.lerp(target, 1 - Math.exp(-dt * COLOR_RATE));
      // One shared, wrapped rotation; with reduced motion the beacons stand still.
      if (!rm) spun = (spun + TAU * style.turns * dt) % TAU;

      if (Math.abs(h - cullHeight) > 0.5) {
        cullHeight = h;
        const top = h + CROWN_LIFT + 3;
        cullSphere.center.set(0, top / 2, 0);
        cullSphere.radius = Math.hypot(fp + BASE_OFFSET + crownReach + 2, top / 2 + 2);
      }

      // Blades and heads: the crown pair always, the plaza pair for major and critical.
      const n = style.beacons;
      glowColor
        .copy(current)
        .lerp(white, 0.18)
        .multiplyScalar(style.glow * presence);
      for (let i = 0; i < n; i++) {
        const b = beacons[i]!;
        const angle = b.phase + b.spin * spun;
        const y = b.on === 'crown' ? h + b.y : b.y;
        const tilt = b.on === 'crown' ? CROWN_TILT : BASE_TILT;
        const width = b.reach * BLADE_SPREAD;
        pos.set(b.x, y, b.z);
        scl.set(width, width, b.reach);
        for (let k = 0; k < 2; k++) {
          quat.setFromEuler(euler.set(tilt, angle + k * Math.PI, 0));
          dummy.matrix.compose(pos, quat, scl);
          blades.setMatrixAt(i * 2 + k, dummy.matrix);
        }
        dummy.position.copy(pos);
        dummy.quaternion.identity();
        dummy.scale.setScalar(b.size);
        dummy.updateMatrix();
        glows.setMatrixAt(i, dummy.matrix);
        glows.setColorAt(i, glowColor);
        angles.setX(i, angle);
      }
      blades.count = n * 2;
      glows.count = n;
      blades.instanceMatrix.needsUpdate = true;
      glows.instanceMatrix.needsUpdate = true;
      if (glows.instanceColor) glows.instanceColor.needsUpdate = true;
      angles.needsUpdate = true;
      bladeMat.uniforms.uIntensity!.value = style.blade * presence;
      glowMat.uniforms.uFlash!.value = rm ? 0 : 1;

      sweep.visible = style.sweep > 0;
      if (sweep.visible) {
        sweepMat.uniforms.uAlpha!.value = style.sweep * presence;
        (sweepMat.uniforms.uAngles!.value as Vector2).set(
          b0.phase + b0.spin * spun,
          b1.phase + b1.spin * spun,
        );
      }
    },
    dispose() {
      group.visible = false;
      flicker = 1;
      blades.dispose();
      glows.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
