// Review issue D: mainnet solver auction — quote signatures, RFQ binding, recomputation, scoring.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { binToHex, secp256k1 } from '@bitauth/libauth';
import { checkLiveQuotes, checkLiveRfq } from '../../../packages/sdk/src/live-auction.js';
import type { LiveAuctionEvidence, LiveSolver } from '@fuse/sdk';

// prepare() is the live composer (network); here it recomputes routes from a fixed fake pool state
const LOSS: Record<string, bigint> = { 'a:0>b:0': 40n, 'c:0>d:0': 90n };
vi.mock('../src/live/execute.js', () => ({
  prepare: vi.fn(async (_c: unknown, r: { route: { buyOutpoint: string; sellOutpoint: string } }) => {
    const k = `${r.route.buyOutpoint}>${r.route.sellOutpoint}`;
    if (!(k in LOSS)) throw Object.assign(new Error('pool not live'), { statusCode: 409 });
    return { route: { satsIn: 1000n, satsOut: 1000n - LOSS[k], roundTripLoss: LOSS[k] }, expectedUserCost: 100n + LOSS[k] + 900n, minerFee: 900n, risk: { ok: true, level: 'PASS' } };
  }),
}));
const { openRfq, signQuote, settleAuction, solverIdOfPub, transcriptHashOf } = await import('../src/live/auction.js');

const key = () => { const priv = randomBytes(32); return { priv, pub: binToHex(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array) }; };
const S1 = key(), S2 = key(), ROGUE = key();
const registry = [{ solverId: solverIdOfPub(S1.pub), pubkey: S1.pub, strategy: 'direct', operator: 't' }, { solverId: solverIdOfPub(S2.pub), pubkey: S2.pub, strategy: 'deep-pair', operator: 't' }];
beforeAll(() => { process.env.FUSE_AUTH_KEY = binToHex(randomBytes(32)); });
const route = (buy: string, sell: string, loss: string) => ({ units: '1', buyOutpoint: buy, sellOutpoint: sell, satsIn: '1000', satsOut: String(1000 - Number(loss)), loss });
const q = (k: typeof S1, r: ReturnType<typeof openRfq>, strategy: string, rt: ReturnType<typeof route>) => signQuote({ auctionId: r.rfq.auctionId, rfqHash: r.rfqHash, solverPubkey: k.pub, strategy, route: rt, quotedAt: r.rfq.issuedAt, expiresAt: r.rfq.issuedAt + 120 }, k.priv);
const addr = 'bitcoincash:qqtestaddressxxxxxxxxxxxxxxxxxxxxxxxxxxx';

describe('live solver auction (D)', () => {
  it('the SDK validates the recorded mainnet RFQ and solver signatures against public pins', () => {
    const { transcript } = JSON.parse(readFileSync('evidence/mainnet/auctions/cb003c5645ec52aea77b896e7f29fba22a751ad937a8a44f4d1649f954733c3c.json', 'utf8')) as LiveAuctionEvidence;
    const { solvers } = JSON.parse(readFileSync('evidence/mainnet/live-solvers.json', 'utf8')) as { solvers: LiveSolver[] };
    const { rfq, rfqSig, rfqHash, quotes, settledAt } = transcript;
    const attestationPubkey = '037e044ab06145cc82956a836cb712f0f422a5bc05371e49eabd4936592419401f';
    checkLiveRfq({ rfq, rfqSig, rfqHash, attestationPubkey, solvers }, {
      address: rfq.address, units: BigInt(rfq.units), vaultId: rfq.vaultId ?? undefined,
    }, attestationPubkey, settledAt);
    expect(checkLiveQuotes({ rfq, rfqSig, quotes }, solvers, settledAt)).toHaveLength(2);
    expect(() => checkLiveQuotes({ rfq, rfqSig, quotes }, [], settledAt)).toThrow(/signature|solver/);
  });
  it('two signed quotes: both recomputed, lowest user cost wins, transcript hash commits to everything', async () => {
    const r = openRfq({ address: addr, units: 1n });
    const res = await settleAuction([], registry, { rfq: r.rfq, rfqSig: r.rfqSig, quotes: [q(S2, r, 'deep-pair', route('c:0', 'd:0', '90')), q(S1, r, 'direct', route('a:0', 'b:0', '40'))] });
    expect(res.winner.strategy).toBe('direct'); expect(res.winner.rank).toBe(1);
    expect(res.transcript.verdicts.every((v) => v.valid)).toBe(true);
    expect(transcriptHashOf(res.transcript)).toBe(res.transcriptHash);
  });
  it('rejects: forged quote signature, unregistered solver, quote for another RFQ, misquote, dead route', async () => {
    const r = openRfq({ address: addr, units: 1n }); const other = openRfq({ address: addr, units: 1n });
    const forged = q(S1, r, 'direct', route('a:0', 'b:0', '40')); forged.quote.route.loss = '1';
    const res = await settleAuction([], registry, { rfq: r.rfq, rfqSig: r.rfqSig, quotes: [
      forged, q(ROGUE, r, 'rogue', route('a:0', 'b:0', '40')), q(S2, other, 'deep-pair', route('a:0', 'b:0', '40')),
    ] }).catch((e: Error) => e);
    expect(res).toBeInstanceOf(Error); expect(String(res)).toMatch(/signature invalid/); expect(String(res)).toMatch(/not in the registry/); expect(String(res)).toMatch(/different RFQ/);
    const mis = await settleAuction([], registry, { rfq: r.rfq, rfqSig: r.rfqSig, quotes: [q(S1, r, 'direct', route('a:0', 'b:0', '5')), q(S2, r, 'deep-pair', route('x:0', 'y:0', '5'))] }).catch((e: Error) => e);
    expect(String(mis)).toMatch(/misquoted/); expect(String(mis)).toMatch(/does not compose/);
  });
  it('an RFQ not signed by this deployment, or expired, is refused', async () => {
    const r = openRfq({ address: addr, units: 1n });
    await expect(settleAuction([], registry, { rfq: { ...r.rfq, units: '5' }, rfqSig: r.rfqSig, quotes: [] })).rejects.toThrow(/RFQ signature invalid/);
    const old = openRfq({ address: addr, units: 1n }, Math.floor(Date.now() / 1000) - 1000);
    await expect(settleAuction([], registry, { rfq: old.rfq, rfqSig: old.rfqSig, quotes: [] })).rejects.toThrow(/expired/);
  });
});
