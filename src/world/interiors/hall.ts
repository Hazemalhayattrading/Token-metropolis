/**
 * Server hall: rows of racks whose LEDs blink with the live traffic curve.
 * Rows grow with load. The rack generation follows the platform's reported
 * accelerator class (platforms.yaml → hardware): liquid-cooled classes get
 * coolant pipes with flowing coolant; LED colour hints at the vendor family.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  ShaderMaterial,
  type Material,
} from 'three';
import type { Platform } from '../../data/schema';
import { isLiquidCooled, LED_COLORS } from '../hardware';
import { hallMaterial, patternUniforms } from '../materials';

export interface HallState {
  load: number;
  activity: number;
  time: number;
}

export interface Hall {
  readonly group: Group;
  readonly liquidCooled: boolean;
  update(s: HallState): void;
  dispose(): void;
}

const MAX_ROWS = 6;
const PER_ROW = 16;
const RACK_W = 0.62;
const ROW_LEN = PER_ROW * (RACK_W + 0.02);
const rowZ = (r: number) => -6 + r * 2.4;

export function createHall(platform: Platform): Hall {
  const group = new Group();
  const materials: Material[] = [];
  const accel = platform.hardware.accelerator;
  const [c1, c2] = LED_COLORS[accel];
  const liquidCooled = isLiquidCooled(accel);
  const u = patternUniforms(7, c1, c2, 2.6);
  const rackMat = hallMaterial('#2a3140', u);
  const floorMat = new MeshStandardMaterial({ color: '#141a26', roughness: 0.35, metalness: 0.5 });
  const wallMat = new MeshStandardMaterial({ color: '#1f2633', roughness: 0.8 });
  const trimMat = new MeshBasicMaterial({ color: platform.identity.palette.accent });
  const aisleMat = new MeshBasicMaterial({
    color: '#5fb8ff',
    transparent: true,
    opacity: 0.35,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  materials.push(rackMat, floorMat, wallMat, trimMat, aisleMat);

  const floor = new Mesh(new BoxGeometry(16, 0.1, 15), floorMat);
  floor.position.y = 0.05;
  group.add(floor);
  // Low walls with a trim line: the hall reads as a room seen from above.
  for (const [w, d, x, z] of [
    [16, 0.2, 0, -7.4],
    [16, 0.2, 0, 7.4],
    [0.2, 15, -7.9, 0],
    [0.2, 15, 7.9, 0],
  ] as const) {
    const wall = new Mesh(new BoxGeometry(w, 0.6, d), wallMat);
    wall.position.set(x, 0.3, z);
    const trim = new Mesh(new BoxGeometry(w + 0.02, 0.04, d + 0.02), trimMat);
    trim.position.set(x, 0.62, z);
    group.add(wall, trim);
  }

  const racks = new InstancedMesh(new BoxGeometry(RACK_W, 2.2, 1.05), rackMat, MAX_ROWS * PER_ROW);
  const dummy = new Object3D();
  let i = 0;
  for (let r = 0; r < MAX_ROWS; r++) {
    for (let k = 0; k < PER_ROW; k++) {
      dummy.position.set(-ROW_LEN / 2 + (k + 0.5) * (RACK_W + 0.02), 1.2, rowZ(r));
      dummy.updateMatrix();
      racks.setMatrixAt(i++, dummy.matrix);
    }
  }
  group.add(racks);

  // Cold aisles (between row pairs) glow faintly on the floor.
  const aisles: Mesh[] = [];
  for (let r = 0; r < MAX_ROWS; r += 2) {
    const a = new Mesh(new BoxGeometry(ROW_LEN, 0.02, 0.5), aisleMat);
    a.position.set(0, 0.11, rowZ(r) + 1.2);
    aisles.push(a);
    group.add(a);
  }

  // Coolant pipes above each row: a flowing-stripe shader.
  const pipeMat = new ShaderMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 1 },
      uColor: { value: new Color('#6fe3ff') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uSpeed; uniform vec3 uColor; varying vec2 vUv;
      void main() {
        float s = smoothstep(0.35, 0.5, fract(vUv.y * 9.0 - uTime * uSpeed)) * (1.0 - smoothstep(0.5, 0.65, fract(vUv.y * 9.0 - uTime * uSpeed)));
        gl_FragColor = vec4(uColor, 0.18 + 0.7 * s);
      }
    `,
  });
  materials.push(pipeMat);
  const pipes: Mesh[] = [];
  if (liquidCooled) {
    const geo = new CylinderGeometry(0.08, 0.08, ROW_LEN + 1.2, 8, 1, true);
    geo.rotateZ(Math.PI / 2);
    for (let r = 0; r < MAX_ROWS; r++) {
      const p = new Mesh(geo, pipeMat);
      p.position.set(0, 2.5, rowZ(r));
      pipes.push(p);
      group.add(p);
    }
  }

  return {
    group,
    liquidCooled,
    update(s) {
      const rows = Math.max(1, Math.min(MAX_ROWS, 1 + Math.round(s.load * (MAX_ROWS - 1))));
      racks.count = rows * PER_ROW;
      pipes.forEach((p, r) => (p.visible = r < rows));
      aisles.forEach((a, k) => (a.visible = k * 2 + 1 < rows));
      u.uActivity.value = Math.min(1, s.activity * 0.65);
      u.uTime.value = s.time;
      pipeMat.uniforms.uTime!.value = s.time;
      pipeMat.uniforms.uSpeed!.value = 0.4 + s.activity * 0.8;
    },
    dispose() {
      group.traverse((o) => o instanceof Mesh && o.geometry.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
