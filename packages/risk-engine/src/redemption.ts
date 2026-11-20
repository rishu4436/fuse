// F27 Redemption arbitrage SEARCH (read-only). Buy ParyonUSD (PUSD) from Cauldron pools and redeem it against a
// Paryon V1 loan for BCH collateral. Execution is BLOCKED (Paryon redemption builders are not published) and it is
// NOT atomic, so FUSE only reports opportunities with their exact numbers and risks.
//
// Rules from @paryonusd/contracts 1.1.0 source:
//   * Redeemer: redemptionPrice = oraclePrice × 1005 / 1000 (a 0.5 % fee, fixed when the redemption starts).
//   * redeem: redeemedCollateral = amount(cents) × 100,000,000 / redemptionPrice; it finalizes only after a
//     relative timelock (`timeLockRedemption` = 12 blocks) and is CANCELLED (amount → 0, tokens returned) if a new
//     interest period starts first; a pending redemption can be swapped to a lower-rate mature loan.
import { cauldronBuyQuote } from '@fuse/contracts';
import type { LoanSnapshot } from './index.js';

export interface PusdPool { id: string; sats: bigint; tokens: bigint }
export interface RedemptionArb {
  amountCents: bigint; costSats: bigint; redeemSats: bigint; profitSats: bigint; profitBps: bigint;
  legs: Array<{ pool: string; tokens: bigint; satsIn: bigint }>; redemptionPriceCents: bigint;
  spot: { bestPoolSatsPerCent: number; redemptionSatsPerCent: number; discountBps: number };
  target: { loan: string; rateRaw: bigint; debtCents: bigint } | null;
  risks: string[]; executable: false; blockedBy: string;
}

/** Greedy exact-quote fill across pools (cheapest marginal price first) for `amount` cents. */
function buyAcross(pools: PusdPool[], amount: bigint, chunk: bigint) {
  const st = pools.map((p) => ({ ...p, used: 0n, paid: 0n }));
  let left = amount;
  while (left > 0n) {
    const q = left < chunk ? left : chunk;
    let best: { i: number; satsIn: bigint } | null = null;
    st.forEach((p, i) => { try { const r = cauldronBuyQuote(p.sats, p.tokens, q); if (!best || r.satsIn < best.satsIn) best = { i, satsIn: r.satsIn }; } catch { /* exhausted */ } });
    if (!best) return null;
    const b = best as { i: number; satsIn: bigint };
    const p = st[b.i]; const r = cauldronBuyQuote(p.sats, p.tokens, q);
    p.sats = r.newSats; p.tokens = r.newTokens; p.used += q; p.paid += r.satsIn; left -= q;
  }
  return { cost: st.reduce((s, p) => s + p.paid, 0n), legs: st.filter((p) => p.used > 0n).map((p) => ({ pool: p.id, tokens: p.used, satsIn: p.paid })) };
}

export function redemptionArbitrage(pools: PusdPool[], oraclePriceCents: bigint, loans: LoanSnapshot[], o: { maxCents?: bigint; chunk?: bigint; timelockBlocks?: bigint } = {}): { best: RedemptionArb | null; curve: Array<{ amountCents: bigint; profitSats: bigint }>; note: string } {
  const live = pools.filter((p) => p.sats > 0n && p.tokens > 1n);
  const redemptionPrice = (oraclePriceCents * 1005n) / 1000n;
  const redeemSatsFor = (cents: bigint) => (cents * 100_000_000n) / redemptionPrice;
  const spotBest = Math.min(...live.map((p) => Number(p.sats) / Number(p.tokens)));
  const redemptionPerCent = 1e8 / Number(redemptionPrice);
  // Target: lowest-rate MATURE active loan (a pending redemption can be swapped there anyway).
  const target = loans.filter((l) => l.debtCents > 0n && l.periodsBehind <= 1n && l.status === 'mature').sort((a, b) => (a.currentRateRaw < b.currentRateRaw ? -1 : 1))[0];
  const maxC = o.maxCents ?? (live.reduce((s, p) => s + p.tokens, 0n) / 2n);
  const chunk = o.chunk ?? 100n;
  const curve: Array<{ amountCents: bigint; profitSats: bigint }> = [];
  let best: RedemptionArb | null = null;
  for (let a = 100n; a <= maxC; a += a < 10_000n ? 100n : 1_000n) {
    if (target && a > target.debtCents) break;
    const fill = buyAcross(live, a, chunk); if (!fill) break;
    const out = redeemSatsFor(a); const profit = out - fill.cost;
    curve.push({ amountCents: a, profitSats: profit });
    if (!best || profit > best.profitSats) best = {
      amountCents: a, costSats: fill.cost, redeemSats: out, profitSats: profit, profitBps: fill.cost > 0n ? (profit * 10_000n) / fill.cost : 0n, legs: fill.legs, redemptionPriceCents: redemptionPrice,
      spot: { bestPoolSatsPerCent: spotBest, redemptionSatsPerCent: redemptionPerCent, discountBps: Math.round(((redemptionPerCent - spotBest) / redemptionPerCent) * 10_000) },
      target: target ? { loan: target.outpoint, rateRaw: target.currentRateRaw, debtCents: target.debtCents } : null,
      risks: [
        `Not atomic: finalization waits a ${o.timelockBlocks ?? 12n}-block relative timelock after startRedemption.`,
        'Cancelled (tokens returned, no BCH) if a new interest period starts before finalization.',
        'Cauldron pool and oracle snapshots are taken at different times; prices move.',
        'Miner fees for buy + start + finalize transactions are not included.',
      ],
      executable: false, blockedBy: 'Paryon startRedemption / redeem builders (@paryonusd/library) not published',
    };
  }
  const note = best && best.profitSats > 0n ? `best size ${best.amountCents} cents nets ${best.profitSats} sats before miner fees` : `no profitable size: the pools charge more per PUSD than a redemption pays out (oracle price + 0.5 % fee)${best ? ` (best ${best.profitSats} sats at ${best.amountCents} cents)` : ''}`;
  return { best, curve, note };
}
