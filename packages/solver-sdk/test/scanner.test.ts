import { describe, it, expect } from 'vitest';
import { scanArbitrage } from '../src/index.js';

describe('F28 arbitrage scanner', () => {
  it('finds the profitable size on a 15% gap and reports none when the gap is below fees', () => {
    const r = scanArbitrage([{ id: 'A', sats: 1_000_000_000n, tokens: 1_000_000n }, { id: 'B', sats: 1_150_000_000n, tokens: 1_000_000n }])!;
    expect(r.buyFrom).toBe('A'); expect(r.sellTo).toBe('B'); expect(r.spotGapBps).toBe(1_500n);
    expect(r.grossProfitSats).toBeGreaterThan(0n);
    const tight = scanArbitrage([{ id: 'A', sats: 1_000_000_000n, tokens: 1_000_000n }, { id: 'B', sats: 1_004_000_000n, tokens: 1_000_000n }])!;
    expect(tight.grossProfitSats).toBeLessThanOrEqual(0n);
    expect(scanArbitrage([{ id: 'A', sats: 1n, tokens: 1n }])).toBeNull();
  });
});
