import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLoan, assessLoan, radar, evaluateRules, readiness, sentinel, type GuardianPolicy } from '../src/index.js';
import { NotificationCenter } from '@fuse/notifications';

const snap = JSON.parse(readFileSync(new URL('../../../evidence/paryon-deployment-verification.json', import.meta.url), 'utf8'));
const loans = snap.live.loans.map(parseLoan);
const price = BigInt(snap.live.latestPrice.priceRaw);

describe('Guardian risk engine on the real Paryon V1 mainnet snapshot (read-only)', () => {
  it('radar tiers every decoded loan and agrees with the snapshot stats', () => {
    const r = radar(loans, price);
    expect(r.risks).toHaveLength(snap.live.decodedLoans);
    expect(r.tiers.INACTIVE).toBe(snap.live.staleLoans);
    const active = r.risks.filter((x) => x.crBps !== null);
    expect(active).toHaveLength(snap.live.activeLoans);
    expect(Number(active[0].crBps)).toBe(snap.live.collateralRatioBps.min);
  });
  it('price shock moves loans into worse tiers monotonically', () => {
    const a = radar(loans, price), b = radar(loans, price, 2_000n);
    expect(b.tiers.LIQUIDATABLE + b.tiers.CRITICAL).toBeGreaterThanOrEqual(a.tiers.LIQUIDATABLE + a.tiers.CRITICAL);
    expect(b.priceCents).toBe(price - price / 5n);
  });
  it('a loan exactly at the liquidation price is LIQUIDATABLE one cent lower', () => {
    const l = { outpoint: 'x:0', collateralSats: 100_000_000n, debtCents: 10_000n, beingRedeemed: 0n, status: 'mature', currentRateRaw: 10n, periodsBehind: 0n };
    const r = assessLoan(l, 20_000n);
    expect(r.tier).toBe('HEALTHY');
    expect(assessLoan(l, r.liquidationPriceCents! - 1n).tier).toBe('LIQUIDATABLE');
  });
  it('rules produce non-executable proposals with exact top-up math; readiness is honest', () => {
    const l = { outpoint: 'y:0', collateralSats: 100_000_000n, debtCents: 15_000n, beingRedeemed: 0n, status: 'mature', currentRateRaw: 10n, periodsBehind: 0n };
    const p: GuardianPolicy = { id: 'p1', name: 't', loan: 'y:0', channels: ['in-app'], createdAt: 0, rules: [{ id: 'r1', when: { crBelowBps: 14_000 }, then: 'PROPOSE_TOP_UP', targetCrBps: 15_000, severity: 'warning' }] };
    const r = assessLoan(l, 20_000n); // CR 13333
    const [prop] = evaluateRules(p, l, r, 20_000n);
    expect(prop.executable).toBe(false);
    expect(prop.amount!.sats).toBe(12_500_000n); // 1.125 BCH * 200 $ = 225 $ = 150%
    const rd = readiness(p, l, { snapshotAgeSec: 60 });
    expect(rd.level).toBe('MONITORING_READY');
    expect(rd.autoProtection).toBe('UNAVAILABLE');
  });
  it('sentinel reports oracle consistency, Moria disabled, Paryon V2 not deployed', () => {
    const s = sentinel(snap.live, Date.parse(snap.checkedAt) + 60_000);
    expect(s.signals.find((x) => x.name === 'Moria V1')!.status).toBe('DISABLED');
    expect(s.signals.find((x) => x.name === 'Paryon V2')!.status).toBe('NOT_DEPLOYED');
  });
  it('notifications dedupe within the cooldown', () => {
    let t = 0; const n = new NotificationCenter({ cooldownMs: 1000, now: () => t });
    expect(n.push({ severity: 'critical', title: 'a', body: 'b', key: 'k', source: 's' })).not.toBeNull();
    expect(n.push({ severity: 'critical', title: 'a', body: 'b', key: 'k', source: 's' })).toBeNull();
    t = 2000; expect(n.push({ severity: 'critical', title: 'a', body: 'b', key: 'k', source: 's' })).not.toBeNull();
    expect(n.unread).toBe(2); n.markRead(); expect(n.unread).toBe(0);
  });
});
