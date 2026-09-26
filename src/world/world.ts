/**
 * The 3D world (Milestone 2 skeleton): renderer, camera, controls, lighting and
 * one placeholder tower per platform, sized on a log scale by today's tokens.
 * Milestone 3 replaces the towers with full campuses.
 */
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { dailyRate } from '../model/estimate';
import type { City } from '../state/city';
import type { Clock } from '../state/clock';

export interface World {
  start(): void;
  stop(): void;
  dispose(): void;
}

export interface WorldOptions {
  reducedMotion: boolean;
  onFrame?: () => void;
}

/** Log-scale tower height: 10 billion tokens/day → 2 units, each ×10 adds 6 units. */
export function towerHeight(tokensPerDay: number): number {
  return Math.max(1, 2 + 6 * Math.log10(Math.max(tokensPerDay, 1e10) / 1e10));
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new Scene();
  scene.background = new Color('#05070d');
  scene.fog = new FogExp2('#05070d', 0.012);

  const camera = new PerspectiveCamera(40, 1, 0.1, 600);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minDistance = 20;
  controls.maxDistance = 220;
  controls.autoRotate = !opts.reducedMotion;
  controls.autoRotateSpeed = 0.25;
  controls.target.set(0, 7, 0);

  scene.add(new HemisphereLight('#5d6fa8', '#0a0d16', 2.2));
  const moon = new DirectionalLight('#d6e0ff', 2.6);
  moon.position.set(-40, 70, 40);
  scene.add(moon);
  const rim = new DirectionalLight('#ffb98a', 0.9);
  rim.position.set(50, 20, -60);
  scene.add(rim);

  const island = new Mesh(
    new CircleGeometry(40, 96),
    new MeshStandardMaterial({ color: '#141c33', roughness: 0.9 }),
  );
  island.rotation.x = -Math.PI / 2;
  scene.add(island);

  const towers = new Group();
  const t = clock.now();
  const n = city.platforms.length;
  city.platforms.forEach((pm, i) => {
    const { palette } = pm.platform.identity;
    const height = towerHeight(dailyRate(pm, t).central);
    const angle = (i / n) * Math.PI * 2;
    const radius = 24;
    const body = new Mesh(
      new BoxGeometry(4, height, 4),
      new MeshStandardMaterial({ color: palette.primary, roughness: 0.55, metalness: 0.2 }),
    );
    body.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius);
    const crown = new Mesh(
      new BoxGeometry(4.2, 0.5, 4.2),
      new MeshStandardMaterial({
        color: palette.accent,
        emissive: palette.accent,
        emissiveIntensity: 1.6,
      }),
    );
    crown.position.set(body.position.x, height + 0.25, body.position.z);
    body.name = crown.name = pm.platform.id;
    towers.add(body, crown);
  });
  scene.add(towers);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Frame the whole island: portrait screens need the camera further back…
    const portrait = camera.aspect < 1;
    const distance = portrait ? 105 / Math.pow(Math.max(camera.aspect, 0.4), 0.75) : 105;
    camera.position
      .setFromSphericalCoords(distance, Math.PI * 0.36, Math.PI * 0.12)
      .add(controls.target);
    // …and the fog must thin out accordingly so the city stays visible.
    (scene.fog as FogExp2).density = 0.8 / distance;
    // On portrait screens the HUD covers the lower part: lift the city into the upper part.
    if (portrait) camera.setViewOffset(w, h, 0, h * 0.2, w, h);
    else camera.clearViewOffset();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const frame = () => {
    controls.update();
    renderer.render(scene, camera);
    opts.onFrame?.();
  };

  let running = false;
  const onVisibility = () => (document.hidden ? stop() : start());
  function start() {
    if (running) return;
    running = true;
    renderer.setAnimationLoop(frame);
  }
  function stop() {
    running = false;
    renderer.setAnimationLoop(null);
  }
  document.addEventListener('visibilitychange', onVisibility);

  return {
    start,
    stop,
    dispose() {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose();
          (o.material as MeshStandardMaterial).dispose();
        }
      });
      renderer.dispose();
    },
  };
}
