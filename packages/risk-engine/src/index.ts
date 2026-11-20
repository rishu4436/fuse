// Guardian risk engine (F14 liquidation radar, F15 redemption radar, F23 readiness, X02 health sentinel,
// F21 strategy policies). Inputs are decoded Paryon V1 mainnet loan states (READ-ONLY); everything is
// exact integer math. Nothing here signs or executes.
import { collateralRatioBps, liquidationPriceCents, PARYON_MAINNET_V1, PARYON_OPERATION_STATUS } from '@fuse/protocol-adapters';

export interface LoanSnapshot { outpoint: string; collateralSats: bigint; debtCents: bigint; beingRedeemed: bigint; status: string; currentRateRaw: bigint; periodsBehind: bigint }
export type RiskTier = 'LIQUIDATABLE' | 'CRITICAL' | 'HIGH' | 'WATCH' | 'HEALTHY' | 'INACTIVE';
export interface LoanRisk { outpoint: string; tier: RiskTier; crBps: bigint | null; liquidationPriceCents: bigint | null; dropToLiquidationBps: bigint | null; redemption: { active: boolean; amountCents: bigint; exposureRank?: number } ; reasons: string[] }
export const TIERS_BPS = { CRITICAL: 12_000n, HIGH: 13_000n, WATCH: 15_000n } as const;
const MIN = BigInt(PARYON_MAINNET_V1.minCollateralRatioBps);

export function parseLoan(l: Record<string, string>): LoanSnapshot {
  return { outpoint: l.outpoint, collateralSats: BigInt(l.collateralSats), debtCents: BigInt(l.debtCents), beingRedeemed: BigInt(l.beingRedeemed ?? '0'), status: l.status, currentRateRaw: BigInt(l.currentRateRaw ?? '0'), periodsBehind: BigInt(l.periodsBehind ?? '0') };
}

export function assessLoan(l: LoanSnapshot, priceCents: bigint): LoanRisk {
  const reasons: string[] = [];
  if (l.debtCents === 0n || l.periodsBehind > 1n) return { outpoint: l.outpoint, tier: 'INACTIVE', crBps: null, liquidationPriceCents: null, dropToLiquidationBps: null, redemption: { active: l.beingRedeemed > 0n, amountCents: l.beingRedeemed }, reasons: [l.debtCents === 0n ? 'no debt' : `interest ${l.periodsBehind} periods behind (stale)`] };
  const cr = collateralRatioBps(l.collateralSats, priceCents, l.debtCents)!;
  const liq = liquidationPriceCents(l.collateralSats, l.debtCents);
  const drop = priceCents > liq ? ((priceCents - liq) * 10_000n) / priceCents : 0n;
  const tier: RiskTier = cr < MIN ? 'LIQUIDATABLE' : cr < TIERS_BPS.CRITICAL ? 'CRITICAL' : cr < TIERS_BPS.HIGH ? 'HIGH' : cr < TIERS_BPS.WATCH ? 'WATCH' : 'HEALTHY';
  reasons.push(`CR ${cr} bps vs minimum ${MIN}`);
  if (l.beingRedeemed > 0n) reasons.push(`redemption in progress: ${l.beingRedeemed} cents`);
  return { outpoint: l.outpoint, tier, crBps: cr, liquidationPriceCents: liq, dropToLiquidationBps: drop, redemption: { active: l.beingRedeemed > 0n, amountCents: l.beingRedeemed }, reasons };
}

/** F14 + F15 over a whole snapshot. Redemption exposure ranking orders active loans by interest rate
 *  ascending. ASSUMPTION (labelled in UI): lower-rate loans are redeemed first, as in rate-ordered
 *  redemption designs. Not verified against Paryon's Redeemer contract logic; treat as a heuristic. */
export function radar(loans: LoanSnapshot[], priceCents: bigint, shockBps = 0n) {
  const p = priceCents - (priceCents * shockBps) / 10_000n;
  const risks = loans.map((l) => assessLoan(l, p));
  const active = risks.filter((r) => r.tier !== 'INACTIVE');
  const byRate = loans.filter((l) => l.debtCents > 0n && l.periodsBehind <= 1n).sort((a, b) => (a.currentRateRaw < b.currentRateRaw ? -1 : a.currentRateRaw > b.currentRateRaw ? 1 : 0));
  byRate.forEach((l, i) => { const r = risks.find((x) => x.outpoint === l.outpoint)!; r.redemption.exposureRank = i + 1; });
  const count = (t: RiskTier) => risks.filter((r) => r.tier === t).length;
  return {
    priceCents: p, shockBps,
    tiers: { LIQUIDATABLE: count('LIQUIDATABLE'), CRITICAL: count('CRITICAL'), HIGH: count('HIGH'), WATCH: count('WATCH'), HEALTHY: count('HEALTHY'), INACTIVE: count('INACTIVE') },
    debtAtRiskCents: active.filter((r) => r.tier === 'LIQUIDATABLE' || r.tier === 'CRITICAL').reduce((s, r) => s + loans.find((l) => l.outpoint === r.outpoint)!.debtCents, 0n),
    redemptionsInProgress: risks.filter((r) => r.redemption.active).length,
    risks: risks.sort((a, b) => (a.crBps ?? 1n << 62n) < (b.crBps ?? 1n << 62n) ? -1 : 1),
  };
}

/** F21 Guardian strategy policy (rules evaluated against a loan; produces PROPOSALS, never executes). */
export interface GuardianRule { id: string; when: { crBelowBps?: number; redemptionActive?: boolean; dropToLiquidationBelowBps?: number }; then: 'ALERT' | 'PROPOSE_TOP_UP' | 'PROPOSE_REPAY' | 'PROPOSE_EXIT'; targetCrBps?: number; severity: 'info' | 'warning' | 'critical' }
export interface GuardianPolicy { id: string; name: string; loan: string; rules: GuardianRule[]; channels: Array<'in-app' | 'webhook' | 'email' | 'telegram'>; createdAt: number }
export interface Proposal { ruleId: string; action: GuardianRule['then']; severity: GuardianRule['severity']; message: string; amount?: { sats?: bigint; cents?: bigint }; executable: false; blockedBy: string }

export function evaluateRules(p: GuardianPolicy, l: LoanSnapshot, r: LoanRisk, priceCents: bigint): Proposal[] {
  const out: Proposal[] = [];
  for (const rule of p.rules) {
    const w = rule.when;
    const hit = (w.crBelowBps !== undefined && r.crBps !== null && r.crBps < BigInt(w.crBelowBps)) || (w.redemptionActive && r.redemption.active) || (w.dropToLiquidationBelowBps !== undefined && r.dropToLiquidationBps !== null && r.dropToLiquidationBps < BigInt(w.dropToLiquidationBelowBps));
    if (!hit) continue;
    const target = BigInt(rule.targetCrBps ?? 15_000);
    let amount: Proposal['amount'];
    if (rule.then === 'PROPOSE_TOP_UP') { const need = (target * l.debtCents * 100_000_000n + priceCents * 10_000n - 1n) / (priceCents * 10_000n) - l.collateralSats; amount = { sats: need > 0n ? need : 0n }; }
    if (rule.then === 'PROPOSE_REPAY') { const maxDebt = (l.collateralSats * priceCents * 10_000n) / (100_000_000n * target); const repay = l.debtCents - maxDebt; amount = { cents: repay > 0n ? repay : 0n }; }
    out.push({ ruleId: rule.id, action: rule.then, severity: rule.severity, amount, executable: false, blockedBy: rule.then === 'ALERT' ? 'n/a (alert only)' : `Paryon V1 ${rule.then === 'PROPOSE_TOP_UP' || rule.then === 'PROPOSE_REPAY' ? 'manage' : 'exit'} is ${PARYON_OPERATION_STATUS.repayOrTopUp_manage} in FUSE`,
      message: `${rule.then.replace('PROPOSE_', '').replace('_', ' ').toLowerCase()}: loan ${l.outpoint.slice(0, 10)}… CR ${r.crBps ?? 'n/a'} bps${amount?.sats ? `, add ${amount.sats} sats to reach ${target} bps` : ''}${amount?.cents ? `, repay ${amount.cents} cents to reach ${target} bps` : ''}` });
  }
  return out;
}

/** F23 protection readiness: can FUSE actually protect this position right now? Honest checklist. */
export function readiness(p: GuardianPolicy | undefined, l: LoanSnapshot | undefined, opts: { snapshotAgeSec: number; fundingSats?: bigint }) {
  const checks = [
    { name: 'Position found on mainnet', ok: Boolean(l), detail: l ? l.outpoint : 'loan outpoint not in snapshot' },
    { name: 'Loan is active (interest current)', ok: Boolean(l && l.periodsBehind <= 1n && l.debtCents > 0n), detail: l ? `${l.periodsBehind} periods behind` : '-' },
    { name: 'Guardian policy configured', ok: Boolean(p && p.rules.length), detail: p ? `${p.rules.length} rule(s)` : 'no policy' },
    { name: 'Notification channel', ok: Boolean(p?.channels.includes('in-app')), detail: p ? p.channels.join(', ') : '-' },
    { name: 'Market data fresh (< 1 h)', ok: opts.snapshotAgeSec < 3600, detail: `${Math.round(opts.snapshotAgeSec / 60)} min old` },
    { name: 'Funding for top-up available', ok: (opts.fundingSats ?? 0n) > 0n, detail: opts.fundingSats ? `${opts.fundingSats} sats` : 'no funding source connected' },
    { name: 'Automated execution path', ok: false, detail: `Paryon V1 manage/liquidate are ${PARYON_OPERATION_STATUS.repayOrTopUp_manage} in FUSE (protocol transaction builders not verified)` },
  ];
  const monitoring = checks.slice(0, 5).every((c) => c.ok);
  return { level: monitoring ? 'MONITORING_READY' : 'NOT_READY', autoProtection: 'UNAVAILABLE' as const, checks };
}

/** X02 protocol health sentinel over the Paryon snapshot. */
export function sentinel(s: { priceStates: Array<{ sequence: string; priceRaw: string; contract: string }>; latestPrice: { sequence: string; priceRaw: string }; activeLoans: number; staleLoans: number; checkedAt: string }, now = Date.now()) {
  const prices = s.priceStates.map((x) => BigInt(x.priceRaw));
  const seqs = new Set(s.priceStates.map((x) => x.sequence));
  const minP = prices.reduce((a, b) => (b < a ? b : a), prices[0] ?? 0n), maxP = prices.reduce((a, b) => (b > a ? b : a), prices[0] ?? 0n);
  const spreadBps = minP > 0n ? ((maxP - minP) * 10_000n) / minP : 0n;
  const ageMin = Math.round((now - Date.parse(s.checkedAt)) / 60_000);
  const signals = [
    { name: 'Oracle consistency', status: spreadBps === 0n ? 'OK' : spreadBps < 100n ? 'WARN' : 'ALERT', detail: `${s.priceStates.length} price-contract UTXOs, ${seqs.size} sequence(s), spread ${spreadBps} bps` },
    { name: 'Stale-loan share', status: s.staleLoans > s.activeLoans * 3 ? 'WARN' : 'OK', detail: `${s.staleLoans} stale / ${s.activeLoans} active` },
    { name: 'Snapshot freshness', status: ageMin < 60 ? 'OK' : ageMin < 24 * 60 ? 'WARN' : 'ALERT', detail: `${ageMin} min old` },
    { name: 'Moria V1', status: 'DISABLED', detail: 'disabled April 2026; historical replay only, never an active venue' },
    { name: 'Paryon V2', status: 'NOT_DEPLOYED', detail: 'not treated as deployed' },
  ];
  return { overall: signals.some((x) => x.status === 'ALERT') ? 'ALERT' : signals.some((x) => x.status === 'WARN') ? 'WARN' : 'OK', signals };
}
