/**
 * How the reported accelerator class (platforms.yaml → hardware) shows up in
 * the server hall. Shared by the 3D hall and the panel so they agree.
 */
import type { Platform } from '../data/schema';

export type Accelerator = Platform['hardware']['accelerator'];

/** LED colours per class: a cosmetic hint at the vendor family, not a brand colour. */
export const LED_COLORS: Readonly<Record<Accelerator, readonly [string, string]>> = {
  'nvidia-ampere': ['#7dff9e', '#ffd36b'],
  'nvidia-hopper': ['#7dff9e', '#ffd36b'],
  'nvidia-blackwell': ['#9ffcff', '#7dff9e'],
  'google-tpu': ['#8fb7ff', '#b3ffcf'],
  'aws-trainium': ['#ffb65c', '#8fd3ff'],
  'huawei-ascend': ['#ff6b6b', '#ffd36b'],
  'amd-instinct': ['#ff7b54', '#9ffcff'],
  mixed: ['#9ffcff', '#ffb65c'],
};

/**
 * Classes usually deployed with direct liquid cooling at scale (rack-scale
 * Blackwell systems, TPU pods, Trainium2 racks). "mixed" (undisclosed or
 * varied fleets) gets no pipes. Illustrative, and labelled so in the panel.
 */
const LIQUID: ReadonlySet<Accelerator> = new Set<Accelerator>([
  'nvidia-blackwell',
  'google-tpu',
  'aws-trainium',
]);

export function isLiquidCooled(a: Accelerator): boolean {
  return LIQUID.has(a);
}
