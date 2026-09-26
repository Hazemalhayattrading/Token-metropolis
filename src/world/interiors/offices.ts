/**
 * Office floors: a cutaway of three floors inside the tower. Desks fill with
 * people as load and local office hours rise; desk hardware upgrades with
 * load tier (boxy monitors → flat screens → holographic panels); screens
 * flicker faster at peak traffic. A visual scale — not a staff count.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
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
  /** Framing for the camera: centre height of the occupied floors and their horizontal radius. */
  readonly frame: { y: number; radius: number };
  update(s: OfficeState): void;
  dispose(): void;
}

const FLOORS = 3;
const FLOOR_GAP = 2.6;
const DESK_DX = 1.25;
const DESK_DZ = 1.6;
const MAX_PER_FLOOR = 40;
const SHIRTS = ['#5f7fb8', '#b86a5f', '#6fa88a', '#c9a45a', '#8a6fb0', '#4f9fb0', '#b0b7c6'];

function hash(n: number): number {
  const x = Math.sin(n * 91.7 + 17.3) * 43758.5453;
  return x - Math.floor(x);
}

export interface OfficeOptions {
  /** Half-extents (x, z) of the tower body's bounding box. */
  half: { x: number; z: number };
  accent: string;
  /** Whether a campus-local point is inside the tower (desks are only placed where they fit). */
  fits: (x: number, y: number, z: number) => boolean;
}

export function createOffices(o: OfficeOptions): Offices {
  const group = new Group();
  const materials: Material[] = [];
  const hx = Math.max(1.2, o.half.x);
  const hz = Math.max(1.2, o.half.z);
  const dummy = new Object3D();

  // Candidate positions on a fine grid over the body's bounding box, packed greedily: a desk is
  // kept when its desk and chair both sit inside the tower at that floor and it doesn't overlap a
  // kept desk. Floors thus follow the real (round, twisted, twin…) shape of each typology, and
  // floors above a short tower simply get no desks.
  const STEP = 0.4;
  const seats: { x: number; y: number; z: number }[] = [];
  const usedFloors = new Set<number>();
  for (let f = 0; f < FLOORS; f++) {
    const y = 0.66 + f * FLOOR_GAP;
    const probeY = y + 0.9;
    const floorSeats: { x: number; z: number }[] = [];
    for (let z = -hz + 0.5; z <= hz - 0.3 && floorSeats.length < MAX_PER_FLOOR; z += STEP) {
      for (let x = -hx + 0.45; x <= hx - 0.45 && floorSeats.length < MAX_PER_FLOOR; x += STEP) {
        if (floorSeats.some((q) => Math.abs(q.x - x) < DESK_DX && Math.abs(q.z - z) < DESK_DZ))
          continue;
        if (!o.fits(x, probeY, z)) continue;
        if (!o.fits(x - 0.45, probeY, z) || !o.fits(x + 0.45, probeY, z)) continue;
        if (!o.fits(x, probeY, z - 0.42)) continue;
        floorSeats.push({ x, z });
      }
    }
    for (const q of floorSeats) seats.push({ x: q.x, y, z: q.z });
    if (floorSeats.length > 0) usedFloors.add(f);
  }
  const desksTotal = Math.max(1, seats.length);
  const floorsUsed = Math.max(1, usedFloors.size);
  let radius = 2;
  for (const seat of seats) radius = Math.max(radius, Math.hypot(seat.x, seat.z) + 0.8);

  const tileMat = new MeshStandardMaterial({ color: '#2b3346', roughness: 0.85 });
  const edgeMat = new LineBasicMaterial({ color: o.accent, transparent: true, opacity: 0.55 });
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
    color: new Color(o.accent),
    transparent: true,
    opacity: 0.45,
    blending: AdditiveBlending,
    side: DoubleSide,
    depthWrite: false,
  });
  materials.push(tileMat, edgeMat, deskMat, bodyMat, headMat, crtMat, flatMat, holoMat);

  // One floor tile per desk: the floor plan follows the seats, with an accent outline.
  const tileGeo = new BoxGeometry(DESK_DX - 0.04, 0.12, DESK_DZ - 0.04);
  const edgeGeo = new EdgesGeometry(tileGeo);
  const tiles = new InstancedMesh(tileGeo, tileMat, desksTotal);
  // All tile outlines merged into one line set (one draw call).
  const edgeSrc = edgeGeo.getAttribute('position');
  const edgePos = new Float32Array(edgeSrc.count * 3 * seats.length);
  seats.forEach((seat, i) => {
    dummy.position.set(seat.x, seat.y - 0.06, seat.z - 0.15);
    dummy.updateMatrix();
    tiles.setMatrixAt(i, dummy.matrix);
    for (let v = 0; v < edgeSrc.count; v++) {
      const k = (i * edgeSrc.count + v) * 3;
      edgePos[k] = edgeSrc.getX(v) + dummy.position.x;
      edgePos[k + 1] = edgeSrc.getY(v) + dummy.position.y;
      edgePos[k + 2] = edgeSrc.getZ(v) + dummy.position.z;
    }
  });
  edgeGeo.dispose();
  const edgesGeo = new BufferGeometry();
  edgesGeo.setAttribute('position', new Float32BufferAttribute(edgePos, 3));
  tiles.count = seats.length;
  group.add(tiles, new LineSegments(edgesGeo, edgeMat));

  const desks = new InstancedMesh(new BoxGeometry(0.9, 0.06, 0.5), deskMat, desksTotal);
  const bodies = new InstancedMesh(new CapsuleGeometry(0.13, 0.32, 3, 8), bodyMat, desksTotal);
  const heads = new InstancedMesh(new SphereGeometry(0.11, 10, 8), headMat, desksTotal);
  const crt = new InstancedMesh(new BoxGeometry(0.34, 0.3, 0.3), crtMat, desksTotal);
  const flat = new InstancedMesh(new BoxGeometry(0.62, 0.24, 0.03), flatMat, desksTotal);
  const holo = new InstancedMesh(new PlaneGeometry(0.8, 0.42), holoMat, desksTotal);
  group.add(desks, bodies, heads, crt, flat, holo);

  // Desks face +z (towards the camera in the offices view): screens in front, people behind.
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
  for (const m of [desks, crt, flat, holo]) m.count = seats.length;
  // People come and go (count changes), so a cached bounding sphere would go stale.
  bodies.frustumCulled = heads.frustumCulled = false;

  let lastTier = -1;
  return {
    group,
    frame: { y: 0.66 + ((floorsUsed - 1) * FLOOR_GAP) / 2 + 0.8, radius },
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
      group.traverse((x) => {
        if (x instanceof Mesh || x instanceof LineSegments) x.geometry.dispose();
        if (x instanceof InstancedMesh) x.dispose();
      });
      materials.forEach((m) => m.dispose());
    },
  };
}
