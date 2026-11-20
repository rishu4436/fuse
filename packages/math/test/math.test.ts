import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseUnits, formatUnits, mulDivCeil, mulDivFloor, ratioBps, bpsOf } from '../src/index.js';

describe('math', () => {
  it('parses and formats exact units', () => {
    expect(parseUnits('1.23', 2)).toBe(123n);
    expect(parseUnits('0.00000001', 8)).toBe(1n);
    expect(() => parseUnits('1.234', 2)).toThrow();
    expect(() => parseUnits('1e5', 2)).toThrow();
    expect(formatUnits(123456789n, 8)).toBe('1.23456789');
    expect(formatUnits(1234500n, 2, { trim: true })).toBe('12,345');
  });
  it('roundtrips (property)', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 10n ** 20n }), fc.integer({ min: 0, max: 12 }), (u, d) => {
      expect(parseUnits(formatUnits(u, d).replace(/,/g, ''), d)).toBe(u);
    }));
  });
  it('mulDiv ceil/floor bracket the exact value', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 2n ** 64n }), fc.bigInt({ min: 0n, max: 2n ** 32n }), fc.bigInt({ min: 1n, max: 2n ** 40n }), (a, b, d) => {
      const f = mulDivFloor(a, b, d), c = mulDivCeil(a, b, d);
      expect(f * d <= a * b && a * b <= c * d).toBe(true);
      expect(c - f <= 1n).toBe(true);
    }));
    expect(() => mulDivFloor(1n, 1n, 0n)).toThrow();
    expect(() => mulDivFloor(-1n, 1n, 1n)).toThrow();
  });
  it('ratio and bps', () => {
    expect(ratioBps(11n, 10n)).toBe(11_000n);
    expect(bpsOf(1_000_000n, 9n)).toBe(900n);
    expect(bpsOf(1n, 9n)).toBe(1n);
  });
});
