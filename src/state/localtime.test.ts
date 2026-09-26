import { describe, expect, it } from 'vitest';
import { daylight, localHour, localTimeLabel, occupancy } from './localtime';

describe('local time at HQs', () => {
  const t = Date.UTC(2026, 8, 25, 0, 30); // 00:30 UTC
  it('converts UTC to HQ local time', () => {
    expect(localHour('Asia/Shanghai', t)).toBeCloseTo(8.5, 5);
    expect(localHour('America/Los_Angeles', t)).toBeCloseTo(17.5, 5); // PDT in September
    expect(localTimeLabel('Asia/Shanghai', t)).toBe('08:30');
  });
  it('daylight and occupancy follow the clock', () => {
    expect(daylight(3)).toBe(0);
    expect(daylight(13)).toBe(1);
    expect(occupancy(3)).toBeCloseTo(0.12, 5);
    expect(occupancy(12)).toBeGreaterThan(0.85);
    expect(occupancy(21)).toBeLessThan(occupancy(12));
    expect(occupancy(21)).toBeGreaterThan(occupancy(3));
  });
});
