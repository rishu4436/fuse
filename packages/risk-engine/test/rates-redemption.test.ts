// F16 rate advice and F27 redemption-arbitrage search on the REAL Paryon V1 + Cauldron PUSD snapshots.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLoan, rateAdvice, aprBps, interestPerPeriodSats, redemptionArbitrage, type LoanSnapshot } from '../src/index.js';

const snap = JSON.parse(readFileSync(new URL('../../../evidence/paryon-deployment-verification.json', import.meta.url), 'utf8'));
const cauldron = JSON.parse(readFileSync(new URL('../../../evidence/cauldron-pool-verification.json', import.meta.url), 'utf8'));
const loans: LoanSnapshot[] = snap.live.loans.map(parseLoan);
const price = BigInt(snap.live.latestPrice.priceRaw);

describe('F16 interest-rate advice (read-only)', () => {
  it('matches the payInterest formula and annualisation exactly', () => {
    expect(aprBps(822n)).toBe(300n); // 822 per 10M per day ≈ 3.00 % APR
    // 1,000.00 PUSD at $195.95 → 510,334,269 sats borrowed value → 822/1e7 of it per period
    expect(interestPerPeriodSats(822n, 100_000n, 19_595n)).toBe((822n * ((100_000n * 100_000_000n) / 19_595n)) / 10_000_000n);
  });
  it('advises a rate for a real mature loan: shield is monotonic in rate and the recommendation is the cheapest rate meeting the target', () => {
    const active = loans.filter((l) => l.debtCents > 0n && l.periodsBehind <= 1n && l.status === 'mature');
    expect(active.length).toBeGreaterThan(10);
    const me = active.sort((a, b) => (a.debtCents > b.debtCents ? -1 : 1))[0];
    const a = rateAdvice(loans, me.outpoint, price, { targetMultiple: 2, demandCents: 1_000_000n });
    expect(a.executable).toBe(false);
    expect(a.blockedBy).toMatch(/changeInterest/);
    for (let i = 1; i < a.candidates.length; i++) {
      expect(a.candidates[i].shieldCents).toBeGreaterThanOrEqual(a.candidates[i - 1].shieldCents);
      expect(a.candidates[i].annualCostSats).toBeGreaterThanOrEqual(a.candidates[i - 1].annualCostSats);
    }
    if (a.recommended) {
      expect(a.recommended.shieldCents).toBeGreaterThanOrEqual(2_000_000n);
      const cheaper = a.candidates.filter((c) => c.rateRaw < a.recommended!.rateRaw);
      expect(cheaper.every((c) => c.shieldCents < 2_000_000n)).toBe(true);
    }
    // shield only counts MATURE peers in the SAME period with a strictly lower rate (Redemption.swapTargetLoan rule)
    const peers = loans.filter((l) => l.outpoint !== me.outpoint && l.status === 'mature' && l.debtCents > 0n && l.periodsBehind <= 1n && l.lastPeriodInterestPaid === me.lastPeriodInterestPaid && l.currentRateRaw < a.current.rateRaw);
    expect(a.current.shieldCents).toBe(peers.reduce((s, l) => s + l.debtCents, 0n));
  });
});

describe('F27 redemption arbitrage search (read-only)', () => {
  const pools = cauldron.checked.map((p: { pool_id: string; sats: string; tokens: string }) => ({ id: p.pool_id.slice(0, 8), sats: BigInt(p.sats), tokens: BigInt(p.tokens) }));
  it('uses redemptionPrice = oracle × 1.005 and exact Cauldron quotes; reports the real best size and never marks it executable', () => {
    const r = redemptionArbitrage(pools, price, loans);
    expect(r.best).not.toBeNull();
    expect(r.best!.redemptionPriceCents).toBe((price * 1005n) / 1000n);
    expect(r.best!.redeemSats).toBe((r.best!.amountCents * 100_000_000n) / r.best!.redemptionPriceCents);
    expect(r.best!.profitSats).toBe(r.best!.redeemSats - r.best!.costSats);
    expect(r.best!.executable).toBe(false);
    expect(r.best!.risks.join(' ')).toMatch(/12-block relative timelock/);
    expect(r.best!.target?.loan).toMatch(/^[0-9a-f]{64}:\d+$/);
    expect(r.curve.length).toBeGreaterThan(3);
  });
  it('a synthetic discounted pool produces a positive opportunity (the search is not hard-wired to "none")', () => {
    const cheap = [{ id: 'cheap', sats: 4_000_000_000n, tokens: 1_000_000n }]; // 4,000 sats per cent vs ~5,078 redemption
    const r = redemptionArbitrage(cheap, 19_595n, loans);
    expect(r.best!.profitSats).toBeGreaterThan(0n);
    expect(r.note).toMatch(/nets \d+ sats/);
  });
});
