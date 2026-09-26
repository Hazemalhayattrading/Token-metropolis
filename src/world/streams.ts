/**
 * Light streams: data arriving from the edges of the world. Each region sits
 * on the horizon at the angle of its UTC offset (like a longitude); each HQ
 * receives an arc from every region that sends it a meaningful share of its
 * traffic. Brightness follows load and the live traffic curve. Cosmetic only.
 */
import {
  AdditiveBlending,
  CatmullRomCurve3,
  Color,
  Group,
  Mesh,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
} from 'three';
import { REGION_IDS, REGION_UTC_OFFSET, type RegionMix } from '../model/traffic';

const HORIZON = 230;
const MIN_SHARE = 0.15;

export function regionAnchor(offsetHours: number): Vector3 {
  const a = (offsetHours / 24) * Math.PI * 2;
  return new Vector3(Math.sin(a) * HORIZON, 0, -Math.cos(a) * HORIZON);
}

export interface Streams {
  readonly group: Group;
  update(time: number, intensity: number): void;
  dispose(): void;
}

export function createStreams(target: Vector3, mix: RegionMix, color: string): Streams {
  const group = new Group();
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uColor: { value: new Color(color) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float dash = smoothstep(0.0, 0.25, fract(vUv.x * 14.0 - uTime * 0.9)) * (1.0 - smoothstep(0.35, 0.6, fract(vUv.x * 14.0 - uTime * 0.9)));
        // Only the final approach is drawn, so arcs never sweep past the camera.
        float fadeIn = smoothstep(0.55, 0.85, vUv.x);
        float glow = 0.08 + 0.92 * dash;
        gl_FragColor = vec4(uColor, glow * fadeIn * uIntensity * 0.24);
      }
    `,
  });
  for (const r of REGION_IDS) {
    const share = mix[r];
    if (share < MIN_SHARE) continue;
    const start = regionAnchor(REGION_UTC_OFFSET[r]);
    const end = target.clone().setY(3);
    const mid = start.clone().lerp(end, 0.55);
    mid.y = 16 + share * 20;
    const curve = new CatmullRomCurve3([start, start.clone().lerp(mid, 0.5).setY(14), mid, end]);
    const tube = new Mesh(new TubeGeometry(curve, 96, 0.05 + share * 0.14, 5, false), mat);
    tube.renderOrder = 4;
    group.add(tube);
  }
  return {
    group,
    update(time, intensity) {
      mat.uniforms.uTime!.value = time;
      mat.uniforms.uIntensity!.value = intensity;
    },
    dispose() {
      group.children.forEach((c) => (c as Mesh).geometry.dispose());
      mat.dispose();
    },
  };
}
