/**
 * The 3D world: environment, one campus per platform, light streams, labels,
 * picking and camera flights. Every frame, each campus is driven by the model:
 * height from today's tokens/day, server activity from the live traffic curve,
 * lit windows from office hours at the HQ, daylight from its local time.
 */
import {
  ACESFilmicToneMapping,
  FogExp2,
  HemisphereLight,
  DirectionalLight,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Mesh,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { dailyRate, rateTier, trafficNow } from '../model/estimate';
import type { City } from '../state/city';
import type { Clock } from '../state/clock';
import { daylight, localHour, occupancy } from '../state/localtime';
import { humanNumber } from '../ui/format';
import { createCampus, type Campus } from './campus/campus';
import { CameraDirector, type Pose } from './director';
import { createEnvironment, MOON_DIRECTION } from './environment';
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
  dispose(): void;
}

export interface WorldOptions {
  reducedMotion: boolean;
  labels: HTMLElement;
  onFrame?: () => void;
  onSelect?: (id: string | null) => void;
}

interface Slot {
  campus: Campus;
  streams: Streams;
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
  controls.minDistance = 14;
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
    scene.add(campus.group, streams.group);
    slots.set(pm.platform.id, { campus, streams, tz: pm.platform.hq.timezone, hour: 12 });
  }

  let selected: string | null = null;
  let hovered: string | null = null;
  let scaleMode: ScaleMode = 'log';

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

  function pick(ev: PointerEvent): string | null {
    const r = canvas.getBoundingClientRect();
    pointer.set(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(hitMeshes, false)[0];
    return (hit?.object.userData.platformId as string | undefined) ?? null;
  }

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerType !== 'mouse') return;
    const id = pick(ev);
    if (id !== hovered) {
      if (hovered) slots.get(hovered)?.campus.setHighlight(hovered === selected);
      hovered = id;
      if (id) slots.get(id)?.campus.setHighlight(true);
      labels.setHovered(id);
      canvas.style.cursor = id ? 'pointer' : '';
    }
  };
  const onDown = (ev: PointerEvent) => (down = { x: ev.clientX, y: ev.clientY });
  const onUp = (ev: PointerEvent) => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    down = null;
    if (moved > 6) return; // a drag, not a tap
    const id = pick(ev);
    if (id) world.select(id);
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

  const frame = (timestamp: number) => {
    timer.update(timestamp);
    const dt = Math.min(timer.getDelta(), 0.1);
    elapsed += dt;
    const t = clock.now();
    const nowMs = Date.now();
    if (nowMs - lastTierUpdate > 5_000) {
      lastTierUpdate = nowMs;
      for (const pm of city.platforms) tiers.set(pm.platform.id, rateTier(pm, t));
    }
    if (nowMs - lastHourUpdate > 20_000) {
      lastHourUpdate = nowMs;
      for (const s of slots.values()) s.hour = localHour(s.tz, nowMs);
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
      slot.campus.update({
        height: towerHeight(rate, scaleMode, maxRate),
        lit: occupancy(slot.hour) * (0.45 + 0.55 * load),
        hour: slot.hour,
        daylight: daylight(slot.hour),
        activity,
        halls: counts.halls,
        cooling: counts.cooling,
        trucks: counts.trucks,
        time: elapsed,
        dt,
      });
      slot.streams.update(elapsed, rate > 0 ? (0.25 + 0.75 * load) * Math.min(1.4, activity) : 0);
      slot.streams.group.visible = rate > 0;
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
    select(id) {
      if (id === selected) return;
      if (selected) slots.get(selected)?.campus.setHighlight(false);
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
      slots.forEach((s) => {
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
