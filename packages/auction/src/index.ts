// Intent auction engine: validate → collect authenticated bids → independently verify each template in
// the BCH VM → recompute the user's outcome from the template (ignoring solver claims) → rank → select →
// collect signatures → final verification → broadcast → certificate. Solver reputation is never used as
// evidence of validity.
import { commitment, FuseError } from '@fuse/core';
import {
  contractUnlocks, finalize, verifyTemplateAndRaw, sourceOutputsOf, toUnsignedTransaction, contractLockingBytecode, templateHash,
  type TxTemplate, type VerificationReport,
} from '@fuse/transaction-composer';
import { verifyBidSignature, solverIdOf, type Bid, type MarketView, type SwapIntentView } from '@fuse/solver-sdk';
import { sealCertificate, type Certificate } from '@fuse/proof-verifier';
import { createVirtualMachineBch2026, hexToBin, encodeTransaction, binToHex } from '@bitauth/libauth';

export interface EvaluatedBid {
  bid: Bid;
  valid: boolean;
  reasons: string[];
  /** Recomputed from the template, not from the solver's claims. */
  actual?: { userReceivesTokens: bigint; userNetSpendSats: bigint; minerFeeSats: bigint };
  verification?: VerificationReport;
  rank?: number;
}

export interface AuctionRecord {
  auctionId: string;
  intent: SwapIntentView;
  market: MarketView;
  openedAt: number;
  closesAt: number;
  status: 'OPEN' | 'EVALUATING' | 'AWAITING_SIGNATURES' | 'BROADCAST' | 'SETTLED' | 'FAILED' | 'EXPIRED';
  bids: Bid[];
  evaluated: EvaluatedBid[];
  winner?: EvaluatedBid;
  signatures: Map<string, Map<number, string>>; // signer -> input -> unlocking
  rawTx?: string;
  txid?: string;
  certificate?: Certificate;
  events: Array<{ at: number; type: string; detail: string }>;
  error?: string;
}

export interface RateLimiter { allow(key: string): boolean }
export function slidingWindowLimiter(max: number, windowMs: number, now = () => Date.now()): RateLimiter {
  const hits = new Map<string, number[]>();
  return { allow(key) { const t = now(); const h = (hits.get(key) ?? []).filter((x) => x > t - windowMs); if (h.length >= max) { hits.set(key, h); return false; } h.push(t); hits.set(key, h); return true; } };
}

/** Recompute what the owner receives/spends by reading the template outputs and inputs. */
export function recomputeOutcome(t: TxTemplate, ownerLb: string, token: string) {
  const recvTokens = t.outputs.filter((o) => o.lockingBytecode === ownerLb && o.token?.category === token).reduce((s, o) => s + (o.token?.amount ?? 0n), 0n);
  const recvSats = t.outputs.filter((o) => o.lockingBytecode === ownerLb).reduce((s, o) => s + o.satoshis, 0n);
  const spentSats = t.inputs.filter((i) => i.lockingBytecode === ownerLb).reduce((s, i) => s + i.satoshis, 0n);
  const inSats = t.inputs.reduce((s, i) => s + i.satoshis, 0n);
  const outSats = t.outputs.reduce((s, o) => s + o.satoshis, 0n);
  return { userReceivesTokens: recvTokens, userNetSpendSats: spentSats - recvSats, minerFeeSats: inSats - outSats };
}

/** Dry-run VM verification of an unsigned template: covenant inputs are fully evaluated; P2PKH inputs
 *  are excluded (signatures do not exist yet) and are verified again after signing. */
export function dryRunCovenants(t: TxTemplate): { ok: boolean; detail: string } {
  const unlocks = contractUnlocks(t);
  const tx = toUnsignedTransaction(t);
  for (const [i, u] of unlocks) tx.inputs[i].unlockingBytecode = hexToBin(u);
  const vm = createVirtualMachineBch2026();
  const sourceOutputs = sourceOutputsOf(t);
  for (const i of unlocks.keys()) {
    const state = vm.evaluate({ inputIndex: i, sourceOutputs, transaction: tx });
    const ok = vm.stateSuccess(state);
    if (ok !== true) return { ok: false, detail: `input ${i}: ${ok}` };
  }
  return { ok: true, detail: `${unlocks.size} covenant input(s) valid` };
}

export function evaluateBid(a: AuctionRecord, bid: Bid, now: number): EvaluatedBid {
  const reasons: string[] = [];
  const sig = verifyBidSignature(bid);
  if (!sig.ok) reasons.push(`signature: ${sig.reason}`);
  if (solverIdOf(bid.solverPubkey) !== bid.solverId) reasons.push('solverId does not match pubkey');
  if (bid.auctionId !== a.auctionId) reasons.push('wrong auction');
  if (bid.expiresAt <= now) reasons.push('quote expired');
  if (a.intent.deadline <= now) reasons.push('intent deadline passed');
  const t = bid.template;
  // Contract identity: every covenant input must be exactly the declared, known contract.
  t.inputs.forEach((inp, i) => {
    const exp = contractLockingBytecode(inp.unlock);
    if (exp && exp !== inp.lockingBytecode) reasons.push(`input ${i} contract identity mismatch`);
    if (inp.unlock.kind === 'p2pkh' && inp.unlock.signer === 'user' && inp.lockingBytecode !== a.intent.owner.lockingBytecode) reasons.push(`input ${i} assigned to user but not owned by user`);
  });
  // Inputs must exist in the current market/owner view (stale UTXO detection).
  const known = new Set([
    ...a.market.pools.map((p) => `${p.utxo.txid}:${p.utxo.vout}`),
    ...a.market.vault.shards.map((s) => `${s.txid}:${s.vout}`),
    ...a.intent.owner.coins.map((c) => `${c.txid}:${c.vout}`),
  ]);
  t.inputs.filter((i) => i.role !== 'solver').forEach((i) => { if (!known.has(`${i.txid}:${i.vout}`)) reasons.push(`stale or unknown input ${i.txid.slice(0, 8)}:${i.vout}`); });
  const actual = recomputeOutcome(t, a.intent.owner.lockingBytecode, a.intent.buyToken);
  if (actual.userReceivesTokens < a.intent.minOut) reasons.push(`delivers ${actual.userReceivesTokens} tokens < minOut ${a.intent.minOut}`);
  if (actual.userNetSpendSats > a.intent.maxIn) reasons.push(`user net spend ${actual.userNetSpendSats} > maxIn ${a.intent.maxIn}`);
  if (actual.minerFeeSats > a.intent.maxFee) reasons.push(`miner fee ${actual.minerFeeSats} > maxFee ${a.intent.maxFee}`);
  if (actual.minerFeeSats < 0n) reasons.push('outputs exceed inputs');
  if (bid.claims.userReceivesTokens !== actual.userReceivesTokens) reasons.push(`claim mismatch: claims ${bid.claims.userReceivesTokens} tokens, template delivers ${actual.userReceivesTokens}`);
  let dry = { ok: false, detail: 'not run' };
  try { dry = dryRunCovenants(t); } catch (e) { dry = { ok: false, detail: (e as Error).message }; }
  if (!dry.ok) reasons.push(`BCH VM covenant dry-run failed: ${dry.detail}`);
  return { bid, valid: reasons.length === 0, reasons, actual };
}

/** Rank valid bids: lowest verified user net spend, then lower miner fee, then earlier submission. */
export function rank(evals: EvaluatedBid[]): EvaluatedBid[] {
  const valid = evals.filter((e) => e.valid).sort((x, y) => (x.actual!.userNetSpendSats < y.actual!.userNetSpendSats ? -1 : x.actual!.userNetSpendSats > y.actual!.userNetSpendSats ? 1 : x.actual!.minerFeeSats < y.actual!.minerFeeSats ? -1 : 1));
  valid.forEach((e, i) => { e.rank = i + 1; });
  return valid;
}

export class AuctionEngine {
  readonly auctions = new Map<string, AuctionRecord>();
  readonly solvers = new Map<string, { solverId: string; pubkey: string; strategy: string; name: string; bids: number; wins: number; rejected: number; revenueSats: bigint; registeredAt: number }>();
  private seenNonces = new Set<string>();
  constructor(private readonly opts: { bidRateLimiter?: RateLimiter; now?: () => number } = {}) {}
  private now() { return this.opts.now?.() ?? Math.floor(Date.now() / 1000); }

  registerSolver(pubkey: string, strategy: string, name: string) {
    if (!/^[0-9a-f]{66}$/.test(pubkey)) throw new FuseError('BAD_PUBKEY', 'solver pubkey must be 33-byte hex');
    const solverId = solverIdOf(pubkey);
    if (!this.solvers.has(solverId)) this.solvers.set(solverId, { solverId, pubkey, strategy, name, bids: 0, wins: 0, rejected: 0, revenueSats: 0n, registeredAt: this.now() });
    return { solverId };
  }

  open(intent: Omit<SwapIntentView, 'auctionId'>, market: MarketView, windowSeconds = 6): AuctionRecord {
    if (intent.deadline <= this.now()) throw new FuseError('DEADLINE_PASSED', 'intent deadline passed');
    if (intent.minOut <= 0n || intent.maxIn <= 0n) throw new FuseError('BAD_INTENT', 'minOut and maxIn must be positive');
    const auctionId = 'auc_' + commitment('auction-id', { ...intent, t: this.now() }).slice(0, 20);
    const rec: AuctionRecord = { auctionId, intent: { ...intent, auctionId }, market, openedAt: this.now(), closesAt: this.now() + windowSeconds, status: 'OPEN', bids: [], evaluated: [], signatures: new Map(), events: [] };
    rec.events.push({ at: this.now(), type: 'AUCTION_OPENED', detail: `intent ${intent.intentId}` });
    this.auctions.set(auctionId, rec);
    return rec;
  }

  openAuctions() { return [...this.auctions.values()].filter((a) => a.status === 'OPEN' && a.closesAt > this.now()); }

  submitBid(bid: Bid): { accepted: boolean; reason?: string } {
    const a = this.auctions.get(bid.auctionId);
    if (!a) return { accepted: false, reason: 'unknown auction' };
    if (a.status !== 'OPEN' || a.closesAt <= this.now()) return { accepted: false, reason: 'auction closed' };
    if (!this.solvers.has(bid.solverId)) return { accepted: false, reason: 'solver not registered' };
    if (this.opts.bidRateLimiter && !this.opts.bidRateLimiter.allow(bid.solverId)) return { accepted: false, reason: 'rate limited' };
    const nonceKey = `${bid.solverId}:${bid.nonce}`;
    if (this.seenNonces.has(nonceKey)) return { accepted: false, reason: 'replayed nonce' };
    if (a.bids.filter((b) => b.solverId === bid.solverId).length >= 3) return { accepted: false, reason: 'per-solver bid limit' };
    const sig = verifyBidSignature(bid);
    if (!sig.ok) return { accepted: false, reason: sig.reason };
    this.seenNonces.add(nonceKey);
    a.bids.push(bid);
    this.solvers.get(bid.solverId)!.bids++;
    a.events.push({ at: this.now(), type: 'BID_RECEIVED', detail: `${bid.solverId} (${bid.strategy})` });
    return { accepted: true };
  }

  /** Close bidding, verify every bid independently, rank, select. */
  close(auctionId: string): AuctionRecord {
    const a = this.mustGet(auctionId);
    if (a.status !== 'OPEN') return a;
    a.status = 'EVALUATING';
    a.evaluated = a.bids.map((b) => evaluateBid(a, b, this.now()));
    for (const e of a.evaluated) if (!e.valid) { this.solvers.get(e.bid.solverId)!.rejected++; a.events.push({ at: this.now(), type: 'BID_REJECTED', detail: `${e.bid.solverId}: ${e.reasons.join('; ')}` }); }
    const ranked = rank(a.evaluated);
    if (!ranked.length) { a.status = 'FAILED'; a.error = 'no valid bids'; a.events.push({ at: this.now(), type: 'AUCTION_FAILED', detail: 'no valid bids' }); return a; }
    a.winner = ranked[0];
    a.status = 'AWAITING_SIGNATURES';
    a.events.push({ at: this.now(), type: 'WINNER_SELECTED', detail: `${a.winner.bid.solverId} net spend ${a.winner.actual!.userNetSpendSats}` });
    return a;
  }

  /** Fallback (F31): drop the current winner (e.g. failed to sign / conflicted) and promote the next valid bid. */
  fallback(auctionId: string, reason: string): AuctionRecord {
    const a = this.mustGet(auctionId);
    const ranked = rank(a.evaluated).filter((e) => e.bid.solverId !== a.winner?.bid.solverId);
    a.events.push({ at: this.now(), type: 'FALLBACK', detail: reason });
    if (a.winner) a.evaluated = a.evaluated.map((e) => (e === a.winner ? { ...e, valid: false, reasons: [...e.reasons, `fallback: ${reason}`] } : e));
    a.winner = ranked[0];
    a.signatures = new Map();
    if (!a.winner) { a.status = 'FAILED'; a.error = `fallback exhausted: ${reason}`; }
    return a;
  }

  addSignatures(auctionId: string, signer: string, unlocks: Map<number, string>) {
    const a = this.mustGet(auctionId);
    if (a.status !== 'AWAITING_SIGNATURES' || !a.winner) throw new FuseError('NOT_AWAITING', 'auction is not awaiting signatures');
    const allowed = a.winner.bid.template.inputs.map((inp, i) => [i, inp] as const).filter(([, inp]) => inp.unlock.kind === 'p2pkh' && inp.unlock.signer === signer).map(([i]) => i);
    for (const k of unlocks.keys()) if (!allowed.includes(k)) throw new FuseError('NOT_YOUR_INPUT', `${signer} may not unlock input ${k}`);
    a.signatures.set(signer, unlocks);
    a.events.push({ at: this.now(), type: 'SIGNATURES_RECEIVED', detail: `${signer}: inputs ${[...unlocks.keys()].join(',')}` });
  }

  requiredSigners(auctionId: string): string[] {
    const a = this.mustGet(auctionId);
    return [...new Set((a.winner?.bid.template.inputs ?? []).flatMap((i) => (i.unlock.kind === 'p2pkh' ? [i.unlock.signer] : [])))];
  }

  /** Assemble, re-verify the exact signed transaction, and hand it to `broadcast`. */
  async settle(auctionId: string, broadcast: (raw: string) => Promise<string>, meta: { network: 'local' | 'chipnet' | 'mainnet'; simulated: boolean; intentCommitment: string; policyCommitment: string | null }): Promise<AuctionRecord> {
    const a = this.mustGet(auctionId);
    if (!a.winner) throw new FuseError('NO_WINNER', 'no winner');
    const missing = this.requiredSigners(auctionId).filter((s) => !a.signatures.has(s));
    if (missing.length) throw new FuseError('MISSING_SIGNATURES', `missing: ${missing.join(',')}`, true);
    const t = a.winner.bid.template;
    const raw = finalize(t, contractUnlocks(t), ...a.signatures.values());
    const vaultInputs = t.inputs.map((inp, i) => [i, inp] as const).filter(([, inp]) => inp.unlock.kind === 'flashvault-bch').map(([i, inp]) => ({ inputIndex: i, minReturn: inp.satoshis + 1n, asset: 'BCH' as const }));
    const report = verifyTemplateAndRaw(t, raw, { ownerLockingBytecode: a.intent.owner.lockingBytecode, minOwnerReceive: { asset: a.intent.buyToken, amount: a.intent.minOut }, maxOwnerSpend: { asset: 'BCH', amount: a.intent.maxIn }, maxMinerFee: a.intent.maxFee, vaultInputs, requireStrongSighash: true });
    a.winner.verification = report;
    if (!report.ok) { a.status = 'FAILED'; a.error = 'final verification failed: ' + report.checks.filter((c) => !c.ok).map((c) => c.name).join(','); a.events.push({ at: this.now(), type: 'VERIFICATION_FAILED', detail: a.error }); return a; }
    a.rawTx = raw;
    a.status = 'BROADCAST';
    a.events.push({ at: this.now(), type: 'BROADCAST_ATTEMPTED', detail: report.txid });
    try {
      a.txid = await broadcast(raw);
    } catch (e) {
      a.status = 'FAILED'; a.error = `broadcast rejected: ${(e as Error).message}`;
      a.events.push({ at: this.now(), type: 'TX_CONFLICTED', detail: a.error });
      return a;
    }
    if (a.txid !== report.txid) throw new FuseError('TXID_MISMATCH', 'broadcast returned a different txid');
    a.status = 'SETTLED';
    const s = this.solvers.get(a.winner.bid.solverId)!;
    s.wins++; s.revenueSats += a.winner.bid.claims.solverFeeSats;
    a.events.push({ at: this.now(), type: 'TX_ACCEPTED', detail: `${a.txid} (${meta.simulated ? 'LOCAL mock network' : meta.network})` });
    a.certificate = sealCertificate({
      schema: 'fuse.certificate/v1', certificateId: 'cert_' + a.txid.slice(0, 24), intentId: a.intent.intentId, intentCommitment: meta.intentCommitment, policyCommitment: meta.policyCommitment,
      network: meta.network, executionClass: 'ATOMIC_SINGLE_TX', solverId: a.winner.bid.solverId, quoteCommitment: commitment('quote/v1', { templateHash: templateHash(t), claims: a.winner.bid.claims }),
      contracts: t.inputs.filter((i) => i.unlock.kind !== 'p2pkh').map((i) => ({ role: i.role, name: i.unlock.kind, lockingBytecode: i.lockingBytecode })),
      transactions: [{ txid: a.txid, blockHeight: null, blockHash: null }],
      inputs: t.inputs.map((i) => ({ txid: a.txid!, outpoint: `${i.txid}:${i.vout}` })),
      outputs: t.outputs.map((o, vout) => ({ txid: a.txid!, vout, lockingBytecode: o.lockingBytecode, satoshis: o.satoshis, token: o.token, role: o.role })),
      vaultContinuations: vaultInputs.map((v) => ({ txid: a.txid!, inputIndex: v.inputIndex, minReturn: v.minReturn, asset: 'BCH' })),
      fees: { minerFeeSats: report.minerFee, liquidityFee: a.winner.bid.claims.liquidityFeeSats, solverFee: a.winner.bid.claims.solverFeeSats },
      outcome: { ownerLockingBytecode: a.intent.owner.lockingBytecode, ownerReceives: [{ asset: a.intent.buyToken, amount: a.winner.actual!.userReceivesTokens }] },
      checks: report.checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
      confirmation: meta.simulated ? 'LOCAL_ACCEPTED' : 'UNCONFIRMED', simulated: meta.simulated, issuedAt: this.now(), issuer: 'fuse-coordinator',
    });
    return a;
  }

  private mustGet(id: string) { const a = this.auctions.get(id); if (!a) throw new FuseError('UNKNOWN_AUCTION', id); return a; }
}

export const rawTxIsUnsignedEqual = (raw: string, t: TxTemplate) => binToHex(encodeTransaction(toUnsignedTransaction(t))) === raw;
