import { describe, expect, it } from 'vitest';
import { cosTurns, dexp, dlog, dpow, sinTurns } from '../detmath';

function rel(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : Math.abs(a - b) / Math.abs(b);
}

describe('deterministic math', () => {
  it('dexp matches Math.exp to ~1e-15 across the useful range', () => {
    let worst = 0;
    for (let x = -700; x <= 700; x += 0.37) worst = Math.max(worst, rel(dexp(x), Math.exp(x)));
    for (let x = -2; x <= 2; x += 0.0013) worst = Math.max(worst, rel(dexp(x), Math.exp(x)));
    expect(worst).toBeLessThan(2e-15);
  });

  it('dexp handles edge cases', () => {
    expect(dexp(0)).toBe(1);
    expect(dexp(1000)).toBe(Infinity);
    expect(dexp(-1000)).toBe(0);
    expect(Number.isNaN(dexp(NaN))).toBe(true);
  });

  it('dlog matches Math.log to ~1e-15', () => {
    let worst = 0;
    for (let e = -300; e <= 300; e += 0.71) {
      const x = 10 ** e;
      worst = Math.max(worst, Math.abs(dlog(x) - Math.log(x)) / Math.max(1, Math.abs(Math.log(x))));
    }
    for (let x = 0.01; x < 10; x += 0.00731) {
      worst = Math.max(
        worst,
        Math.abs(dlog(x) - Math.log(x)) / Math.max(1e-3, Math.abs(Math.log(x))),
      );
    }
    expect(worst).toBeLessThan(4e-15);
    expect(dlog(1)).toBe(0);
    expect(dlog(0)).toBe(-Infinity);
    expect(Number.isNaN(dlog(-1))).toBe(true);
    expect(rel(dlog(5e-320), Math.log(5e-320))).toBeLessThan(1e-12);
  });

  it('dpow agrees with **', () => {
    expect(rel(dpow(2, 10), 1024)).toBeLessThan(1e-14);
    expect(rel(dpow(1.07, 365), 1.07 ** 365)).toBeLessThan(1e-12);
    expect(dpow(3, 0)).toBe(1);
  });

  it('sinTurns/cosTurns match Math.sin/cos', () => {
    let worst = 0;
    for (let t = -3; t <= 3; t += 0.000917) {
      worst = Math.max(worst, Math.abs(sinTurns(t) - Math.sin(2 * Math.PI * t)));
      worst = Math.max(worst, Math.abs(cosTurns(t) - Math.cos(2 * Math.PI * t)));
    }
    expect(worst).toBeLessThan(3e-15);
    expect(sinTurns(0)).toBe(0);
    expect(sinTurns(0.25)).toBe(1);
    expect(cosTurns(0)).toBe(1);
  });

  it('range reduction in turns is exact for large day counts', () => {
    // 20,000 days after epoch + 0.25 turn: should be exactly sin(π/2)
    expect(sinTurns(20000.25)).toBe(1);
  });

  it('is bit-for-bit stable (golden values guard against accidental algorithm changes)', () => {
    const golden = [dexp(1), dexp(-3.5), dlog(10), dlog(0.3), sinTurns(0.1), cosTurns(0.37)];
    expect(golden).toMatchInlineSnapshot(`
      [
        2.7182818284590455,
        0.0301973834223185,
        2.302585092994046,
        -1.2039728043259361,
        0.5877852522924731,
        -0.6845471059286886,
      ]
    `);
  });
});
