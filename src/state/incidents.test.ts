import { InstancedMesh, Matrix4, Mesh, type Light, type Material, type Object3D } from 'three';
import { describe, expect, it, vi, type MockInstance } from 'vitest';
import { IncidentSchema, type Incident } from '../data/schema';
import {
  alarmFlicker,
  alarmLevel,
  ALARM_STYLES,
  beaconLayout,
  createAlarmFx,
  FLICKER_MIN,
  REDUCED_FLICKER,
  slotHash,
  type AlarmFx,
  type AlarmFxState,
} from '../world/alarm';
import {
  activeIncidents,
  compareIncidents,
  incidentSeverity,
  incidentsSignature,
  isActiveAt,
  parseInstant,
  utcParts,
  visibleIncidents,
} from './incidents';

// ---------------------------------------------------------------------------
// fixtures: validated against the published schema, like public/data/incidents.json
// ---------------------------------------------------------------------------

function inc(p: Partial<Incident> & Pick<Incident, 'id' | 'platform'>): Incident {
  return IncidentSchema.parse({
    impact: 'major',
    title: 'Elevated error rates',
    started: '2026-09-26T10:00:00Z',
    resolved: null,
    url: `https://status.example.com/incidents/${p.id}`,
    ...p,
  });
}

const at = (iso: string) => Date.parse(iso);
const T = at('2026-09-26T12:00:00Z');

describe('incidentSeverity', () => {
  it('orders critical > major > minor > maintenance > none, with none = 0', () => {
    const order = ['critical', 'major', 'minor', 'maintenance', 'none'] as const;
    for (let i = 0; i < order.length - 1; i++)
      expect(incidentSeverity(order[i]!)).toBeGreaterThan(incidentSeverity(order[i + 1]!));
    expect(incidentSeverity('none')).toBe(0);
    expect(incidentSeverity('maintenance')).toBeGreaterThan(0);
  });
});

describe('parseInstant', () => {
  it('reads status-page timestamps as instants', () => {
    expect(parseInstant('2026-09-26T10:00:00Z')).toBe(Date.UTC(2026, 8, 26, 10));
    expect(parseInstant('2026-09-26T10:00:00.000Z')).toBe(Date.UTC(2026, 8, 26, 10));
    expect(parseInstant('2026-09-26T03:00:00-07:00')).toBe(Date.UTC(2026, 8, 26, 10));
  });

  it('reads dates and zone-less times as UTC, the same for every visitor', () => {
    expect(parseInstant('2026-09-26')).toBe(Date.UTC(2026, 8, 26));
    expect(parseInstant('2026-09-26T10:00:00')).toBe(Date.UTC(2026, 8, 26, 10));
    expect(parseInstant('2026-09-26 10:00')).toBe(Date.UTC(2026, 8, 26, 10));
    expect(parseInstant(' 2026-09-26T10:00:00Z ')).toBe(Date.UTC(2026, 8, 26, 10));
  });

  it('returns null for text it cannot read', () => {
    expect(parseInstant('not a date at all')).toBeNull();
    expect(parseInstant('2026-13-45T99:00:00Z')).toBeNull();
    expect(parseInstant('')).toBeNull();
  });
});

describe('isActiveAt', () => {
  const open = inc({ id: 'open-1', platform: 'chatgpt' });

  it('is active from its start (inclusive) while unresolved', () => {
    expect(isActiveAt(open, at('2026-09-26T09:59:59Z'))).toBe(false);
    expect(isActiveAt(open, at('2026-09-26T10:00:00Z'))).toBe(true);
    expect(isActiveAt(open, at('2027-01-01T00:00:00Z'))).toBe(true);
  });

  it('ends at its resolution (exclusive), so a replayed past shows it only while it lasted', () => {
    const done = inc({ id: 'done-1', platform: 'chatgpt', resolved: '2026-09-26T11:30:00Z' });
    expect(isActiveAt(done, at('2026-09-26T11:29:59Z'))).toBe(true);
    expect(isActiveAt(done, at('2026-09-26T11:30:00Z'))).toBe(false);
    expect(isActiveAt(done, T)).toBe(false);
  });

  it('never shows impact "none", and claims nothing from unreadable times', () => {
    expect(isActiveAt(inc({ id: 'none-1', platform: 'x', impact: 'none' }), T)).toBe(false);
    expect(isActiveAt(inc({ id: 'bad-start', platform: 'x', started: 'sometime today' }), T)).toBe(
      false,
    );
    expect(isActiveAt(inc({ id: 'bad-end', platform: 'x', resolved: 'eventually!' }), T)).toBe(
      false,
    );
  });

  it('shows ongoing maintenance, but not maintenance still to come', () => {
    const now = inc({ id: 'mnt-1', platform: 'x', impact: 'maintenance' });
    const later = inc({
      id: 'mnt-2',
      platform: 'x',
      impact: 'maintenance',
      started: '2026-09-27T01:00:00Z',
      resolved: '2026-09-27T03:00:00Z',
    });
    expect(isActiveAt(now, T)).toBe(true);
    expect(isActiveAt(later, T)).toBe(false);
  });

  it('can ignore unresolved incidents left open by a stale feed', () => {
    const old = inc({ id: 'old-1', platform: 'x', started: '2026-09-01T00:00:00Z' });
    expect(isActiveAt(old, T)).toBe(true);
    expect(isActiveAt(old, T, { staleAfterMs: 7 * 86_400_000 })).toBe(false);
    expect(isActiveAt(open, T, { staleAfterMs: 7 * 86_400_000 })).toBe(true);
  });

  it('shows a notice only while the pipeline read it recently, and never without that time', () => {
    const within = { checkedWithinMs: 3 * 3_600_000 };
    const fresh = inc({ id: 'f-1', platform: 'x', checked: new Date(T - 3_600_000).toISOString() });
    const stale = inc({
      id: 's-1',
      platform: 'x',
      checked: new Date(T - 4 * 3_600_000).toISOString(),
    });
    const unknown = inc({ id: 'u-1', platform: 'x' });
    const garbled = inc({ id: 'g-1', platform: 'x', checked: 'yesterday-ish' });
    expect(isActiveAt(fresh, T, within)).toBe(true);
    expect(isActiveAt(stale, T, within)).toBe(false);
    expect(isActiveAt(unknown, T, within)).toBe(false);
    expect(isActiveAt(garbled, T, within)).toBe(false);
    expect(isActiveAt(unknown, T)).toBe(true); // the rule applies only when asked for
  });

  it('is never active at a non-finite time', () => {
    expect(isActiveAt(open, Number.NaN)).toBe(false);
    expect(isActiveAt(open, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('activeIncidents', () => {
  it('returns an empty map for the empty published file', () => {
    expect(activeIncidents([], T).size).toBe(0);
  });

  it('keeps one incident per platform: the most severe, then the most recent, then by id', () => {
    const list = [
      inc({ id: 'a-minor-new', platform: 'a', impact: 'minor', started: '2026-09-26T11:00:00Z' }),
      inc({ id: 'a-major-old', platform: 'a', impact: 'major', started: '2026-09-26T08:00:00Z' }),
      inc({ id: 'b-minor-old', platform: 'b', impact: 'minor', started: '2026-09-26T08:00:00Z' }),
      inc({ id: 'b-minor-new', platform: 'b', impact: 'minor', started: '2026-09-26T11:00:00Z' }),
      inc({ id: 'c-2', platform: 'c', impact: 'minor', started: '2026-09-26T09:00:00Z' }),
      inc({ id: 'c-1', platform: 'c', impact: 'minor', started: '2026-09-26T09:00:00Z' }),
    ];
    const active = activeIncidents(list, T);
    expect(active.get('a')?.id).toBe('a-major-old');
    expect(active.get('b')?.id).toBe('b-minor-new');
    expect(active.get('c')?.id).toBe('c-1');
    // the same answer whatever the input order
    const reversed = activeIncidents([...list].reverse(), T);
    expect([...reversed.entries()]).toEqual([...active.entries()]);
  });

  it('skips resolved, future and "none" incidents when choosing', () => {
    const list = [
      inc({
        id: 'x-crit-done',
        platform: 'x',
        impact: 'critical',
        resolved: '2026-09-26T11:00:00Z',
      }),
      inc({
        id: 'x-crit-soon',
        platform: 'x',
        impact: 'critical',
        started: '2026-09-26T13:00:00Z',
      }),
      inc({ id: 'x-none', platform: 'x', impact: 'none' }),
      inc({ id: 'x-minor', platform: 'x', impact: 'minor' }),
    ];
    expect(activeIncidents(list, T).get('x')?.id).toBe('x-minor');
    expect(activeIncidents(list.slice(0, 3), T).has('x')).toBe(false);
  });

  it('orders platforms most severe first', () => {
    const list = [
      inc({ id: 'id-m', platform: 'm', impact: 'maintenance' }),
      inc({ id: 'id-k', platform: 'k', impact: 'critical' }),
      inc({ id: 'id-n', platform: 'n', impact: 'minor' }),
    ];
    expect([...activeIncidents(list, T).keys()]).toEqual(['k', 'n', 'm']);
  });

  it('passes the stale-feed guard through', () => {
    const list = [inc({ id: 'old', platform: 'x', started: '2026-08-01T00:00:00Z' })];
    expect(activeIncidents(list, T).size).toBe(1);
    expect(activeIncidents(list, T, { staleAfterMs: 3 * 86_400_000 }).size).toBe(0);
  });
});

describe('banner helpers', () => {
  const a = inc({ id: 'id-a', platform: 'pa', impact: 'minor' });
  const b = inc({ id: 'id-b', platform: 'pb', impact: 'critical' });
  const c = inc({ id: 'id-c', platform: 'pc', impact: 'minor', started: '2026-09-26T11:00:00Z' });
  const active = activeIncidents([a, b, c], T);

  it('shows undismissed notices, most severe then most recent first', () => {
    const ids = (d: Set<string>) => visibleIncidents(active, d).map((i) => i.id);
    expect(ids(new Set())).toEqual(['id-b', 'id-c', 'id-a']);
    expect(ids(new Set(['id-b']))).toEqual(['id-c', 'id-a']);
    expect(ids(new Set(['id-a', 'id-b', 'id-c']))).toEqual([]);
  });

  it('compareIncidents is a total order', () => {
    expect(compareIncidents(a, a)).toBe(0);
    expect(Math.sign(compareIncidents(a, c))).toBe(-Math.sign(compareIncidents(c, a)));
  });

  it('changes the signature only when what is shown changes', () => {
    const list = visibleIncidents(active, new Set());
    expect(incidentsSignature(list)).toBe(incidentsSignature(visibleIncidents(active, new Set())));
    const retitled = activeIncidents([a, { ...b, title: 'Partial outage' }, c], T);
    expect(incidentsSignature(visibleIncidents(retitled, new Set()))).not.toBe(
      incidentsSignature(list),
    );
    expect(incidentsSignature([])).toBe('[]');
  });

  it('writes instants as UTC date and time', () => {
    expect(utcParts(Date.UTC(2026, 8, 6, 7, 5, 59))).toEqual({ date: '2026-09-06', hhmm: '07:05' });
  });
});

// ---------------------------------------------------------------------------
// The alarm in 3D (src/world/alarm.ts): pure helpers and the scene graph (no WebGL needed)
// ---------------------------------------------------------------------------

describe('alarm styles', () => {
  it('maps severities to looks, and nothing below maintenance', () => {
    expect(alarmLevel(0)).toBeNull();
    expect(alarmLevel(Number.NaN)).toBeNull();
    expect(alarmLevel(incidentSeverity('maintenance'))).toBe('maintenance');
    expect(alarmLevel(incidentSeverity('minor'))).toBe('minor');
    expect(alarmLevel(incidentSeverity('major'))).toBe('major');
    expect(alarmLevel(incidentSeverity('critical'))).toBe('critical');
    expect(alarmLevel(99)).toBe('critical');
  });

  it('turns faster and adds plaza beacons as severity rises; ≤ 1 flash per second per beacon', () => {
    const s = ALARM_STYLES;
    expect(s.maintenance.turns).toBeLessThan(s.minor.turns);
    expect(s.minor.turns).toBeLessThan(s.major.turns);
    expect(s.major.turns).toBeLessThan(s.critical.turns);
    for (const style of Object.values(s)) expect(style.turns * 2).toBeLessThanOrEqual(1);
    expect([s.maintenance.beacons, s.minor.beacons]).toEqual([2, 2]);
    expect([s.major.beacons, s.critical.beacons]).toEqual([4, 4]);
  });

  it('hashes slots deterministically into [0, 1)', () => {
    for (let k = -500; k < 500; k++) {
      const v = slotHash(k, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(slotHash(k, 3)).toBe(v);
    }
    expect(slotHash(7, 1)).not.toBe(slotHash(7, 2));
  });
});

describe('alarmFlicker', () => {
  const sample = (severity: number, seconds: number, hz: number) =>
    Array.from({ length: seconds * hz }, (_, i) => alarmFlicker(i / hz, severity, false));

  it('stays between FLICKER_MIN and 1 and really dips for incidents', () => {
    for (const sev of [2, 3, 4]) {
      const v = sample(sev, 60, 200);
      expect(Math.min(...v)).toBeGreaterThanOrEqual(FLICKER_MIN);
      expect(Math.max(...v)).toBeLessThanOrEqual(1);
      expect(Math.min(...v)).toBeLessThan(0.75);
    }
    expect(Math.min(...sample(4, 60, 200))).toBeLessThan(0.45);
  });

  it('never flickers for maintenance or without an alarm', () => {
    for (let t = 0; t < 30; t += 0.037) {
      expect(alarmFlicker(t, incidentSeverity('maintenance'), false)).toBe(1);
      expect(alarmFlicker(t, 0, false)).toBe(1);
    }
  });

  it('holds a steady value with reduced motion', () => {
    for (let t = 0; t < 10; t += 0.13) {
      expect(alarmFlicker(t, 2, true)).toBe(REDUCED_FLICKER);
      expect(alarmFlicker(t, 4, true)).toBe(REDUCED_FLICKER);
      expect(alarmFlicker(t, 1, true)).toBe(1);
    }
  });

  it('is deterministic and irregular (dips are not evenly spaced)', () => {
    expect(sample(3, 20, 60)).toEqual(sample(3, 20, 60));
    const v = sample(4, 120, 1000);
    const starts: number[] = [];
    for (let i = 1; i < v.length; i++) if (v[i]! < v[i - 1]! * 0.9) starts.push(i / 1000);
    expect(starts.length).toBeGreaterThan(40);
    const gaps = starts.slice(1).map((s, i) => s - starts[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.5);
  });

  it('never flashes more than three times in any one second (WCAG 2.3.1)', () => {
    const hz = 1000;
    const v = sample(4, 120, hz);
    const starts: number[] = [];
    for (let i = 1; i < v.length; i++) if (v[i]! < v[i - 1]! * 0.9) starts.push(i);
    let worst = 0;
    for (let a = 0, b = 0; b < starts.length; b++) {
      while (starts[b]! - starts[a]! >= hz) a++;
      worst = Math.max(worst, b - a + 1);
    }
    expect(worst).toBeLessThanOrEqual(3);
  });
});

describe('beaconLayout', () => {
  it('puts two beacons over the crown and two on the front plaza, beyond the footprint', () => {
    for (const fp of [4, 5, 5.5, 6, 7, 8]) {
      const [c1, c2, b1, b2] = beaconLayout(fp);
      expect(c1!.on).toBe('crown');
      expect(c2!.on).toBe('crown');
      expect(c1!.y).toBeGreaterThan(0);
      expect(Math.hypot(c1!.x, c1!.z)).toBeLessThan(fp);
      for (const b of [b1!, b2!]) {
        expect(b.on).toBe('base');
        expect(b.z).toBeGreaterThan(0);
        expect(Math.hypot(b.x, b.z)).toBeGreaterThan(fp);
        expect(b.reach).toBeGreaterThan(0);
      }
      expect(b1!.x).toBeCloseTo(-b2!.x, 10);
    }
  });
});

function run(fx: AlarmFx, s: Partial<AlarmFxState>, seconds: number, from = 0): number {
  let time = from;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    time += 1 / 60;
    fx.update({ active: true, severity: 3, height: 20, reducedMotion: false, ...s, time });
  }
  return time;
}

function mesh(fx: AlarmFx, name: string): Mesh {
  const o = fx.group.getObjectByName(name);
  if (!(o instanceof Mesh)) throw new Error(`missing ${name}`);
  return o;
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

describe('createAlarmFx', () => {
  it('costs at most three draw calls and uses no real lights', () => {
    const fx = createAlarmFx({ footprint: 6 });
    const meshes: Mesh[] = [];
    fx.group.traverse((o: Object3D) => {
      expect((o as Light).isLight).toBeFalsy();
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(meshes.length).toBeLessThanOrEqual(3);
    for (const m of meshes) expect(Array.isArray(m.material)).toBe(false);
    fx.dispose();
  });

  it('is hidden with windows untouched while inactive', () => {
    const fx = createAlarmFx({ footprint: 5 });
    expect(fx.group.visible).toBe(false);
    expect(fx.flicker).toBe(1);
    run(fx, { active: false }, 1);
    expect(fx.group.visible).toBe(false);
    expect(fx.flicker).toBe(1);
    // "active" with no real severity raises no alarm either
    run(fx, { active: true, severity: 0 }, 1);
    expect(fx.group.visible).toBe(false);
    expect(fx.flicker).toBe(1);
    fx.dispose();
  });

  it('fades in, flickers within range, and fades back out to untouched windows', () => {
    const fx = createAlarmFx({ footprint: 5 });
    let t = run(fx, { severity: 4 }, 2);
    expect(fx.group.visible).toBe(true);
    let lowest = 1;
    for (let i = 0; i < 600; i++) {
      t = run(fx, { severity: 4 }, 1 / 60, t);
      expect(fx.flicker).toBeGreaterThanOrEqual(FLICKER_MIN);
      expect(fx.flicker).toBeLessThanOrEqual(1);
      lowest = Math.min(lowest, fx.flicker);
    }
    expect(lowest).toBeLessThan(0.7);
    run(fx, { active: false, severity: 4 }, 5, t);
    expect(fx.group.visible).toBe(false);
    expect(fx.flicker).toBe(1);
    fx.dispose();
  });

  it('lights 2 beacons for minor incidents and 4 (with the plaza sweep) for major ones', () => {
    const fx = createAlarmFx({ footprint: 6 });
    run(fx, { severity: 2 }, 2);
    const blades = mesh(fx, 'alarm-blades') as InstancedMesh;
    const glows = mesh(fx, 'alarm-glows') as InstancedMesh;
    expect(blades.count).toBe(4);
    expect(glows.count).toBe(2);
    expect(mesh(fx, 'alarm-sweep').visible).toBe(false);
    run(fx, { severity: 3 }, 1, 2);
    expect(blades.count).toBe(8);
    expect(glows.count).toBe(4);
    expect(mesh(fx, 'alarm-sweep').visible).toBe(true);
    fx.dispose();
  });

  it('puts the crown beacons just above the crown', () => {
    const h = 32;
    const fx = createAlarmFx({ footprint: 6 });
    run(fx, { severity: 2, height: h }, 2);
    for (const e of matrices(mesh(fx, 'alarm-glows') as InstancedMesh)) {
      expect(e[13]!).toBeGreaterThan(h);
      expect(e[13]!).toBeLessThan(h + 3);
    }
    fx.dispose();
  });

  it('never flickers for maintenance', () => {
    const fx = createAlarmFx({ footprint: 5 });
    let t = 0;
    for (let i = 0; i < 300; i++) {
      t = run(fx, { severity: 1 }, 1 / 60, t);
      expect(fx.flicker).toBe(1);
    }
    expect(fx.group.visible).toBe(true);
    fx.dispose();
  });

  it('with reduced motion: still beacons and a steady flicker of ~0.7', () => {
    const fx = createAlarmFx({ footprint: 5.5 });
    const t = run(fx, { severity: 4, reducedMotion: true }, 3);
    expect(fx.flicker).toBeCloseTo(REDUCED_FLICKER, 10);
    const names = ['alarm-blades', 'alarm-glows'];
    const before = names.map((n) => matrices(mesh(fx, n) as InstancedMesh));
    run(fx, { severity: 4, reducedMotion: true }, 2.3, t);
    expect(names.map((n) => matrices(mesh(fx, n) as InstancedMesh))).toEqual(before);
    expect(fx.flicker).toBeCloseTo(REDUCED_FLICKER, 10);
    fx.dispose();
  });

  it('spins with full motion', () => {
    const fx = createAlarmFx({ footprint: 5.5 });
    const t = run(fx, { severity: 3 }, 2);
    const before = matrices(mesh(fx, 'alarm-blades') as InstancedMesh);
    run(fx, { severity: 3 }, 0.5, t);
    expect(matrices(mesh(fx, 'alarm-blades') as InstancedMesh)).not.toEqual(before);
    fx.dispose();
  });

  it('survives odd input', () => {
    const fx = createAlarmFx({ footprint: Number.NaN });
    expect(() =>
      fx.update({
        active: true,
        severity: Number.NaN,
        time: Number.NaN,
        height: -5,
        reducedMotion: false,
      }),
    ).not.toThrow();
    expect(() => run(fx, { severity: 4, height: Number.POSITIVE_INFINITY }, 0.5)).not.toThrow();
    expect(Number.isFinite(fx.flicker)).toBe(true);
    fx.dispose();
  });

  it('disposes every geometry and material', () => {
    const fx = createAlarmFx({ footprint: 6 });
    const spies: MockInstance[] = [];
    fx.group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      spies.push(vi.spyOn(o.geometry, 'dispose'), vi.spyOn(o.material as Material, 'dispose'));
      if (o instanceof InstancedMesh) spies.push(vi.spyOn(o, 'dispose'));
    });
    expect(spies.length).toBe(8);
    fx.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
    expect(fx.flicker).toBe(1);
  });
});
