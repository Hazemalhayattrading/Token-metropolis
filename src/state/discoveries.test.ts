import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BatchedMesh,
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Object3D,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { COPY } from '../copy';
import type { Platform } from '../data/schema';
import { createCampus, type Campus } from '../world/campus/campus';
import {
  campusCovers,
  clearArc,
  coffeePuffs,
  coffeeRate,
  createDiscoveryProps,
  detailHosts,
  findSpot,
  interiorDetails,
  isNightHour,
  officeSeats,
  type DiscoveryProps,
  type InteriorKind,
} from '../world/discoveries';
import { ISLAND_RADIUS, layoutPlots } from '../world/layout';
import {
  createTracker,
  DISCOVERIES,
  DISCOVERY_STORAGE_KEY,
  DISCOVERY_WHERES,
  discoveriesIn,
  discoveryById,
  parseFound,
  serializeFound,
} from './discoveries';

/** The platform ids of the published dataset. */
const PLATFORM_IDS: string[] = (
  JSON.parse(readFileSync(join(process.cwd(), 'public/data/platforms.json'), 'utf8')) as {
    id: string;
  }[]
).map((p) => p.id);

/** An in-memory Storage with call counters. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    removeItem: vi.fn((k: string) => void data.delete(k)),
  };
}

const items: Record<string, { title: string; hint: string }> = COPY.discoveries.items;

describe('DISCOVERIES', () => {
  it('has exactly forty details with unique, stable-looking ids', () => {
    expect(DISCOVERIES).toHaveLength(40);
    const ids = DISCOVERIES.map((x) => x.id);
    expect(new Set(ids).size).toBe(40);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('spreads them over the island and every interior view', () => {
    const per = Object.fromEntries(
      DISCOVERY_WHERES.map((w) => [w, DISCOVERIES.filter((x) => x.where === w).length]),
    );
    expect(per).toEqual({ city: 16, offices: 6, hall: 6, power: 6, lab: 6 });
    for (const x of DISCOVERIES) expect(DISCOVERY_WHERES).toContain(x.where);
  });

  it('ties details only to HQs that exist, and never ties a city detail', () => {
    for (const x of DISCOVERIES) {
      if (x.where === 'city') expect(x.platform).toBeUndefined();
      if (x.platform !== undefined) expect(PLATFORM_IDS).toContain(x.platform);
    }
  });

  it('gives every HQ at least one detail of its own, and every interior view a shared one', () => {
    expect(PLATFORM_IDS).toHaveLength(15);
    for (const id of PLATFORM_IDS) {
      expect(DISCOVERIES.some((x) => x.platform === id)).toBe(true);
    }
    for (const w of ['offices', 'hall', 'power', 'lab'] as const) {
      expect(DISCOVERIES.some((x) => x.where === w && x.platform === undefined)).toBe(true);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DISCOVERIES)).toBe(true);
    expect(Object.isFrozen(DISCOVERIES[0])).toBe(true);
  });

  it('has a title and a hint in COPY for every detail, and no orphan copy', () => {
    for (const x of DISCOVERIES) {
      const c = items[x.id];
      expect(c, x.id).toBeDefined();
      expect(c!.title.trim().length).toBeGreaterThan(3);
      expect(c!.hint.trim().length).toBeGreaterThan(10);
      expect(c!.hint).not.toContain(c!.title); // a hint never gives the answer away verbatim
    }
    expect(Object.keys(items).sort()).toEqual(DISCOVERIES.map((x) => x.id).sort());
  });

  it('never names a company in a hint (the hunt is for the visitor, and hints make no claims)', () => {
    const names = (
      JSON.parse(readFileSync(join(process.cwd(), 'public/data/platforms.json'), 'utf8')) as {
        name: string;
        parent: string;
      }[]
    ).flatMap((p) => [p.name, p.parent]);
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const c of Object.values(items)) {
      for (const n of names) {
        const word = new RegExp(`\\b${escape(n)}\\b`, 'i');
        expect(c.hint).not.toMatch(word);
        expect(c.title).not.toMatch(word);
      }
    }
  });

  it('looks details up by id and by view', () => {
    expect(discoveryById('server-cat')).toEqual({
      id: 'server-cat',
      where: 'hall',
      platform: 'deepseek',
    });
    expect(discoveryById('nope')).toBeUndefined();
    expect(discoveriesIn('city')).toHaveLength(16);
    // The shared hall detail everywhere; the cat only in its own HQ.
    expect(discoveriesIn('hall', 'chatgpt').map((x) => x.id)).toEqual([
      'sticky-note',
      'mop-bucket',
    ]);
    expect(discoveriesIn('hall', 'deepseek').map((x) => x.id)).toEqual([
      'server-cat',
      'mop-bucket',
    ]);
    expect(discoveriesIn('hall').map((x) => x.id)).toEqual(['mop-bucket']);
    expect(discoveriesIn('offices', 'unknown-hq').map((x) => x.id)).toEqual([
      'night-shift',
      'coffee-machine',
    ]);
  });
});

describe('parseFound / serializeFound', () => {
  it('round-trips in DISCOVERIES order', () => {
    const s = serializeFound(['owl', 'fox', 'lighthouse']);
    expect(JSON.parse(s)).toEqual({ v: 1, found: ['lighthouse', 'fox', 'owl'] });
    expect(parseFound(s)).toEqual(['lighthouse', 'fox', 'owl']);
  });

  it('accepts a bare array and drops unknown, duplicate and non-string entries', () => {
    expect(parseFound('["fox", "fox", "unicorn", 3, null, {"id": "owl"}, "owl"]')).toEqual([
      'fox',
      'owl',
    ]);
  });

  it('ignores corrupt or unexpected data', () => {
    for (const raw of [
      null,
      undefined,
      '',
      '{',
      'null',
      'true',
      '42',
      '"fox"',
      '{"found": "fox"}',
      '{"v": 1}',
      '[[["fox"]]]',
      `[${'"fox",'.repeat(30_000)}"fox"]`, // absurdly large
    ]) {
      expect(parseFound(raw)).toEqual([]);
    }
  });
});

describe('createTracker', () => {
  it('marks each known detail once and counts them', () => {
    const t = createTracker({ storage: null });
    expect(t.total).toBe(40);
    expect(t.count).toBe(0);
    expect(t.has('fox')).toBe(false);
    expect(t.mark('fox')).toBe(true);
    expect(t.mark('fox')).toBe(false);
    expect(t.mark('owl')).toBe(true);
    expect(t.has('fox')).toBe(true);
    expect(t.count).toBe(2);
  });

  it('ignores unknown ids', () => {
    const storage = memoryStorage();
    const t = createTracker({ storage });
    expect(t.mark('unicorn')).toBe(false);
    expect(t.mark('')).toBe(false);
    expect(t.has('unicorn')).toBe(false);
    expect(t.count).toBe(0);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('persists under the default key and restores in a new tracker', () => {
    const storage = memoryStorage();
    const a = createTracker({ storage });
    a.mark('lighthouse');
    a.mark('server-cat');
    expect(storage.data.has(DISCOVERY_STORAGE_KEY)).toBe(true);
    expect(DISCOVERY_STORAGE_KEY).toBe('token-metropolis:discoveries:v1');
    const b = createTracker({ storage });
    expect(b.count).toBe(2);
    expect(b.has('server-cat')).toBe(true);
  });

  it('uses a custom key', () => {
    const storage = memoryStorage();
    createTracker({ storage, key: 'custom' }).mark('fox');
    expect([...storage.data.keys()]).toEqual(['custom']);
    expect(createTracker({ storage }).count).toBe(0);
    expect(createTracker({ storage, key: 'custom' }).count).toBe(1);
  });

  it('drops unknown ids and survives corrupt stored data', () => {
    const t = createTracker({
      storage: memoryStorage({ [DISCOVERY_STORAGE_KEY]: '{"v":1,"found":["fox","gone-id"]}' }),
    });
    expect(t.count).toBe(1);
    expect(t.has('gone-id')).toBe(false);
    const corrupt = memoryStorage({ [DISCOVERY_STORAGE_KEY]: '{not json' });
    const u = createTracker({ storage: corrupt });
    expect(u.count).toBe(0);
    expect(u.mark('owl')).toBe(true);
    expect(parseFound(corrupt.data.get(DISCOVERY_STORAGE_KEY))).toEqual(['owl']);
  });

  it('keeps working in memory when every storage call throws', () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    const t = createTracker({ storage: { getItem: boom, setItem: boom, removeItem: boom } });
    expect(t.count).toBe(0);
    expect(t.mark('fox')).toBe(true);
    expect(t.has('fox')).toBe(true);
    expect(() => t.reset()).not.toThrow();
    expect(t.count).toBe(0);
  });

  it('works without any storage (default: localStorage when present)', () => {
    const t = createTracker();
    expect(t.mark('fox')).toBe(true);
    expect(t.count).toBe(1);
  });

  it('merges finds made meanwhile by another tab on the same storage', () => {
    const storage = memoryStorage();
    const tabA = createTracker({ storage });
    const tabB = createTracker({ storage });
    tabA.mark('fox');
    tabB.mark('owl');
    expect(createTracker({ storage }).count).toBe(2);
    expect(tabB.has('fox')).toBe(true);
  });

  it('resets progress and removes the stored copy', () => {
    const storage = memoryStorage();
    const t = createTracker({ storage });
    t.mark('fox');
    t.reset();
    expect(t.count).toBe(0);
    expect(t.has('fox')).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith(DISCOVERY_STORAGE_KEY);
    expect(storage.data.size).toBe(0);
    expect(createTracker({ storage }).count).toBe(0);
  });

  it('notifies subscribers on new finds and resets, and unsubscribes', () => {
    const t = createTracker({ storage: null });
    const fn = vi.fn();
    const off = t.subscribe(fn);
    t.mark('fox');
    t.mark('fox'); // not new: no call
    t.mark('unicorn'); // unknown: no call
    expect(fn).toHaveBeenCalledTimes(1);
    t.reset();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    t.mark('owl');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keeps notifying the others when one subscriber throws', () => {
    const t = createTracker({ storage: null });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = vi.fn();
    t.subscribe(() => {
      throw new Error('listener bug');
    });
    t.subscribe(good);
    expect(t.mark('fox')).toBe(true);
    expect(good).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('lets a subscriber unsubscribe itself during a notification', () => {
    const t = createTracker({ storage: null });
    const calls: string[] = [];
    const off = t.subscribe(() => {
      calls.push('a');
      off();
    });
    t.subscribe(() => calls.push('b'));
    t.mark('fox');
    t.mark('owl');
    expect(calls).toEqual(['a', 'b', 'b']);
  });
});

// ---------------------------------------------------------------------------
// The props in 3D (src/world/discoveries.ts) — exercised headless, without a renderer.
// ---------------------------------------------------------------------------

const PLATFORMS = JSON.parse(
  readFileSync(join(process.cwd(), 'public/data/platforms.json'), 'utf8'),
) as Platform[];

/** The real island: every campus from the dataset on its fixed plot. */
function realCampuses(): Campus[] {
  const plots = layoutPlots(PLATFORMS.map((p) => p.id));
  return PLATFORMS.map((p) => {
    const c = createCampus(p, plots.get(p.id)!);
    c.group.updateMatrixWorld(true);
    return c;
  });
}

const CAMPUSES = realCampuses();
const SHAPES = CAMPUSES.map((c) => ({
  toLocal: c.group.matrixWorld.clone().invert(),
  footprint: c.footprint,
}));

function makeProps(reducedMotion = false): DiscoveryProps {
  return createDiscoveryProps({
    campuses: CAMPUSES.map((c) => ({ id: c.id, group: c.group, footprint: c.footprint })),
    islandRadius: ISLAND_RADIUS,
    reducedMotion,
  });
}

const frame = (time: number, extra: Partial<Parameters<DiscoveryProps['update']>[0]> = {}) => ({
  time,
  hours: new Map<string, number>(),
  loads: new Map<string, number>(),
  reducedMotion: false,
  ...extra,
});

const idsOf = (list: readonly Object3D[]) => list.map((o) => o.userData.discoveryId as string);

function worldPos(o: Object3D): Vector3 {
  o.updateWorldMatrix(true, false);
  return new Vector3().setFromMatrixPosition(o.matrixWorld);
}

/** An office diorama stand-in: an instanced desk top (0.06 high) per seat, like offices.ts. */
function fakeOffices(seats: readonly [number, number, number][]): Group {
  const g = new Group();
  const desks = new InstancedMesh(
    new BoxGeometry(0.9, 0.06, 0.5),
    new MeshBasicMaterial(),
    seats.length,
  );
  seats.forEach(([x, y, z], i) =>
    desks.setMatrixAt(i, new Matrix4().makeTranslation(x, y + 0.72, z)),
  );
  g.add(new InstancedMesh(new BoxGeometry(1.21, 0.12, 1.56), new MeshBasicMaterial(), 1), desks);
  return g;
}

/** A model-lab stand-in: a plinth 2 × half + 0.6 wide, like lab.ts. */
function fakeLab(half: number): Group {
  const g = new Group();
  const plinth = new Mesh(new BoxGeometry(half * 2 + 0.6, 0.18, 2.4), new MeshBasicMaterial());
  plinth.position.set(0, 0.09, -0.4);
  g.add(plinth);
  return g;
}

function interiorParent(view: InteriorKind, campus: Campus): Group {
  const parent =
    view === 'offices'
      ? fakeOffices([
          [0, 0.66, 0],
          [1.3, 0.66, 0],
          [0, 0.66, 1.7],
          [1.3, 3.26, 0.4],
          [-1.3, 3.26, 0],
        ])
      : view === 'lab'
        ? fakeLab(4)
        : new Group();
  campus.group.add(parent);
  return parent;
}

describe('discovery props: small pure helpers', () => {
  it('knows night at an HQ, and treats an unknown hour as night', () => {
    for (const h of [21, 23.9, 0, 3, 6.4]) expect(isNightHour(h)).toBe(true);
    for (const h of [6.5, 9, 12, 18, 20.9]) expect(isNightHour(h)).toBe(false);
    expect(isNightHour(undefined)).toBe(true);
    expect(isNightHour(Number.NaN)).toBe(true);
    expect(isNightHour(-1)).toBe(true); // 23:00
  });

  it('works the coffee machine harder as load rises', () => {
    expect(coffeePuffs(0)).toBe(1);
    expect(coffeePuffs(1)).toBe(6);
    expect(coffeePuffs(Number.NaN)).toBe(1);
    expect(coffeePuffs(7)).toBe(6);
    let last = 0;
    for (let l = 0; l <= 1.0001; l += 0.05) {
      expect(coffeePuffs(l)).toBeGreaterThanOrEqual(last);
      last = coffeePuffs(l);
      expect(coffeeRate(l + 0.05)).toBeGreaterThan(coffeeRate(l) - 1e-12);
    }
  });

  it('finds the first clear spot near a preference, swinging out on both sides', () => {
    const blocked = (x: number, z: number) => Math.atan2(z, x) < 0.1 && Math.atan2(z, x) > -0.1;
    const s = findSpot(blocked, 0, [10], 0.4, 0.02);
    expect(s.clear).toBe(true);
    expect(Math.abs(s.angle)).toBeGreaterThanOrEqual(0.1);
    expect(Math.abs(s.angle)).toBeLessThan(0.13);
    expect(Math.hypot(s.x, s.z)).toBeCloseTo(10, 6);
    // Nothing clear: the preferred spot comes back, flagged.
    const none = findSpot(() => true, 1, [5, 6], 0.1);
    expect(none.clear).toBe(false);
    expect(none.angle).toBe(1);
    expect(none.radius).toBe(5);
  });

  it('measures the clear arc around a spot', () => {
    const blocked = (x: number, z: number) => Math.abs(Math.atan2(z, x)) > 0.2;
    const [lo, hi] = clearArc(blocked, 0, 10, 1);
    expect(lo).toBeCloseTo(-0.2, 1);
    expect(hi).toBeCloseTo(0.2, 1);
    const [a, b] = clearArc(() => false, 0, 10, 0.3);
    expect(a).toBeCloseTo(-0.3, 1);
    expect(b).toBeCloseTo(0.3, 1);
  });

  it('knows where a campus stands: plaza and truck loop, halls behind, cooling beside', () => {
    const g = new Group();
    g.updateMatrixWorld(true);
    const c = { toLocal: g.matrixWorld.clone().invert(), footprint: 5 };
    expect(campusCovers(c, 0, 0)).toBe(true);
    expect(campusCovers(c, 15, 0)).toBe(true); // truck loop (radius 14.5)
    expect(campusCovers(c, 0, -18)).toBe(true); // second row of server halls
    expect(campusCovers(c, 15.5, -6)).toBe(true); // far cooling tower
    expect(campusCovers(c, 0, 17)).toBe(false); // in front, past the loop
    expect(campusCovers(c, 30, 0)).toBe(false);
    expect(campusCovers(c, 0, 17, 2)).toBe(true); // a margin widens it
    // Turned and moved: the halls follow the campus's back.
    g.position.set(40, 0, 0);
    g.rotation.y = Math.PI / 2; // local −z → world −x
    g.updateMatrixWorld(true);
    const turned = { toLocal: g.matrixWorld.clone().invert(), footprint: 5 };
    expect(campusCovers(turned, 40 - 18, 0)).toBe(true);
    expect(campusCovers(turned, 40, 18)).toBe(false);
  });

  it('hosts every HQ-specific detail in its own HQ, or re-homes it when that HQ is missing', () => {
    const all = PLATFORMS.map((p) => p.id);
    const hosts = detailHosts(all);
    for (const d of DISCOVERIES) {
      if (d.platform) expect(hosts.get(d.id)).toBe(d.platform);
      else expect(hosts.has(d.id)).toBe(false);
    }
    const without = all.filter((id) => id !== 'deepseek');
    const moved = detailHosts(without);
    const cat = moved.get('server-cat');
    expect(cat).toBeDefined();
    expect(without).toContain(cat);
    // …never onto an HQ that already has a server-hall detail of its own.
    const hallHosts = DISCOVERIES.filter((d) => d.where === 'hall' && d.id !== 'server-cat').map(
      (d) => moved.get(d.id),
    );
    expect(hallHosts).not.toContain(cat);
    expect(detailHosts(without)).toEqual(moved); // deterministic
  });

  it('lists the details an interior view shows for one HQ', () => {
    const hosts = detailHosts(PLATFORMS.map((p) => p.id));
    expect(idsOf([])).toEqual([]);
    expect(interiorDetails('hall', 'deepseek', hosts).map((d) => d.id)).toEqual([
      'server-cat',
      'mop-bucket',
    ]);
    expect(interiorDetails('power', 'chatgpt', hosts).map((d) => d.id)).toEqual([
      'night-inspector',
      'birds-on-wire',
    ]);
    expect(interiorDetails('lab', 'nobody', hosts).map((d) => d.id)).toEqual(['lab-plant']);
  });

  it('reads office seats from the diorama, never-occupied desks first', () => {
    const seats = officeSeats(
      fakeOffices([
        [0, 0.66, 0],
        [2, 0.66, 0],
        [4, 3.26, 1],
      ]),
    );
    expect(seats).toHaveLength(3);
    for (const s of seats) expect([0.66, 3.26].some((y) => Math.abs(s.y - y) < 1e-6)).toBe(true);
    expect(officeSeats(new Group())).toEqual([]);
  });
});

describe('discovery props: the island', () => {
  const props = makeProps();

  it('has one generous pick target for each island detail', () => {
    const island = DISCOVERIES.filter((d) => d.where === 'city').map((d) => d.id);
    expect(idsOf(props.pickables).sort()).toEqual([...island].sort());
    for (const p of props.pickables) {
      expect(p).toBeInstanceOf(Mesh);
      const m = p as Mesh;
      expect((m.material as MeshBasicMaterial).visible).toBe(false); // never drawn
      expect(Math.min(m.scale.x, m.scale.y, m.scale.z)).toBeGreaterThanOrEqual(0.9);
      expect(m.layers.mask).toBe(1);
    }
  });

  it('draws every island prop with two draw calls', () => {
    const drawn = props.group.children.filter(
      (c) => !(c instanceof Mesh && !(c instanceof BatchedMesh)),
    );
    expect(drawn).toHaveLength(2);
    expect(drawn.every((c) => c instanceof BatchedMesh)).toBe(true);
  });

  it('keeps ground props clear of every campus, on the island or out at sea', () => {
    for (const t of [0, 7.3, 31, 95]) {
      props.update(frame(t));
      for (const p of props.pickables) {
        const v = worldPos(p);
        const r = Math.hypot(v.x, v.z);
        const id = p.userData.discoveryId as string;
        expect(Number.isFinite(r), id).toBe(true);
        expect(r, id).toBeLessThan(ISLAND_RADIUS + 30);
        const inAir = v.y > 5;
        const atSea = r > ISLAND_RADIUS + 2;
        if (inAir || atSea) continue;
        expect(r, id).toBeLessThanOrEqual(ISLAND_RADIUS);
        for (const c of SHAPES) expect(campusCovers(c, v.x, v.z), id).toBe(false);
      }
    }
  });

  it('keeps flying props away from the towers', () => {
    for (const t of [0, 12, 40, 200]) {
      props.update(frame(t));
      for (const id of ['delivery-drone', 'paper-plane', 'hot-air-balloon']) {
        const v = worldPos(props.pickables.find((p) => p.userData.discoveryId === id)!);
        for (const c of CAMPUSES) {
          const d = Math.hypot(v.x - c.group.position.x, v.z - c.group.position.z);
          expect(d, id).toBeGreaterThan(c.footprint + 2);
        }
      }
    }
  });

  it('moves, and holds still with reduced motion', () => {
    const drone = () =>
      worldPos(props.pickables.find((p) => p.userData.discoveryId === 'delivery-drone')!);
    props.update(frame(1));
    const a = drone();
    props.update(frame(6));
    expect(drone().distanceTo(a)).toBeGreaterThan(0.5);
    props.update(frame(1, { reducedMotion: true }));
    const b = drone();
    props.update(frame(60, { reducedMotion: true }));
    expect(drone().distanceTo(b)).toBe(0);
    // Reduced motion from the start: every pick target stays put.
    const calm = makeProps(true);
    const before = calm.pickables.map(worldPos);
    calm.update(frame(42, { reducedMotion: true }));
    calm.pickables.forEach((p, i) => expect(worldPos(p).distanceTo(before[i]!)).toBe(0));
    calm.dispose();
  });

  it('places the same props in the same places every time (no randomness)', () => {
    // three.js itself draws object UUIDs from Math.random, so check our source instead.
    const src = readFileSync(join(process.cwd(), 'src/world/discoveries.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/Math\.random/);
    const again = makeProps();
    again.update(frame(3));
    props.update(frame(3));
    again.pickables.forEach((p, i) =>
      expect(worldPos(p).distanceTo(worldPos(props.pickables[i]!))).toBeLessThan(1e-9),
    );
    again.dispose();
  });
});

describe('discovery props: interiors', () => {
  const views: InteriorKind[] = ['offices', 'hall', 'power', 'lab'];

  it('decorates every view of every HQ with its shared and own details', () => {
    const props = makeProps();
    const hosts = detailHosts(PLATFORMS.map((p) => p.id));
    const found = new Set<string>();
    for (const campus of CAMPUSES) {
      for (const view of views) {
        const parent = interiorParent(view, campus);
        const picks = props.decorateInterior(view, parent, campus);
        const expected = interiorDetails(view, campus.id, hosts).map((d) => d.id);
        expect(idsOf(picks), `${campus.id} ${view}`).toEqual(expected);
        for (const p of picks) {
          let o: Object3D | null = p;
          while (o && o !== parent) o = o.parent;
          expect(o, `${campus.id} ${view}`).toBe(parent);
          found.add(p.userData.discoveryId as string);
        }
        // At most two draw calls per decorated view.
        const batches: BatchedMesh[] = [];
        parent.traverse((o) => o instanceof BatchedMesh && batches.push(o));
        expect(batches.length).toBeLessThanOrEqual(2);
        parent.removeFromParent();
      }
    }
    // Every interior detail can be found somewhere.
    for (const d of DISCOVERIES.filter((x) => x.where !== 'city'))
      expect(found.has(d.id), d.id).toBe(true);
    props.dispose();
  });

  it('returns the same targets when a parent is decorated twice, and replaces a changed view', () => {
    const props = makeProps();
    const campus = CAMPUSES.find((c) => c.id === 'deepseek')!;
    const parent = interiorParent('hall', campus);
    const first = props.decorateInterior('hall', parent, campus);
    const count = parent.children.length;
    const second = props.decorateInterior('hall', parent, campus);
    expect(second).toEqual(first);
    expect(parent.children.length).toBe(count);
    const power = props.decorateInterior('power', parent, campus);
    expect(idsOf(power)).toEqual(['night-inspector']);
    expect(parent.children.length).toBe(count);
    props.dispose();
    expect(parent.children.length).toBe(count - 1);
  });

  it('puts the night-shift nap to bed only at night, and makes it unpickable by day', () => {
    const props = makeProps();
    const campus = CAMPUSES.find((c) => c.id === 'claude')!;
    const parent = interiorParent('offices', campus);
    const picks = props.decorateInterior('offices', parent, campus);
    const nap = picks.find((p) => p.userData.discoveryId === 'night-shift')!;
    expect(nap).toBeDefined();
    props.update(frame(5, { hours: new Map([['claude', 13]]) }));
    expect(nap.layers.mask).toBe(0);
    props.update(frame(6, { hours: new Map([['claude', 23.5]]) }));
    expect(nap.layers.mask).toBe(1);
    props.dispose();
  });

  it('poses an interior decorated between frames with the latest hours (no flash of the nap by day)', () => {
    const props = makeProps();
    const campus = CAMPUSES.find((c) => c.id === 'qwen')!;
    props.update(frame(5, { hours: new Map([['qwen', 11]]) }));
    const parent = interiorParent('offices', campus);
    const nap = props
      .decorateInterior('offices', parent, campus)
      .find((p) => p.userData.discoveryId === 'night-shift')!;
    expect(nap.layers.mask).toBe(0);
    props.dispose();
  });

  it('seats the office props at real desks', () => {
    const props = makeProps();
    const campus = CAMPUSES.find((c) => c.id === 'cursor')!;
    const desks: [number, number, number][] = [
      [0, 0.66, 0],
      [1.3, 0.66, 0],
      [0, 3.26, 1.7],
    ];
    const parent = fakeOffices(desks);
    campus.group.add(parent);
    const picks = props.decorateInterior('offices', parent, campus);
    expect(idsOf(picks)).toEqual(['night-shift', 'coffee-machine', 'office-dog']);
    for (const p of picks) {
      const near = desks.some(
        ([x, y, z]) =>
          Math.hypot(p.position.x - x, p.position.z - z) < 0.7 &&
          p.position.y >= y &&
          p.position.y < y + 1.3,
      );
      expect(near, p.userData.discoveryId as string).toBe(true);
    }
    // No desks (an empty diorama): nothing to decorate, and no error.
    const empty = new Group();
    campus.group.add(empty);
    expect(props.decorateInterior('offices', empty, campus)).toEqual([]);
    props.dispose();
  });

  it('fits the lab props to the width of the display', () => {
    const props = makeProps();
    const campus = CAMPUSES.find((c) => c.id === 'meta-ai')!;
    for (const half of [2, 5.5]) {
      const parent = fakeLab(half);
      campus.group.add(parent);
      props.update(frame(10));
      for (const p of props.decorateInterior('lab', parent, campus)) {
        expect(Math.abs(p.position.x), p.userData.discoveryId as string).toBeLessThanOrEqual(
          half + 0.3,
        );
      }
    }
    props.dispose();
  });

  it('releases an interior once its group is detached (the interior was disposed)', () => {
    const props = makeProps();
    const campus = CAMPUSES.find((c) => c.id === 'grok')!;
    const parent = interiorParent('power', campus);
    props.decorateInterior('power', parent, campus);
    const root = parent.children.find((c) => c.name.startsWith('discoveries-'))!;
    expect(root).toBeDefined();
    props.update(frame(1));
    expect(root.parent).toBe(parent);
    parent.removeFromParent();
    props.update(frame(2));
    expect(root.parent).toBeNull();
    // A group decorated before it is attached is kept until it is attached and then detached.
    const early = new Group();
    props.decorateInterior('power', early, campus);
    props.update(frame(3));
    expect(early.children).toHaveLength(1);
    campus.group.add(early);
    props.update(frame(4));
    early.removeFromParent();
    props.update(frame(5));
    expect(early.children).toHaveLength(0);
    props.dispose();
  });

  it('disposes cleanly', () => {
    const props = makeProps();
    const campus = CAMPUSES[0]!;
    const parent = interiorParent('lab', campus);
    props.decorateInterior('lab', parent, campus);
    const scene = new Group();
    scene.add(props.group);
    expect(() => props.dispose()).not.toThrow();
    expect(props.group.parent).toBeNull();
    expect(props.group.children).toHaveLength(0);
    expect(parent.children.some((c) => c.name.startsWith('discoveries-'))).toBe(false);
    parent.removeFromParent();
  });
});
