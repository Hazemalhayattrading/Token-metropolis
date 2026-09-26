/**
 * The 3D world: environment, one campus per platform, light streams, labels,
 * picking and camera flights. Every frame, each campus is driven by the model:
 * height from today's tokens/day, server activity from the live traffic curve,
 * lit windows from office hours at the HQ, daylight from its local time.
 */
import {
  ACESFilmicToneMapping,
  Box3,
  FogExp2,
  HemisphereLight,
  DirectionalLight,
  PerspectiveCamera,
  Ray,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Mesh,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TimelineEvent } from '../data/schema';
import { dailyRate, rateTier, trafficNow } from '../model/estimate';
import { daysToMs } from '../model/time';
import { activeLaunches, celebrates, crossedEvents } from '../state/events';
import type { City } from '../state/city';
import type { Clock } from '../state/clock';
import { daylight, localHour, occupancy } from '../state/localtime';
import { humanNumber } from '../ui/format';
import { createCampus, type Campus } from './campus/campus';
import { CameraDirector, type Pose } from './director';
import { createEnvironment, MOON_DIRECTION } from './environment';
import type { InteriorView, Interiors } from './interiors';
import { releasedBy } from './interiors/lineup';
import { createLaunchFx, type LaunchFx } from './launch';
import { createLabels, type LabelValue, type Labels } from './labels';
import { layoutPlots } from './layout';
import { createPost } from './post';
import { facilityCounts, logLoad, towerHeight, type ScaleMode } from './scale';
import { createStreams, type Streams } from './streams';

export interface World {
  start(): void;
  stop(): void;
  select(id: string | null): void;
  setScale(mode: ScaleMode): void;
  /** Screen space covered by UI (side panel / bottom sheet), so the scene recentres in the free area. */
  setInsets(insets: { left: number; bottom: number }): void;
  /** Fly into one of the selected campus's interiors (loaded on first use). */
  setView(view: InteriorView): void;
  /** Highlight a model in the lab (from the panel list). */
  selectModel(id: string | null): void;
  /** The time shown jumped (a seek, or back to live): no launch pulses for the gap. */
  resetTimeline(): void;
  readonly view: InteriorView;
  dispose(): void;
}

export interface WorldOptions {
  reducedMotion: boolean;
  labels: HTMLElement;
  onFrame?: () => void;
  onSelect?: (id: string | null) => void;
  /** A model crystal was clicked in the lab. */
  onModel?: (id: string) => void;
  /** The world changed view on its own (e.g. the interiors failed to load and it fell back). */
  onViewChange?: (view: InteriorView) => void;
  /** Model launches (public/data/events.json), newest first. */
  events?: readonly TimelineEvent[];
  /** The time shown moved forward past a launch (playback, or live). */
  onLaunch?: (e: TimelineEvent) => void;
  /** Whether the time machine is playing (playback fires every launch it crosses). */
  isPlaying?: () => boolean;
}

interface Slot {
  campus: Campus;
  streams: Streams;
  launch: LaunchFx;
  /** Remaining fraction of the short launch pulse (1 → 0 over BURST_SECONDS). */
  burst: number;
  tz: string;
  hour: number;
}

export function createWorld(
  canvas: HTMLCanvasElement,
  city: City,
  clock: Clock,
  opts: WorldOptions,
): World {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new Scene();
  scene.fog = new FogExp2('#0a0f22', 0.006);

  const camera = new PerspectiveCamera(38, 1, 0.5, 2000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 5;
  controls.maxDistance = 320;
  controls.autoRotate = !opts.reducedMotion;
  controls.autoRotateSpeed = 0.18;
  controls.target.set(0, 6, 0);
  const director = new CameraDirector(camera, controls, opts.reducedMotion);

  // Lighting language: cool moonlight, a faint warm counter-light from the city.
  scene.add(new HemisphereLight('#5363a0', '#0b0d18', 1.4));
  const moon = new DirectionalLight('#cdd8ff', 1.8);
  moon.position.copy(MOON_DIRECTION).multiplyScalar(200);
  scene.add(moon);
  const cityGlow = new DirectionalLight('#ffb27a', 0.35);
  cityGlow.position.set(80, 30, 120);
  scene.add(cityGlow);

  const plots = layoutPlots(city.platforms.map((pm) => pm.platform.id));
  const env = createEnvironment([...plots.values()]);
  scene.add(env.group);

  const slots = new Map<string, Slot>();
  for (const pm of city.platforms) {
    const plot = plots.get(pm.platform.id)!;
    const campus = createCampus(pm.platform, plot);
    const streams = createStreams(
      new Vector3(plot.x, 0, plot.z),
      pm.mix,
      pm.platform.identity.palette.accent,
    );
    const launch = createLaunchFx({
      accent: pm.platform.identity.palette.accent,
      footprint: campus.footprint,
      blocked: (x, z) => campus.groundBlocked(x, z),
    });
    campus.group.add(launch.group);
    scene.add(campus.group, streams.group);
    slots.set(pm.platform.id, {
      campus,
      streams,
      launch,
      burst: 0,
      tz: pm.platform.hq.timezone,
      hour: 12,
    });
  }

  let selected: string | null = null;
  let hovered: string | null = null;
  let scaleMode: ScaleMode = 'log';
  let view: InteriorView = 'overview';
  let interiors: Interiors | null = null;
  let interiorsModule: Promise<typeof import('./interiors')> | null = null;
  let interiorsLib: typeof import('./interiors') | null = null;
  /** What the open interiors were built for (rebuilt when the date shown changes them). */
  let builtFor = { models: -1, height: 0 };
  let lastRebuild = 0;
  let selectedModel: string | null = null;

  const labels: Labels = createLabels(
    opts.labels,
    city.platforms.map((pm) => ({
      id: pm.platform.id,
      name: pm.platform.name,
      accent: pm.platform.identity.palette.accent,
    })),
    (id) => world.select(id),
  );

  const post = createPost(renderer, scene, camera);

  // --- framing ---------------------------------------------------------------
  function overviewPose(): Pose {
    const distance = camera.aspect < 1 ? 195 : 150;
    const target = new Vector3(0, 6, 0);
    const position = new Vector3()
      .setFromSphericalCoords(distance, Math.PI * 0.34, Math.PI * 0.18)
      .add(target);
    return { position, target };
  }

  function campusPose(id: string): Pose {
    const c = slots.get(id)!.campus;
    const base = c.group.position;
    const h = Math.max(c.currentHeight, 6);
    const portrait = camera.aspect < 1;
    const target = new Vector3(base.x, h * (portrait ? 0.38 : 0.45), base.z);
    const out = new Vector3(base.x, 0, base.z).normalize();
    if (out.lengthSq() < 0.01) out.set(0, 0, 1);
    const distance = (16 + h * 0.95) * (portrait ? 2.1 : 1);
    const side = new Vector3(-out.z, 0, out.x).multiplyScalar(distance * 0.3);
    const position = target
      .clone()
      .add(out.multiplyScalar(distance))
      .add(side)
      .setY(h * 0.5 + distance * 0.4);
    return { position, target };
  }

  // --- interior framings ------------------------------------------------------
  const UP = new Vector3(0, 1, 0);
  const probeRay = new Ray();
  const probeBox = new Box3();
  const probeHit = new Vector3();

  /**
   * How far a sight line from `from` along `dir` stays clear of the campus's own tower (its pick
   * box). Other HQs step aside while an interior is open (see the frame loop), so only the
   * campus itself can block the view.
   */
  function clearDistance(from: Vector3, dir: Vector3, max: number, own: Campus | null): number {
    if (!own) return max;
    probeRay.set(from, dir);
    probeBox.setFromObject(own.hit);
    return probeRay.intersectBox(probeBox, probeHit)
      ? Math.min(max, from.distanceTo(probeHit))
      : max;
  }

  /**
   * Interior framings, in the campus's local space (+z faces the city centre). The campus's own
   * tower can stand in the preferred line of sight, so candidate directions are tried in order
   * (turning around the target, then climbing) and the first with a clear view wins.
   */
  function viewPose(id: string, v: InteriorView): Pose {
    if (v === 'overview') return campusPose(id);
    const c = slots.get(id)!.campus;
    let target: Vector3;
    let dir: Vector3;
    let distance: number;
    let yaws = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];
    // The target sits inside the campus's own pick box only for the offices.
    let own: Campus | null = c;
    switch (v) {
      case 'offices': {
        const f = interiors?.officeFrame() ?? { y: 3.8, radius: 3 };
        target = new Vector3(0, f.y, 0);
        dir = new Vector3(0.55, 0.55, 1);
        distance = 9 + f.radius * 2.2;
        own = null;
        break;
      }
      case 'hall':
        target = c.anchors.halls.clone().setY(0.8);
        dir = new Vector3(0.55, 1.35, -0.75);
        distance = 21;
        break;
      case 'power':
        target = c.anchors.power.clone().setY(1.8);
        dir = new Vector3(0.9, 1.15, 0.45);
        distance = 23;
        break;
      case 'lab':
        target = c.anchors.lab.clone().setY(1.5);
        dir = new Vector3(0.12, 0.38, 1);
        distance = 9 + (interiors?.labHalfWidth() ?? 6) * 1.8;
        yaws = [0, 20, -20, 40, -40, 60, -60]; // the display case has a back wall
        break;
    }
    // Portrait screens see ~27° across, so step back to keep the scene in frame.
    if (camera.aspect < 1) distance *= 1.7;
    c.group.updateMatrixWorld();
    const worldTarget = c.group.localToWorld(target);
    let best = { dir: new Vector3(), clear: -1 };
    search: for (const lift of [0, 0.7, 1.6]) {
      for (const yaw of yaws) {
        const d = dir
          .clone()
          .setY(dir.y + lift)
          .normalize()
          .applyAxisAngle(UP, (yaw * Math.PI) / 180)
          .applyQuaternion(c.group.quaternion);
        const clear = clearDistance(worldTarget, d, distance, own);
        if (clear > best.clear) best = { dir: d, clear };
        if (clear >= distance) break search;
      }
    }
    const finalDistance = Math.max(6, Math.min(distance, best.clear - 1.5));
    return {
      target: worldTarget,
      position: worldTarget.clone().addScaledVector(best.dir, finalDistance),
    };
  }

  /** Build the selected campus's interiors for the date shown (models released by then, log height). */
  function buildInteriors(lib: typeof import('./interiors'), id: string, t: number): Interiors {
    const pm = city.byId.get(id)!;
    const models = releasedBy(
      city.dataset.models.filter((m) => m.platform === id),
      t,
    );
    const height = towerHeight(dailyRate(pm, t).central, 'log', 0);
    builtFor = { models: models.length, height };
    return lib.createInteriors(pm.platform, slots.get(id)!.campus, models, height);
  }

  function closeInteriors(): void {
    interiors?.dispose();
    interiors = null;
    view = 'overview';
    selectedModel = null;
    opts.labels.classList.remove('labels--interior');
  }

  let insets = { left: 0, bottom: 0 };
  function applyViewOffset(): void {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (w === 0 || h === 0) return;
    // Portrait: the HUD covers the lower part, so lift the scene; panels push it aside.
    const x = -insets.left / 2;
    const y = (camera.aspect < 1 && insets.bottom === 0 ? h * 0.12 : 0) + insets.bottom / 2;
    if (x !== 0 || y !== 0) camera.setViewOffset(w, h, x, y, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    post.setSize(w, h, pixelRatio);
    camera.aspect = w / h;
    // Keep ~27° of horizontal view on portrait screens so the island is not cropped.
    camera.fov =
      camera.aspect < 1
        ? Math.min(
            70,
            Math.max(
              38,
              (2 * Math.atan(Math.tan((13.5 * Math.PI) / 180) / camera.aspect) * 180) / Math.PI,
            ),
          )
        : 38;
    applyViewOffset();
    if (!selected) void director.flyTo(overviewPose(), 0);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // --- picking ---------------------------------------------------------------
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const hitMeshes: Mesh[] = [...slots.values()].map((s) => s.campus.hit);
  let down: { x: number; y: number } | null = null;

  interface Picked {
    platform: string | null;
    model: string | null;
  }

  function pick(ev: PointerEvent): Picked {
    const r = canvas.getBoundingClientRect();
    pointer.set(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const crystals = interiors?.pickables() ?? [];
    if (crystals.length > 0) {
      const m = raycaster.intersectObjects(crystals as Object3D[], false)[0];
      if (m) return { platform: null, model: m.object.userData.modelId as string };
    }
    // Inside an interior, taps never jump to a neighbouring HQ; the panel's tabs lead out.
    if (view !== 'overview') return { platform: null, model: null };
    const hit = raycaster.intersectObjects(hitMeshes, false)[0];
    return {
      platform: (hit?.object.userData.platformId as string | undefined) ?? null,
      model: null,
    };
  }

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerType !== 'mouse') return;
    const picked = pick(ev);
    const id = picked.platform;
    if (picked.model) {
      canvas.style.cursor = 'pointer';
      return;
    }
    if (id !== hovered) {
      if (hovered) slots.get(hovered)?.campus.setHighlight(hovered === selected);
      hovered = id;
      if (id) slots.get(id)?.campus.setHighlight(true);
      labels.setHovered(id);
    }
    canvas.style.cursor = id && id !== selected ? 'pointer' : '';
  };
  const onDown = (ev: PointerEvent) => (down = { x: ev.clientX, y: ev.clientY });
  const onUp = (ev: PointerEvent) => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    down = null;
    if (moved > 6) return; // a drag, not a tap
    const picked = pick(ev);
    if (picked.model) {
      world.selectModel(picked.model);
      opts.onModel?.(picked.model);
    } else if (picked.platform) world.select(picked.platform);
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);

  // --- frame loop ----------------------------------------------------------------
  const timer = new Timer();
  let elapsed = 0;
  let lastHourUpdate = 0;
  const labelPositions = new Map<string, Vector3>();
  const labelValues = new Map<string, LabelValue>();
  let lastTierUpdate = 0;
  const tiers = new Map<string, ReturnType<typeof rateTier>>();

  const events = opts.events ?? [];
  const BURST_SECONDS = 2.5;
  // Outside playback (live), only a small forward step (e.g. after the tab slept) fires pulses;
  // seeks call resetTimeline(), so they never do.
  const MAX_LIVE_STEP_DAYS = 1;
  let launches = new Map<string, TimelineEvent[]>();
  let launchesAt = Number.NaN;
  let prevT: number | null = null;
  let tierT = Number.NaN;
  let hourT = Number.NaN;

  /**
   * Keep an open interior true to the date shown: before launch there is nothing to show, so go
   * back to the campus; the lab lists only models released by then; the offices follow the tower.
   */
  function syncInteriors(id: string, t: number, rate: number): void {
    if (rate <= 0) {
      world.setView('overview');
      opts.onViewChange?.('overview');
      return;
    }
    if (!interiorsLib || !interiors) return;
    const now = performance.now();
    if (now - lastRebuild < 500) return;
    const models = releasedBy(
      city.dataset.models.filter((m) => m.platform === id),
      t,
    ).length;
    const height = towerHeight(rate, 'log', 0);
    const stale =
      (view === 'lab' && models !== builtFor.models) ||
      (view === 'offices' && Math.abs(height - builtFor.height) > 0.25 * builtFor.height);
    if (!stale) return;
    lastRebuild = now;
    const shown = view;
    interiors.dispose();
    interiors = buildInteriors(interiorsLib, id, t);
    interiors.show(shown);
    interiors.selectModel(selectedModel);
    void director.flyTo(viewPose(id, shown), 0.8);
  }

  const frame = (timestamp: number) => {
    timer.update(timestamp);
    const dt = Math.min(timer.getDelta(), 0.1);
    elapsed += dt;
    const t = clock.now();
    if (!(Math.abs(t - launchesAt) < 1 / 1440)) {
      launches = activeLaunches(events, t);
      launchesAt = t;
    }
    const playing = opts.isPlaying?.() ?? false;
    if (prevT !== null && t > prevT && (playing || t - prevT < MAX_LIVE_STEP_DAYS)) {
      for (const e of crossedEvents(events, prevT, t)) {
        const slot = slots.get(e.platform);
        if (slot && celebrates(e)) slot.burst = 1;
        opts.onLaunch?.(e);
      }
    }
    prevT = t;
    const nowMs = Date.now();
    // Tiers and local hours follow the time shown: refreshed when it moves, and every few seconds.
    if (nowMs - lastTierUpdate > 5_000 || !(Math.abs(t - tierT) < 0.25)) {
      lastTierUpdate = nowMs;
      tierT = t;
      for (const pm of city.platforms) tiers.set(pm.platform.id, rateTier(pm, t));
    }
    if (nowMs - lastHourUpdate > 20_000 || !(Math.abs(t - hourT) < 5 / 1440)) {
      lastHourUpdate = nowMs;
      hourT = t;
      for (const s of slots.values()) s.hour = localHour(s.tz, daysToMs(t));
    }
    let maxRate = 0;
    const rates = new Map<string, number>();
    for (const pm of city.platforms) {
      const r = dailyRate(pm, t).central;
      rates.set(pm.platform.id, r);
      maxRate = Math.max(maxRate, r);
    }
    for (const pm of city.platforms) {
      const id = pm.platform.id;
      const slot = slots.get(id)!;
      const rate = rates.get(id)!;
      const load = logLoad(rate);
      const activity = rate > 0 ? trafficNow(pm, t) : 0;
      const counts = facilityCounts(rate);
      // While an interior is open, the other HQs sink away (and regrow on the way out) so nothing
      // stands between the camera and the interior; the selected campus shows log scale, which
      // the interiors are laid out for.
      const inside = id === selected && view !== 'overview';
      const away = view !== 'overview' && id !== selected;
      slot.campus.update({
        height: away ? 0 : towerHeight(rate, inside ? 'log' : scaleMode, maxRate),
        lit: occupancy(slot.hour) * (0.45 + 0.55 * load),
        hour: slot.hour,
        daylight: daylight(slot.hour),
        activity,
        halls: counts.halls,
        cooling: counts.cooling,
        trucks: counts.trucks,
        time: elapsed,
        dt,
        ease: away ? 10 : 5,
      });
      if (inside) {
        interiors?.update({ load, occupancy: occupancy(slot.hour), activity, time: elapsed });
        syncInteriors(id, t, rate);
      }
      slot.streams.update(elapsed, rate > 0 ? (0.25 + 0.75 * load) * Math.min(1.4, activity) : 0);
      slot.streams.group.visible = rate > 0 && view === 'overview';
      slot.burst = Math.max(0, slot.burst - dt / BURST_SECONDS);
      slot.launch.update({
        active: launches.has(id) && rate > 0 && view === 'overview',
        burst: view === 'overview' ? slot.burst : 0,
        time: elapsed,
        height: slot.campus.currentHeight,
        reducedMotion: opts.reducedMotion,
      });
      labelPositions.set(id, slot.campus.top);
      labelValues.set(id, {
        text: rate > 0 ? `${humanNumber(rate, 'short')} tokens/day` : '',
        tier: tiers.get(id) ?? 'modeled',
        priority: rate,
      });
    }
    director.update(dt);
    controls.update();
    labels.update(camera, labelPositions, labelValues);
    post.render();
    opts.onFrame?.();
  };

  let running = false;
  const onVisibility = () => (document.hidden ? world.stop() : world.start());
  document.addEventListener('visibilitychange', onVisibility);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && selected) world.select(null);
  };
  window.addEventListener('keydown', onKey);

  const world: World = {
    start() {
      if (running) return;
      running = true;
      timer.reset();
      renderer.setAnimationLoop(frame);
    },
    stop() {
      running = false;
      renderer.setAnimationLoop(null);
    },
    get view() {
      return view;
    },
    select(id) {
      if (id === selected) return;
      if (selected) slots.get(selected)?.campus.setHighlight(false);
      closeInteriors();
      selected = id;
      labels.setSelected(id);
      if (id) {
        slots.get(id)?.campus.setHighlight(true);
        controls.autoRotate = false;
        void director.flyTo(campusPose(id));
      } else {
        controls.autoRotate = !opts.reducedMotion;
        void director.flyTo(overviewPose());
      }
      opts.onSelect?.(id);
    },
    setScale(mode) {
      scaleMode = mode;
    },
    setInsets(next) {
      insets = next;
      applyViewOffset();
    },
    setView(next) {
      const id = selected;
      if (!id || next === view) return;
      view = next;
      opts.labels.classList.toggle('labels--interior', next !== 'overview');
      if (next === 'overview') {
        interiors?.show('overview');
        void director.flyTo(viewPose(id, 'overview'), 1.4);
        return;
      }
      interiorsModule ??= import('./interiors');
      interiorsModule
        .then(async (mod) => {
          if (selected !== id || view !== next) return; // superseded while loading
          interiorsLib = mod;
          const slot = slots.get(id)!;
          interiors ??= buildInteriors(mod, id, clock.now());
          interiors.show(next);
          interiors.selectModel(selectedModel);
          // Compile the interior's shaders before the flight so the first frames don't stall
          // (in parallel where the browser supports it; otherwise once, right now).
          if (renderer.extensions.has('KHR_parallel_shader_compile')) {
            await renderer.compileAsync(slot.campus.group, camera, scene).catch(() => undefined);
          } else {
            renderer.compile(slot.campus.group, camera, scene);
          }
          if (selected !== id || view !== next) return;
          void director.flyTo(viewPose(id, next), 1.4);
        })
        .catch(() => {
          // Chunk failed to load (offline): stay on the campus overview and tell the panel.
          interiorsModule = null;
          view = 'overview';
          opts.labels.classList.remove('labels--interior');
          opts.onViewChange?.('overview');
        });
    },
    selectModel(id) {
      selectedModel = id;
      interiors?.selectModel(id);
    },
    resetTimeline() {
      prevT = null;
    },
    dispose() {
      world.stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKey);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      observer.disconnect();
      controls.dispose();
      labels.dispose();
      closeInteriors();
      slots.forEach((s) => {
        s.launch.dispose();
        s.campus.dispose();
        s.streams.dispose();
      });
      env.dispose();
      post.dispose();
      renderer.dispose();
    },
  };
  return world;
}
