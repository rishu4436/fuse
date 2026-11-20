// F16 Interest-rate optimizer (READ-ONLY advisory on real Paryon V1 loan data). Changing a rate needs the
// Paryon `changeInterest` transaction builder, which is not published, so FUSE only advises.
//
// Rules taken from @paryonusd/contracts 1.1.0 source (not assumed):
//   * payInterest: interest per period = rate × borrowedValueSats / 10,000,000; a period is 144 blocks (~1 day).
//     The NEXT rate becomes the current rate at the next interest payment (and not while being redeemed).
//   * Redemption.swapTargetLoan: a pending redemption can be moved to a loan with a strictly LOWER current rate
//     and the SAME lastPeriodInterestPaid; swapInRedemption only accepts MATURE loans (status 0x02);
//     swapOutRedemption only applies to loans with ≥ 100.00 ParyonUSD debt.
// Consequence used here: within a period, the debt of mature loans paying a LOWER rate than yours is the
// "shield" a redemption must exhaust before it can stick to your loan (if keepers swap optimally).
import type { LoanSnapshot } from './index.js';

export const PERIOD_BLOCKS = 144n;
export const RATE_DENOM = 10_000_000n;
export const MIN_SWAP_OUT_DEBT_CENTS = 10_000n; // 100.00 PUSD
/** Annualised rate in bps from the raw per-period rate (365 periods/year approximation, 144 blocks ≈ 1 day). */
export const aprBps = (rateRaw: bigint) => (rateRaw * 365n * 10_000n) / RATE_DENOM;
/** Interest in sats per period for a debt (cents) at a BCH price (cents per BCH), exactly as payInterest computes it. */
export const interestPerPeriodSats = (rateRaw: bigint, debtCents: bigint, priceCents: bigint) => (rateRaw * ((debtCents * 100_000_000n) / priceCents)) / RATE_DENOM;

export interface RateCandidate { rateRaw: bigint; aprBps: bigint; annualCostSats: bigint; shieldCents: bigint; shieldMultiple: number | null; loansAhead: number }
export interface RateAdvice {
  loan: string; period: bigint | null; currentRateRaw: bigint; currentAprBps: bigint; debtCents: bigint;
  demandCents: bigint; demandSource: string; targetMultiple: number;
  peers: number; current: RateCandidate; recommended: RateCandidate | null; candidates: RateCandidate[];
  notes: string[]; executable: false; blockedBy: string;
}

/** Advise a rate for `loanOutpoint`: the LOWEST rate whose shield (lower-rate mature debt in the same period)
 *  is at least `targetMultiple` × redemption demand. Demand = in-flight redemption amounts in the snapshot unless
 *  the caller supplies its own estimate. */
export function rateAdvice(loans: LoanSnapshot[], loanOutpoint: string, priceCents: bigint, o: { targetMultiple?: number; demandCents?: bigint; step?: bigint } = {}): RateAdvice {
  const me = loans.find((l) => l.outpoint === loanOutpoint);
  if (!me) throw new Error('loan not found in snapshot');
  const notes: string[] = [];
  const period = me.lastPeriodInterestPaid ?? null;
  if (period === null) notes.push('snapshot has no lastPeriodInterestPaid: peers are all active loans (less precise)');
  const peers = loans.filter((l) => l.outpoint !== me.outpoint && l.debtCents > 0n && l.periodsBehind <= 1n && (period === null || l.lastPeriodInterestPaid === period));
  const mature = peers.filter((l) => l.status === 'mature');
  const inflight = loans.reduce((s, l) => s + l.beingRedeemed, 0n);
  const demand = o.demandCents ?? (inflight > 0n ? inflight : 0n);
  const demandSource = o.demandCents !== undefined ? 'caller estimate' : inflight > 0n ? 'sum of in-flight redemptions in the snapshot' : 'no redemptions in flight (demand 0)';
  const target = o.targetMultiple ?? 2;
  const cand = (rateRaw: bigint): RateCandidate => {
    const ahead = mature.filter((l) => l.currentRateRaw < rateRaw);
    const shield = ahead.reduce((s, l) => s + l.debtCents, 0n);
    return { rateRaw, aprBps: aprBps(rateRaw), annualCostSats: interestPerPeriodSats(rateRaw, me.debtCents, priceCents) * 365n, shieldCents: shield, shieldMultiple: demand > 0n ? Number((shield * 100n) / demand) / 100 : null, loansAhead: ahead.length };
  };
  // Candidate rates: one step above each distinct peer rate (the cheapest way to get behind that loan), plus current.
  const step = o.step ?? 1n;
  const distinct = [...new Set(mature.map((l) => l.currentRateRaw))].sort((a, b) => (a < b ? -1 : 1));
  const rates = [...new Set([0n, ...distinct.map((r) => r + step), me.currentRateRaw])].filter((r) => r >= 0n && r < 65_536n).sort((a, b) => (a < b ? -1 : 1));
  const candidates = rates.map(cand);
  const meets = (c: RateCandidate) => (demand === 0n ? c.loansAhead > 0 : c.shieldCents >= (demand * BigInt(Math.round(target * 100))) / 100n);
  const recommended = candidates.find(meets) ?? null;
  if (me.status !== 'mature') notes.push(`loan status is ${me.status}: only MATURE loans can be swapped IN as a redemption target, so it is shielded from swaps until it matures`);
  if (me.debtCents < MIN_SWAP_OUT_DEBT_CENTS) notes.push('debt below 100.00 PUSD: a redemption on this loan cannot be swapped out to a cheaper loan');
  if (!recommended) notes.push(`no rate in range reaches ${target}× the demand with the current peer set`);
  if (recommended && recommended.rateRaw > me.currentRateRaw) notes.push('recommended rate is ABOVE the current rate: the loan is currently among the most exposed in its period');
  if (recommended && recommended.rateRaw < me.currentRateRaw) notes.push(`lowering to ${recommended.rateRaw} saves ${cand(me.currentRateRaw).annualCostSats - recommended.annualCostSats} sats/yr while keeping the shield target`);
  notes.push('A new rate applies from the next interest payment (nextInterestRate), not immediately.');
  return { loan: me.outpoint, period, currentRateRaw: me.currentRateRaw, currentAprBps: aprBps(me.currentRateRaw), debtCents: me.debtCents, demandCents: demand, demandSource, targetMultiple: target, peers: mature.length, current: cand(me.currentRateRaw), recommended, candidates, notes, executable: false, blockedBy: 'Paryon changeInterest builder (@paryonusd/library) not published' };
}
