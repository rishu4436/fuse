import { describe, it, expect, beforeAll } from 'vitest';
import { toJson, fromJson } from '@fuse/solver-sdk';
import { buildApp } from '../src/app.js';
import { FuseState } from '../src/state.js';

let app: Awaited<ReturnType<typeof buildApp>>;
const get = async <T>(url: string) => { const r = await app.inject({ method: 'GET', url }); expect(r.statusCode, r.body).toBe(200); return fromJson<T>(r.body); };
const post = async <T>(url: string, body: unknown, code = 200) => { const r = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: toJson(body) }); expect(r.statusCode, r.body).toBe(code); return fromJson<T>(r.body); };

beforeAll(async () => { app = await buildApp(new FuseState(process.cwd(), { auctionWindowSeconds: 4 })); });

describe('studio API', () => {
  it('compiles a draft intent through all stages with an explanation', async () => {
    const d = await get<Record<string, unknown>>('/api/compile/draft?minOut=30000');
    const p = await post<{ ok: boolean; stages: Array<{ stage: string; ok: boolean }>; selected: { strategy: string }; explanation: { headline: string } }>('/api/compile', d);
    expect(p.ok).toBe(true); expect(p.stages).toHaveLength(10); expect(p.selected.strategy).toBe('FLASH_LIQUIDITY');
    const w = await post<Array<{ scenario: { id: string }; strategy?: string }>>('/api/parallel-worlds', d);
    expect(w.map((x) => x.scenario.id)).toContain('vault-paused');
  });
  it('nets intents in a VM-verified simulated tx', async () => {
    const r = await post<{ matched: bigint; verification: { ok: boolean }; submitted: boolean }>('/api/netting/simulate', {});
    expect(r.matched).toBe(20_000n); expect(r.verification.ok).toBe(true); expect(r.submitted).toBe(false);
  });
  it('guardian radar, policy → in-app notification, readiness, sentinel', async () => {
    const r = await get<{ status: string; total: number; risks: Array<{ outpoint: string; crBps: bigint | null }> }>('/api/guardian/radar?shockBps=1000');
    expect(r.status).toBe('READ-ONLY'); expect(r.total).toBeGreaterThan(100);
    const loan = r.risks.find((x) => x.crBps !== null)!.outpoint;
    const p = await post<{ proposals: Array<{ executable: boolean }> }>('/api/guardian/policies', { name: 'Keep 150%', loan, channels: ['in-app'], rules: [{ id: 'r1', when: { crBelowBps: 100_000 }, then: 'PROPOSE_TOP_UP', targetCrBps: 20_000, severity: 'warning' }] });
    expect(p.proposals.length).toBeGreaterThan(0); expect(p.proposals.every((x) => x.executable === false)).toBe(true);
    const n = await get<{ unread: number }>('/api/notifications'); expect(n.unread).toBeGreaterThan(0);
    const rd = await get<{ autoProtection: string }>(`/api/guardian/readiness?loan=${loan}`); expect(rd.autoProtection).toBe('UNAVAILABLE');
    const s = await get<{ signals: Array<{ name: string }> }>('/api/guardian/sentinel'); expect(s.signals.length).toBe(5);
  });
  it('LP deposit on the LOCAL chain, then explorer and contracts', async () => {
    const l = await get<{ health: { shards: number; totalSats: bigint } }>('/api/liquidity');
    expect(l.health.shards).toBe(3);
    const v = await get<{ shards: Array<{ outpoint: string }> }>('/api/vault');
    const r = await post<{ ok: boolean; txid: string }>('/api/liquidity/op', { op: 'deposit', shard: v.shards[0].outpoint, amount: '1000000' });
    expect(r.ok).toBe(true);
    const l2 = await get<{ health: { totalSats: bigint } }>('/api/liquidity');
    expect(l2.health.totalSats).toBe(l.health.totalSats + 1_000_000n);
    const tx = await get<{ txid: string; outputs: unknown[] }>(`/api/explorer/${r.txid}`); expect(tx.outputs.length).toBe(2);
    const c = await get<Array<{ name: string; bytecodeSha256: string }>>('/api/contracts'); expect(c.map((x) => x.name)).toEqual(['FlashVaultBCH', 'FlashVaultToken']);
  });
});
