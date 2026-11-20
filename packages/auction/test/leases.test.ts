// F30: the auction coordinator leases every vault shard a winning template spends. Two concurrent auctions
// whose best bids use the same shard can never both select it; the second falls back to the next valid bid.
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { STRATEGIES, signBid, type Bid } from '@fuse/solver-sdk';
import { createLocalMarket, marketViewOf, swapIntentOf, solverIdentity } from '@fuse/simulation';
import { signInputs } from '@fuse/transaction-composer';
import { ShardManager, type ShardRef } from '@fuse/flash-liquidity';
import { AuctionEngine, vaultShardsOf } from '../src/index.js';

const S = { routing: 'ROUTING', flash: 'FLASH_LIQUIDITY' } as const;
const refs = async (m: ReturnType<typeof createLocalMarket>): Promise<ShardRef[]> =>
  (await m.provider.getUtxos(m.vault.tokenAddress)).filter((u) => u.token?.nft && u.token.category === m.vaultParams.vaultCategory).map((u) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis, commitment: u.token!.nft!.commitment }));

async function world() {
  const m = createLocalMarket();
  const sm = new ShardManager(m.vaultParams, await refs(m), { maxLeasesPerHolder: 4 });
  const engine = new AuctionEngine({ leases: sm });
  const ids = { routing: solverIdentity(m, 'routing'), flash: solverIdentity(m, 'flash') };
  for (const k of ['routing', 'flash'] as const) engine.registerSolver(ids[k].pubkey, S[k], k);
  const market = marketViewOf(m);
  const bidFor = (a: ReturnType<AuctionEngine['open']>, k: 'routing' | 'flash'): Bid => {
    const p = STRATEGIES[S[k]](market, a.intent, ids[k]);
    return signBid({ auctionId: a.auctionId, solverId: ids[k].id, solverPubkey: ids[k].pubkey, strategy: S[k], executionClass: 'ATOMIC_SINGLE_TX', template: p.template, claims: p.claims, explanation: p.explanation, expiresAt: Math.floor(Date.now() / 1000) + 120, nonce: randomBytes(8).toString('hex') }, ids[k].priv);
  };
  return { m, sm, engine, market, ids, bidFor };
}

describe('F30 shard leases in the auction coordinator', () => {
  it('two concurrent auctions: the second cannot select a template that spends the leased shard and falls back to routing', async () => {
    const { m, sm, engine, market, bidFor } = await world();
    const a1 = engine.open(swapIntentOf(m), market, 30);
    const a2 = engine.open({ ...swapIntentOf(m), intentId: 'intent_second_000001' }, market, 30);
    for (const a of [a1, a2]) for (const k of ['routing', 'flash'] as const) expect(engine.submitBid(bidFor(a, k)).accepted).toBe(true);
    engine.close(a1.auctionId);
    expect(a1.winner!.bid.strategy).toBe('FLASH_LIQUIDITY');
    const shard = vaultShardsOf(a1.winner!.bid.template)[0];
    expect(sm.leaseOf(shard)?.holder).toBe(a1.auctionId);
    engine.close(a2.auctionId);
    const flash2 = a2.evaluated.find((e) => e.bid.strategy === 'FLASH_LIQUIDITY')!;
    expect(vaultShardsOf(flash2.bid.template)).toContain(shard);
    expect(flash2.valid).toBe(false);
    expect(flash2.reasons.join()).toMatch(/F30 shard lease conflict/);
    expect(a2.winner!.bid.strategy).toBe('ROUTING');
    expect(a2.events.some((e) => e.type === 'BID_LEASE_CONFLICT')).toBe(true);
    // a1 settles on the LOCAL chain; its lease is released and the continuation shard is free again
    engine.addSignatures(a1.auctionId, 'user', signInputs(a1.winner!.bid.template, 'user', m.user.priv));
    if (engine.requiredSigners(a1.auctionId).includes('solver')) engine.addSignatures(a1.auctionId, 'solver', signInputs(a1.winner!.bid.template, 'solver', m.solvers.flash.priv));
    const r = await engine.settle(a1.auctionId, (raw) => m.provider.sendRawTransaction(raw), { network: 'local', simulated: true, intentCommitment: a1.intent.intentCommitment, policyCommitment: null });
    expect(r.status).toBe('SETTLED');
    expect(sm.leaseOf(shard)).toBeUndefined();
    sm.sync(await refs(m));
    expect(sm.leased()).toHaveLength(0);
  });

  it('a solver pre-reservation is transferred to the auction that selects its bid; another solver cannot take it', async () => {
    const { m, sm, engine, market, ids, bidFor } = await world();
    const a = engine.open(swapIntentOf(m), market, 30);
    const fb = bidFor(a, 'flash');
    const shard = vaultShardsOf(fb.template)[0];
    sm.reserveExact(shard, ids.flash.id);
    expect(() => sm.reserveExact(shard, ids.routing.id)).toThrow(/leased by/);
    engine.submitBid(fb); engine.submitBid(bidFor(a, 'routing'));
    engine.close(a.auctionId);
    expect(a.winner!.bid.strategy).toBe('FLASH_LIQUIDITY');
    expect(sm.leaseOf(shard)?.holder).toBe(a.auctionId);
    // fallback (winner fails to sign) releases the shard lease and promotes routing
    engine.fallback(a.auctionId, 'solver signature timeout');
    expect(sm.leaseOf(shard)).toBeUndefined();
    expect(a.winner!.bid.strategy).toBe('ROUTING');
  });
});
