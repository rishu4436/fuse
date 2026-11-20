// @fuse/sdk — public client for the FUSE API.
// Design rules: bigint everywhere for amounts (JSON wire format "123n"); certificates are verified LOCALLY with
// @fuse/proof-verifier against raw transactions that are re-hashed (a raw tx from any source authenticates
// itself by its txid); the SDK never holds keys for the user and exposes no broadcast call.
import { verifyCertificate, type Certificate, type CertificateVerification, type ChainReader } from '@fuse/proof-verifier';

export const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
export const fromJson = <T>(s: string): T => JSON.parse(s, (_k, x) => (typeof x === 'string' && /^-?\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x));

export class FuseApiError extends Error { constructor(public readonly status: number, public readonly code: string, message: string) { super(message); } }

export interface StageRow { stage: string; ok: boolean; ms: number; detail: string }
export interface CompiledPlan { ok: boolean; stages: StageRow[]; selected?: { strategy: string; outcome?: { userReceivesTokens: bigint; userNetSpendSats: bigint; minerFeeSats: bigint } }; explanation?: { headline: string; steps: string[] }; error?: { stage: string; reason: string } }
export interface AuctionView { auctionId: string; status: string; txid?: string; certificateId?: string; error?: string; bids: Array<{ strategy: string; valid: boolean | null; reasons?: string[]; winner?: boolean }> }
export interface RecipeEntry { id: string; hash: string; body: { name: string; legs: string[] }; verdict: { listed: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> } }

export class FuseClient {
  constructor(readonly baseUrl: string, private readonly f: typeof fetch = fetch) {}
  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const r = await this.f(this.baseUrl.replace(/\/$/, '') + path, { method: init.method ?? (init.body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json' }, body: init.body === undefined ? undefined : toJson(init.body) });
    const text = await r.text();
    if (!r.ok) { let code = 'HTTP_' + r.status, msg = text; try { const j = JSON.parse(text); code = j.error ?? code; msg = j.message ?? msg; } catch { /* plain */ } throw new FuseApiError(r.status, code, msg); }
    return fromJson<T>(text);
  }
  // ---- health / network ----
  health() { return this.request<{ ok: boolean; network: string; simulated: boolean; mainnetBroadcast: boolean }>('/api/health'); }
  // ---- intents & compile ----
  draftSwap(o: { minOut?: bigint; maxIn?: bigint; maxFee?: bigint } = {}) { const q = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])); return this.request<Record<string, unknown>>(`/api/compile/draft?${q}`); }
  compile(intent: unknown) { return this.request<CompiledPlan>('/api/compile', { body: intent }); }
  compileTyped(o: { type: 'TOKEN_SWAP' | 'ATOMIC_ARBITRAGE' | 'LIQUIDITY_DEPOSIT' | 'LIQUIDITY_WITHDRAWAL'; amount?: bigint; minProfit?: bigint; atomicity?: 'ATOMIC_SINGLE_TX' | 'STAGED_RECOVERABLE' }) { return this.request<{ intent: unknown; plan: CompiledPlan }>('/api/compile/typed', { body: o }); }
  parallelWorlds(intent: unknown) { return this.request<Array<{ scenario: { id: string; label: string }; ok: boolean; strategy?: string }>>('/api/parallel-worlds', { body: intent }); }
  // ---- auctions (LOCAL network) ----
  openSwap(o: { minOut: bigint; maxIn: bigint; maxFee: bigint }) { return this.request<AuctionView>('/api/intents/swap', { body: o }); }
  auction(id: string) { return this.request<AuctionView>(`/api/auctions/${id}`); }
  async waitForAuction(id: string, o: { timeoutMs?: number; pollMs?: number } = {}): Promise<AuctionView> {
    const end = Date.now() + (o.timeoutMs ?? 30_000);
    for (;;) {
      const a = await this.auction(id);
      if (['SETTLED', 'FAILED', 'EXPIRED'].includes(a.status)) return a;
      if (Date.now() > end) throw new FuseApiError(408, 'TIMEOUT', `auction ${id} still ${a.status}`);
      await new Promise((r) => setTimeout(r, o.pollMs ?? 500));
    }
  }
  // ---- certificates ----
  certificate(id: string) { return this.request<Certificate>(`/api/certificates/${id}`); }
  /** A ChainReader that fetches raw transactions from the FUSE explorer. The verifier re-hashes every raw tx, so
   *  a lying explorer can only make verification FAIL, never pass. Use an independent indexer for mainnet. */
  explorerReader(): ChainReader {
    return { network: 'local', getRawTransaction: async (txid) => { try { const r = await this.request<{ raw: string }>(`/api/explorer/${txid}`); return { rawHex: r.raw, blockHeight: null, blockHash: null }; } catch { return null; } }, tipHeight: async () => 0 };
  }
  /** Independent, client-side certificate verification. */
  async verifyLocally(cert: Certificate, reader: ChainReader = this.explorerReader()): Promise<CertificateVerification> {
    return verifyCertificate(cert, reader);
  }
  // ---- guardian (READ-ONLY mainnet snapshots) ----
  radar(shockBps = 0) { return this.request<{ status: 'READ-ONLY'; tiers: Record<string, number>; total: number }>(`/api/guardian/radar?shockBps=${shockBps}`); }
  rateAdvice(o: { loan?: string; multiple?: number; demandCents?: bigint } = {}) { const q = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])); return this.request<{ status: 'READ-ONLY'; executable: false; recommended: { rateRaw: bigint; aprBps: bigint } | null }>(`/api/guardian/rates?${q}`); }
  redemptionSearch() { return this.request<{ status: 'READ-ONLY'; note: string }>('/api/opportunities/redemption'); }
  // ---- marketplace ----
  recipes() { return this.request<{ autoExecute: false; recipes: RecipeEntry[] }>('/api/marketplace/recipes'); }
  submitRecipe(signed: { recipe: unknown; hash: string; signature: string }) { return this.request<{ listed: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> }>('/api/marketplace/recipes', { body: signed }); }
  // ---- solvers ----
  solverPerformance() { return this.request<Array<{ name: string; bids: number; wins: number; rejected: number; winRateBps: number }>>('/api/solvers/performance'); }
}
export { signRecipe, recipeHash, structure, PRESETS, type Recipe } from '@fuse/recipes';
