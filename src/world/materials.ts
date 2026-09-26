/**
 * Materials. Facades use MeshStandardMaterial with a small shader injection:
 *
 * - "windows": a procedural window grid in world space (windows keep their size
 *   when a tower grows), lit per window by `uLit` (occupancy) and dimmed by
 *   `uDaylight` (local daytime at the HQ);
 * - "leds": rows of server LEDs that blink faster with `uActivity`.
 *
 * Window randomness is cosmetic only — it never feeds a number on screen.
 */
import { Color, MeshStandardMaterial, type ColorRepresentation, type IUniform } from 'three';

export interface PatternUniforms {
  uLit: IUniform<number>;
  uDaylight: IUniform<number>;
  uActivity: IUniform<number>;
  uTime: IUniform<number>;
  uSeed: IUniform<number>;
  uWindowColor: IUniform<Color>;
  uWindowColor2: IUniform<Color>;
  uIntensity: IUniform<number>;
  uFlicker: IUniform<number>;
}

export type PatternMode = 'windows' | 'leds';

const COMMON = /* glsl */ `
  varying vec3 vTmWorldPos;
  varying vec3 vTmWorldNormal;
  uniform float uLit;
  uniform float uDaylight;
  uniform float uActivity;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uWindowColor;
  uniform vec3 uWindowColor2;
  uniform float uIntensity;
  uniform float uFlicker;
  float tmHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
`;

const WINDOWS = /* glsl */ `
  if (abs(vTmWorldNormal.y) < 0.45) {
    vec2 tangent = normalize(vec2(-vTmWorldNormal.z, vTmWorldNormal.x));
    vec2 uv = vec2(dot(vTmWorldPos.xz, tangent) / 0.95, (vTmWorldPos.y - 0.4) / 1.15);
    vec2 cell = floor(uv);
    vec2 f = fract(uv);
    float mask = step(0.16, f.x) * step(f.x, 0.84) * step(0.22, f.y) * step(f.y, 0.78) * step(0.0, uv.y);
    float h = tmHash(cell + vec2(uSeed, uSeed * 1.37));
    float lit = step(h, uLit);
    float flick = 1.0 - uFlicker * step(0.5, fract(sin(uTime * 23.0 + h * 50.0) * 7.0));
    vec3 wc = mix(uWindowColor, uWindowColor2, tmHash(cell.yx + 3.7));
    float night = 1.0 - 0.8 * uDaylight;
    totalEmissiveRadiance += wc * mask * lit * uIntensity * night * flick;
    diffuseColor.rgb *= mix(1.0, 0.45, mask);
  }
  diffuseColor.rgb *= 1.0 + 1.4 * uDaylight;
  totalEmissiveRadiance += diffuseColor.rgb * 0.32 * uDaylight;
`;

const LEDS = /* glsl */ `
  if (abs(vTmWorldNormal.y) < 0.45) {
    vec2 tangent = normalize(vec2(-vTmWorldNormal.z, vTmWorldNormal.x));
    vec2 uv = vec2(dot(vTmWorldPos.xz, tangent) / 0.32, (vTmWorldPos.y - 0.25) / 0.34);
    vec2 cell = floor(uv);
    vec2 f = fract(uv);
    float row = step(0.0, uv.y) * step(uv.y, 4.0);
    float dot_ = step(0.3, f.x) * step(f.x, 0.7) * step(0.35, f.y) * step(f.y, 0.65) * row;
    float tick = floor(uTime * (1.5 + uActivity * 10.0) + tmHash(cell) * 10.0);
    float on = step(tmHash(cell + vec2(tick, uSeed)), 0.25 + 0.65 * uActivity);
    vec3 c = mix(uWindowColor, uWindowColor2, step(0.93, tmHash(cell + 11.0)));
    totalEmissiveRadiance += c * dot_ * on * uIntensity;
  }
`;

function inject(mat: MeshStandardMaterial, mode: PatternMode, uniforms: PatternUniforms): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON}`)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vTmWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vTmWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vTmWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTmWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n${mode === 'windows' ? WINDOWS : LEDS}`,
      );
  };
  mat.customProgramCacheKey = () => `tm-${mode}`;
}

export function patternUniforms(
  seed: number,
  c1: ColorRepresentation,
  c2: ColorRepresentation,
  intensity: number,
): PatternUniforms {
  return {
    uLit: { value: 0.5 },
    uDaylight: { value: 0 },
    uActivity: { value: 0.5 },
    uTime: { value: 0 },
    uSeed: { value: seed },
    uWindowColor: { value: new Color(c1) },
    uWindowColor2: { value: new Color(c2) },
    uIntensity: { value: intensity },
    uFlicker: { value: 0 },
  };
}

export interface FacadeOptions {
  color: ColorRepresentation;
  roughness?: number;
  metalness?: number;
  uniforms: PatternUniforms;
}

/** Building facade with procedural windows. Share `uniforms` across a campus. */
export function facadeMaterial(o: FacadeOptions): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: o.color,
    roughness: o.roughness ?? 0.62,
    metalness: o.metalness ?? 0.25,
  });
  inject(m, 'windows', o.uniforms);
  return m;
}

/** Server hall shell with blinking LED rows. */
export function hallMaterial(
  color: ColorRepresentation,
  uniforms: PatternUniforms,
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.3 });
  inject(m, 'leds', uniforms);
  return m;
}

/** Self-lit accent (crowns, beacons, trims). Picked up by bloom. */
export function accentMaterial(color: ColorRepresentation, intensity = 2.2): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: '#000000',
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.4,
  });
}

export function plainMaterial(
  color: ColorRepresentation,
  roughness = 0.8,
  metalness = 0.1,
): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}
