import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { STRATEGIES, signBid, type Bid } from '@fuse/solver-sdk';
import { signInputs } from '@fuse/transaction-composer';
import { verifyCertificate, mockChainReader, sealCertificate } from '@fuse/proof-verifier';
import { createLocalMarket } from '@fuse/simulation';
import { marketViewOf, swapIntentOf, solverIdentity } from '@fuse/simulation';
import { AuctionEngine, slidingWindowLimiter } from '../src/index.js';

const strategiesFor = { direct: 'DIRECT_LIQUIDITY', routing: 'ROUTING', flash: 'FLASH_LIQUIDITY', rogue: 'ADVERSARIAL_FIXTURE' } as const;

function setup() {
  const m = createLocalMarket();
  const engine = new AuctionEngine({ bidRateLimiter: slidingWindowLimiter(10, 60_000) });
  const market = marketViewOf(m);
  const a = engine.open(swapIntentOf(m), market, 30);
  const bids: Record<string, Bid> = {};
  for (const k of Object.keys(strategiesFor) as Array<keyof typeof strategiesFor>) {
    const id = solverIdentity(m, k);
    engine.registerSolver(id.pubkey, strategiesFor[k], k);
    const p = STRATEGIES[strategiesFor[k]](market, a.intent, id);
    bids[k] = signBid({ auctionId: a.auctionId, solverId: id.id, solverPubkey: id.pubkey, strategy: strategiesFor[k], executionClass: 'ATOMIC_SINGLE_TX', template: p.template, claims: p.claims, explanation: p.explanation, expiresAt: Math.floor(Date.now() / 1000) + 120, nonce: randomBytes(8).toString('hex') }, id.priv);
  }
  return { m, engine, a, bids };
}

describe('Demo 3 — competing solvers, independent verification, settlement, certificate', () => {
  it('three honest strategies + one adversarial: rejects the adversary, selects the cheapest valid route, settles atomically and issues a verifiable certificate', async () => {
    const { m, engine, a, bids } = setup();
    for (const b of Object.values(bids)) expect(engine.submitBid(b).accepted).toBe(true);
    const closed = engine.close(a.auctionId);
    const byStrategy = Object.fromEntries(closed.evaluated.map((e) => [e.bid.strategy, e]));
    expect(byStrategy.ADVERSARIAL_FIXTURE.valid).toBe(false);
    expect(byStrategy.ADVERSARIAL_FIXTURE.reasons.join()).toMatch(/delivers .* < minOut/);
    expect(byStrategy.ROUTING.valid).toBe(true);
    expect(byStrategy.DIRECT_LIQUIDITY.valid).toBe(true);
    expect(byStrategy.FLASH_LIQUIDITY.valid).toBe(true);
    const spends = closed.evaluated.filter((e) => e.valid).map((e) => e.actual!.userNetSpendSats);
    expect(new Set(spends.map(String)).size).toBe(3); // distinct bids
    expect(closed.winner!.actual!.userNetSpendSats).toBe(spends.reduce((x, y) => (y < x ? y : x)));
    expect(closed.winner!.bid.strategy).toBe('FLASH_LIQUIDITY');

    // signatures: user (LOCAL demo wallet) + winning solver
    const winnerKey = { DIRECT_LIQUIDITY: m.solvers.direct, ROUTING: m.solvers.routing, FLASH_LIQUIDITY: m.solvers.flash }[closed.winner!.bid.strategy as 'ROUTING'];
    for (const signer of engine.requiredSigners(a.auctionId)) engine.addSignatures(a.auctionId, signer, signInputs(closed.winner!.bid.template, signer, signer === 'user' ? m.user.priv : winnerKey.priv));
    const settled = await engine.settle(a.auctionId, (raw) => m.provider.sendRawTransaction(raw), { network: 'local', simulated: true, intentCommitment: '11'.repeat(32), policyCommitment: null });
    expect(settled.status).toBe('SETTLED');
    expect(settled.winner!.verification!.ok).toBe(true);
    const v = await verifyCertificate(JSON.parse(JSON.stringify(settled.certificate, (_k, x) => typeof x === 'bigint' ? x.toString() : x)), mockChainReader(m.provider), { intentCommitment: '11'.repeat(32) });
    expect(v.status).toBe('VERIFIED');
    // vault actually earned its fee on the mock chain
    const shards = await m.provider.getUtxos(m.vault.tokenAddress);
    expect(shards.reduce((s, u) => s + u.satoshis, 0n)).toBeGreaterThan(75_000_000n);
  });

  it('malicious backend: fabricated / tampered certificates are rejected by the independent verifier', async () => {
    const { m, engine, a, bids } = setup();
    engine.submitBid(bids.routing);
    const c = engine.close(a.auctionId);
    for (const signer of engine.requiredSigners(a.auctionId)) engine.addSignatures(a.auctionId, signer, signInputs(c.winner!.bid.template, signer, signer === 'user' ? m.user.priv : m.solvers.routing.priv));
    const s = await engine.settle(a.auctionId, (raw) => m.provider.sendRawTransaction(raw), { network: 'local', simulated: true, intentCommitment: '22'.repeat(32), policyCommitment: null });
    const reader = mockChainReader(m.provider);
    const ser = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
    // 1. inflate the owner outcome and re-seal (backend lies consistently)
    const { commitment: _c, ...rest } = s.certificate!;
    const inflated = sealCertificate({ ...rest, outcome: { ...rest.outcome, ownerReceives: [{ asset: m.token, amount: 10_000_000n }] } });
    expect((await verifyCertificate(ser(inflated), reader)).status).toBe('FAILED');
    // 2. fabricated txid
    const fake = sealCertificate({ ...rest, transactions: [{ txid: 'ab'.repeat(32), blockHeight: 1, blockHash: null }] });
    expect((await verifyCertificate(ser(fake), reader)).status).toBe('FAILED');
    // 3. edit without re-sealing
    expect((await verifyCertificate({ ...ser(s.certificate), solverId: 'someone-else' }, reader)).status).toBe('FAILED');
    // 4. wrong intent
    expect((await verifyCertificate(ser(s.certificate), reader, { intentCommitment: '33'.repeat(32) })).status).toBe('FAILED');
  });

  it('anti-replay, rate-limit, unregistered solver, expired quote and signature tampering', () => {
    const { engine, a, bids } = setup();
    expect(engine.submitBid(bids.routing).accepted).toBe(true);
    expect(engine.submitBid(bids.routing).reason).toBe('replayed nonce');
    const tampered = { ...bids.direct, claims: { ...bids.direct.claims, userPaysSats: 1n } };
    expect(engine.submitBid(tampered).accepted).toBe(false);
    const unknown = { ...bids.flash, solverId: 'solver_ffffffffffffffff' };
    expect(engine.submitBid(unknown).reason).toBe('solver not registered');
    expect(engine.close(a.auctionId).status).toBe('AWAITING_SIGNATURES');
  });

  it('fallback execution promotes the next valid bid when the winner fails to sign', () => {
    const { engine, a, bids } = setup();
    for (const b of Object.values(bids)) engine.submitBid(b);
    const first = engine.close(a.auctionId).winner!.bid.solverId;
    const after = engine.fallback(a.auctionId, 'winner did not sign before timeout');
    expect(after.winner!.bid.solverId).not.toBe(first);
    expect(after.winner!.valid).toBe(true);
  });

  it('stale UTXO: a bid spending a pool outpoint not in the current market view is rejected', () => {
    const { engine, a, bids } = setup();
    const t = structuredClone(bids.routing.template);
    t.inputs[0].txid = 'cd'.repeat(32);
    const m2 = createLocalMarket();
    const id = solverIdentity(m2, 'routing');
    const { signature: _s, templateHash: _h, ...base } = bids.routing;
    const stale = signBid({ ...base, template: t, nonce: 'aa'.repeat(8) }, id.priv);
    expect(engine.submitBid(stale).accepted).toBe(true);
    const e = engine.close(a.auctionId).evaluated[0];
    expect(e.valid).toBe(false);
    expect(e.reasons.join()).toMatch(/stale or unknown input/);
  });
});
