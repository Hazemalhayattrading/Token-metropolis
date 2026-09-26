/**
 * One HQ campus: the tower (typology) plus facilities that grow with load —
 * server halls whose LEDs blink with tokens/second, cooling towers with steam,
 * a substation feeding the tower, and delivery trucks on the service loop.
 */
import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Points,
  Raycaster,
  ShaderMaterial,
  type Side,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import type { Platform } from '../../data/schema';
import type { InteriorView } from '../interiors';
import type { Plot } from '../layout';
import {
  accentMaterial,
  facadeMaterial,
  hallMaterial,
  patternUniforms,
  plainMaterial,
  type PatternUniforms,
} from '../materials';
import { buildTypology, type TowerParts } from './typologies';

const MAX_HALLS = 6;
const MAX_COOLING = 4;
const MAX_TRUCKS = 8;

export interface CampusState {
  /** Target tower height (world units); the campus eases towards it. */
  height: number;
  /** Office occupancy 0..1 (lit windows). */
  lit: number;
  /** Local daylight 0..1 at the HQ. */
  daylight: number;
  /** Local hour at the HQ (for the colour of its light). */
  hour: number;
  /** Traffic intensity (1 = daily average). */
  activity: number;
  halls: number;
  cooling: number;
  trucks: number;
  /** Seconds, for cosmetic animation. */
  time: number;
  /** Seconds since last frame. */
  dt: number;
  /** How fast the height eases (1/s); default 5 (~0.6 s). */
  ease?: number;
}

export interface Campus {
  readonly id: string;
  readonly group: Group;
  /** Invisible box used for picking. */
  readonly hit: Mesh;
  /** World-space point just above the crown (for labels and camera framing). */
  readonly top: Vector3;
  readonly footprint: number;
  /** Half-extents (x, z) of the tower body's bounding box, for the office cutaway. */
  readonly bodyHalf: { x: number; z: number };
  /**
   * Whether a campus-local point lies inside the tower body when the tower is
   * `height` tall (ray-parity test against the body meshes). Used to cut the
   * office floors to the tower's real shape.
   */
  insideBody(x: number, y: number, z: number, height: number): boolean;
  /** Local-space anchors for the interiors (M4). */
  readonly anchors: { halls: Vector3; power: Vector3; lab: Vector3 };
  currentHeight: number;
  update(s: CampusState): void;
  setHighlight(on: boolean): void;
  /**
   * Make room for an interior: offices turn the tower to glass, the server
   * hall lifts the hall roofs away, the lab parks the trucks.
   */
  setInterior(view: InteriorView): void;
  dispose(): void;
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return h / 10;
}

function steamMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uRate: { value: 1 }, uColor: { value: new Color('#9fb4d8') } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uRate;
      varying float vLife;
      void main() {
        float life = fract(aSeed * 7.13 + uTime * 0.12 * uRate);
        vLife = life;
        vec3 p = position;
        p.y += life * 9.0;
        p.x += sin(aSeed * 40.0 + uTime * 0.6) * life * 1.6;
        p.z += cos(aSeed * 23.0) * life * 1.2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (60.0 + 160.0 * life) / -mv.z;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * (1.0 - vLife) * vLife * 0.8;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
}

export function createCampus(platform: Platform, plot: Plot): Campus {
  const { palette, motif } = platform.identity;
  const seed = seedOf(platform.id);

  const facadeU = patternUniforms(seed, '#ffd9a0', '#bcd6ff', 1.6);
  const hallU: PatternUniforms = patternUniforms(seed + 5, palette.accent, '#ff3b3b', 2.4);
  const facade = facadeMaterial({ color: palette.primary, uniforms: facadeU });
  const facadeAlt = facadeMaterial({ color: palette.secondary, uniforms: facadeU, roughness: 0.7 });
  const accent = accentMaterial(palette.accent, 1.6);
  const accentSoft = accentMaterial(palette.accent, 0.6);
  const dark = plainMaterial('#0d1018', 0.7, 0.3);
  const glass = new MeshStandardMaterial({ color: '#0a1428', roughness: 0.08, metalness: 0.9 });
  const materials: Material[] = [facade, facadeAlt, accent, accentSoft, dark, glass];

  const tower: TowerParts = buildTypology(motif, {
    facade,
    facadeAlt,
    accent,
    accentSoft,
    dark,
    glass,
    accentColor: palette.accent,
  });

  const bodyBox = new Box3().setFromObject(tower.body, true);
  const bodyHalf = {
    x: Math.max(Math.abs(bodyBox.min.x), Math.abs(bodyBox.max.x)),
    z: Math.max(Math.abs(bodyBox.min.z), Math.abs(bodyBox.max.z)),
  };

  const group = new Group();
  group.position.set(plot.x, 0, plot.z);
  group.rotation.y = plot.facing;
  group.add(tower.body, tower.crown, tower.base);

  // --- server halls (behind the tower) ------------------------------------
  const hallMat = hallMaterial('#161b26', hallU);
  materials.push(hallMat);
  const halls = new InstancedMesh(new BoxGeometry(3.4, 1.6, 5.2), hallMat, MAX_HALLS);
  const dummy = new Object3D();
  for (let i = 0; i < MAX_HALLS; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    dummy.position.set(-4.2 + col * 4.2, 0.8, -tower.footprint - 5 - row * 6);
    dummy.updateMatrix();
    halls.setMatrixAt(i, dummy.matrix);
  }
  halls.count = 0;
  group.add(halls);

  // --- cooling towers + steam (to the side) --------------------------------
  const lathe: Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const y = i / 12;
    lathe.push(new Vector2(1.5 - 0.55 * Math.sin(Math.PI * y * 0.85), y * 4.2));
  }
  const coolGeo = new LatheGeometry(lathe, 24);
  const coolMat = new MeshStandardMaterial({
    color: '#5b6474',
    emissive: '#1b2130',
    roughness: 0.9,
  });
  materials.push(coolMat);
  const cooling = new InstancedMesh(coolGeo, coolMat, MAX_COOLING);
  // A lit lip on each tower so they read at night.
  const lipGeo = new TorusGeometry(1.1, 0.07, 6, 32);
  lipGeo.rotateX(Math.PI / 2);
  lipGeo.translate(0, 4.2, 0);
  const lips = new InstancedMesh(lipGeo, accentSoft, MAX_COOLING);
  const coolPos: Vector3[] = [];
  for (let i = 0; i < MAX_COOLING; i++) {
    const p = new Vector3(tower.footprint + 5.5 + (i % 2) * 3.4, 0, -2 - Math.floor(i / 2) * 3.6);
    coolPos.push(p);
    dummy.position.copy(p);
    dummy.updateMatrix();
    cooling.setMatrixAt(i, dummy.matrix);
    lips.setMatrixAt(i, dummy.matrix);
  }
  cooling.count = lips.count = 0;
  group.add(cooling, lips);

  const steamMat = steamMaterial();
  materials.push(steamMat);
  const puffsPer = 14;
  const steamPos: number[] = [];
  const steamSeed: number[] = [];
  for (let i = 0; i < MAX_COOLING; i++) {
    for (let j = 0; j < puffsPer; j++) {
      const c = coolPos[i]!;
      steamPos.push(
        c.x + (hash(i * 50 + j) - 0.5) * 1.2,
        4.3,
        c.z + (hash(i * 70 + j) - 0.5) * 1.2,
      );
      steamSeed.push(hash(i * 13 + j * 7 + seed));
    }
  }
  const steamGeo = new BufferGeometry();
  steamGeo.setAttribute('position', new Float32BufferAttribute(steamPos, 3));
  steamGeo.setAttribute('aSeed', new Float32BufferAttribute(steamSeed, 1));
  const steam = new Points(steamGeo, steamMat);
  steam.frustumCulled = false;
  group.add(steam);

  // --- substation + feeder line (beside the cooling towers) ------------------
  const sub = new Group();
  const subMat = plainMaterial('#2a303c', 0.6, 0.5);
  materials.push(subMat);
  const subZ = 3.4;
  const capGeo = new BoxGeometry(0.5, 0.08, 0.5);
  for (let i = 0; i < 3; i++) {
    const tr = new Mesh(new BoxGeometry(1.1, 1.3, 1.1), subMat);
    tr.position.set(tower.footprint + 4.6 + i * 1.6, 0.65, subZ);
    const cap = new Mesh(capGeo, accentSoft);
    cap.position.set(tr.position.x, 1.34, subZ);
    sub.add(tr, cap);
  }
  const feederMat = new MeshBasicMaterial({
    color: palette.accent,
    transparent: true,
    opacity: 0.8,
  });
  materials.push(feederMat);
  const feederFrom = tower.footprint * 0.55;
  const feederTo = tower.footprint + 4;
  const feeder = new Mesh(new BoxGeometry(feederTo - feederFrom, 0.08, 0.08), feederMat);
  feeder.position.set((feederFrom + feederTo) / 2, 1.4, subZ);
  sub.add(feeder);
  group.add(sub);

  // --- trucks on the service loop -------------------------------------------
  const truckMat = new MeshStandardMaterial({
    color: '#2c323e',
    emissive: '#ff9d4d',
    emissiveIntensity: 0.3,
    roughness: 0.5,
  });
  materials.push(truckMat);
  const trucks = new InstancedMesh(new BoxGeometry(0.55, 0.45, 1.25), truckMat, MAX_TRUCKS);
  trucks.count = 0;
  group.add(trucks);
  const loopR = tower.footprint + 9.5;

  // --- local sunlight: a soft pool of light on the plot during the HQ's daytime ---
  const sunMat = new MeshBasicMaterial({
    color: '#fff1d6',
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  materials.push(sunMat);
  const sun = new Mesh(new CircleGeometry(tower.footprint + 8, 48), sunMat);
  sun.rotation.x = -Math.PI / 2;
  sun.position.y = 0.06;
  sun.renderOrder = 2;
  group.add(sun);
  const dawn = new Color('#ffb27a');
  const noon = new Color('#fff4e0');
  const dusk = new Color('#ff9a8a');

  // --- picking box & label anchor -------------------------------------------
  const hit = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ visible: false }));
  hit.userData.platformId = platform.id;
  group.add(hit);
  const top = new Vector3();

  let currentHeight = 0;
  let interior: InteriorView = 'overview';
  const towerMaterials = [facade, facadeAlt, accent, accentSoft, dark, glass];
  const probe = new Raycaster();
  const probeOrigin = new Vector3();
  const probeDir = new Vector3();
  let highlight = 0;
  let highlightTarget = 0;

  const campus: Campus = {
    id: platform.id,
    group,
    hit,
    top,
    footprint: tower.footprint,
    bodyHalf,
    anchors: {
      halls: new Vector3(0, 0, -tower.footprint - 8),
      power: new Vector3(tower.footprint + 6.5, 0, -0.8),
      lab: new Vector3(0, 0, tower.footprint + 7),
    },
    get currentHeight() {
      return currentHeight;
    },
    set currentHeight(v: number) {
      currentHeight = v;
    },
    update(s) {
      // Ease towards the target height (frame-rate independent, ~0.6 s).
      const k = 1 - Math.exp(-s.dt * (s.ease ?? 5));
      currentHeight +=
        (s.height - currentHeight) * (Math.abs(s.height - currentHeight) < 0.01 ? 1 : k);
      const h = Math.max(currentHeight, 0.001);
      const exists = s.height > 0 || currentHeight > 0.05;
      group.visible = exists;
      tower.body.scale.y = h;
      tower.crown.position.y = h;
      tower.animate?.(s.time, h);

      // Dawn and dusk tint the light warm; midday is pale.
      const warm =
        s.hour < 12
          ? Math.max(0, 1 - Math.abs(s.hour - 7) / 2.5)
          : Math.max(0, 1 - Math.abs(s.hour - 18.5) / 2.5);
      sunMat.color.copy(noon).lerp(s.hour < 12 ? dawn : dusk, warm);
      sunMat.opacity = Math.max(s.daylight, warm * 0.6) * 0.05;
      sun.visible = sunMat.opacity > 0.002;

      facadeU.uLit.value = s.lit;
      facadeU.uDaylight.value = s.daylight;
      facadeU.uTime.value = s.time;
      hallU.uActivity.value = Math.min(1, s.activity * 0.6);
      hallU.uTime.value = s.time;
      steamMat.uniforms.uTime!.value = s.time;
      steamMat.uniforms.uRate!.value = 0.6 + s.activity * 0.6;

      halls.count = interior === 'hall' ? 0 : Math.min(MAX_HALLS, s.halls);
      cooling.count = lips.count = Math.min(MAX_COOLING, s.cooling);
      steamGeo.setDrawRange(0, Math.min(MAX_COOLING, s.cooling) * puffsPer);
      sub.visible = s.halls > 0;

      // Trucks: evenly spaced around a loop, speed follows traffic.
      const n = interior === 'lab' ? 0 : Math.min(MAX_TRUCKS, s.trucks);
      trucks.count = n;
      for (let i = 0; i < n; i++) {
        const a = (i / Math.max(n, 1)) * Math.PI * 2 + s.time * 0.05 * (0.6 + s.activity * 0.5);
        dummy.position.set(Math.cos(a) * loopR, 0.23, Math.sin(a) * loopR);
        dummy.rotation.set(0, -a, 0);
        dummy.updateMatrix();
        trucks.setMatrixAt(i, dummy.matrix);
      }
      trucks.instanceMatrix.needsUpdate = true;

      highlight += (highlightTarget - highlight) * k;
      // Inside an interior the campus trims dim so they don't glare next to the camera.
      accent.emissiveIntensity = interior === 'overview' ? 1.6 + highlight * 1.6 : 0.45;
      // The feeder line pulses with traffic.
      feederMat.opacity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(s.time * (1.5 + s.activity * 3)));

      const pickH = Math.max(h + 4, 6);
      hit.scale.set(tower.footprint * 2 + 6, pickH, tower.footprint * 2 + 6);
      hit.position.set(0, pickH / 2, 0);
      top.set(0, h + 5, 0);
      group.localToWorld(top);
    },
    insideBody(x, y, z, height) {
      // Temporarily set the body to `height`, make every face hit-testable from inside,
      // cast a ray along local +x and count crossings. Restored before returning.
      const sides: Side[] = towerMaterials.map((m) => m.side);
      const prevScale = tower.body.scale.y;
      towerMaterials.forEach((m) => (m.side = DoubleSide));
      tower.body.scale.y = Math.max(height, 0.001);
      group.updateMatrixWorld(true);
      probeOrigin.set(x, y, z);
      group.localToWorld(probeOrigin);
      probeDir.set(1, 0, 0).applyQuaternion(group.quaternion);
      probe.set(probeOrigin, probeDir);
      // Towers are unions of overlapping solids (core + skirts + fins), so parity is taken per
      // mesh: inside any one part means inside the tower.
      let inside = false;
      tower.body.traverse((o) => {
        if (inside || !(o instanceof Mesh)) return;
        const hits = probe.intersectObject(o, false);
        let crossings = 0;
        let last = -Infinity;
        for (const hit of hits) {
          if (hit.distance - last > 1e-4) crossings++; // shared edges report twice
          last = hit.distance;
        }
        if (crossings % 2 === 1) inside = true;
      });
      towerMaterials.forEach((m, i) => (m.side = sides[i] ?? FrontSide));
      tower.body.scale.y = prevScale;
      group.updateMatrixWorld(true);
      return inside;
    },
    setInterior(view) {
      if (view === interior) return;
      // Base parts (plazas, workshops, canopies) would cut through the office floors and
      // the hall diorama, so they step aside for those two views.
      tower.base.visible = view !== 'offices' && view !== 'hall';
      const wasGhost = interior === 'offices';
      interior = view;
      const ghost = view === 'offices';
      if (ghost === wasGhost) return;
      for (const m of towerMaterials) {
        m.transparent = ghost;
        m.opacity = ghost ? 0.16 : 1;
        m.depthWrite = !ghost;
        m.needsUpdate = true;
      }
    },
    setHighlight(on) {
      highlightTarget = on ? 1 : 0;
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof Mesh || o instanceof Points) o.geometry.dispose();
        if (o instanceof InstancedMesh) o.dispose();
      });
      materials.forEach((m) => m.dispose());
    },
  };
  return campus;
}
