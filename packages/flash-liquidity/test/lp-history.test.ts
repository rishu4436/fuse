import { describe, it, expect } from 'vitest';
import { lpRiskHistory, type VaultSnapshot } from '../src/index.js';

const s = (totalSats: bigint, utilizationBps: bigint, cumulativeFees: bigint, flashCount: bigint, paused = 0): VaultSnapshot => ({ totalSats, leasedSats: 0n, utilizationBps, cumulativeFees, flashCount, paused, shards: 4, largestFreeSats: totalSats / 4n });
describe('F40 LP risk history', () => {
  it('exact drawdown net of LP flows, utilization and fee growth', () => {
    const series = [s(100_000_000n, 0n, 0n, 0n), s(100_018_000n, 2_000n, 18_000n, 1n), s(90_018_000n, 0n, 18_000n, 1n), s(95_000_000n, 5_000n, 20_000n, 2n, 1)];
    // index 2 is an LP withdrawal of 10M (not a loss); index 3 is a 5,018,000-sat loss vs the post-withdrawal NAV
    const flows = new Map([[2, -10_000_000n]]);
    const m = lpRiskHistory(series, flows);
    expect(m.feesEarned).toBe(20_000n); expect(m.flashes).toBe(2n); expect(m.peakUtilizationBps).toBe(5_000n); expect(m.avgUtilizationBps).toBe(1_750n);
    // NAV: 100.000M, 100.018M, 100.018M, 105.000M → no drawdown once the withdrawal is netted out
    expect(m.maxDrawdownBps).toBe(0n);
    // without netting the flow, the withdrawal would look like a ~10% drawdown
    expect(lpRiskHistory(series).maxDrawdownBps).toBe(((100_018_000n - 90_018_000n) * 10_000n) / 100_018_000n);
    expect(m.pausedObservations).toBe(1);
    expect(lpRiskHistory([]).points).toBe(0);
  });
});
