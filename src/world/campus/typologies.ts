/**
 * Fifteen original architectural typologies — one per HQ (see `identity` in
 * data/manual/platforms.yaml). No logos, wordmarks or brand shapes.
 *
 * Contract: `body` is modelled at unit height (y ∈ [0, 1]) and scaled in Y by
 * load; `crown` sits on top and is not scaled; `base` is ground-level and not
 * scaled. `animate` may move parts every frame.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type Material,
} from 'three';

export interface Kit {
  facade: Material;
  facadeAlt: Material;
  accent: Material;
  accentSoft: Material;
  dark: Material;
  glass: Material;
  accentColor: string;
}

export interface TowerParts {
  body: Group;
  crown: Group;
  base: Group;
  /** Radius (world units) the tower occupies around its centre at ground level. */
  footprint: number;
  animate?: (t: number, height: number) => void;
}

type Builder = (k: Kit) => TowerParts;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mesh(geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** A box spanning y ∈ [y0, y1] (unit-height coordinates). */
function slab(w: number, d: number, y0: number, y1: number, mat: Material, x = 0, z = 0): Mesh {
  return mesh(new BoxGeometry(w, y1 - y0, d), mat, x, (y0 + y1) / 2, z);
}

function cyl(
  rTop: number,
  rBottom: number,
  y0: number,
  y1: number,
  mat: Material,
  seg = 32,
  x = 0,
  z = 0,
): Mesh {
  return mesh(new CylinderGeometry(rTop, rBottom, y1 - y0, seg, 1), mat, x, (y0 + y1) / 2, z);
}

function parts(footprint: number): TowerParts {
  return { body: new Group(), crown: new Group(), base: new Group(), footprint };
}

/** Twist a geometry around Y proportionally to height (y in [0, 1]). */
function twist(geo: BufferGeometry, turns: number): BufferGeometry {
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + 0.5;
    const a = y * turns * Math.PI * 2;
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setXYZ(
      i,
      x * Math.cos(a) - z * Math.sin(a),
      pos.getY(i),
      x * Math.sin(a) + z * Math.cos(a),
    );
  }
  geo.computeVertexNormals();
  return geo;
}

function beam(color: string, length: number, radius: number): Mesh {
  const geo = new ConeGeometry(radius, length, 24, 1, true);
  geo.translate(0, -length / 2, 0);
  geo.rotateX(Math.PI);
  const mat = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.028,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const m = new Mesh(geo, mat);
  m.renderOrder = 5;
  return m;
}

// ---------------------------------------------------------------------------
// typologies
// ---------------------------------------------------------------------------

/** ChatGPT — ring-plaza monolith. */
const ring: Builder = (k) => {
  const p = parts(5);
  p.body.add(slab(6, 3.4, 0, 1, k.facade), slab(6.3, 3.7, 0, 0.04, k.dark));
  p.crown.add(slab(6.2, 3.6, 0, 0.35, k.accent), slab(5.4, 2.8, 0.35, 0.9, k.dark));
  const plaza = mesh(new TorusGeometry(9.2, 0.14, 8, 96), k.accent, 0, 0.12, 0);
  plaza.rotation.x = Math.PI / 2;
  p.base.add(plaza, cyl(9.6, 9.6, 0, 0.1, k.dark, 96));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const pav = slab(2.2, 1.2, 0, 1.6, k.facadeAlt, Math.cos(a) * 8.6, Math.sin(a) * 8.6);
    pav.rotation.y = -a;
    p.base.add(pav);
  }
  return p;
};

/** Gemini — twin helix spires with sky-bridges. */
const helix: Builder = (k) => {
  const p = parts(5.5);
  const a = mesh(twist(new BoxGeometry(2.6, 1, 2.6, 1, 32, 1), 0.35), k.facade, -2.3, 0.5, 0);
  const b = mesh(twist(new BoxGeometry(2.6, 1, 2.6, 1, 32, 1), -0.35), k.facade, 2.3, 0.5, 0);
  p.body.add(a, b);
  for (const y of [0.32, 0.58, 0.84]) p.body.add(slab(2.4, 0.9, y, y + 0.012, k.accent));
  p.crown.add(
    cyl(0.05, 0.35, 0, 3.2, k.accent, 8, -2.3, 0),
    cyl(0.05, 0.35, 0, 3.2, k.accent, 8, 2.3, 0),
  );
  return p;
};

/** Claude — terraced garden library with a lantern crown. */
const terraces: Builder = (k) => {
  const p = parts(5.5);
  const steps: [number, number, number][] = [
    [10, 0, 0.3],
    [8.2, 0.3, 0.5],
    [6.6, 0.5, 0.68],
    [5, 0.68, 0.85],
    [3.6, 0.85, 1],
  ];
  for (const [w, y0, y1] of steps) {
    p.body.add(slab(w, w * 0.8, y0, y1, k.facade));
    p.body.add(slab(w + 0.5, w * 0.8 + 0.5, y1 - 0.006, y1, k.accentSoft)); // garden edge
  }
  p.crown.add(
    cyl(1.1, 1.3, 0, 1.8, k.accent, 6),
    mesh(new ConeGeometry(1.5, 1.2, 6), k.dark, 0, 2.4, 0),
  );
  return p;
};

/** Meta AI — oval tower under an undulating lattice canopy. */
const canopy: Builder = (k) => {
  const p = parts(8);
  const tower = cyl(2.8, 3.2, 0, 1, k.facade, 40);
  tower.scale.x = 1.4;
  p.body.add(tower);
  p.crown.add(cyl(2.4, 2.8, 0, 0.5, k.accent, 40));
  p.crown.children[0]!.scale.x = 1.4;
  const geo = new PlaneGeometry(22, 16, 44, 32);
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, 3.2 + Math.sin(x * 0.45) * 0.8 + Math.cos(y * 0.55) * 0.6);
  }
  geo.computeVertexNormals();
  const lattice = new Mesh(geo, k.accentSoft);
  (lattice.material as Material).side = DoubleSide;
  lattice.rotation.x = -Math.PI / 2;
  const wire = new Mesh(
    geo,
    new MeshBasicMaterial({
      color: k.accentColor,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    }),
  );
  wire.rotation.x = -Math.PI / 2;
  wire.position.y = 0.02;
  p.base.add(lattice, wire);
  for (const [x, z] of [
    [-9, -6],
    [9, -6],
    [-9, 6],
    [9, 6],
  ] as const)
    p.base.add(cyl(0.18, 0.18, 0, 3.2, k.dark, 8, x, z));
  return p;
};

/** Microsoft Copilot — cantilevered slab stack. */
const slabs: Builder = (k) => {
  const p = parts(5.5);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const s = slab(
      6.4,
      4.2,
      i / n,
      (i + 1) / n - 0.004,
      i % 2 ? k.facade : k.facadeAlt,
      i % 2 ? 1.1 : -1.1,
    );
    s.rotation.y = (i % 3) * 0.08;
    p.body.add(s);
  }
  p.crown.add(slab(6.6, 4.4, 0, 0.3, k.accent, 1.1));
  return p;
};

/** Doubao — honeycomb megastructure of hexagonal cells. */
const hexagons: Builder = (k) => {
  const p = parts(7);
  const r = 2.1;
  const cells: [number, number, number][] = [[0, 0, 1]];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    cells.push([Math.cos(a) * r * 1.73, Math.sin(a) * r * 1.73, 0.5 + ((i * 37) % 30) / 100]);
  }
  for (const [x, z, h] of cells) {
    p.body.add(cyl(r, r, 0, h, k.facade, 6, x, z));
    p.body.add(cyl(r * 1.02, r * 1.02, h - 0.008, h, k.accentSoft, 6, x, z));
  }
  const rim = mesh(new TorusGeometry(r * 0.95, 0.12, 6, 6), k.accent, 0, 0.2, 0);
  rim.rotation.x = Math.PI / 2;
  rim.rotation.z = Math.PI / 6;
  p.crown.add(rim, cyl(r * 0.6, r * 0.8, 0, 1.2, k.dark, 6));
  return p;
};

/** Qwen — tiered eave tower over a still pool. */
const eaves: Builder = (k) => {
  const p = parts(5.5);
  const tiers = 6;
  for (let i = 0; i < tiers; i++) {
    const y0 = i / tiers;
    const y1 = (i + 1) / tiers;
    const w = 5.2 - i * 0.45;
    p.body.add(slab(w, w, y0, y1 - 0.02, k.facade));
    p.body.add(
      mesh(new CylinderGeometry(w * 0.62, w * 0.9, 0.02, 4, 1), k.accentSoft, 0, y1 - 0.01, 0),
    );
    p.body.children[p.body.children.length - 1]!.rotation.y = Math.PI / 4;
  }
  const roof = mesh(new ConeGeometry(2.6, 2.4, 4), k.accent, 0, 1.2, 0);
  roof.rotation.y = Math.PI / 4;
  p.crown.add(roof, cyl(0.08, 0.08, 2.4, 4.6, k.accent, 6));
  const pool = cyl(8.5, 8.5, 0, 0.06, k.glass, 64, 0, 0);
  p.base.add(pool, mesh(new TorusGeometry(8.5, 0.1, 6, 64), k.accent, 0, 0.08, 0));
  p.base.children[1]!.rotation.x = Math.PI / 2;
  return p;
};

/** DeepSeek — cylindrical tower rising from a sunken atrium with a mirror pool. */
const well: Builder = (k) => {
  const p = parts(5);
  p.body.add(cyl(3.1, 3.4, 0, 1, k.facade, 48));
  for (const y of [0.25, 0.5, 0.75]) p.body.add(cyl(3.5, 3.5, y, y + 0.01, k.accentSoft, 48));
  const halo = mesh(new TorusGeometry(3.3, 0.16, 8, 64), k.accent, 0, 0.25, 0);
  halo.rotation.x = Math.PI / 2;
  p.crown.add(halo, cyl(2.6, 3.1, 0, 0.6, k.dark, 48));
  const atrium = mesh(new TorusGeometry(8, 0.9, 12, 72), k.facadeAlt, 0, 0.1, 0);
  atrium.rotation.x = Math.PI / 2;
  p.base.add(atrium, cyl(7.2, 7.2, 0, 0.05, k.glass, 72));
  return p;
};

/** Grok — brutalist forge with an exoskeleton and a power plant. */
const forge: Builder = (k) => {
  const p = parts(6);
  p.body.add(slab(5, 5, 0, 1, k.facade));
  for (const [x, z] of [
    [-2.9, -2.9],
    [2.9, -2.9],
    [-2.9, 2.9],
    [2.9, 2.9],
  ] as const)
    p.body.add(slab(0.5, 0.5, 0, 1.02, k.dark, x, z));
  for (let i = 0; i < 6; i++) {
    const y = (i + 0.5) / 6;
    const brace = slab(6.2, 0.35, y - 0.004, y + 0.004, k.accentSoft, 0, 2.95);
    brace.rotation.z = i % 2 ? 0.02 : -0.02;
    const brace2 = brace.clone();
    brace2.position.z = -2.95;
    p.body.add(brace, brace2);
  }
  p.crown.add(slab(4.2, 4.2, 0, 0.6, k.accent), slab(0.3, 0.3, 0.6, 4, k.dark, 1.5, 1.5));
  for (const x of [-7.5, -5]) {
    p.base.add(cyl(0.8, 1.1, 0, 7, k.dark, 16, x, -5));
    p.base.add(cyl(0.82, 0.82, 6.9, 7.1, k.accent, 16, x, -5));
  }
  p.base.add(slab(6, 3, 0, 2.2, k.facadeAlt, -6.2, -8.5));
  return p;
};

/** GitHub Copilot — clock tower over sawtooth workshop halls. */
const sawtooth: Builder = (k) => {
  const p = parts(4);
  p.body.add(slab(3.2, 3.2, 0, 1, k.facade), slab(3.6, 3.6, 0.97, 1, k.accentSoft));
  const clock = mesh(new CylinderGeometry(1.1, 1.1, 0.12, 40), k.accent, 0, 1.6, 1.75);
  clock.rotation.x = Math.PI / 2;
  p.crown.add(
    slab(3.2, 3.2, 0, 3.2, k.facadeAlt),
    clock,
    mesh(new ConeGeometry(2.4, 2.2, 4), k.dark, 0, 4.3, 0),
  );
  p.crown.children[2]!.rotation.y = Math.PI / 4;
  for (let row = 0; row < 2; row++) {
    const z = -6 - row * 4.2;
    p.base.add(slab(14, 3.8, 0, 1.6, k.facadeAlt, 0, z));
    for (let i = 0; i < 7; i++) {
      const tooth = mesh(new BoxGeometry(2, 0.12, 3.8), k.facadeAlt, -6 + i * 2, 2.0, z);
      tooth.rotation.z = 0.5;
      p.base.add(
        tooth,
        mesh(new BoxGeometry(0.08, 0.08, 3.8), k.accentSoft, -6 + i * 2 + 0.85, 2.45, z),
      );
    }
  }
  return p;
};

/** Perplexity — observatory pillar with a slotted dome and a telescope beam. */
const dome: Builder = (k) => {
  const p = parts(4.5);
  p.body.add(cyl(2.8, 3.4, 0, 1, k.facade, 40), cyl(3.5, 3.5, 0.985, 1, k.accentSoft, 40));
  const d = mesh(
    new SphereGeometry(3.6, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
    k.facadeAlt,
    0,
    0,
    0,
  );
  const slot = mesh(new BoxGeometry(0.5, 3.8, 0.4), k.accent, 0, 2.2, 1.9);
  slot.rotation.x = -0.9;
  const scope = beam(k.accentColor, 60, 0.9);
  scope.position.set(0, 3, 0);
  scope.rotation.x = -0.45;
  p.crown.add(d, slot, scope);
  p.animate = (t) => {
    p.crown.rotation.y = t * 0.05;
  };
  return p;
};

/** Tencent Yuanbao — stepped pavilion swelling at the waist, lantern roof. */
const ingot: Builder = (k) => {
  const p = parts(5);
  const pts: Vector2[] = [];
  const steps = 9;
  for (let i = 0; i <= steps; i++) {
    const y = i / steps;
    const r = 2.6 + 1.4 * Math.sin(Math.PI * y) ** 1.5;
    pts.push(new Vector2(r, y), new Vector2(r, Math.min(1, y + 1 / steps)));
  }
  p.body.add(mesh(new LatheGeometry(pts, 8), k.facade));
  for (let i = 1; i < steps; i++) {
    const y = i / steps;
    p.body.add(
      cyl(
        2.7 + 1.4 * Math.sin(Math.PI * y) ** 1.5,
        2.7 + 1.4 * Math.sin(Math.PI * y) ** 1.5,
        y,
        y + 0.006,
        k.accentSoft,
        8,
      ),
    );
  }
  p.crown.add(
    mesh(new ConeGeometry(3.2, 2.2, 8), k.accent, 0, 1.1, 0),
    cyl(0.1, 0.1, 2.2, 3.6, k.accent, 6),
  );
  return p;
};

/** Cursor — a razor-thin blade with one brilliant edge. */
const blade: Builder = (k) => {
  const p = parts(4.5);
  const s = new Shape();
  s.moveTo(-4, -1.4);
  s.lineTo(4.4, 0);
  s.lineTo(-4, 1.4);
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  p.body.add(mesh(geo, k.facade));
  p.body.add(slab(0.18, 0.18, 0, 1.03, k.accent, 4.35, 0));
  p.crown.add(mesh(new ConeGeometry(0.12, 6, 6), k.accent, 4.35, 3, 0));
  return p;
};

/** Character.AI — marquee tower ringed with bulb strips over an amphitheatre. */
const marquee: Builder = (k) => {
  const p = parts(5.5);
  p.body.add(cyl(3, 3.8, 0, 1, k.facade, 48));
  for (let i = 1; i <= 6; i++) {
    const t = mesh(new TorusGeometry(3.85 - (i / 7) * 0.8, 0.1, 6, 64), k.accent, 0, i / 7, 0);
    t.rotation.x = Math.PI / 2;
    t.scale.z = 0.01; // flattened to a bulb strip after Y scaling
    p.body.add(t);
  }
  p.crown.add(
    cyl(2.6, 3, 0, 0.8, k.accent, 48),
    mesh(new SphereGeometry(0.5, 16, 8), k.accent, 0, 1.2, 0),
  );
  for (let r = 0; r < 4; r++) {
    const seat = mesh(
      new TorusGeometry(6.5 + r * 0.9, 0.35, 4, 64, Math.PI * 1.2),
      k.facadeAlt,
      0,
      0.25 + r * 0.35,
      0,
    );
    seat.rotation.x = Math.PI / 2;
    seat.rotation.z = Math.PI * 0.9;
    p.base.add(seat);
  }
  return p;
};

/** Kimi — a crescent tower cradling a luminous orb. */
const crescent: Builder = (k) => {
  const p = parts(4.5);
  const s = new Shape();
  s.absarc(0, 0, 4, Math.PI * 0.25, Math.PI * 1.75, false);
  s.absarc(1.6, 0, 3, Math.PI * 1.62, Math.PI * 0.38, true);
  const geo = new ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 24 });
  geo.rotateX(-Math.PI / 2);
  p.body.add(mesh(geo, k.facade));
  const orb = mesh(new SphereGeometry(1.4, 32, 16), k.accent, 2.2, 1.6, 0);
  p.crown.add(orb);
  p.animate = (t) => {
    orb.position.y = 1.6 + Math.sin(t * 0.8) * 0.3;
  };
  return p;
};

export const TYPOLOGIES: Record<string, Builder> = {
  ring,
  helix,
  terraces,
  canopy,
  slabs,
  hexagons,
  eaves,
  well,
  forge,
  sawtooth,
  dome,
  ingot,
  blade,
  marquee,
  crescent,
};

export function buildTypology(motif: string, kit: Kit): TowerParts {
  const b = TYPOLOGIES[motif] ?? ring;
  return b(kit);
}
