/**
 * Procedural sound (brief §5.3 item 11): an ambient city bed, a server hum, a
 * launch fanfare and a soft incident alarm. Web Audio only and all synthesized:
 * no audio files, no network. Off by default: nothing is created until
 * `setEnabled(true)` is called (from a user gesture, as browsers require).
 *
 * Volume follows zoom: from the city overview you hear a quiet, distant city
 * bed; flying into an HQ brings the server hum forward and the whole mix up.
 * Traffic intensity gently brightens the city and spins up the server fans.
 *
 * Levels are conservative (the loudest master is about −10 dBFS, with a soft
 * safety clipper that is transparent at normal levels), every change is a
 * smooth ramp (no clicks), and the context is suspended while switched off or
 * while the tab is hidden. Noise comes from a deterministic hash, never
 * Math.random(). If Web Audio is missing or blocked, `enabled` simply stays
 * false — no throw, no console noise.
 */

// ---------------------------------------------------------------------------
// contract
// ---------------------------------------------------------------------------

export interface Sound {
  readonly enabled: boolean;
  /**
   * Creates the AudioContext lazily on first enable (call it from a user gesture); resolves once
   * the audio is running (`enabled` true) or could not start (`enabled` false). Disabling fades
   * out, then suspends the context.
   */
  setEnabled(on: boolean): Promise<void>;
  /** 0 = city overview … 1 = inside an interior; master volume and the server-hum share follow it. */
  setZoom(z: number): void;
  /** Traffic intensity (1 = daily average): subtly modulates the city bed and the hum. */
  setActivity(a: number): void;
  /** A short, tasteful fanfare: a rising chime arpeggio under two seconds. */
  launch(): void;
  /** A soft two-tone alert loop for an incident, toggled on and off. */
  alarm(on: boolean): void;
  dispose(): void;
}

export interface SoundOptions {
  /** Makes the AudioContext (tests inject a fake; defaults to the browser's). */
  contextFactory?: () => AudioContext;
}

// ---------------------------------------------------------------------------
// tuning
// ---------------------------------------------------------------------------

/** Master gain at the closest zoom (≈ −10 dBFS). A soft clipper guards against any pile-up. */
export const MASTER_MAX = 0.32;
/** The city overview sits this much quieter than the closest zoom (dB). */
export const OVERVIEW_DB = -9;
/**
 * Levels, as measured in Chromium (offline render of this module): the city bed sits near
 * −29 dBFS RMS over the overview; bed + hum near −24 dBFS inside an HQ at peak traffic; chimes
 * peak near −13 dBFS over the overview and −9 dBFS up close; the alarm peaks near −10 dBFS. The
 * loudest moment stays under −6 dBFS, where the safety clipper is still exactly linear.
 */
const BED_GAIN = 2;
const HUM_GAIN = 0.3;
/** Level of the fan hiss inside the hum (relative to the noise). */
const FAN_GAIN = 1.2;
/** Event buses (fanfare, alarm). */
const FX_GAIN = 0.85;
const ALARM_GAIN = 0.8;
/** The safety clipper is exactly linear up to this level and never exceeds the ceiling. */
export const CLIP_KNEE = 0.5;
export const CLIP_CEILING = 0.9;
/** Fundamental of the server hum (Hz): mains-like, with its harmonics carrying on small speakers. */
const HUM_HZ = 60;
/** Length of the looping noise buffer (s). White noise loops without a seam; filters shape it. */
const NOISE_SECONDS = 4;
/** Time constant of mix changes (s): settles in ~0.6 s without clicks. */
const MIX_TC = 0.12;
/** Time constant of the traffic-driven filter drift (s). */
const DRIFT_TC = 1.2;
/** Time constant of the fade when switching off or hiding the tab (s). */
const FADE_TC = 0.08;
/** After fading out, suspend the context (ms): > 5 time constants, so the cut is inaudible. */
const SUSPEND_MS = 450;
/** Give up waiting for the context to start after this long (ms): the gesture was not accepted. */
const RESUME_TIMEOUT_MS = 2000;
/** Fanfares closer together than this are dropped (s) — fast playback crosses many launches. */
export const FANFARE_GAP = 0.9;
/** The alarm is scheduled this far ahead (s), topped up every tick. */
const ALARM_LOOKAHEAD = 2;
const ALARM_TICK_MS = 250;
/** The bed and hum dip by this factor while the alarm plays, so it reads without being loud. */
const ALARM_DUCK = 0.6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(Number.isFinite(v) ? v : 0, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const noop = () => undefined;

// ---------------------------------------------------------------------------
// pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export interface ZoomMix {
  /** Master gain. */
  master: number;
  /** Share of the city bed (0..1). */
  bed: number;
  /** Share of the server hum (0..1). */
  hum: number;
}

/**
 * Zoom → mix. The master rises OVERVIEW_DB → 0 dB (loudness is heard in dB, so the ramp is in
 * dB); the city bed recedes and the server hum takes over as you move in.
 */
export function zoomMix(z: number): ZoomMix {
  const t = smoothstep(clamp01(z));
  return {
    master: MASTER_MAX * 10 ** ((OVERVIEW_DB * (1 - t)) / 20),
    bed: lerp(1, 0.4, t),
    hum: lerp(0.1, 1, t),
  };
}

export interface ActivityMix {
  /** Cutoff of the city bed's low-pass filter (Hz): a busier city sounds brighter. */
  cutoff: number;
  /** Level of the city bed (relative). */
  bed: number;
  /** Level of the server-fan hiss (relative). */
  fan: number;
  /** Level of the hum's upper harmonics (relative). */
  bright: number;
}

/** Traffic intensity (1 = daily average; the day runs ~0.3–1.8) → gentle changes to the mix. */
export function activityMix(a: number): ActivityMix {
  const x = clamp(Number.isFinite(a) ? a : 1, 0, 2.5);
  return {
    cutoff: clamp(300 * 2 ** (1.3 * x), 300, 1800),
    bed: 0.8 + 0.2 * clamp01(x / 1.6),
    fan: 0.3 + 0.7 * clamp01(x / 1.8),
    bright: 0.5 + 0.5 * clamp01(x / 1.8),
  };
}

/**
 * Event sounds (fanfare, alarm) follow zoom half as strongly as the ambience (in dB), so a launch
 * or an incident still reads over the quiet overview: the lift that undoes the other half.
 */
export function eventLift(z: number): number {
  return Math.sqrt(MASTER_MAX / zoomMix(z).master);
}

/**
 * The safety stage's transfer curve (for a WaveShaperNode): exactly linear up to CLIP_KNEE, then
 * a tanh shoulder that never passes CLIP_CEILING. Unlike DynamicsCompressorNode it adds no
 * make-up gain, so normal levels pass through untouched.
 */
export function softClipCurve(points = 2049): Float32Array<ArrayBuffer> {
  const n = Math.max(3, Math.floor(points));
  const curve = new Float32Array(n);
  const room = CLIP_CEILING - CLIP_KNEE;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const m = Math.abs(x);
    const y = m <= CLIP_KNEE ? m : CLIP_KNEE + room * Math.tanh((m - CLIP_KNEE) / room);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/**
 * Camera distance to what it looks at → zoom for `setZoom`: 1 at `near` or closer (inside an
 * interior), 0 at `far` or beyond (the whole island), logarithmic in between.
 */
export function zoomFromDistance(distance: number, near = 18, far = 190): number {
  if (!(distance > 0) || !(near > 0) || !(far > near)) return 0;
  return 1 - clamp01(Math.log(distance / near) / Math.log(far / near));
}

/** Deterministic white noise in [-1, 1): an integer hash of the sample index (never Math.random()). */
export function hashNoise(i: number, seed = 0): number {
  let h = Math.imul((i | 0) ^ Math.imul(seed | 0, 0x27d4eb2d), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x80000000 - 1;
}

/** One note: a soft attack, a hold, then an exponential release. Seconds, Hz, linear gain. */
export interface Tone {
  at: number;
  freq: number;
  gain: number;
  attack: number;
  hold: number;
  release: number;
}

/** When a tone has faded out (s after its start time). */
export function toneEnd(t: Tone): number {
  return t.at + t.attack + t.hold + t.release;
}

/** The launch fanfare: a rising C-major chime arpeggio (C5 E5 G5 C6), the top note ringing on. */
export const FANFARE: readonly Tone[] = [
  { at: 0, freq: 523.25, gain: 0.42, attack: 0.006, hold: 0.02, release: 0.8 },
  { at: 0.1, freq: 659.25, gain: 0.4, attack: 0.006, hold: 0.02, release: 0.8 },
  { at: 0.2, freq: 783.99, gain: 0.4, attack: 0.006, hold: 0.02, release: 0.9 },
  { at: 0.31, freq: 1046.5, gain: 0.46, attack: 0.006, hold: 0.03, release: 1.3 },
];

/** Bell-like timbre: [frequency ratio, relative gain, relative release]. */
const CHIME_PARTIALS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [2, 0.25, 0.5],
  [3.02, 0.07, 0.35],
];

/** The incident alarm: a soft, descending two-tone chime (E5 → C5), repeating. */
export const ALARM: { readonly period: number; readonly tones: readonly Tone[] } = {
  period: 1.6,
  tones: [
    { at: 0, freq: 659.25, gain: 0.3, attack: 0.05, hold: 0.25, release: 0.3 },
    { at: 0.62, freq: 523.25, gain: 0.3, attack: 0.05, hold: 0.25, release: 0.35 },
  ],
};

/** Round, gentle alarm timbre: the fundamental and a whisper of the octave. */
const ALARM_PARTIALS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [2, 0.12, 0.6],
];

/** How long a sequence of tones lasts (s). */
export function sequenceLength(tones: readonly Tone[]): number {
  return tones.reduce((end, t) => Math.max(end, toneEnd(t)), 0);
}

// ---------------------------------------------------------------------------
// audio graph
// ---------------------------------------------------------------------------

interface Graph {
  master: GainNode;
  /** Bed + hum, dipped under the alarm. */
  duck: GainNode;
  bedLevel: GainNode;
  bedFilter: BiquadFilterNode;
  humLevel: GainNode;
  humBright: GainNode;
  fanLevel: GainNode;
  fx: GainNode;
  alarmBus: GainNode;
  /** Continuous sources (noise, hum, LFOs), stopped on dispose. */
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = hashNoise(i, ch + 1);
  }
  return buffer;
}

function buildGraph(ctx: AudioContext): Graph {
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const track = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  const gain = (value: number): GainNode => {
    const g = track(ctx.createGain());
    g.gain.value = value;
    return g;
  };
  const filter = (type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode => {
    const f = track(ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  };
  const osc = (frequency: number): OscillatorNode => {
    const o = track(ctx.createOscillator());
    o.type = 'sine';
    o.frequency.value = frequency;
    sources.push(o);
    return o;
  };

  // Output: master → safety clipper → speakers. The clipper is transparent at normal levels.
  const safety = track(ctx.createWaveShaper());
  safety.curve = softClipCurve();
  safety.oversample = 'none';
  safety.connect(ctx.destination);
  const master = gain(0);
  master.connect(safety);
  const duck = gain(1);
  duck.connect(master);

  // City bed: stereo noise → low-pass (traffic moves the cutoff; a slow LFO breathes it) → a
  // gentle top roll-off → no rumble below 45 Hz → a slow swell.
  const noise = noiseBuffer(ctx);
  const bed = track(ctx.createBufferSource());
  bed.buffer = noise;
  bed.loop = true;
  sources.push(bed);
  const bedFilter = filter('lowpass', activityMix(1).cutoff, 0.4);
  const bedTop = filter('lowpass', 2400, 0.3);
  const bedFloor = filter('highpass', 45, 0.5);
  const swell = gain(1);
  const bedLevel = gain(0);
  bed.connect(bedFilter).connect(bedTop).connect(bedFloor).connect(swell).connect(bedLevel);
  bedLevel.connect(duck);
  const breathe = osc(0.045);
  breathe.connect(gain(140)).connect(bedFilter.frequency);
  const traffic = osc(0.11);
  traffic.connect(gain(0.14)).connect(swell.gain);

  // Server hum: 60 Hz and harmonics (the 120 Hz transformer tone strongest, a slow beat for
  // life); the upper harmonics and the fan hiss follow traffic.
  const humLevel = gain(0);
  humLevel.connect(duck);
  const humBright = gain(activityMix(1).bright);
  humBright.connect(humLevel);
  const partials: readonly (readonly [number, number, boolean])[] = [
    [1, 0.32, false],
    [2, 0.5, false],
    [2.006, 0.18, false],
    [3, 0.22, false],
    [4, 0.16, true],
    [6, 0.07, true],
  ];
  for (const [ratio, level, bright] of partials) {
    osc(HUM_HZ * ratio)
      .connect(gain(level))
      .connect(bright ? humBright : humLevel);
  }
  const fan = track(ctx.createBufferSource());
  fan.buffer = noise;
  fan.loop = true;
  sources.push(fan);
  const fanLevel = gain(activityMix(1).fan);
  fan
    .connect(filter('bandpass', 1400, 0.6))
    .connect(gain(FAN_GAIN))
    .connect(fanLevel);
  fanLevel.connect(humLevel);

  // Event buses (not ducked): fanfare and alarm, each softened by a low-pass.
  const fx = gain(FX_GAIN);
  fx.connect(filter('lowpass', 5200, 0.5)).connect(master);
  const alarmBus = gain(ALARM_GAIN);
  alarmBus.connect(filter('lowpass', 2600, 0.5)).connect(master);

  const t = ctx.currentTime;
  for (const s of sources) {
    // The fan reads the shared noise from another offset so it does not correlate with the bed.
    if (s === fan) fan.start(t, NOISE_SECONDS * 0.43);
    else s.start(t);
  }
  return {
    master,
    duck,
    bedLevel,
    bedFilter,
    humLevel,
    humBright,
    fanLevel,
    fx,
    alarmBus,
    sources,
    nodes,
  };
}

function defaultContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

function wait(ms: number): { promise: Promise<void>; cancel: () => void } {
  let id: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    id = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => clearTimeout(id) };
}

// ---------------------------------------------------------------------------
// the sound
// ---------------------------------------------------------------------------

interface AlarmSession {
  out: GainNode;
  next: number;
  playing: Set<OscillatorNode>;
}

export function createSound(opts: SoundOptions = {}): Sound {
  let ctx: AudioContext | null = null;
  let graph: Graph | null = null;
  let enabled = false;
  let disposed = false;
  /** Bumped by every setEnabled call; an older call that resumes late does nothing. */
  let generation = 0;
  let zoom = 0;
  let activity = 1;
  let alarmWanted = false;
  let session: AlarmSession | null = null;
  let alarmTimer: ReturnType<typeof setInterval> | undefined;
  let suspendTimer: ReturnType<typeof setTimeout> | undefined;
  let lastFanfare = Number.NEGATIVE_INFINITY;
  let listening = false;
  let gestureArmed = false;
  const targets = new Map<AudioParam, number>();

  const doc = (): Document | null => (typeof document === 'undefined' ? null : document);
  const hidden = (): boolean => doc()?.hidden ?? false;
  const audible = (): boolean => enabled && !hidden();

  /** Glide a parameter to a value (skipping repeats), from wherever it is now. */
  function glide(param: AudioParam, value: number, tc = MIX_TC): void {
    if (!ctx) return;
    const last = targets.get(param);
    if (last !== undefined && Math.abs(last - value) <= Math.max(1e-4, Math.abs(last) * 0.002)) {
      return;
    }
    targets.set(param, value);
    const t = ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setTargetAtTime(value, t, tc);
  }

  function applyMix(): void {
    if (!graph) return;
    const z = zoomMix(zoom);
    const a = activityMix(activity);
    glide(graph.master.gain, audible() ? z.master : 0, audible() ? MIX_TC : FADE_TC);
    glide(graph.bedLevel.gain, BED_GAIN * z.bed * a.bed);
    glide(graph.humLevel.gain, HUM_GAIN * z.hum);
    glide(graph.humBright.gain, a.bright, DRIFT_TC);
    glide(graph.fanLevel.gain, a.fan, DRIFT_TC);
    glide(graph.bedFilter.frequency, a.cutoff, DRIFT_TC);
    glide(graph.duck.gain, session ? ALARM_DUCK : 1, 0.25);
    const lift = eventLift(zoom);
    glide(graph.fx.gain, FX_GAIN * lift);
    glide(graph.alarmBus.gain, ALARM_GAIN * lift);
  }

  function clearSuspend(): void {
    clearTimeout(suspendTimer);
    suspendTimer = undefined;
  }

  /** Suspend once the fade-out has finished, if still silent by then. */
  function suspendSoon(): void {
    clearSuspend();
    suspendTimer = setTimeout(() => {
      suspendTimer = undefined;
      if (ctx && !audible() && ctx.state === 'running') void ctx.suspend().catch(noop);
    }, SUSPEND_MS);
  }

  function resumeOrWait(): void {
    const c = ctx;
    if (!c) return;
    void c
      .resume()
      .catch(noop)
      .then(() => {
        if (audible() && c.state !== 'running') armGesture();
      });
  }

  // Some browsers only restart audio inside a user gesture (e.g. after the tab slept):
  // retry on the next tap or key press.
  function onGesture(): void {
    disarmGesture();
    if (audible()) resumeOrWait();
  }
  function armGesture(): void {
    const d = doc();
    if (!d || gestureArmed || disposed) return;
    gestureArmed = true;
    d.addEventListener('pointerdown', onGesture, true);
    d.addEventListener('keydown', onGesture, true);
  }
  function disarmGesture(): void {
    const d = doc();
    if (!d || !gestureArmed) return;
    gestureArmed = false;
    d.removeEventListener('pointerdown', onGesture, true);
    d.removeEventListener('keydown', onGesture, true);
  }

  function onVisibility(): void {
    if (!ctx || !graph) return;
    applyMix();
    if (!audible()) {
      suspendSoon();
    } else {
      clearSuspend();
      resumeOrWait();
    }
  }

  function onStateChange(): void {
    if (!ctx) return;
    if (audible() && ctx.state !== 'running' && ctx.state !== 'closed') armGesture();
    // A resume that was still pending when we gave up (or switched off) can land later.
    if (!audible() && ctx.state === 'running' && suspendTimer === undefined) suspendSoon();
  }

  function listen(): void {
    if (listening || !ctx) return;
    listening = true;
    doc()?.addEventListener('visibilitychange', onVisibility);
    ctx.onstatechange = onStateChange;
  }

  /** Play one tone (with its partials) into `out` at time `start`; returns its oscillators. */
  function playTone(
    tone: Tone,
    start: number,
    out: AudioNode,
    partials: readonly (readonly [number, number, number])[],
    pan = 0,
  ): OscillatorNode[] {
    const c = ctx!;
    const t0 = start + tone.at;
    const peak = t0 + tone.attack;
    const held = peak + tone.hold;
    const end = held + tone.release;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(tone.gain, peak);
    env.gain.setValueAtTime(tone.gain, held);
    env.gain.exponentialRampToValueAtTime(1e-4, end);
    let tail: AudioNode = env;
    if (pan !== 0 && typeof c.createStereoPanner === 'function') {
      const p = c.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      env.connect(p);
      tail = p;
    }
    tail.connect(out);
    const extra: AudioNode[] = [];
    const oscs = partials.map(([ratio, level, releaseScale]) => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = tone.freq * ratio;
      const g = c.createGain();
      // Upper partials die away sooner, as on a struck bell.
      g.gain.setValueAtTime(level, t0);
      g.gain.setValueAtTime(level, held);
      g.gain.exponentialRampToValueAtTime(
        Math.max(1e-4, level * 1e-3),
        held + tone.release * releaseScale,
      );
      o.connect(g).connect(env);
      extra.push(g);
      o.start(t0);
      o.stop(end + 0.02);
      return o;
    });
    const last = oscs[oscs.length - 1];
    if (last) {
      last.onended = () => {
        for (const o of oscs) o.disconnect();
        for (const g of extra) g.disconnect();
        env.disconnect();
        if (tail !== env) tail.disconnect();
      };
    }
    return oscs;
  }

  function tickAlarm(): void {
    const s = session;
    if (!s || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // After a stall (a blocked main thread), skip ahead instead of firing a burst.
    if (s.next < now) s.next = now + 0.05;
    while (s.next < now + ALARM_LOOKAHEAD) {
      for (const tone of ALARM.tones) {
        for (const o of playTone(tone, s.next, s.out, ALARM_PARTIALS)) {
          s.playing.add(o);
          o.addEventListener('ended', () => s.playing.delete(o));
        }
      }
      s.next += ALARM.period;
    }
  }

  function startAlarm(): void {
    if (session || !ctx || !graph || !enabled) return;
    const out = ctx.createGain();
    out.connect(graph.alarmBus);
    session = { out, next: ctx.currentTime + 0.05, playing: new Set() };
    tickAlarm();
    alarmTimer = setInterval(tickAlarm, ALARM_TICK_MS);
    applyMix();
  }

  function stopAlarm(): void {
    clearInterval(alarmTimer);
    alarmTimer = undefined;
    const s = session;
    session = null;
    if (!s || !ctx) return;
    const t = ctx.currentTime;
    s.out.gain.cancelScheduledValues(t);
    s.out.gain.setTargetAtTime(0, t, 0.06);
    for (const o of s.playing) {
      // Also cancels tones scheduled further ahead (a stop before the start plays nothing).
      try {
        o.stop(t + 0.4);
      } catch {
        // an engine that rejects a second stop(): the fade above silences it anyway
      }
    }
    s.playing.clear();
    setTimeout(() => s.out.disconnect(), 700);
    applyMix();
  }

  function create(): boolean {
    if (ctx) return true;
    let c: AudioContext | null = null;
    try {
      c = opts.contextFactory ? opts.contextFactory() : defaultContext();
      if (!c) return false;
      graph = buildGraph(c);
      ctx = c;
      listen();
      return true;
    } catch {
      // No usable Web Audio: stay silent (enabled remains false).
      graph = null;
      if (c) void c.close().catch(noop);
      return false;
    }
  }

  const sound: Sound = {
    get enabled() {
      return enabled;
    },
    async setEnabled(on) {
      if (disposed) return;
      const gen = ++generation;
      if (!on) {
        enabled = false;
        stopAlarm();
        disarmGesture();
        applyMix(); // fade out
        const c = ctx;
        if (!c) return;
        clearSuspend();
        await wait(SUSPEND_MS).promise;
        if (gen !== generation || disposed) return;
        if (c.state === 'running') await c.suspend().catch(noop);
        return;
      }
      // Created synchronously, inside the caller's user gesture.
      if (!create() || !ctx) return;
      const c = ctx;
      clearSuspend();
      const timeout = wait(RESUME_TIMEOUT_MS);
      await Promise.race([c.resume().catch(noop), timeout.promise]);
      timeout.cancel();
      if (gen !== generation || disposed) return;
      enabled = c.state === 'running';
      applyMix(); // fade in (or stay silent)
      if (!enabled) {
        suspendSoon();
        return;
      }
      // The alarm's scheduler simply pauses while the context is suspended (hidden tab).
      if (alarmWanted) startAlarm();
      if (hidden()) suspendSoon();
      else clearSuspend();
    },
    setZoom(z) {
      zoom = clamp01(z);
      applyMix();
    },
    setActivity(a) {
      activity = Number.isFinite(a) ? Math.max(0, a) : 1;
      applyMix();
    },
    launch() {
      const g = graph;
      if (!ctx || !g || !audible() || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (now - lastFanfare < FANFARE_GAP) return;
      lastFanfare = now;
      // The arpeggio walks gently from left to right.
      const n = FANFARE.length;
      FANFARE.forEach((tone, i) =>
        playTone(tone, now + 0.02, g.fx, CHIME_PARTIALS, n > 1 ? -0.3 + (0.6 * i) / (n - 1) : 0),
      );
    },
    alarm(on) {
      alarmWanted = on;
      if (on) startAlarm();
      else stopAlarm();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      enabled = false;
      stopAlarm();
      clearSuspend();
      disarmGesture();
      if (listening) {
        doc()?.removeEventListener('visibilitychange', onVisibility);
        if (ctx) ctx.onstatechange = null;
      }
      if (graph) {
        for (const s of graph.sources) {
          try {
            s.stop();
          } catch {
            // already stopped
          }
        }
        for (const n of graph.nodes) n.disconnect();
      }
      if (ctx) void ctx.close().catch(noop);
      graph = null;
      ctx = null;
    },
  };
  return sound;
}
