/**
 * Office floors: a cutaway of three floors inside the tower. Desks fill with
 * people as load and local office hours rise; desk hardware upgrades with
 * load tier (boxy monitors → flat screens → holographic panels); screens
 * flicker faster at peak traffic. A visual scale — not a staff count.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  type Material,
} from 'three';
import { deskTier } from '../scale';

export interface OfficeState {
  load: number;
  occupancy: number;
  activity: number;
  time: number;
}

export interface Offices {
  readonly group: Group;
  update(s: OfficeState): void;
  dispose(): void;
}

const FLOORS = 3;
const FLOOR_GAP = 2.6;
const DESK_DX = 1.25;
const DESK_DZ = 1.6;
const SHIRTS = ['#5f7fb8', '#b86a5f', '#6fa88a', '#c9a45a', '#8a6fb0', '#4f9fb0', '#b0b7c6'];

function hash(n: number): number {
  const x = Math.sin(n * 91.7 + 17.3) * 43758.5453;
  return x - Math.floor(x);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * @param half half-extents (x, z) of the tower body at ground level — the
 *             floors are cut to fit inside it.
 */
export function createOffices(half: { x: number; z: number }, accent: string): Offices {
  const group = new Group();
  const materials: Material[] = [];
  const hx = Math.max(1.6, half.x * 0.94);
  const hz = Math.max(1.6, half.z * 0.94);
  const cols = clamp(Math.floor((2 * hx - 0.7) / DESK_DX) + 1, 2, 8);
  const rows = clamp(Math.floor((2 * hz - 0.9) / DESK_DZ) + 1, 1, 5);
  const perFloor = cols * rows;
  const desksTotal = FLOORS * perFloor;
  const dummy = new Object3D();

  const plateMat = new MeshStandardMaterial({ color: '#2b3346', roughness: 0.85 });
  const edgeMat = new LineBasicMaterial({ color: accent, transparent: true, opacity: 0.7 });
  const deskMat = new MeshStandardMaterial({ color: '#59606e', roughness: 0.6 });
  const bodyMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 });
  const headMat = new MeshStandardMaterial({ color: '#d9b49a', roughness: 0.6 });
  const crtMat = new MeshStandardMaterial({
    color: '#8f8a7e',
    emissive: '#b8f5c8',
    emissiveIntensity: 0.35,
  });
  const flatMat = new MeshStandardMaterial({
    color: '#0b0e14',
    emissive: '#9cc2ff',
    emissiveIntensity: 0.55,
  });
  const holoMat = new MeshBasicMaterial({
    color: new Color(accent),
    transparent: true,
    opacity: 0.45,
    blending: AdditiveBlending,
    side: DoubleSide,
    depthWrite: false,
  });
  materials.push(plateMat, edgeMat, deskMat, bodyMat, headMat, crtMat, flatMat, holoMat);

  const plateGeo = new BoxGeometry(hx * 2, 0.12, hz * 2);
  const edgeGeo = new EdgesGeometry(plateGeo);
  for (let f = 0; f < FLOORS; f++) {
    const plate = new Mesh(plateGeo, plateMat);
    plate.position.y = 0.6 + f * FLOOR_GAP;
    const edge = new LineSegments(edgeGeo, edgeMat);
    edge.position.copy(plate.position);
    group.add(plate, edge);
  }

  const desks = new InstancedMesh(new BoxGeometry(0.9, 0.06, 0.5), deskMat, desksTotal);
  const bodies = new InstancedMesh(new CapsuleGeometry(0.13, 0.32, 3, 8), bodyMat, desksTotal);
  const heads = new InstancedMesh(new SphereGeometry(0.11, 10, 8), headMat, desksTotal);
  const crt = new InstancedMesh(new BoxGeometry(0.34, 0.3, 0.3), crtMat, desksTotal);
  const flat = new InstancedMesh(new BoxGeometry(0.62, 0.24, 0.03), flatMat, desksTotal);
  const holo = new InstancedMesh(new PlaneGeometry(0.8, 0.42), holoMat, desksTotal);
  group.add(desks, bodies, heads, crt, flat, holo);

  // Desks face +z (towards the camera in the offices view): screens in front, people behind.
  const seats: { x: number; y: number; z: number }[] = [];
  for (let f = 0; f < FLOORS; f++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = cols === 1 ? 0 : -hx + 0.55 + (c / (cols - 1)) * (2 * hx - 1.1);
        const z = rows === 1 ? 0 : -hz + 0.75 + (r / (rows - 1)) * (2 * hz - 1.3);
        seats.push({ x, y: 0.66 + f * FLOOR_GAP, z });
      }
    }
  }
  const shirt = new Color();
  seats.forEach((s, i) => {
    dummy.position.set(s.x, s.y + 0.72, s.z);
    dummy.updateMatrix();
    desks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(s.x, s.y + 0.92, s.z + 0.08);
    dummy.updateMatrix();
    crt.setMatrixAt(i, dummy.matrix);
    dummy.position.set(s.x, s.y + 0.95, s.z + 0.14);
    dummy.updateMatrix();
    flat.setMatrixAt(i, dummy.matrix);
    dummy.position.set(s.x, s.y + 1.2, s.z + 0.18);
    dummy.updateMatrix();
    holo.setMatrixAt(i, dummy.matrix);
    bodies.setColorAt(i, shirt.set(SHIRTS[i % SHIRTS.length]!));
  });
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;

  let lastTier = -1;
  return {
    group,
    update(s) {
      const tier = deskTier(s.load);
      if (tier !== lastTier) {
        lastTier = tier;
        crt.visible = tier === 0;
        flat.visible = tier === 1;
        holo.visible = tier === 2;
      }
      const share = Math.min(1, (0.3 + 0.7 * s.load) * s.occupancy);
      // Screens flicker faster at peak traffic ("typing faster").
      const flicker = 0.85 + 0.15 * Math.sin(s.time * (3 + s.activity * 9));
      flatMat.emissiveIntensity = 0.55 * flicker;
      crtMat.emissiveIntensity = 0.35 * flicker;
      holoMat.opacity = 0.38 + 0.12 * flicker;
      let n = 0;
      for (let i = 0; i < seats.length; i++) {
        if (hash(i) > share) continue;
        const seat = seats[i]!;
        const bob = Math.sin(s.time * (4 + s.activity * 6) + i) * 0.015;
        dummy.position.set(seat.x, seat.y + 0.62 + bob, seat.z - 0.42);
        dummy.updateMatrix();
        bodies.setMatrixAt(n, dummy.matrix);
        if (bodies.instanceColor) bodies.setColorAt(n, shirt.set(SHIRTS[i % SHIRTS.length]!));
        dummy.position.set(seat.x, seat.y + 0.98 + bob, seat.z - 0.42);
        dummy.updateMatrix();
        heads.setMatrixAt(n, dummy.matrix);
        n++;
      }
      bodies.count = heads.count = n;
      bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
      if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    },
    dispose() {
      group.traverse(
        (o) => (o instanceof Mesh || o instanceof LineSegments) && o.geometry.dispose(),
      );
      materials.forEach((m) => m.dispose());
    },
  };
}
