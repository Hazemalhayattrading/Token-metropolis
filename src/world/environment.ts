/**
 * The night: sky dome with stars and a moon, a dark sea, and the island with
 * its road network and street lights.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { ISLAND_RADIUS, type Plot } from './layout';

export const MOON_DIRECTION = new Vector3(-0.45, 0.55, -0.7).normalize();

function skyDome(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new Color('#03050d') },
      uHorizon: { value: new Color('#1b2350') },
      uGlow: { value: new Color('#3a2a55') },
      uMoonDir: { value: MOON_DIRECTION },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // always behind everything
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGlow;
      uniform vec3 uMoonDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
        col += uGlow * exp(-abs(h) * 9.0) * 0.55;
        // stars: sparse cells on the upper sky
        vec3 cell = floor(vDir * 380.0);
        float s = hash(cell);
        float star = step(0.9965, s) * smoothstep(0.02, 0.25, h);
        col += vec3(0.75, 0.82, 1.0) * star * (0.35 + 0.65 * hash(cell + 3.1));
        // moon disc and halo
        float m = dot(vDir, uMoonDir);
        col += vec3(0.95, 0.93, 0.85) * smoothstep(0.99955, 0.9997, m);
        col += vec3(0.35, 0.4, 0.6) * pow(max(m, 0.0), 180.0) * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const dome = new Mesh(new SphereGeometry(900, 48, 24), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  return dome;
}

function sea(): Mesh {
  const mat = new MeshStandardMaterial({ color: '#050a16', roughness: 0.22, metalness: 0.85 });
  const m = new Mesh(new CircleGeometry(900, 64), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = -1.2;
  return m;
}

/** Road network drawn once into a canvas: a ring road, avenues to each plot, a plaza. */
function roadTexture(plots: readonly Plot[]): CanvasTexture {
  const size = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const toPx = (v: number) => (v / (ISLAND_RADIUS * 2) + 0.5) * size;
  // ground
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, '#1a2138');
  grad.addColorStop(0.85, '#121828');
  grad.addColorStop(1, '#0c101c');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // subtle block grid
  g.strokeStyle = 'rgba(255,255,255,0.025)';
  g.lineWidth = 2;
  for (let i = 0; i < size; i += 48) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, size);
    g.moveTo(0, i);
    g.lineTo(size, i);
    g.stroke();
  }
  const road = (w: number, colour: string, draw: () => void) => {
    g.strokeStyle = colour;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.beginPath();
    draw();
    g.stroke();
  };
  const ring = (r: number) =>
    g.arc(size / 2, size / 2, (r / (ISLAND_RADIUS * 2)) * size, 0, Math.PI * 2);
  for (const [w, colour] of [
    [26, '#0a0d16'],
    [3, 'rgba(255, 196, 120, 0.35)'],
  ] as const) {
    road(w, colour, () => ring(30.5));
    road(w, colour, () => ring(ISLAND_RADIUS - 6));
    for (const p of plots) {
      road(w, colour, () => {
        g.moveTo(size / 2, size / 2);
        g.lineTo(toPx(p.x), toPx(p.z));
      });
    }
  }
  // central plaza
  g.fillStyle = '#1e2640';
  g.beginPath();
  g.arc(size / 2, size / 2, (6 / (ISLAND_RADIUS * 2)) * size, 0, Math.PI * 2);
  g.fill();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function streetLights(plots: readonly Plot[]): Points {
  const pts: number[] = [];
  const addRing = (r: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push(Math.cos(a) * r, 0.35, Math.sin(a) * r);
    }
  };
  addRing(29.3, 70);
  addRing(31.7, 70);
  addRing(ISLAND_RADIUS - 7.2, 120);
  for (const p of plots) {
    const len = Math.hypot(p.x, p.z);
    for (let d = 7; d < len - 8; d += 2.6) {
      const ux = p.x / len;
      const uz = p.z / len;
      pts.push(
        ux * d - uz * 1.1,
        0.35,
        uz * d + ux * 1.1,
        ux * d + uz * 1.1,
        0.35,
        uz * d - ux * 1.1,
      );
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const mat = new PointsMaterial({
    color: '#ffc78a',
    size: 0.42,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  return new Points(geo, mat);
}

export interface Environment {
  readonly group: Group;
  dispose(): void;
}

export function createEnvironment(plots: readonly Plot[]): Environment {
  const group = new Group();
  group.add(skyDome(), sea());
  const texture = roadTexture(plots);
  const top = new MeshStandardMaterial({ map: texture, roughness: 0.92, metalness: 0.05 });
  const side = new MeshStandardMaterial({ color: '#0b0f1a', roughness: 1 });
  const island = new Mesh(new CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS + 3, 2.4, 128, 1), [
    side,
    top,
    side,
  ]);
  island.position.y = -1.2;
  group.add(island);
  // shoreline glow
  const shore = new Mesh(
    new CylinderGeometry(ISLAND_RADIUS + 3.4, ISLAND_RADIUS + 3.4, 0.08, 128, 1, true),
    new MeshStandardMaterial({
      color: '#000',
      emissive: '#27407a',
      emissiveIntensity: 0.9,
      side: BackSide,
    }),
  );
  shore.position.y = -1.1;
  group.add(shore, streetLights(plots));
  return {
    group,
    dispose() {
      texture.dispose();
      group.traverse((o) => {
        if (o instanceof Mesh || o instanceof Points) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
    },
  };
}
