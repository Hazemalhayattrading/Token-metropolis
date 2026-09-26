import {
  Matrix4,
  PerspectiveCamera,
  Vector3,
  type InstancedMesh,
  type Mesh,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import { COMPUTE, isDisplayable } from '../model/constants';
import { joulesPerToken, promptFootprint } from '../model/derived';
import { isOrdered } from '../model/range';
import {
  AFTERGLOW_SECONDS,
  afterglowLevel,
  arcControl,
  arcPoint,
  arcTangent,
  createTokenFlight,
  easeInOut,
  easeOut,
  FLIGHT_SECONDS,
  flightPhase,
  LANDING_SECONDS,
  MAX_FLIGHTS,
  REDUCED_FLASH_SECONDS,
  REDUCED_SECONDS,
  screenToWorld,
  TRAIL_POINTS,
  type TokenFlight,
} from '../world/tokenflight';
import {
  clampTokens,
  createTokenizerLoader,
  failedModuleUrl,
  footprintFor,
  formatQuantity,
  importTokenizer,
  MAX_PROMPT_TOKENS,
  perTokenEnergy,
  TOKENIZER_NAME,
  type TokenizerModule,
} from './prompt';

describe('clampTokens', () => {
  it('keeps counts integer and in [0, MAX_PROMPT_TOKENS]', () => {
    expect(clampTokens(0)).toBe(0);
    expect(clampTokens(312)).toBe(312);
    expect(clampTokens(3.9)).toBe(3);
    expect(clampTokens(-5)).toBe(0);
    expect(clampTokens(Number.NaN)).toBe(0);
    expect(clampTokens(-Infinity)).toBe(0);
    expect(clampTokens(Infinity)).toBe(MAX_PROMPT_TOKENS);
    expect(clampTokens(1e15)).toBe(MAX_PROMPT_TOKENS);
  });
});

describe('footprintFor', () => {
  it('wraps promptFootprint() exactly', () => {
    for (const n of [1, 12, 312, 5000]) {
      const view = footprintFor(n);
      const model = promptFootprint(n);
      expect(view.tokens).toBe(n);
      expect(view.energyWh).toEqual(model.energyWh);
      expect(view.waterMl).toEqual(model.waterMl);
    }
  });

  it('is Modeled, ordered, displayable and says where it comes from', () => {
    const f = footprintFor(312);
    for (const e of [f.energyWh, f.waterMl]) {
      expect(e.tier).toBe('modeled');
      expect(isOrdered(e.range)).toBe(true);
      expect(e.range.low).toBeLessThan(e.range.central);
      expect(e.range.high).toBeGreaterThan(e.range.central);
      expect(e.formula.length).toBeGreaterThan(0);
      expect(isDisplayable(e.refs)).toBe(true);
    }
    expect(f.energyWh.formula).toContain('312 tokens');
    expect(f.waterMl.refs).toContain('COMPUTE.wueLitersPerKwh');
  });

  it('follows the documented formula: tokens × J/token ÷ 3600, water = kWh × WUE', () => {
    const f = footprintFor(1000);
    const jpt = joulesPerToken().central;
    expect(f.energyWh.range.central).toBeCloseTo((1000 * jpt) / 3600, 12);
    expect(f.waterMl.range.central).toBeCloseTo(
      (f.energyWh.range.central / 1000) * COMPUTE.wueLitersPerKwh.value * 1000,
      12,
    );
  });

  it('scales linearly with tokens and is zero for an empty prompt', () => {
    const a = footprintFor(250).energyWh.range;
    const b = footprintFor(500).energyWh.range;
    expect(b.central).toBeCloseTo(2 * a.central, 12);
    expect(b.low).toBeCloseTo(2 * a.low, 12);
    expect(b.high).toBeCloseTo(2 * a.high, 12);
    const zero = footprintFor(0);
    expect(zero.tokens).toBe(0);
    expect(zero.energyWh.range).toEqual({ low: 0, central: 0, high: 0 });
    expect(zero.waterMl.range).toEqual({ low: 0, central: 0, high: 0 });
  });

  it('clamps nonsense input instead of producing NaN or Infinity', () => {
    for (const bad of [Number.NaN, -1, -Infinity]) {
      expect(footprintFor(bad).tokens).toBe(0);
      expect(footprintFor(bad).energyWh.range.central).toBe(0);
    }
    const huge = footprintFor(Infinity);
    expect(huge.tokens).toBe(MAX_PROMPT_TOKENS);
    expect(Number.isFinite(huge.energyWh.range.high)).toBe(true);
    expect(Number.isFinite(huge.waterMl.range.high)).toBe(true);
  });
});

describe('perTokenEnergy', () => {
  it('is the model’s J/token with its inputs, Modeled', () => {
    const pt = perTokenEnergy();
    expect(pt.joules).toEqual(joulesPerToken());
    expect(pt.tier).toBe('modeled');
    expect(pt.kwPerGpu).toBe(COMPUTE.kwPerGpu.value);
    expect(pt.pue).toBe(COMPUTE.pue.value);
    expect(pt.tokensPerSecPerGpu).toBe(COMPUTE.throughputTokensPerSecPerGpu.value);
    expect(pt.joules.central).toBeCloseTo(
      (pt.kwPerGpu * 1000 * pt.pue) / pt.tokensPerSecPerGpu,
      12,
    );
    expect(isDisplayable(pt.refs)).toBe(true);
  });
});

describe('formatQuantity', () => {
  it('shows two significant figures in plain decimals, however small', () => {
    expect(formatQuantity(0.0208)).toBe('0.021');
    expect(formatQuantity(0.006169)).toBe('0.0062');
    expect(formatQuantity(0.0000666667)).toBe('0.000067');
    expect(formatQuantity(6.7e-7)).toBe('0.00000067');
    expect(formatQuantity(1.3333)).toBe('1.3');
    expect(formatQuantity(0.24)).toBe('0.24');
    expect(formatQuantity(66.67)).toBe('67');
    expect(formatQuantity(1333.3)).toBe('1,333');
  });

  it('drops trailing zeros and handles rounding across a power of ten', () => {
    expect(formatQuantity(0.001)).toBe('0.001');
    expect(formatQuantity(1)).toBe('1');
    expect(formatQuantity(0.0999)).toBe('0.1');
    expect(formatQuantity(9.96)).toBe('10');
    expect(formatQuantity(99.96)).toBe('100');
  });

  it('never prints exponents, NaN or negatives', () => {
    expect(formatQuantity(0)).toBe('0');
    expect(formatQuantity(-3)).toBe('0');
    expect(formatQuantity(Number.NaN)).toBe('0');
    expect(formatQuantity(Infinity)).toBe('0');
    for (let e = -12; e <= 8; e++) expect(formatQuantity(1.2345 * 10 ** e)).not.toMatch(/e|NaN/);
  });
});

describe('the tokenizer', () => {
  it('is the o200k_base encoding (its token ids, not another encoding’s)', async () => {
    expect(TOKENIZER_NAME).toBe('o200k_base');
    const m = await importTokenizer();
    // o200k_base ids for "Hello, world!" (cl100k_base would give 9906, 11, 1917, 0).
    expect(m.encode('Hello, world!')).toEqual([13225, 11, 2375, 0]);
  });

  it('counts real text, empty text and special-token look-alikes without throwing', async () => {
    const loader = createTokenizerLoader();
    expect(loader.ready).toBe(false);
    const count = await loader.load();
    expect(loader.ready).toBe(true);
    expect(count('')).toBe(0);
    expect(count('Hello, world!')).toBe(4);
    // Pasted text containing "<|endoftext|>" is ordinary characters, not a special token.
    expect(count('<|endoftext|> hi')).toBeGreaterThan(2);
    // Unicode, emoji and a lone surrogate all count.
    expect(count('Naïve café — 東京 🚀')).toBeGreaterThan(5);
    expect(count(`a${'\uD83D'}b`)).toBeGreaterThan(0);
    // A full box counts in one go.
    const long = 'The quick brown fox jumps over the lazy dog. '.repeat(450).slice(0, 20_000);
    expect(count(long)).toBeGreaterThan(3000);
    expect(count(long)).toBeLessThan(20_000);
  });

  it('loads once and shares the counter', async () => {
    let calls = 0;
    const fake: TokenizerModule = { countTokens: (t) => t.length };
    const loader = createTokenizerLoader(() => {
      calls++;
      return Promise.resolve(fake);
    });
    const [a, b] = await Promise.all([loader.load(), loader.load()]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    expect(a('abc')).toBe(3);
  });

  it('retries a failed chunk under a fresh URL when the browser named it', async () => {
    const origin = 'https://example.org';
    const chunk = `${origin}/Token-metropolis/assets/o200k_base-C5Yq_o7d.js`;
    const urls: string[] = [];
    const loader = createTokenizerLoader(
      () => Promise.reject(new TypeError(`Failed to fetch dynamically imported module: ${chunk}`)),
      (url) => {
        urls.push(url);
        return Promise.resolve<TokenizerModule>({ countTokens: () => 5 });
      },
      origin,
    );
    await expect(loader.load()).rejects.toThrow('Failed to fetch');
    expect(loader.failures).toBe(1);
    const count = await loader.load();
    expect(urls).toEqual([`${chunk}?retry=1`]); // browsers remember a failed URL: ask anew
    expect(count('x')).toBe(5);
  });

  it('names the failed chunk only for same-origin scripts', () => {
    const o = 'https://example.org';
    const chromium = new TypeError(
      `Failed to fetch dynamically imported module: ${o}/assets/o200k_base-X.js`,
    );
    const firefox = new TypeError(`error loading dynamically imported module: ${o}/a/b.mjs?v=2`);
    expect(failedModuleUrl(chromium, o)).toBe(`${o}/assets/o200k_base-X.js`);
    expect(failedModuleUrl(firefox, o)).toBe(`${o}/a/b.mjs`);
    expect(failedModuleUrl(chromium, 'https://other.example')).toBeNull();
    expect(failedModuleUrl(new TypeError('Importing a module script failed.'), o)).toBeNull();
    expect(failedModuleUrl(chromium, '')).toBeNull();
    expect(failedModuleUrl(42, o)).toBeNull();
  });

  it('does not cache a failed load: the next load() retries', async () => {
    let calls = 0;
    const loader = createTokenizerLoader(() => {
      calls++;
      return calls === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve<TokenizerModule>({ countTokens: () => 7 });
    });
    await expect(loader.load()).rejects.toThrow('offline');
    expect(loader.ready).toBe(false);
    const count = await loader.load();
    expect(calls).toBe(2);
    expect(count('anything')).toBe(7);
    expect(loader.ready).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The token flight (src/world/tokenflight.ts) — its pure helpers and lifecycle
// ---------------------------------------------------------------------------

describe('flight easing and arc', () => {
  it('eases from 0 to 1, monotonic and symmetric', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const t = i / 100;
      const v = easeInOut(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeCloseTo(1 - easeInOut(1 - t), 12);
      prev = v;
    }
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
    expect(easeInOut(Number.NaN)).toBe(0);
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });

  it('flies a raised arc that starts and ends at the given points', () => {
    const from = new Vector3(0, 60, 120);
    const to = new Vector3(20, 2, -10);
    const c = arcControl(from, to);
    expect(arcPoint(from, c, to, 0)).toEqual(from);
    expect(arcPoint(from, c, to, 1).distanceTo(to)).toBeLessThan(1e-9);
    const mid = arcPoint(from, c, to, 0.5);
    const chordMid = from.clone().add(to).multiplyScalar(0.5);
    expect(mid.y).toBeGreaterThan(chordMid.y + 1);
    expect(mid.x).toBeCloseTo(chordMid.x, 9);
    expect(mid.z).toBeCloseTo(chordMid.z, 9);
    // Short hops still arc; long flights are capped so the mote never leaves the sky.
    const hop = arcControl(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
    expect(hop.y).toBeGreaterThanOrEqual(2);
    const far = arcControl(new Vector3(0, 0, 0), new Vector3(1000, 0, 0));
    expect(far.y).toBeLessThanOrEqual(24);
  });

  it('the trail follows the direction of travel (tangent = derivative of the arc)', () => {
    const from = new Vector3(3, 50, 80);
    const to = new Vector3(-15, 1.7, -22);
    const c = arcControl(from, to);
    for (const u of [0.05, 0.3, 0.5, 0.8, 0.95]) {
      const h = 1e-6;
      const numeric = arcPoint(from, c, to, u + h)
        .sub(arcPoint(from, c, to, u - h))
        .divideScalar(2 * h);
      expect(arcTangent(from, c, to, u).distanceTo(numeric)).toBeLessThan(1e-4);
    }
  });

  it('phases: travel for ~2.2 s, land, flash and ring, afterglow, done', () => {
    expect(FLIGHT_SECONDS).toBeCloseTo(2.2, 6);
    expect(flightPhase(0, false)).toMatchObject({ travel: 0, landed: false, done: false });
    expect(flightPhase(FLIGHT_SECONDS / 2, false).travel).toBeCloseTo(0.5, 12);
    expect(flightPhase(FLIGHT_SECONDS - 0.01, false).landed).toBe(false);
    expect(flightPhase(FLIGHT_SECONDS, false)).toMatchObject({ travel: 1, landed: true });
    expect(flightPhase(FLIGHT_SECONDS + LANDING_SECONDS / 2, false).landing).toBeCloseTo(0.5, 12);
    expect(flightPhase(FLIGHT_SECONDS + LANDING_SECONDS, false).landing).toBeCloseTo(1, 12);
    expect(flightPhase(FLIGHT_SECONDS + LANDING_SECONDS, false).done).toBe(false); // afterglow
    expect(flightPhase(FLIGHT_SECONDS + AFTERGLOW_SECONDS, false).done).toBe(true);
  });

  it('reduced motion: no travel, lands after ~300 ms, the flash and afterglow fade after', () => {
    expect(REDUCED_SECONDS).toBeCloseTo(0.3, 6);
    expect(flightPhase(0, true).travel).toBe(1);
    expect(flightPhase(REDUCED_SECONDS - 0.01, true).landed).toBe(false);
    expect(flightPhase(REDUCED_SECONDS, true).landed).toBe(true);
    expect(flightPhase(REDUCED_SECONDS, true).done).toBe(false);
    expect(flightPhase(REDUCED_FLASH_SECONDS, true).landing).toBe(1);
    expect(flightPhase(AFTERGLOW_SECONDS, true).done).toBe(true);
  });

  it('the afterglow rises, holds and fades to nothing', () => {
    expect(afterglowLevel(0)).toBe(0);
    expect(afterglowLevel(0.3)).toBe(1);
    expect(afterglowLevel(0.7)).toBeGreaterThan(0);
    expect(afterglowLevel(0.7)).toBeLessThan(1);
    expect(afterglowLevel(1)).toBe(0);
  });
});

/** Advance a flight by `seconds` in 60 fps frames. */
function run(f: TokenFlight, seconds: number, start = 0): number {
  const dt = 1 / 60;
  let t = start;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    t += dt;
    f.update(dt, t);
  }
  return t;
}

function tracked(p: Promise<void>): { done: boolean } {
  const s = { done: false };
  void p.then(() => (s.done = true));
  return s;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function part<T extends Object3D>(f: TokenFlight, name: string): T {
  const o = f.group.getObjectByName(name);
  if (!o) throw new Error(`${name} missing`);
  return o as T;
}

const glowsOf = (f: TokenFlight) => part<InstancedMesh>(f, 'token-flight-glows');
const ringsOf = (f: TokenFlight) => part<InstancedMesh>(f, 'token-flight-rings');
const trailsOf = (f: TokenFlight) => part<Mesh>(f, 'token-flight-trails');

describe('createTokenFlight', () => {
  const from = new Vector3(0, 40, 90);
  const to = new Vector3(-12, 1.7, -20);

  it('resolves on arrival (~2.2 s), not before, then cleans up', async () => {
    const f = createTokenFlight({ reducedMotion: false });
    expect(f.group.visible).toBe(false);
    const s = tracked(f.launch(from, to, { color: '#46d98a' }));
    let t = run(f, FLIGHT_SECONDS - 0.1);
    await flush();
    expect(s.done).toBe(false);
    expect(f.group.visible).toBe(true);
    expect(glowsOf(f).count).toBe(1); // the mote
    expect(trailsOf(f).geometry.drawRange.count).toBe((TRAIL_POINTS - 1) * 6); // its trail
    t = run(f, 0.2, t);
    await flush();
    expect(s.done).toBe(true);
    expect(ringsOf(f).count).toBe(1); // the landing ring
    expect(glowsOf(f).count).toBe(2); // the flash and the afterglow
    t = run(f, LANDING_SECONDS, t);
    expect(ringsOf(f).count).toBe(0);
    expect(trailsOf(f).geometry.drawRange.count).toBe(0);
    expect(glowsOf(f).count).toBe(1); // the afterglow lingers on the rack
    run(f, AFTERGLOW_SECONDS, t);
    f.update(1 / 60, 99);
    expect(f.group.visible).toBe(false);
    expect(glowsOf(f).count).toBe(0);
    f.dispose();
  });

  it('can land without an afterglow', async () => {
    const f = createTokenFlight({ reducedMotion: false });
    const s = tracked(f.launch(from, to, { afterglow: false }));
    run(f, FLIGHT_SECONDS + LANDING_SECONDS + 0.05);
    await flush();
    expect(s.done).toBe(true);
    expect(glowsOf(f).count).toBe(0);
    f.dispose();
  });

  it('reduced motion: resolves after ~300 ms, lights only the destination', async () => {
    const f = createTokenFlight({ reducedMotion: true });
    const s = tracked(f.launch(from, to));
    run(f, 0.2);
    await flush();
    expect(s.done).toBe(false);
    run(f, 0.15, 0.2);
    await flush();
    expect(s.done).toBe(true);
    const glows = glowsOf(f);
    expect(glows.count).toBeGreaterThan(0);
    const m = new Matrix4();
    const at = new Vector3();
    for (let i = 0; i < glows.count; i++) {
      glows.getMatrixAt(i, m);
      expect(at.setFromMatrixPosition(m).distanceTo(to)).toBeLessThan(1e-6); // nothing travels
    }
    expect(ringsOf(f).count).toBe(0);
    expect(trailsOf(f).geometry.drawRange.count).toBe(0);
    f.dispose();
  });

  it('lets flights overlap, and retires the oldest when the sky is full', async () => {
    const f = createTokenFlight({ reducedMotion: false });
    const first = tracked(f.launch(from, to));
    run(f, 0.5);
    const second = tracked(f.launch(from, to.clone().setX(10)));
    // The second is drawn from the next frame on; until then only the first has a trail.
    expect(trailsOf(f).geometry.drawRange.count).toBe((TRAIL_POINTS - 1) * 6);
    run(f, 0.1, 0.5);
    expect(trailsOf(f).geometry.drawRange.count).toBe(2 * (TRAIL_POINTS - 1) * 6);
    run(f, FLIGHT_SECONDS - 0.6 + 0.05, 0.6);
    await flush();
    expect(first.done).toBe(true);
    expect(second.done).toBe(false);
    run(f, 0.6, 3);
    await flush();
    expect(second.done).toBe(true);

    const all = Array.from({ length: MAX_FLIGHTS + 1 }, () => tracked(f.launch(from, to)));
    await flush();
    expect(all[0]!.done).toBe(true); // retired to make room
    expect(all.slice(1).every((x) => !x.done)).toBe(true);
    f.dispose();
    await flush();
    expect(all.every((x) => x.done)).toBe(true); // dispose never leaves anyone waiting
  });

  it('is deterministic (no randomness) and ignores bad input', async () => {
    const a = createTokenFlight({ reducedMotion: false });
    const b = createTokenFlight({ reducedMotion: false });
    void a.launch(from, to);
    void b.launch(from, to);
    run(a, 1.1);
    run(b, 1.1);
    expect(glowsOf(a).count).toBe(glowsOf(b).count);
    expect(Array.from(glowsOf(a).instanceMatrix.array)).toEqual(
      Array.from(glowsOf(b).instanceMatrix.array),
    );
    const pa = trailsOf(a).geometry.getAttribute('position').array;
    const pb = trailsOf(b).geometry.getAttribute('position').array;
    expect(Array.from(pa)).toEqual(Array.from(pb));
    a.dispose();
    b.dispose();

    const c = createTokenFlight({ reducedMotion: false });
    const bad = tracked(c.launch(new Vector3(Number.NaN, 0, 0), to));
    await flush();
    expect(bad.done).toBe(true);
    expect(c.group.visible).toBe(false);
    c.dispose();
    const afterDispose = tracked(c.launch(from, to));
    await flush();
    expect(afterDispose.done).toBe(true);
  });

  it('the trail runs from the mote back along the arc', () => {
    const f = createTokenFlight({ reducedMotion: false });
    void f.launch(from, to);
    run(f, 1.1);
    const pos = trailsOf(f).geometry.getAttribute('position');
    const head = new Vector3(pos.getX(0), pos.getY(0), pos.getZ(0));
    const tail = new Vector3(
      pos.getX((TRAIL_POINTS - 1) * 2),
      pos.getY((TRAIL_POINTS - 1) * 2),
      pos.getZ((TRAIL_POINTS - 1) * 2),
    );
    const m = new Matrix4();
    glowsOf(f).getMatrixAt(0, m);
    const mote = new Vector3().setFromMatrixPosition(m);
    expect(head.distanceTo(mote)).toBeLessThan(1e-4);
    expect(tail.distanceTo(from)).toBeLessThan(head.distanceTo(from)); // the tail lags behind
    expect(tail.distanceTo(head)).toBeGreaterThan(1);
    f.dispose();
  });
});

describe('screenToWorld', () => {
  it('puts the start point in front of the camera, under the given screen position', () => {
    const camera = new PerspectiveCamera(38, 1440 / 900, 0.5, 2000);
    camera.position.set(40, 90, 130);
    camera.lookAt(0, 6, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const rect = { left: 0, top: 0, width: 1440, height: 900 };
    const p = screenToWorld(camera, rect, 720, 700, 6);
    expect(p.distanceTo(camera.position)).toBeCloseTo(6, 6);
    const ndc = p.clone().project(camera);
    expect(ndc.x).toBeCloseTo(0, 6);
    expect(ndc.y).toBeCloseTo(-((700 / 900) * 2 - 1), 6);
  });
});
