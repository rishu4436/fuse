// Persistence across an API restart: intents, auctions, certificates, Guardian policies, alerts and the F32
// solver ledger survive; restored LOCAL certificates are flagged because the mock chain resets.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { toJson, fromJson, STRATEGIES, signBid } from '@fuse/solver-sdk';
import { solverIdentity } from '@fuse/simulation';
import { signInputs } from '@fuse/transaction-composer';
import { FuseStore } from '@fuse/store';
import { buildApp } from '../src/app.js';
import { FuseState } from '../src/state.js';

const S = { routing: 'ROUTING', flash: 'FLASH_LIQUIDITY', rogue: 'ADVERSARIAL_FIXTURE' } as const;

describe('API persistence (SQLite)', () => {
  it('settles an auction, persists everything, and restores it in a new session', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'fuse-api-')), 'fuse.db');
    const state = new FuseState(process.cwd(), { auctionWindowSeconds: 1, store: new FuseStore(path, 'sessionA') });
    const app = await buildApp(state);
    const post = async <T>(url: string, body: unknown) => { const r = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: toJson(body) }); expect(r.statusCode, r.body).toBe(200); return fromJson<T>(r.body); };
    const get = async <T>(url: string) => fromJson<T>((await app.inject({ method: 'GET', url })).body);
    const ids = Object.fromEntries((Object.keys(S) as Array<keyof typeof S>).map((k) => [k, solverIdentity(state.market, k)])) as Record<keyof typeof S, ReturnType<typeof solverIdentity>>;
    for (const k of Object.keys(S) as Array<keyof typeof S>) await post('/api/solvers/register', { pubkey: ids[k].pubkey, strategy: S[k], name: `${k}-solver` });
    const a = await post<{ auctionId: string }>('/api/intents/swap', { minOut: 30_000n, maxIn: 40_000_000n, maxFee: 20_000n });
    const open = await get<Array<{ auctionId: string; intent: never; market: never }>>('/api/auctions/open');
    const o = open.find((x) => x.auctionId === a.auctionId)!;
    for (const k of Object.keys(S) as Array<keyof typeof S>) {
      const p = STRATEGIES[S[k]](o.market, o.intent, ids[k]);
      const bid = signBid({ auctionId: a.auctionId, solverId: ids[k].id, solverPubkey: ids[k].pubkey, strategy: S[k], executionClass: 'ATOMIC_SINGLE_TX', template: p.template, claims: p.claims, explanation: p.explanation, expiresAt: Math.floor(Date.now() / 1000) + 120, nonce: randomBytes(8).toString('hex') }, ids[k].priv);
      expect((await post<{ accepted: boolean }>('/api/solver/bids', bid)).accepted).toBe(true);
    }
    await new Promise((r) => setTimeout(r, 1_100));
    await state.tick();
    const rec = state.engine.auctions.get(a.auctionId)!;
    expect(rec.winner!.bid.strategy).toBe('FLASH_LIQUIDITY');
    expect(rec.leases?.length).toBe(1); // F30 lease held by the auction while signatures are collected
    state.engine.addSignatures(a.auctionId, 'solver', signInputs(rec.winner!.bid.template, 'solver', ids.flash.priv));
    await state.tick();
    expect(rec.status).toBe('SETTLED');
    const radar = await get<{ risks: Array<{ outpoint: string; crBps: bigint | null }> }>('/api/guardian/radar');
    const loan = radar.risks.find((x) => x.crBps !== null)!.outpoint;
    await post('/api/guardian/policies', { name: 'Persisted', loan, channels: ['in-app', 'telegram'], rules: [{ id: 'r1', when: { crBelowBps: 100_000 }, then: 'ALERT', severity: 'warning' }] });
    const perf = await get<Array<{ name: string; wins: number; rejected: number; losses: number }>>('/api/solvers/performance');
    expect(perf.find((p) => p.name === 'flash-solver')!.wins).toBe(1);
    expect(perf.find((p) => p.name === 'rogue-solver')!.rejected).toBe(1);
    expect(perf.find((p) => p.name === 'routing-solver')!.losses).toBe(1);
    await new Promise((r) => setTimeout(r, 50)); // async delivery records
    const deliveries = await get<Array<{ channel: string; status: string }>>('/api/notifications/deliveries');
    expect(deliveries.find((d) => d.channel === 'telegram')!.status).toBe('SKIPPED'); // not configured: nothing sent
    state.store.close();

    // ---- restart: new session on the same database ----
    const state2 = new FuseState(process.cwd(), { auctionWindowSeconds: 1, store: new FuseStore(path, 'sessionB') });
    const app2 = await buildApp(state2);
    const get2 = async <T>(url: string) => fromJson<T>((await app2.inject({ method: 'GET', url })).body);
    const hist = await get2<Array<{ certificateId: string; restored: boolean }>>('/api/certificates/history');
    expect(hist.map((c) => c.certificateId)).toContain(rec.certificate!.certificateId);
    expect(hist[0].restored).toBe(true);
    expect((await get2<Array<{ name: string }>>('/api/guardian/policies')).map((p) => p.name)).toContain('Persisted');
    expect((await get2<{ items: unknown[] }>('/api/notifications')).items.length).toBeGreaterThan(0);
    expect((await get2<Array<{ name: string; wins: number }>>('/api/solvers/performance')).find((p) => p.name === 'flash-solver')!.wins).toBe(1);
    const st = await get2<{ migrations: Array<{ version: number }>; counts: Record<string, number>; session: string }>('/api/store');
    expect(st.session).toBe('sessionB'); expect(st.migrations.map((m) => m.version)).toEqual([1, 2, 3]);
    expect(st.counts.intents).toBe(1); expect(st.counts.auctions).toBe(1); expect(st.counts.certificates).toBe(1);
    const ih = await get2<{ auctions: Array<{ status: string; restored: boolean }> }>('/api/intents/history');
    expect(ih.auctions[0]).toMatchObject({ status: 'SETTLED', restored: true });
    state2.store.close();
  }, 30_000);
});
