// @fuse/sdk — public client for the FUSE API.
// Design rules: bigint everywhere for amounts (JSON wire format "123n"); certificates are verified LOCALLY with
// @fuse/proof-verifier against raw transactions that are re-hashed (a raw tx from any source authenticates
// itself by its txid); the SDK never holds keys for the user and exposes no broadcast call.
import { verifyCertificate, type Certificate, type CertificateVerification, type ChainReader } from '@fuse/proof-verifier';
import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { contractUnlocks, txidOfRaw, verifyTemplateAndRaw } from '@fuse/transaction-composer';
import { FuseApiError } from './errors.js';
import { fromJson, toJson } from './wire.js';
import { checkLiveQuotes, checkLiveRfq, liveAuctionHash, verifyLiveAuction } from './live-auction.js';
import { checkMainnetSources, checkUnsigned, checkVault, liveIntentBinder, mainnetWallet, requireLive, verifyPreflight } from './live-verification.js';
import { liveReceiptRederiver } from './live-receipt.js';
import type {
  LiveAuctionInput, LiveAuctionResult, LiveChainTip, LiveExecutionPolicy, LiveIntentEvidence,
  LivePreflight, LivePrepareInput, LiveReceipt, LiveReceiptInput, LiveRfqEnvelope, LiveRfqInput,
  LiveSignedVerification, LiveSolver, LiveTransactionStatus, LiveVault, LiveVaultEntry, LiveVaultIdentity,
} from './live.js';

export type * from './live.js';
export { fromJson, toJson, FuseApiError };
export { liveIntentBinder } from './live-verification.js';
export { liveReceiptRederiver };

function invalidResponse(error: unknown): never {
  if (error instanceof FuseApiError) throw error;
  throw new FuseApiError(502, 'INVALID_LIVE_RESPONSE', 'The API returned invalid data. Discard this response and retry.');
}

export interface StageRow { stage: string; ok: boolean; ms: number; detail: string }
export interface CompiledPlan { ok: boolean; stages: StageRow[]; selected?: { strategy: string; outcome?: { userReceivesTokens: bigint; userNetSpendSats: bigint; minerFeeSats: bigint } }; explanation?: { headline: string; steps: string[] }; error?: { stage: string; reason: string } }
export interface AuctionView { auctionId: string; status: string; txid?: string; certificateId?: string; error?: string; bids: Array<{ strategy: string; valid: boolean | null; reasons?: string[]; winner?: boolean }> }
export interface RecipeEntry { id: string; hash: string; body: { name: string; legs: string[] }; verdict: { listed: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> } }

export class FuseClient {
  constructor(readonly baseUrl: string, private readonly f: typeof fetch = fetch) {}
  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const body = init.body === undefined ? undefined : toJson(init.body);
    let response: Response;
    let text: string;
    try {
      response = await this.f(this.baseUrl.replace(/\/$/, '') + path, {
        method: init.method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(40_000),
      });
      text = await response.text();
    } catch {
      throw new FuseApiError(503, 'NETWORK_UNAVAILABLE', 'Cannot reach the FUSE API. Check the connection and retry.');
    }
    if (!response.ok) {
      let code = 'HTTP_' + response.status;
      let message = `FUSE API returned HTTP ${response.status}.`;
      try {
        const error = JSON.parse(text);
        if (typeof error?.error === 'string') code = error.error;
        if (typeof error?.message === 'string') message = error.message;
      } catch { /* The proxy can return a non-JSON body. */ }
      throw new FuseApiError(response.status, code, message);
    }
    try { return fromJson<T>(text); } catch { return invalidResponse(null); }
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
  // ---- BCH mainnet execution ----
  async liveVaults() {
    const entries = await this.request<LiveVaultEntry[]>('/api/live/vaults');
    try {
      for (const entry of entries) if (!('error' in entry)) checkVault(entry);
      return entries;
    } catch (error) { return invalidResponse(error); }
  }
  async liveVault(id: string) {
    const vault = await this.request<LiveVault>(`/api/live/vault/${encodeURIComponent(id)}`);
    try {
      requireLive(vault.id === id, 'The response describes a different FlashVault.');
      checkVault(vault);
      return vault;
    } catch (error) { return invalidResponse(error); }
  }
  /** Compose and check an unsigned transaction. Inspect risk and authorization before wallet signing. */
  async prepareLive(input: LivePrepareInput) {
    const request = { ...input };
    mainnetWallet(request.address);
    const prepared = await this.request<LivePreflight>('/api/live/prepare', { body: request });
    try {
      checkUnsigned(prepared, request);
      return prepared;
    } catch (error) { return invalidResponse(error); }
  }
  /** Verify the preflight locally, re-read mainnet parents, then ask the deployment about current spend status. */
  async checkLiveAuthorization(preflight: LivePreflight, input: LivePrepareInput, policy: LiveExecutionPolicy) {
    const prepared = structuredClone(preflight);
    const request = { ...input };
    const trust = { ...policy, vault: policy.vault && structuredClone(policy.vault) };
    try {
      const p = verifyPreflight(prepared, request, trust);
      await checkMainnetSources(p.template, trust.reader);
      const status = await this.request<{ chainTip: LiveChainTip; intentId: string }>('/api/live/check-authorization', { body: prepared.authorization });
      requireLive(status.intentId === p.intentId && Number.isSafeInteger(status.chainTip?.height) &&
        status.chainTip.height > 0 && /^[0-9a-f]{64}$/.test(status.chainTip.hash), 'Fresh chain check returned a different authorization or an invalid tip.');
      requireLive(Date.now() < p.expiresAt * 1000, 'Authorization expired during chain checks. Run preflight again.', 'AUTHORIZATION_EXPIRED', 409);
      const capital = p.constraints.capital;
      prepared.sign.userPrompt = `FUSE ${p.action} on BCH mainnet · Wallet cost ${p.constraints.expectedUserCost} sats${capital ? ` · Vault capital ${capital} sats` : ''}`;
      return { ...status, prepared };
    } catch (error) { return invalidResponse(error); }
  }
  /** Run the signed transaction through the BCH VM using chain-derived inputs. */
  async verifyLiveSigned(rawHex: string, reviewed: LivePreflight) {
    requireLive(/^(?:[0-9a-f]{2})+$/.test(rawHex) && rawHex.length <= 200_000, 'Wallet must return a signed transaction in hex.', 'INVALID_TRANSACTION', 400);
    const check = verifyTemplateAndRaw(reviewed.template, rawHex, { requireStrongSighash: true });
    requireLive(check.ok, check.checks.find(c => !c.ok)?.detail ?? 'The signed transaction failed local checks.', 'SIGNED_TRANSACTION_REJECTED');
    const tx = decodeTransaction(hexToBin(rawHex));
    requireLive(typeof tx !== 'string' && [...contractUnlocks(reviewed.template)].every(([i, unlock]) => binToHex(tx.inputs[i].unlockingBytecode) === unlock),
      'The wallet changed a covenant input.', 'SIGNED_TRANSACTION_REJECTED');
    const report = await this.request<LiveSignedVerification>('/api/live/verify-signed', { body: { rawHex } });
    requireLive(report.txid === txidOfRaw(rawHex) && report.minerFee === check.minerFee, 'Deployment verification describes a different transaction or fee.');
    requireLive(report.vmValid === true, report.vmDetail ?? 'The signed transaction failed chain-derived verification.', 'SIGNED_TRANSACTION_REJECTED');
    return report;
  }
  async liveTransaction(txid: string) {
    requireLive(/^[0-9a-f]{64}$/.test(txid), 'Provide a lowercase BCH transaction ID.', 'INVALID_TXID', 400);
    const status = await this.request<LiveTransactionStatus>(`/api/live/tx/${txid}`);
    requireLive(status?.txid === txid, 'Status describes a different transaction.');
    return status;
  }
  liveSolvers() {
    return this.request<LiveSolver[]>('/api/live/auction/solvers');
  }
  async openLiveRfq(input: LiveRfqInput, attestationPubkey: string) {
    const request = { ...input };
    mainnetWallet(request.address);
    const result = await this.request<LiveRfqEnvelope>('/api/live/auction/rfq', { body: request });
    try {
      checkLiveRfq(result, request, attestationPubkey);
      return result;
    } catch (error) { return invalidResponse(error); }
  }
  /** Check signed quotes and prepare the winner's unsigned transaction. */
  async settleLiveAuction(input: LiveAuctionInput, policy: LiveExecutionPolicy, trustedSolvers: readonly LiveSolver[]) {
    const body = structuredClone(input);
    const trusted = structuredClone(trustedSolvers);
    const trust = { ...policy, vault: policy.vault && structuredClone(policy.vault) };
    try {
      const { rfq, rfqSig } = body;
      const rfqHash = liveAuctionHash('fuse-rfq/v1', rfq);
      checkLiveRfq({ rfq, rfqHash, rfqSig, attestationPubkey: trust.attestationPubkey, solvers: [] },
        { address: rfq.address, units: BigInt(rfq.units), vaultId: rfq.vaultId ?? undefined }, trust.attestationPubkey);
      mainnetWallet(rfq.address);
      checkLiveQuotes(body, trusted);
      const result = await this.request<LiveAuctionResult>('/api/live/auction/settle', { body });
      verifyLiveAuction(result, body, trust, trusted);
      return result;
    } catch (error) { return invalidResponse(error); }
  }
  async liveReceipt(input: LiveReceiptInput) {
    const body = structuredClone(input);
    const receipt = await this.request<LiveReceipt>('/api/live/certificate', { body });
    requireLive(receipt?.certificate?.network === 'mainnet' && receipt.certificate.transactions.length === 1 &&
      receipt.certificate.transactions[0].txid === body.txid, 'Receipt describes a different network or transaction.');
    return receipt;
  }
  /** Re-derive the receipt using this deployment's chain reader and configured attestation key. */
  verifyLiveReceipt(input: LiveIntentEvidence & { certificate: Certificate }) {
    const { certificate, authorization, userSignature } = input;
    requireLive(certificate.network === 'mainnet', 'Use a BCH mainnet certificate.', 'NETWORK_MISMATCH', 400);
    return this.request<CertificateVerification>('/api/live/verify-certificate', { body: { certificate, authorization, userSignature } });
  }
  verifyLiveReceiptLocally(input: LiveIntentEvidence & { certificate: Certificate }, reader: ChainReader,
    options: { attestationPubkey: string; vaults: readonly LiveVaultIdentity[] }) {
    requireLive(input.certificate.network === 'mainnet' && reader.network === 'mainnet', 'A BCH mainnet certificate and reader are required.', 'NETWORK_MISMATCH', 400);
    return verifyCertificate(input.certificate, reader, {
      rederive: liveReceiptRederiver(options.vaults),
      intent: liveIntentBinder(input, options.attestationPubkey),
    });
  }
  // ---- certificates ----
  certificate(id: string) { return this.request<Certificate>(`/api/certificates/${id}`); }
  /** A ChainReader that fetches raw transactions from the FUSE explorer. The verifier re-hashes every raw tx, so
   *  a lying explorer can only make verification FAIL, never pass. Use an independent indexer for mainnet. */
  explorerReader(): ChainReader {
    return { network: 'local', getRawTransaction: async (txid) => { try { const r = await this.request<{ raw: string }>(`/api/explorer/${txid}`); return { rawHex: r.raw, blockHeight: null, blockHash: null }; } catch { return null; } }, tipHeight: async () => 0 };
  }
  /** Independent, client-side certificate verification. */
  async verifyLocally(cert: Certificate, reader: ChainReader = this.explorerReader(), options?: Parameters<typeof verifyCertificate>[2]): Promise<CertificateVerification> {
    return verifyCertificate(cert, reader, options);
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
export { recipeHash, structure, PRESETS, type Recipe } from '@fuse/recipes';
