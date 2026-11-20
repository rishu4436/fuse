// F28 arbitrage scanner: exact Cauldron constant-product quotes (0.3% fee) across a set of pools.
// Finds the best buy-low / sell-high pair and the size that maximises gross profit. Analysis only.
import { cauldronBuyQuote, cauldronSellQuote } from '@fuse/contracts';

export interface ScanPool { id: string; sats: bigint; tokens: bigint }
export interface ArbOpportunity { buyFrom: string; sellTo: string; spotGapBps: bigint; bestTokens: bigint; costSats: bigint; proceedsSats: bigint; grossProfitSats: bigint }

export function scanArbitrage(pools: ScanPool[], steps = 40): ArbOpportunity | null {
  const live = pools.filter((p) => p.sats > 10_000n && p.tokens > 10n);
  if (live.length < 2) return null;
  const spot = (p: ScanPool) => [p.sats, p.tokens] as const;
  const sorted = [...live].sort((a, b) => (a.sats * b.tokens < b.sats * a.tokens ? -1 : 1));
  const cheap = sorted[0], rich = sorted[sorted.length - 1];
  const [cs, ct] = spot(cheap), [rs, rt] = spot(rich);
  const gapBps = ((rs * ct - cs * rt) * 10_000n) / (cs * rt);
  let best: ArbOpportunity | null = null;
  const maxX = (ct < rt ? ct : rt) / 4n;
  for (let i = 1; i <= steps; i++) {
    const x = (maxX * BigInt(i)) / BigInt(steps);
    if (x <= 0n) continue;
    try {
      const buy = cauldronBuyQuote(cs, ct, x).satsIn, sell = cauldronSellQuote(rs, rt, x).satsOut;
      const g = sell - buy;
      if (!best || g > best.grossProfitSats) best = { buyFrom: cheap.id, sellTo: rich.id, spotGapBps: gapBps, bestTokens: x, costSats: buy, proceedsSats: sell, grossProfitSats: g };
    } catch { /* size exceeds pool */ }
  }
  return best;
}
