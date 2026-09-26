/**
 * Model lab: a display case of the platform's model lineup. One crystal per
 * model on a pedestal, oldest on the left; the newest glows. Crystals of the
 * platform's own models are faceted gems in its accent colour; models offered
 * from other companies are pale, rounder stones. Flagships stand taller.
 * Crystals are pickable — the details live in the panel (and its list is the
 * accessible version of this scene).
 */
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { Model } from '../../data/schema';
import { labLineup } from './lineup';

export interface LabState {
  time: number;
}

export interface Lab {
  readonly group: Group;
  /** Meshes carrying `userData.modelId`. */
  readonly pickables: readonly Object3D[];
  /** Half the width of the display, for camera framing. */
  readonly halfWidth: number;
  select(modelId: string | null): void;
  update(s: LabState): void;
  dispose(): void;
}

const SPACING = 1.35;

export function createLab(models: readonly Model[], accent: string): Lab {
  const group = new Group();
  const materials: Material[] = [];
  const lineup = labLineup(models);
  const n = lineup.length;
  const halfWidth = Math.max(2, ((n - 1) * SPACING) / 2 + 1);

  const plinthMat = new MeshStandardMaterial({ color: '#141a28', roughness: 0.5, metalness: 0.4 });
  const pedestalMat = new MeshStandardMaterial({
    color: '#1c2230',
    roughness: 0.8,
    metalness: 0.2,
  });
  const wallMat = new MeshStandardMaterial({ color: '#0e121b', roughness: 0.9 });
  const trimMat = new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55 });
  const ringMat = new MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  materials.push(plinthMat, pedestalMat, wallMat, trimMat, ringMat);

  const curve = (x: number) => -0.012 * x * x;
  const plinth = new Mesh(new BoxGeometry(halfWidth * 2 + 0.6, 0.18, 2.4), plinthMat);
  plinth.position.set(0, 0.09, -0.4);
  const trim = new Mesh(new BoxGeometry(halfWidth * 2 + 0.6, 0.03, 0.03), trimMat);
  trim.position.set(0, 0.19, 0.8);
  // A dark back wall turns the row into a display case and hides the busy campus behind.
  const wall = new Mesh(new BoxGeometry(halfWidth * 2 + 0.6, 3.2, 0.2), wallMat);
  wall.position.set(0, 1.6, -1.7);
  const wallTrim = new Mesh(new BoxGeometry(halfWidth * 2 + 0.6, 0.04, 0.04), trimMat);
  wallTrim.position.set(0, 3.2, -1.58);
  group.add(plinth, trim, wall, wallTrim);

  const pedestalGeo = new CylinderGeometry(0.34, 0.42, 1, 20);
  const ownGeo = new OctahedronGeometry(0.42, 0);
  ownGeo.scale(1, 1.35, 1);
  const offeredGeo = new DodecahedronGeometry(0.34, 0);
  const crystals: Mesh[] = [];
  const crystalMats: MeshStandardMaterial[] = [];
  const base = new Color(accent);
  const pale = new Color('#dfe6f5');

  lineup.forEach((m, i) => {
    const x = (i - (n - 1) / 2) * SPACING;
    const z = curve(x);
    const hgt = m.flagship ? 1.25 : 0.95;
    const ped = new Mesh(pedestalGeo, pedestalMat);
    ped.scale.y = hgt;
    ped.position.set(x, 0.18 + hgt / 2, z);
    group.add(ped);
    const newest = i === n - 1;
    // Older models dim gradually; the newest is the brightest thing in the room.
    const recency = n > 1 ? i / (n - 1) : 1;
    const own = m.origin === 'own';
    const mat = new MeshStandardMaterial({
      // Some diffuse colour so the facets shade; emission carries the recency.
      color: (own ? base : pale).clone().multiplyScalar(0.55),
      emissive: own ? base : pale,
      emissiveIntensity: newest ? 2.4 : 0.12 + 0.4 * recency,
      roughness: 0.25,
      metalness: 0.3,
      flatShading: true,
    });
    crystalMats.push(mat);
    materials.push(mat);
    const c = new Mesh(own ? ownGeo : offeredGeo, mat);
    c.position.set(x, 0.18 + hgt + 0.5, z);
    c.scale.setScalar(m.flagship ? 1.15 : 0.9);
    c.userData.modelId = m.id;
    c.userData.baseY = c.position.y;
    c.userData.newest = newest;
    c.userData.flagship = m.flagship;
    c.userData.top = 0.18 + hgt;
    crystals.push(c);
    group.add(c);
  });

  const ring = new Mesh(new RingGeometry(0.46, 0.56, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  group.add(ring);

  let selected: string | null = null;
  return {
    group,
    pickables: crystals,
    halfWidth,
    select(id) {
      selected = id;
      const c = crystals.find((x) => x.userData.modelId === id);
      ring.visible = !!c;
      if (c) ring.position.set(c.position.x, (c.userData.top as number) + 0.01, c.position.z);
    },
    update(s) {
      crystals.forEach((c, i) => {
        c.rotation.y = s.time * 0.4 + i;
        c.position.y = (c.userData.baseY as number) + Math.sin(s.time * 1.2 + i) * 0.05;
        const mat = crystalMats[i]!;
        if (c.userData.newest) mat.emissiveIntensity = 2.1 + 0.5 * Math.sin(s.time * 2.2);
        const on = c.userData.modelId === selected;
        c.scale.setScalar((on ? 1.25 : 1) * (c.userData.flagship ? 1.15 : 0.9));
      });
      if (ring.visible) ringMat.opacity = 0.6 + 0.3 * Math.sin(s.time * 3);
    },
    dispose() {
      group.traverse((o) => o instanceof Mesh && o.geometry.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
