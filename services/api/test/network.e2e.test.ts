// End-to-end: real HTTP API process + 4 separate OS solver processes. Proves bids come from independent
// processes with distinct keys, the adversarial bid is rejected, and the winner settles on the LOCAL chain.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { fromJson, toJson } from '@fuse/solver-sdk';
import { quickstart } from '../../../examples/sdk-quickstart/index.js';

const PORT = 18787 + Math.floor(Math.random() * 1000);
const API = `http://127.0.0.1:${PORT}`;
const procs: ChildProcess[] = [];
const get = async <T>(p: string) => fromJson<T>(await (await fetch(API + p)).text());
const post = async <T>(p: string, b: unknown) => fromJson<T>(await (await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: toJson(b) })).text());
const waitFor = async <T>(f: () => Promise<T | undefined>, ms: number) => { const end = Date.now() + ms; for (;;) { const v = await f().catch(() => undefined); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 300)); } };

beforeAll(async () => {
  procs.push(spawn(process.execPath, ['--import', 'tsx', 'services/api/src/server.ts'], { env: { ...process.env, PORT: String(PORT), FUSE_AUCTION_WINDOW: '6' }, stdio: 'ignore' }));
  await waitFor(() => get<{ ok: boolean }>('/api/health').then((h) => h.ok || undefined), 30_000);
  for (const k of ['direct', 'routing', 'flash', 'rogue']) procs.push(spawn(process.execPath, ['--import', 'tsx', 'services/solver-reference/src/worker.ts', k], { env: { ...process.env, FUSE_API: API }, stdio: 'ignore' }));
  await waitFor(() => get<unknown[]>('/api/solvers').then((s) => s.length === 4 || undefined), 40_000);
}, 90_000);
afterAll(() => { for (const p of procs) p.kill('SIGTERM'); });

describe('solver network over HTTP (separate processes)', () => {
  it('4 processes register with distinct keys; auction settles with the best verified bid; certificate verifies', async () => {
    const solvers = await get<Array<{ solverId: string; pubkey: string }>>('/api/solvers');
    expect(new Set(solvers.map((s) => s.pubkey)).size).toBe(4);
    const a = await post<{ auctionId: string }>('/api/intents/swap', { minOut: '30000', maxIn: '40000000' });
    const done = await waitFor(() => get<{ status: string; bids: Array<{ strategy: string; valid: boolean; reasons: string[] }>; txid?: string; certificateId?: string }>(`/api/auctions/${a.auctionId}`).then((x) => (['SETTLED', 'FAILED'].includes(x.status) ? x : undefined)), 40_000);
    expect(done.status).toBe('SETTLED');
    expect(done.bids.length).toBe(4);
    expect(done.bids.find((b) => b.strategy === 'ADVERSARIAL_FIXTURE')!.valid).toBe(false);
    expect(done.bids.filter((b) => b.valid).length).toBe(3);
    const cert = await get<unknown>(`/api/certificates/${done.certificateId}`);
    const v = await post<{ status: string }>('/api/certificates/verify', cert);
    expect(v.status).toBe('VERIFIED');
    // second auction on the updated chain state (pools moved, vault shard has new outpoint)
    const b = await post<{ auctionId: string }>('/api/intents/swap', { minOut: '20000', maxIn: '40000000' });
    const done2 = await waitFor(() => get<{ status: string }>(`/api/auctions/${b.auctionId}`).then((x) => (['SETTLED', 'FAILED'].includes(x.status) ? x : undefined)), 40_000);
    expect(done2.status).toBe('SETTLED');
    const vault = await get<{ cumulativeFees: bigint; flashCount: bigint }>('/api/vault');
    expect(vault.flashCount).toBeGreaterThanOrEqual(1n);
  }, 120_000);
  it('F45: the standalone SDK quickstart app runs end-to-end and verifies its certificate client-side', async () => {
    const lines: string[] = [];
    const r = await quickstart(API, { log: (l) => lines.push(l) });
    expect(r.plan.ok).toBe(true);
    expect(r.recipes.autoExecute).toBe(false);
    expect(r.rates.executable).toBe(false);
    expect(r.verification).toBe('VERIFIED');
    expect(lines.some((l) => l.includes('verified client-side'))).toBe(true);
  }, 60_000);
});
