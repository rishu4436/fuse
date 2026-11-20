import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { handle } from '../src/embedded.js';

const root = resolve(__dirname, '../../..');
const req = async <T>(method: string, url: string, body?: unknown) => { const r = await handle(root, { method, url, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: (r.headers['content-type'] ?? '').includes('json') ? (JSON.parse(r.body) as T) : (r.body as unknown as T) }; };

describe('hosted mode: in-process API + reference solvers (no background workers)', () => {
  it('labels itself, settles an auction lazily per request, and never offers broadcasting', async () => {
    const h = await req<{ mainnetBroadcast: boolean; hostedMode: { hosted: boolean; mainnetBroadcast: boolean } }>('GET', '/api/health');
    expect(h.json.hostedMode.hosted).toBe(true); expect(h.json.mainnetBroadcast).toBe(false); expect(h.json.hostedMode.mainnetBroadcast).toBe(false);
    expect((await req<unknown[]>('GET', '/api/solvers')).json).toHaveLength(4);
    const a = await req<{ auctionId: string }>('POST', '/api/intents/swap', { minOut: '30000', maxIn: '40000000' });
    let status = ''; let txid: string | undefined;
    for (let i = 0; i < 80 && !['SETTLED', 'FAILED'].includes(status); i++) { await new Promise((r) => setTimeout(r, 300)); const x = await req<{ status: string; txid?: string }>('GET', `/api/auctions/${a.json.auctionId}`); status = x.json.status; txid = x.json.txid; }
    expect(status).toBe('SETTLED'); expect(txid).toMatch(/^[0-9a-f]{64}$/);
    const sse = await req<string>('GET', '/api/events');
    expect(sse.json).toContain('retry: 3000'); expect(sse.json).toContain('WINNER_SELECTED');
  }, 60_000);
});
