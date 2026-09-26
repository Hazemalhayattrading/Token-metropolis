import {
  InstancedMesh,
  Matrix4,
  Mesh,
  Vector3,
  type Light,
  type Material,
  type Object3D,
} from 'three';
import { describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  approach,
  beamAim,
  beamCount,
  beamDirection,
  beamLength,
  blink,
  burstRing,
  createLaunchFx,
  crowdCount,
  crowdHop,
  crowdLayout,
  CROWD_SPREAD,
  crownFlash,
  droneCount,
  dronePose,
  hash01,
  lampLayout,
  MAX_CROWD,
  MAX_DRONES,
  type LaunchFx,
  type LaunchFxState,
} from './launch';

const FOOTPRINTS = [4, 4.5, 5, 5.5, 6, 7, 8];

describe('hash01', () => {
  it('is deterministic and in [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const v = hash01(i * 0.37);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash01(i * 0.37)).toBe(v);
    }
  });
});

describe('approach', () => {
  it('moves towards the target without overshooting and snaps when close', () => {
    let v = 0;
    for (let i = 0; i < 600; i++) {
      const next = approach(v, 1, 1 / 60, 3);
      expect(next).toBeGreaterThanOrEqual(v);
      expect(next).toBeLessThanOrEqual(1);
      v = next;
    }
    expect(v).toBe(1);
  });

  it('is frame-rate independent', () => {
    const one = approach(0, 1, 0.2, 3);
    const two = approach(approach(0, 1, 0.1, 3), 1, 0.1, 3);
    expect(two).toBeCloseTo(one, 10);
  });

  it('does nothing without elapsed time', () => {
    expect(approach(0.4, 1, 0, 3)).toBe(0.4);
    expect(approach(0.4, 1, -1, 3)).toBe(0.4);
    expect(approach(0.4, 1, Number.NaN, 3)).toBe(0.4);
  });
});

describe('counts', () => {
  it('3–4 beams, 8–16 drones and at most 60 figures for every tower size', () => {
    for (const fp of FOOTPRINTS) {
      expect([3, 4]).toContain(beamCount(fp));
      expect(droneCount(fp)).toBeGreaterThanOrEqual(8);
      expect(droneCount(fp)).toBeLessThanOrEqual(MAX_DRONES);
      expect(crowdCount(fp)).toBeLessThanOrEqual(MAX_CROWD);
    }
    expect(droneCount(4)).toBe(8);
    expect(droneCount(8)).toBe(16);
  });
});

describe('lampLayout', () => {
  it('puts the lamps on the front plaza, footprint + 2..4 from the tower', () => {
    for (const fp of FOOTPRINTS) {
      const lamps = lampLayout(fp);
      expect(lamps).toHaveLength(beamCount(fp));
      for (const l of lamps) {
        expect(l.z).toBeGreaterThan(0);
        const r = Math.hypot(l.x, l.z);
        expect(r).toBeGreaterThanOrEqual(fp + 2);
        expect(r).toBeLessThanOrEqual(fp + 4);
      }
    }
  });
});

describe('beams', () => {
  it('lean gently outwards and upwards', () => {
    for (let i = 0; i < 4; i++) {
      for (let t = 0; t < 120; t += 3.7) {
        const aim = beamAim(0.5, i, t, false);
        expect(aim.tilt).toBeGreaterThanOrEqual(0.15);
        expect(aim.tilt).toBeLessThanOrEqual(0.4);
        const d = beamDirection(aim, new Vector3());
        expect(d.length()).toBeCloseTo(1, 10);
        expect(d.y).toBeGreaterThan(0.9);
      }
    }
  });

  it('sweep over time, but hold still with reduced motion', () => {
    expect(beamAim(0.33, 1, 0, false)).not.toEqual(beamAim(0.33, 1, 8, false));
    expect(beamAim(0.33, 1, 0, true)).toEqual(beamAim(0.33, 1, 8, true));
  });

  it('reach above the crown', () => {
    for (const h of [0, 3, 20, 44]) {
      expect(beamLength(h)).toBeGreaterThan(h + 4);
      expect(beamLength(h)).toBeLessThanOrEqual(72);
    }
  });
});

describe('dronePose', () => {
  it('orbits the crown at height + 2..4, outside the tower, without collisions', () => {
    for (const fp of FOOTPRINTS) {
      const n = droneCount(fp);
      for (const h of [3, 25, 44]) {
        for (let t = 0; t < 60; t += 2.3) {
          const poses = Array.from({ length: n }, (_, i) => dronePose(i, n, fp, h, t, false));
          for (const p of poses) {
            expect(p.y).toBeGreaterThanOrEqual(h + 2);
            expect(p.y).toBeLessThanOrEqual(h + 4);
            expect(Math.hypot(p.x, p.z)).toBeGreaterThan(fp + 1);
            expect(Number.isFinite(p.heading)).toBe(true);
          }
          for (let a = 0; a < n; a++) {
            for (let b = a + 1; b < n; b++) {
              const pa = poses[a]!;
              const pb = poses[b]!;
              expect(Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z)).toBeGreaterThan(0.5);
            }
          }
        }
      }
    }
  });

  it('moves over time, but hovers in place with reduced motion', () => {
    expect(dronePose(3, 12, 6, 20, 0, false)).not.toEqual(dronePose(3, 12, 6, 20, 5, false));
    expect(dronePose(3, 12, 6, 20, 0, true)).toEqual(dronePose(3, 12, 6, 20, 5, true));
  });

  it('writes into the object it is given', () => {
    const out = { x: 0, y: 0, z: 0, heading: 0 };
    expect(dronePose(0, 8, 5, 10, 1, false, out)).toBe(out);
  });
});

describe('blink', () => {
  it('is on for the duty fraction of each period', () => {
    let on = 0;
    const samples = 10_000;
    for (let i = 0; i < samples; i++) {
      const v = blink((i / samples) * 14, 1.4, 0.1, 0.37);
      expect([0, 1]).toContain(v);
      on += v;
    }
    expect(on / samples).toBeCloseTo(0.1, 2);
  });

  it('handles negative time', () => {
    expect([0, 1]).toContain(blink(-3.3, 1.1, 0.5, 0.2));
  });
});

describe('crowdLayout', () => {
  it('fills a crescent on the front plaza, spaced out and clear of the lamps', () => {
    for (const fp of FOOTPRINTS) {
      const lamps = lampLayout(fp);
      const figures = crowdLayout(fp, crowdCount(fp), lamps);
      expect(figures).toHaveLength(crowdCount(fp));
      for (const f of figures) {
        const r = Math.hypot(f.x, f.z);
        expect(r).toBeGreaterThanOrEqual(fp + 1.5 - 1e-9);
        expect(r).toBeLessThanOrEqual(fp + 5 + 1e-9);
        expect(Math.abs(Math.atan2(f.x, f.z))).toBeLessThanOrEqual(CROWD_SPREAD + 1e-9);
        expect(f.z).toBeGreaterThan(0);
        expect(f.scale).toBeGreaterThanOrEqual(0.9);
        expect(f.scale).toBeLessThanOrEqual(1.1);
        for (const l of lamps) expect(Math.hypot(f.x - l.x, f.z - l.z)).toBeGreaterThanOrEqual(0.8);
      }
      for (let a = 0; a < figures.length; a++) {
        for (let b = a + 1; b < figures.length; b++) {
          const fa = figures[a]!;
          const fb = figures[b]!;
          expect(Math.hypot(fa.x - fb.x, fa.z - fb.z)).toBeGreaterThanOrEqual(0.3);
        }
      }
    }
  });

  it('is deterministic and capped', () => {
    expect(crowdLayout(6, 40)).toEqual(crowdLayout(6, 40));
    expect(crowdLayout(6, 500).length).toBeLessThanOrEqual(MAX_CROWD);
    expect(crowdLayout(6, 0)).toEqual([]);
  });

  it('hops gently, and not at all with reduced motion', () => {
    for (let t = 0; t < 10; t += 0.13) {
      const hop = crowdHop(t, 1.2, false);
      expect(hop).toBeGreaterThanOrEqual(0);
      expect(hop).toBeLessThanOrEqual(0.04);
      expect(crowdHop(t, 1.2, true)).toBe(0);
    }
  });
});

describe('burst', () => {
  it('ring leaves the tower and runs outwards while fading', () => {
    let prev = burstRing(1, 6, false);
    expect(prev.radius).toBeCloseTo(6 * 0.9, 10);
    expect(prev.alpha).toBeGreaterThan(0.5);
    for (let b = 0.95; b > 0; b -= 0.05) {
      const s = burstRing(b, 6, false);
      expect(s.radius).toBeGreaterThan(prev.radius);
      expect(s.alpha).toBeLessThan(prev.alpha);
      prev = s;
    }
    expect(burstRing(0, 6, false).alpha).toBe(0);
  });

  it('ring stays put with reduced motion, only fading', () => {
    const a = burstRing(0.9, 6, true);
    const b = burstRing(0.3, 6, true);
    expect(a.radius).toBe(b.radius);
    expect(b.alpha).toBeLessThan(a.alpha);
    expect(burstRing(0, 6, true).alpha).toBe(0);
  });

  it('crown flash is brief and bright, gentle with reduced motion', () => {
    expect(crownFlash(0, false)).toBe(0);
    expect(crownFlash(0.5, false)).toBe(0);
    expect(crownFlash(1, false)).toBeGreaterThan(1);
    for (let b = 0; b < 1; b += 0.05) {
      expect(crownFlash(b + 0.05, false)).toBeGreaterThanOrEqual(crownFlash(b, false));
      expect(crownFlash(b, true)).toBeLessThanOrEqual(0.45);
    }
    expect(crownFlash(Number.NaN, false)).toBe(0);
    expect(crownFlash(7, false)).toBe(crownFlash(1, false));
  });
});

// --- scene graph (no WebGL needed) ------------------------------------------------------------

function byName(fx: LaunchFx, name: string): Mesh {
  const o = fx.group.getObjectByName(name);
  if (!(o instanceof Mesh)) throw new Error(`missing ${name}`);
  return o;
}

function run(fx: LaunchFx, s: Partial<LaunchFxState>, seconds: number, from = 0): number {
  let time = from;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    time += 1 / 60;
    fx.update({ active: true, burst: 0, height: 20, reducedMotion: false, ...s, time });
  }
  return time;
}

function matrices(m: InstancedMesh): number[][] {
  const out: number[][] = [];
  const mat = new Matrix4();
  for (let i = 0; i < m.count; i++) {
    m.getMatrixAt(i, mat);
    out.push([...mat.elements]);
  }
  return out;
}

describe('createLaunchFx', () => {
  it('costs at most six draw calls and uses no real lights', () => {
    const fx = createLaunchFx({ accent: '#a98bff', footprint: 6 });
    const meshes: Mesh[] = [];
    fx.group.traverse((o: Object3D) => {
      expect((o as Light).isLight).toBeFalsy();
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(meshes.length).toBeLessThanOrEqual(6);
    for (const m of meshes) {
      expect(Array.isArray(m.material)).toBe(false);
      expect(m.geometry.groups.length).toBeLessThanOrEqual(1);
    }
    fx.dispose();
  });

  it('is hidden while idle and fades in and out with the launch window', () => {
    const fx = createLaunchFx({ accent: '#ffb444', footprint: 5 });
    expect(fx.group.visible).toBe(false);
    run(fx, { active: false }, 1);
    expect(fx.group.visible).toBe(false);
    const t = run(fx, { active: true }, 3);
    expect(fx.group.visible).toBe(true);
    expect(byName(fx, 'launch-beams').visible).toBe(true);
    expect(byName(fx, 'launch-ring').visible).toBe(false);
    run(fx, { active: false }, 5, t);
    expect(fx.group.visible).toBe(false);
    fx.dispose();
  });

  it('shows the burst even outside the window, and only the burst', () => {
    const fx = createLaunchFx({ accent: '#ffb444', footprint: 5 });
    run(fx, { active: false, burst: 0.8 }, 0.1);
    expect(fx.group.visible).toBe(true);
    expect(byName(fx, 'launch-ring').visible).toBe(true);
    expect(byName(fx, 'launch-beams').visible).toBe(false);
    expect(byName(fx, 'launch-crowd').visible).toBe(false);
    run(fx, { active: false, burst: 0 }, 0.1);
    expect(fx.group.visible).toBe(false);
    fx.dispose();
  });

  it('places drones around the crown and the crowd on the front plaza', () => {
    const fp = 7;
    const h = 30;
    const fx = createLaunchFx({ accent: '#45a6ff', footprint: fp });
    run(fx, { height: h }, 4);
    const drones = byName(fx, 'launch-drones') as InstancedMesh;
    const crowd = byName(fx, 'launch-crowd') as InstancedMesh;
    expect(drones.count).toBe(droneCount(fp));
    expect(crowd.count).toBe(crowdCount(fp));
    const p = new Vector3();
    for (const e of matrices(drones)) {
      p.set(e[12]!, e[13]!, e[14]!);
      expect(p.y).toBeGreaterThanOrEqual(h + 2);
      expect(p.y).toBeLessThanOrEqual(h + 4);
    }
    for (const e of matrices(crowd)) {
      p.set(e[12]!, e[13]!, e[14]!);
      expect(p.z).toBeGreaterThan(0);
      expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(fp + 1.5 - 1e-6);
      expect(p.y).toBeLessThan(0.1);
    }
    fx.dispose();
  });

  it('holds everything still with reduced motion', () => {
    const fx = createLaunchFx({ accent: '#5cf2a6', footprint: 5.5 });
    const t = run(fx, { reducedMotion: true }, 3);
    const names = ['launch-beams', 'launch-drones', 'launch-crowd', 'launch-glows'];
    const before = names.map((n) => matrices(byName(fx, n) as InstancedMesh));
    run(fx, { reducedMotion: true }, 2.7, t);
    const after = names.map((n) => matrices(byName(fx, n) as InstancedMesh));
    expect(after).toEqual(before);
    fx.dispose();
  });

  it('moves with full motion', () => {
    const fx = createLaunchFx({ accent: '#5cf2a6', footprint: 5.5 });
    const t = run(fx, {}, 3);
    const before = matrices(byName(fx, 'launch-drones') as InstancedMesh);
    run(fx, {}, 1, t);
    expect(matrices(byName(fx, 'launch-drones') as InstancedMesh)).not.toEqual(before);
    fx.dispose();
  });

  it('survives odd input', () => {
    const fx = createLaunchFx({ accent: '#e9eef7', footprint: Number.NaN });
    expect(() =>
      fx.update({
        active: true,
        burst: Number.NaN,
        time: Number.NaN,
        height: -5,
        reducedMotion: false,
      }),
    ).not.toThrow();
    expect(() => run(fx, { burst: 3, height: Number.POSITIVE_INFINITY }, 0.5)).not.toThrow();
    fx.dispose();
  });

  it('disposes every geometry and material', () => {
    const fx = createLaunchFx({ accent: '#ff6f8e', footprint: 6 });
    const spies: MockInstance[] = [];
    fx.group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      spies.push(vi.spyOn(o.geometry, 'dispose'), vi.spyOn(o.material as Material, 'dispose'));
      if (o instanceof InstancedMesh) spies.push(vi.spyOn(o, 'dispose'));
    });
    expect(spies.length).toBeGreaterThanOrEqual(16);
    fx.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
  });
});
