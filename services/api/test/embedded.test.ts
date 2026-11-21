import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { handle, _dropWorldsForTests } from '../src/embedded.js';

const root = resolve(__dirname, '../../..');
/** a browser session: carries the signed sandbox journal like apps/web/lib/api.ts does */
function session() {
  let tok: string | undefined;
  return {
    get token() { return tok; },
    async req<T>(method: string, url: string, body?: unknown) {
      const r = await handle(root, { method, url, headers: { 'content-type': 'application/json', ...(tok ? { 'x-fuse-sandbox': tok } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (r.headers['x-fuse-sandbox']) tok = r.headers['x-fuse-sandbox'];
      return { status: r.status, headers: r.headers, json: (r.headers['content-type'] ?? '').includes('json') ? (JSON.parse(r.body) as T) : (r.body as unknown as T) };
    },
  };
}
const settle = async (s: ReturnType<typeof session>, id: string) => {
  let x = { status: '', txid: undefined as string | undefined, certificateId: undefined as string | undefined };
  for (let i = 0; i < 80 && !['SETTLED', 'FAILED'].includes(x.status); i++) { await new Promise((r) => setTimeout(r, 300)); x = (await s.req<typeof x>('GET', `/api/auctions/${id}`)).json; }
  return x;
};

describe('hosted mode: in-process API + reference solvers (no background workers)', () => {
  it('labels itself, settles an auction lazily per request, and never offers broadcasting', async () => {
    const s = session();
    const h = await s.req<{ mainnetBroadcast: boolean; hostedMode: { hosted: boolean; mainnetBroadcast: boolean } }>('GET', '/api/health');
    expect(h.json.hostedMode.hosted).toBe(true); expect(h.json.mainnetBroadcast).toBe(false); expect(h.json.hostedMode.mainnetBroadcast).toBe(false);
    expect((await s.req<unknown[]>('GET', '/api/solvers')).json).toHaveLength(4);
    const a = await s.req<{ auctionId: string }>('POST', '/api/intents/swap', { minOut: '30000', maxIn: '40000000' });
    const x = await settle(s, a.json.auctionId);
    expect(x.status).toBe('SETTLED'); expect(x.txid).toMatch(/^[0-9a-f]{64}$/);
    const sse = await s.req<string>('GET', '/api/events');
    expect(sse.json).toContain('retry: 3000'); expect(sse.json).toContain('WINNER_SELECTED');
  }, 60_000);

  it('deterministic across instances: a fresh instance replays the journal to the identical world', async () => {
    const s = session();
    const a = await s.req<{ auctionId: string }>('POST', '/api/intents/swap', { minOut: '30000', maxIn: '40000000' });
    const x = await settle(s, a.json.auctionId);
    expect(x.status).toBe('SETTLED');
    const shards = (await s.req<{ shards: Array<{ outpoint: string }> }>('GET', '/api/vault')).json.shards;
    const lp = await s.req<{ ok: boolean; txid?: string }>('POST', '/api/liquidity/op', { op: 'deposit', shard: shards[0].outpoint, amount: '10000' });
    expect(lp.json, JSON.stringify(lp.json).slice(0, 300)).toMatchObject({ ok: true });
    const before = (await s.req<{ shards: unknown[] }>('GET', '/api/vault')).json;
    _dropWorldsForTests(); // the next request lands on an instance that has never seen this session
    const y = await s.req<typeof x>('GET', `/api/auctions/${a.json.auctionId}`);
    expect(y.headers['x-fuse-sandbox-replayed']).toBe('2');
    expect(y.json.status).toBe('SETTLED'); expect(y.json.txid).toBe(x.txid); expect(y.json.certificateId).toBe(x.certificateId);
    expect((await s.req<{ shards: unknown[] }>('GET', '/api/vault')).json).toEqual(before);
  }, 90_000);

  it('a forged journal is rejected (sandbox restarts from genesis)', async () => {
    const s = session();
    await s.req('POST', '/api/intents/swap', { minOut: '30000', maxIn: '40000000' });
    const [body] = s.token!.split('.');
    const r = await handle(root, { method: 'GET', url: '/api/auctions', headers: { 'x-fuse-sandbox': `${body}.AAAAAAAAAAAAAAAAAAAAAA` } });
    expect(r.headers['x-fuse-sandbox-note']).toMatch(/rejected/);
    expect(JSON.parse(r.body)).toEqual([]);
  }, 60_000);
});
