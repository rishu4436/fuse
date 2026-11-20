// HTTP client used by independent solver processes. Values travel as JSON with bigint encoded as strings.
import type { Bid, MarketView, SwapIntentView } from './types.js';

export const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
export const fromJson = <T>(s: string): T => JSON.parse(s, (_k, x) => (typeof x === 'string' && /^-?\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x));

export class SolverClient {
  constructor(private readonly baseUrl: string, private readonly solverId: string) {}
  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.baseUrl + path, { ...init, headers: { 'content-type': 'application/json', 'x-fuse-solver': this.solverId, ...(init?.headers ?? {}) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text}`);
    return fromJson<T>(text);
  }
  register(pubkey: string, strategy: string, name: string) { return this.req<{ solverId: string }>('/api/solvers/register', { method: 'POST', body: toJson({ pubkey, strategy, name }) }); }
  openAuctions() { return this.req<Array<{ auctionId: string; intent: SwapIntentView; market: MarketView; closesAt: number }>>('/api/auctions/open'); }
  submitBid(bid: Bid) { return this.req<{ accepted: boolean; reason?: string }>('/api/solver/bids', { method: 'POST', body: toJson(bid) }); }
  signRequests() { return this.req<Array<{ auctionId: string; bid: Bid }>>(`/api/solver/sign-requests?solverId=${encodeURIComponent(this.solverId)}`); }
  submitSignatures(auctionId: string, unlocks: Record<string, string>) { return this.req<{ ok: boolean }>('/api/solver/signatures', { method: 'POST', body: toJson({ auctionId, solverId: this.solverId, unlocks }) }); }
  results() { return this.req<Array<{ auctionId: string; status: string; winner?: string; txid?: string; solverRevenueSats?: bigint }>>(`/api/solver/results?solverId=${encodeURIComponent(this.solverId)}`); }
}
