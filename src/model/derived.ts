/**
 * From tokens to hardware, power, water and household equivalents.
 *
 *   gpuEquivalents = tokens/s ÷ throughput per GPU
 *   powerMW        = gpuEquivalents × kW per GPU × PUE ÷ 1000
 *   water L/day    = energy kWh/day × WUE
 *   homes          = power kW ÷ average household kW
 *
 * The throughput-per-GPU transfer from benchmarks to each platform is an
 * assumption, so everything here is at best "Modeled".
 */
import { COMPUTE, EQUIV } from './constants';
import { compact } from './format';
import { divide, fromConstant, multiply, scale } from './range';
import { weakest } from './tier';
import { SECONDS_PER_DAY } from './time';
import type { Estimate, Range, Tier } from './types';

const K = {
  throughput: 'COMPUTE.throughputTokensPerSecPerGpu',
  kw: 'COMPUTE.kwPerGpu',
  pue: 'COMPUTE.pue',
  wue: 'COMPUTE.wueLitersPerKwh',
  household: 'EQUIV.householdKw',
} as const;

function est(range: Range, tier: Tier, formula: string, refs: readonly string[]): Estimate {
  return { range, tier: weakest(tier, 'modeled'), formula, refs };
}

/** H100-equivalent accelerators busy serving `tokensPerSec`. */
export function gpuEquivalents(tokensPerSec: Range, tier: Tier): Estimate {
  const tp = COMPUTE.throughputTokensPerSecPerGpu;
  return est(
    divide(tokensPerSec, fromConstant(tp)),
    tier,
    `tokens/s ÷ ${compact(tp.value)} tokens/s per GPU`,
    [K.throughput],
  );
}

/** Facility power (MW) for a given number of GPU-equivalents. */
export function powerMW(gpus: Range, tier: Tier): Estimate {
  const r = scale(
    multiply(gpus, fromConstant(COMPUTE.kwPerGpu), fromConstant(COMPUTE.pue)),
    1 / 1000,
  );
  return est(
    r,
    tier,
    `GPUs × ${COMPUTE.kwPerGpu.value} kW per GPU × PUE ${COMPUTE.pue.value} ÷ 1000`,
    [K.throughput, K.kw, K.pue],
  );
}

/** Power straight from a token rate (tokens/s → MW). */
export function powerFromTokensPerSecond(tokensPerSec: Range, tier: Tier): Estimate {
  return powerMW(gpuEquivalents(tokensPerSec, tier).range, tier);
}

/** Daily energy (MWh/day) from a daily token rate (tokens/day). */
export function energyMWhPerDay(tokensPerDay: Range, tier: Tier): Estimate {
  const mw = powerFromTokensPerSecond(scale(tokensPerDay, 1 / SECONDS_PER_DAY), tier);
  return est(scale(mw.range, 24), tier, 'average MW × 24 h', mw.refs);
}

/** On-site cooling water (litres/day) from a daily token rate. */
export function waterLitersPerDay(tokensPerDay: Range, tier: Tier): Estimate {
  const e = energyMWhPerDay(tokensPerDay, tier);
  const r = multiply(scale(e.range, 1000), fromConstant(COMPUTE.wueLitersPerKwh));
  return est(r, tier, `MWh/day × 1000 × ${COMPUTE.wueLitersPerKwh.value} L/kWh (on-site WUE)`, [
    ...e.refs,
    K.wue,
  ]);
}

/** Number of average US homes the given power would supply. */
export function homesPowered(mw: Range, tier: Tier): Estimate {
  const r = divide(scale(mw, 1000), fromConstant(EQUIV.householdKw));
  return est(r, tier, `MW × 1000 ÷ ${EQUIV.householdKw.value.toFixed(2)} kW per US home`, [
    K.household,
  ]);
}

/** Energy per token, joules (facility level). */
export function joulesPerToken(): Range {
  return divide(
    multiply(scale(fromConstant(COMPUTE.kwPerGpu), 1000), fromConstant(COMPUTE.pue)),
    fromConstant(COMPUTE.throughputTokensPerSecPerGpu),
  );
}

export interface PromptFootprint {
  readonly energyWh: Estimate;
  readonly waterMl: Estimate;
}

/** Energy and on-site water of processing `tokens` tokens (the "your prompt" visualizer). */
export function promptFootprint(tokens: number): PromptFootprint {
  const jpt = joulesPerToken();
  const wh = scale(jpt, tokens / 3600);
  const refs = [K.throughput, K.kw, K.pue];
  const energyWh = est(wh, 'modeled', `${tokens} tokens × J/token ÷ 3600`, refs);
  const waterMl = est(
    multiply(scale(wh, 1 / 1000), fromConstant(COMPUTE.wueLitersPerKwh), {
      low: 1000,
      central: 1000,
      high: 1000,
    }),
    'modeled',
    `kWh × ${COMPUTE.wueLitersPerKwh.value} L/kWh × 1000 mL/L`,
    [...refs, K.wue],
  );
  return { energyWh, waterMl };
}
