import { describe, it, expect, afterEach } from 'vitest';
import { fulcrumBroadcast } from '../src/live/chain';

// Fake WebSocket: answers blockchain.transaction.broadcast like Fulcrum does
function fakeWs(reply: (params: unknown[]) => unknown) {
  return class {
    onopen?: () => void; onmessage?: (m: { data: string }) => void; onerror?: () => void; sent: string[] = [];
    constructor(public url: string) { setTimeout(() => this.onopen?.(), 0); }
    send(s: string) { const req = JSON.parse(s) as { id: number; method: string; params: unknown[] }; expect(req.method).toBe('blockchain.transaction.broadcast'); setTimeout(() => this.onmessage?.({ data: JSON.stringify({ id: req.id, ...(reply(req.params) as object) }) }), 0); }
    close() { /* noop */ }
  };
}
const g = globalThis as { WebSocket?: unknown }; const orig = g.WebSocket;
afterEach(() => { g.WebSocket = orig; });

describe('second broadcast path (Fulcrum WSS fan-out)', () => {
  it('returns the node txid for the exact hex sent', async () => {
    g.WebSocket = fakeWs((p) => ({ result: (p[0] as string) === 'aabb' ? 'f'.repeat(64) : null }));
    await expect(fulcrumBroadcast('aabb', 'wss://test')).resolves.toBe('f'.repeat(64));
  });
  it('surfaces a node rejection', async () => {
    g.WebSocket = fakeWs(() => ({ error: { code: 1, message: 'the transaction was rejected by network rules' } }));
    await expect(fulcrumBroadcast('aabb', 'wss://test')).rejects.toThrow(/rejected by network rules/);
  });
  it('times out instead of hanging the broadcast route', async () => {
    g.WebSocket = class { onopen?: () => void; constructor() { /* never opens */ } send() { /* */ } close() { /* */ } };
    await expect(fulcrumBroadcast('aabb', 'wss://test', 50)).rejects.toThrow(/timeout/);
  });
});
