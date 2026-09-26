/**
 * The site's notion of "now", in days since the Unix epoch (UTC).
 * Live mode follows the device clock, so every visitor at the same instant
 * computes the same numbers. The time machine (M5) will add a scrub mode.
 */
export interface Clock {
  /** Current model time in days since epoch. */
  now(): number;
}

export const liveClock: Clock = {
  now: () => Date.now() / 86_400_000,
};
