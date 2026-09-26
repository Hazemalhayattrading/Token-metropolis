import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALARM,
  CLIP_CEILING,
  CLIP_KNEE,
  FANFARE,
  FANFARE_GAP,
  MASTER_MAX,
  OVERVIEW_DB,
  activityMix,
  createSound,
  eventLift,
  hashNoise,
  sequenceLength,
  softClipCurve,
  toneEnd,
  zoomFromDistance,
  zoomMix,
  type Sound,
} from './sound';

// --- pure helpers ------------------------------------------------------------------------------

describe('zoomMix', () => {
  it('raises the master and hands the mix from the city bed to the server hum as you zoom in', () => {
    let prev = zoomMix(0);
    expect(prev.master).toBeCloseTo(MASTER_MAX * 10 ** (OVERVIEW_DB / 20), 10);
    for (let z = 0.05; z <= 1.0001; z += 0.05) {
      const m = zoomMix(z);
      expect(m.master).toBeGreaterThan(prev.master);
      expect(m.bed).toBeLessThan(prev.bed);
      expect(m.hum).toBeGreaterThan(prev.hum);
      prev = m;
    }
    expect(zoomMix(1).master).toBeCloseTo(MASTER_MAX, 10);
    expect(zoomMix(0).bed).toBeGreaterThan(zoomMix(0).hum * 5); // the overview is the city
    expect(zoomMix(1).hum).toBeGreaterThan(zoomMix(1).bed); // inside, the servers
  });

  it('stays conservative and clamps odd input', () => {
    expect(MASTER_MAX).toBeLessThanOrEqual(0.35); // ≈ −10 dBFS at the loudest
    expect(zoomMix(-2)).toEqual(zoomMix(0));
    expect(zoomMix(9)).toEqual(zoomMix(1));
    expect(zoomMix(Number.NaN)).toEqual(zoomMix(0));
  });
});

describe('eventLift', () => {
  it('lets fanfares and alarms follow zoom half as strongly as the ambience', () => {
    expect(eventLift(1)).toBeCloseTo(1, 10);
    for (const z of [0, 0.25, 0.5, 0.75]) {
      const ambience = 20 * Math.log10(zoomMix(z).master / MASTER_MAX); // dB below the top
      const events = 20 * Math.log10((zoomMix(z).master * eventLift(z)) / MASTER_MAX);
      expect(events).toBeCloseTo(ambience / 2, 6);
    }
  });
});

describe('softClipCurve', () => {
  it('passes normal levels untouched and never exceeds the ceiling', () => {
    const curve = softClipCurve(2049);
    const n = curve.length;
    expect(n).toBe(2049);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const y = curve[i]!;
      if (Math.abs(x) <= CLIP_KNEE) expect(y).toBeCloseTo(x, 6); // exactly linear
      expect(Math.abs(y)).toBeLessThan(CLIP_CEILING);
      expect(y).toBeCloseTo(-curve[n - 1 - i]!, 6); // odd: no DC, no bias
      if (i > 0) {
        expect(y).toBeGreaterThan(curve[i - 1]!); // monotonic: never folds back
        expect(y - curve[i - 1]!).toBeLessThanOrEqual(2 / (n - 1) + 1e-6); // no gain, no jumps
      }
    }
    expect(CLIP_KNEE).toBeGreaterThanOrEqual(MASTER_MAX); // the loudest master is still linear
  });
});

describe('activityMix', () => {
  it('brightens the city and spins up the fans as traffic rises, within bounds', () => {
    let prev = activityMix(0);
    for (let a = 0.1; a <= 2.5001; a += 0.1) {
      const m = activityMix(a);
      expect(m.cutoff).toBeGreaterThanOrEqual(prev.cutoff);
      expect(m.bed).toBeGreaterThanOrEqual(prev.bed);
      expect(m.fan).toBeGreaterThanOrEqual(prev.fan);
      expect(m.bright).toBeGreaterThanOrEqual(prev.bright);
      for (const v of [m.bed, m.fan, m.bright]) {
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(m.cutoff).toBeGreaterThanOrEqual(300);
      expect(m.cutoff).toBeLessThanOrEqual(1800);
      prev = m;
    }
    // Night to peak moves the city filter by about an octave or more: audible, not dramatic.
    expect(activityMix(1.6).cutoff / activityMix(0.4).cutoff).toBeGreaterThan(2);
    expect(activityMix(Number.NaN)).toEqual(activityMix(1));
  });
});

describe('zoomFromDistance', () => {
  it('is 1 up close, 0 for the whole island, and falls in between', () => {
    expect(zoomFromDistance(10)).toBe(1);
    expect(zoomFromDistance(18)).toBe(1);
    expect(zoomFromDistance(190)).toBe(0);
    expect(zoomFromDistance(400)).toBe(0);
    let prev = 1;
    for (let d = 20; d < 190; d += 10) {
      const z = zoomFromDistance(d);
      expect(z).toBeLessThan(prev);
      prev = z;
    }
    // The overview (~150), a campus (~50) and an interior (~20) land far apart.
    expect(zoomFromDistance(150)).toBeLessThan(0.15);
    expect(zoomFromDistance(50)).toBeGreaterThan(0.45);
    expect(zoomFromDistance(20)).toBeGreaterThan(0.9);
    expect(zoomFromDistance(Number.NaN)).toBe(0);
    expect(zoomFromDistance(50, 30, 10)).toBe(0);
  });
});

describe('hashNoise', () => {
  it('is deterministic white noise in [-1, 1)', () => {
    const n = 100_000;
    let sum = 0;
    let sq = 0;
    let lag = 0;
    let cross = 0;
    let prev = hashNoise(0, 1);
    for (let i = 0; i < n; i++) {
      const v = hashNoise(i, 1);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
      sum += v;
      sq += v * v;
      if (i > 0) lag += v * prev;
      cross += v * hashNoise(i, 2);
      prev = v;
    }
    const variance = sq / n;
    expect(Math.abs(sum / n)).toBeLessThan(0.01);
    expect(variance).toBeCloseTo(1 / 3, 2); // uniform on [-1, 1)
    expect(Math.abs(lag / n / variance)).toBeLessThan(0.01); // no correlation sample to sample
    expect(Math.abs(cross / n / variance)).toBeLessThan(0.01); // stereo channels decorrelated
    expect(hashNoise(12345, 1)).toBe(hashNoise(12345, 1));
  });
});

describe('fanfare and alarm', () => {
  it('fanfare: a rising arpeggio, soft-edged, under two seconds', () => {
    expect(FANFARE.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < FANFARE.length; i++) {
      expect(FANFARE[i]!.freq).toBeGreaterThan(FANFARE[i - 1]!.freq);
      expect(FANFARE[i]!.at).toBeGreaterThan(FANFARE[i - 1]!.at);
    }
    for (const t of FANFARE) {
      expect(t.attack).toBeGreaterThan(0.002); // no click at the onset
      expect(t.gain).toBeLessThanOrEqual(0.5);
    }
    expect(sequenceLength(FANFARE)).toBeLessThan(2);
  });

  it('alarm: two gentle tones that fit in one repeat', () => {
    const freqs = new Set(ALARM.tones.map((t) => t.freq));
    expect(freqs.size).toBe(2);
    for (const t of ALARM.tones) {
      expect(t.freq).toBeGreaterThan(300); // no rumble
      expect(t.freq).toBeLessThan(1000); // nothing shrill
      expect(t.attack).toBeGreaterThanOrEqual(0.03); // soft onset
      expect(t.release).toBeGreaterThanOrEqual(0.2); // soft tail
      expect(t.gain).toBeLessThanOrEqual(0.35);
      expect(toneEnd(t)).toBeLessThanOrEqual(ALARM.period);
    }
  });
});

// --- a strict fake Web Audio context (throws where real engines throw) --------------------------

class FakeParam {
  value: number;
  events: { kind: string; value: number; time: number }[] = [];
  constructor(value: number) {
    this.value = value;
  }
  private time(t: number): void {
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`bad time ${t}`);
  }
  setValueAtTime(v: number, t: number): this {
    this.time(t);
    if (!Number.isFinite(v)) throw new TypeError('non-finite value');
    this.events.push({ kind: 'set', value: v, time: t });
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.time(t);
    this.events.push({ kind: 'linear', value: v, time: t });
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    this.time(t);
    if (v === 0 || !Number.isFinite(v)) throw new RangeError('exponential ramp to zero');
    this.events.push({ kind: 'exp', value: v, time: t });
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number): this {
    this.time(t);
    if (!(tc >= 0)) throw new RangeError('bad time constant');
    this.events.push({ kind: 'target', value: v, time: t });
    return this;
  }
  cancelScheduledValues(t: number): this {
    this.time(t);
    this.events = this.events.filter((e) => e.time < t);
    return this;
  }
  /** Where the parameter is heading: the last scheduled value. */
  get target(): number {
    return this.events.at(-1)?.value ?? this.value;
  }
}

class FakeNode {
  outputs: unknown[] = [];
  disconnected = false;
  constructor(readonly ctx: FakeContext) {
    ctx.nodes.push(this);
  }
  connect<T>(dest: T): T {
    if (dest === undefined || dest === null) throw new TypeError('connect to nothing');
    this.outputs.push(dest);
    return dest;
  }
  disconnect(): void {
    this.disconnected = true;
    this.outputs = [];
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
}

class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = 'none';
}

class FakePanner extends FakeNode {
  pan = new FakeParam(0);
}

class FakeSource extends FakeNode {
  startAt: number | null = null;
  stopAt: number | null = null;
  onended: (() => void) | null = null;
  private listeners: (() => void)[] = [];
  start(t = 0): void {
    if (this.startAt !== null) throw new Error('InvalidStateError: start() twice');
    if (!(t >= 0)) throw new RangeError('bad start time');
    this.startAt = t;
  }
  stop(t = 0): void {
    if (this.startAt === null) throw new Error('InvalidStateError: stop() before start()');
    if (!(t >= 0)) throw new RangeError('bad stop time');
    this.stopAt = t;
  }
  addEventListener(type: string, fn: () => void): void {
    if (type === 'ended') this.listeners.push(fn);
  }
  end(): void {
    this.onended?.();
    for (const fn of this.listeners) fn();
  }
}

class FakeOscillator extends FakeSource {
  type = 'sine';
  frequency = new FakeParam(440);
}

class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
}

class FakeBuffer {
  readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(i: number): Float32Array {
    return this.channels[i]!;
  }
}

type ResumeMode = 'run' | 'stay' | 'reject' | 'hang';

class FakeContext {
  currentTime = 0;
  sampleRate = 8000;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = { kind: 'destination' };
  nodes: FakeNode[] = [];
  onstatechange: (() => void) | null = null;
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  constructor(public resumeMode: ResumeMode = 'run') {}
  private set(s: FakeContext['state']): void {
    if (this.state === s) return;
    this.state = s;
    this.onstatechange?.();
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.resumeMode === 'reject') return Promise.reject(new Error('NotAllowedError'));
    if (this.resumeMode === 'hang') return new Promise(() => undefined);
    if (this.resumeMode === 'run') this.set('running');
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls++;
    this.set('suspended');
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closeCalls++;
    this.set('closed');
    return Promise.resolve();
  }
  createGain() {
    return new FakeGain(this);
  }
  createBiquadFilter() {
    return new FakeFilter(this);
  }
  createWaveShaper() {
    return new FakeShaper(this);
  }
  createStereoPanner() {
    return new FakePanner(this);
  }
  createOscillator() {
    return new FakeOscillator(this);
  }
  createBufferSource() {
    return new FakeBufferSource(this);
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length, sampleRate);
  }
  oscillators(): FakeOscillator[] {
    return this.nodes.filter((n): n is FakeOscillator => n instanceof FakeOscillator);
  }
  /** The gain node wired straight into the safety clipper: the master. */
  master(): FakeGain {
    const safety = this.nodes.find((n) => n instanceof FakeShaper)!;
    const m = this.nodes.find((n) => n instanceof FakeGain && n.outputs.includes(safety));
    return m as FakeGain;
  }
  safety(): FakeShaper {
    return this.nodes.find((n): n is FakeShaper => n instanceof FakeShaper)!;
  }
}

function setup(mode: ResumeMode = 'run'): {
  ctx: FakeContext;
  factory: ReturnType<typeof vi.fn<() => AudioContext>>;
  sound: Sound;
} {
  const ctx = new FakeContext(mode);
  const factory = vi.fn(() => ctx as unknown as AudioContext);
  return { ctx, factory, sound: createSound({ contextFactory: factory }) };
}

/** The oscillators created since `before` (a snapshot of the node count). */
function newOscillators(ctx: FakeContext, before: number): FakeOscillator[] {
  return ctx.nodes.slice(before).filter((n): n is FakeOscillator => n instanceof FakeOscillator);
}

// --- the sound ---------------------------------------------------------------------------------

describe('createSound', () => {
  let errors: ReturnType<typeof vi.spyOn>;
  let warns: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warns = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stays silent and never throws where Web Audio is missing', async () => {
    const sound = createSound(); // node: no window, no AudioContext
    await expect(sound.setEnabled(true)).resolves.toBeUndefined();
    expect(sound.enabled).toBe(false);
    expect(() => {
      sound.setZoom(1);
      sound.setActivity(1.4);
      sound.launch();
      sound.alarm(true);
      sound.alarm(false);
    }).not.toThrow();
    await expect(sound.setEnabled(false)).resolves.toBeUndefined();
    sound.dispose();
  });

  it('stays silent when the context cannot be made', async () => {
    const sound = createSound({
      contextFactory: () => {
        throw new Error('NotSupportedError');
      },
    });
    await sound.setEnabled(true);
    expect(sound.enabled).toBe(false);
    sound.dispose();
  });

  it('creates nothing until enabled, then one context for good', async () => {
    const { ctx, factory, sound } = setup();
    sound.setZoom(0.4);
    sound.setActivity(1.2);
    sound.launch();
    sound.alarm(false);
    expect(factory).not.toHaveBeenCalled();
    expect(sound.enabled).toBe(false);
    await sound.setEnabled(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(sound.enabled).toBe(true);
    expect(ctx.state).toBe('running');
    vi.useFakeTimers();
    const off = sound.setEnabled(false);
    await vi.advanceTimersByTimeAsync(1000);
    await off;
    await sound.setEnabled(true);
    expect(factory).toHaveBeenCalledTimes(1);
    sound.dispose();
  });

  it('builds the bed from deterministic noise and starts every continuous source', async () => {
    const { ctx, sound } = setup();
    await sound.setEnabled(true);
    const sources = ctx.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
    expect(sources.length).toBeGreaterThanOrEqual(8); // noise ×2, LFOs ×2, hum partials
    for (const s of sources) expect(s.startAt).not.toBeNull();
    const noise = ctx.nodes.find((n): n is FakeBufferSource => n instanceof FakeBufferSource)!;
    expect(noise.loop).toBe(true);
    const data = noise.buffer!.getChannelData(0);
    expect(data[0]).toBe(Math.fround(hashNoise(0, 1)));
    expect(data[1234]).toBe(Math.fround(hashNoise(1234, 1)));
    expect(noise.buffer!.getChannelData(1)[1234]).toBe(Math.fround(hashNoise(1234, 2)));
    expect(noise.buffer!.numberOfChannels).toBe(2);
    // Everything leaves through the transparent safety clipper, straight to the speakers.
    expect(ctx.safety().curve).toEqual(softClipCurve());
    expect(ctx.safety().outputs).toEqual([ctx.destination]);
    sound.dispose();
  });

  it('fades in to the zoom level and follows zoom', async () => {
    const { ctx, sound } = setup();
    await sound.setEnabled(true);
    const master = ctx.master();
    expect(master.gain.value).toBe(0); // starts silent, then glides
    expect(master.gain.target).toBeCloseTo(zoomMix(0).master, 10);
    ctx.currentTime = 1;
    sound.setZoom(1);
    expect(master.gain.target).toBeCloseTo(zoomMix(1).master, 10);
    for (const e of master.gain.events) expect(e.kind).toBe('target'); // glides only: no clicks
    sound.dispose();
  });

  it('turns the city up with traffic', async () => {
    const { ctx, sound } = setup();
    await sound.setEnabled(true);
    const filters = ctx.nodes.filter((n): n is FakeFilter => n instanceof FakeFilter);
    const bed = filters.find((f) => f.frequency.target === activityMix(1).cutoff)!;
    expect(bed).toBeDefined();
    sound.setActivity(0.4);
    const night = bed.frequency.target;
    sound.setActivity(1.6);
    expect(bed.frequency.target).toBeGreaterThan(night);
    sound.dispose();
  });

  it('plays a rising fanfare under two seconds, and not twice in a row', async () => {
    const { ctx, sound } = setup();
    await sound.setEnabled(true);
    ctx.currentTime = 5;
    let before = ctx.nodes.length;
    sound.launch();
    const oscs = newOscillators(ctx, before);
    expect(oscs.length).toBeGreaterThanOrEqual(FANFARE.length);
    for (const o of oscs) {
      expect(o.startAt!).toBeGreaterThanOrEqual(5);
      expect(o.stopAt! - 5).toBeLessThan(2);
    }
    // Each note's lowest partial, in the order the notes start: the arpeggio rises.
    const notes = new Map<number, number>();
    for (const o of oscs) {
      notes.set(o.startAt!, Math.min(notes.get(o.startAt!) ?? Infinity, o.frequency.value));
    }
    const heard = [...notes.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => f);
    expect(heard).toEqual(FANFARE.map((t) => t.freq));
    // A second launch right away is dropped (fast playback crosses many launches).
    ctx.currentTime = 5 + FANFARE_GAP / 2;
    before = ctx.nodes.length;
    sound.launch();
    expect(newOscillators(ctx, before)).toHaveLength(0);
    ctx.currentTime = 5 + FANFARE_GAP + 0.01;
    sound.launch();
    expect(newOscillators(ctx, before).length).toBeGreaterThanOrEqual(FANFARE.length);
    // Finished notes clean up after themselves.
    for (const o of oscs) o.end();
    expect(oscs.every((o) => o.disconnected)).toBe(true);
    sound.dispose();
  });

  it('plays nothing while switched off', async () => {
    const { ctx, sound } = setup();
    sound.launch();
    expect(ctx.nodes).toHaveLength(0);
    await sound.setEnabled(true);
    vi.useFakeTimers();
    const off = sound.setEnabled(false);
    await vi.advanceTimersByTimeAsync(1000);
    await off;
    const before = ctx.nodes.length;
    sound.launch();
    expect(ctx.nodes).toHaveLength(before);
    sound.dispose();
  });

  it('loops a soft two-tone alarm until switched off, dipping the city under it', async () => {
    vi.useFakeTimers();
    const { ctx, sound } = setup();
    await sound.setEnabled(true);
    // The bed and hum reach the master through one gain: the duck.
    const duck = ctx.nodes.find(
      (n) => n instanceof FakeGain && n.outputs.includes(ctx.master()),
    ) as FakeGain;
    let before = ctx.nodes.length;
    sound.alarm(true);
    let oscs = newOscillators(ctx, before);
    const tones = new Set(oscs.map((o) => o.frequency.value));
    for (const t of ALARM.tones) expect(tones.has(t.freq)).toBe(true);
    expect(duck.gain.target).toBeLessThan(1);
    // Soft onsets: every alarm envelope starts at zero and ramps up.
    const envelopes = ctx.nodes
      .slice(before)
      .filter((n): n is FakeGain => n instanceof FakeGain && n.gain.events[0]?.kind === 'set');
    expect(envelopes.some((g) => g.gain.events[0]!.value === 0)).toBe(true);
    // It keeps scheduling as time passes.
    before = ctx.nodes.length;
    ctx.currentTime += 3 * ALARM.period;
    await vi.advanceTimersByTimeAsync(600);
    oscs = newOscillators(ctx, before);
    expect(oscs.length).toBeGreaterThan(0);
    // Off: everything still scheduled stops soon, and nothing new is scheduled.
    const now = ctx.currentTime;
    sound.alarm(false);
    for (const o of oscs) expect(o.stopAt!).toBeLessThanOrEqual(now + 0.5);
    expect(duck.gain.target).toBe(1);
    before = ctx.nodes.length;
    ctx.currentTime += 5;
    await vi.advanceTimersByTimeAsync(2000);
    expect(newOscillators(ctx, before)).toHaveLength(0);
    sound.dispose();
  });

  it('remembers an alarm asked for while switched off', async () => {
    const { ctx, sound } = setup();
    sound.alarm(true);
    expect(ctx.nodes).toHaveLength(0);
    await sound.setEnabled(true);
    const freqs = new Set(ctx.oscillators().map((o) => o.frequency.value));
    for (const t of ALARM.tones) expect(freqs.has(t.freq)).toBe(true);
    sound.alarm(false);
    sound.dispose();
  });

  it('keeps a wanted alarm when switched on in a hidden tab (it plays once visible)', async () => {
    vi.useFakeTimers();
    const doc = Object.assign(new EventTarget(), { hidden: true });
    vi.stubGlobal('document', doc);
    const { ctx, sound } = setup();
    sound.alarm(true);
    await sound.setEnabled(true);
    expect(sound.enabled).toBe(true);
    expect(ctx.master().gain.target).toBe(0); // nobody hears a hidden tab
    const freqs = new Set(ctx.oscillators().map((o) => o.frequency.value));
    for (const t of ALARM.tones) expect(freqs.has(t.freq)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.state).toBe('suspended');
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10);
    expect(ctx.state).toBe('running');
    expect(ctx.master().gain.target).toBeGreaterThan(0);
    sound.dispose();
  });

  it('fades out, then suspends, when switched off', async () => {
    vi.useFakeTimers();
    const { ctx, sound } = setup();
    await sound.setEnabled(true);
    const off = sound.setEnabled(false);
    expect(sound.enabled).toBe(false);
    expect(ctx.master().gain.target).toBe(0);
    expect(ctx.suspendCalls).toBe(0); // not before the fade has finished
    await vi.advanceTimersByTimeAsync(1000);
    await off;
    expect(ctx.suspendCalls).toBe(1);
    expect(ctx.state).toBe('suspended');
    sound.dispose();
  });

  it('does not suspend when switched back on during the fade', async () => {
    vi.useFakeTimers();
    const { ctx, sound } = setup();
    await sound.setEnabled(true);
    const off = sound.setEnabled(false);
    await vi.advanceTimersByTimeAsync(100);
    await sound.setEnabled(true);
    await vi.advanceTimersByTimeAsync(1000);
    await off;
    expect(ctx.suspendCalls).toBe(0);
    expect(sound.enabled).toBe(true);
    expect(ctx.master().gain.target).toBeGreaterThan(0);
    sound.dispose();
  });

  it('keeps the last word when toggled quickly', async () => {
    vi.useFakeTimers();
    const { ctx, sound } = setup();
    const on = sound.setEnabled(true);
    const off = sound.setEnabled(false);
    await on;
    expect(sound.enabled).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await off;
    expect(sound.enabled).toBe(false);
    expect(ctx.master().gain.target).toBe(0);
    expect(ctx.state).toBe('suspended');
    sound.dispose();
  });

  it('stays off if the browser refuses to start audio', async () => {
    for (const mode of ['stay', 'reject'] as const) {
      const { ctx, sound } = setup(mode);
      await sound.setEnabled(true);
      expect(sound.enabled).toBe(false);
      expect(ctx.master().gain.target).toBe(0);
      sound.dispose();
    }
    vi.useFakeTimers();
    const { sound } = setup('hang');
    const on = sound.setEnabled(true);
    await vi.advanceTimersByTimeAsync(2500);
    await on;
    expect(sound.enabled).toBe(false);
    sound.dispose();
  });

  it('suspends while the tab is hidden and comes back when it is visible', async () => {
    vi.useFakeTimers();
    const doc = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', doc);
    const { ctx, sound } = setup();
    await sound.setEnabled(true);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(ctx.master().gain.target).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.state).toBe('suspended');
    expect(sound.enabled).toBe(true); // still wanted: it returns with the tab
    sound.launch(); // nobody hears a hidden tab
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10);
    expect(ctx.state).toBe('running');
    expect(ctx.master().gain.target).toBeCloseTo(zoomMix(0).master, 10);
    const removed = vi.spyOn(doc, 'removeEventListener');
    sound.dispose();
    // Listeners are gone after dispose.
    expect(removed).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    const resumes = ctx.resumeCalls;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(ctx.resumeCalls).toBe(resumes);
  });

  it('retries on the next tap if the browser will not resume on its own', async () => {
    vi.useFakeTimers();
    const doc = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', doc);
    const { ctx, sound } = setup();
    await sound.setEnabled(true);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1000);
    ctx.resumeMode = 'stay';
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10);
    expect(ctx.state).toBe('suspended');
    ctx.resumeMode = 'run';
    doc.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(10);
    expect(ctx.state).toBe('running');
    sound.dispose();
  });

  it('disposes everything and ignores calls afterwards', async () => {
    const { ctx, factory, sound } = setup();
    await sound.setEnabled(true);
    sound.alarm(true);
    const continuous = ctx.nodes.filter(
      (n): n is FakeSource => n instanceof FakeSource && n.stopAt === null,
    );
    sound.dispose();
    expect(ctx.closeCalls).toBe(1);
    expect(sound.enabled).toBe(false);
    for (const s of continuous) expect(s.stopAt).not.toBeNull();
    await sound.setEnabled(true);
    sound.launch();
    sound.alarm(true);
    expect(sound.enabled).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(() => sound.dispose()).not.toThrow();
  });
});
