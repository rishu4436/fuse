// In-process LOCAL execution world. All value here is SIMULATED on a MockNetworkProvider that runs the
// real BCH 2026 VM against the real compiled contract bytecode. Mainnet data is served READ-ONLY from
// evidence snapshots captured by scripts/verification (each response carries its capture time).
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { binToHex } from '@bitauth/libauth';
import { AuctionEngine, slidingWindowLimiter, type AuctionRecord } from '@fuse/auction';
import { createLocalMarket, liveMarketView, utxosOf, type LocalMarket } from '@fuse/simulation';
import { decodeVaultState } from '@fuse/contracts';
import { signInputs } from '@fuse/transaction-composer';
import { verifyCertificate, mockChainReader, certificateToHtml, type Certificate } from '@fuse/proof-verifier';
import { commitment } from '@fuse/core';
import { ShardManager, type ShardRef } from '@fuse/flash-liquidity';
import { FuseStore } from '@fuse/store';

export type FuseEvent = { id: number; at: number; type: string; detail: string; auctionId?: string };

export class FuseState {
  market: LocalMarket = createLocalMarket();
  /** F30: one shard lease coordinator per vault, shared by the auction engine and the liquidity API. */
  shards = new ShardManager(this.market.vaultParams, [], { leaseTtlMs: 60_000, maxLeasesPerHolder: 4 });
  engine = this.newEngine();
  private newEngine() { return new AuctionEngine({ bidRateLimiter: slidingWindowLimiter(20, 60_000), leases: this.shards, leaseTtlMs: 60_000 }); }
  async shardRefs(): Promise<ShardRef[]> { const m = this.market; return (await m.provider.getUtxos(m.vault.tokenAddress)).filter((u) => u.token?.nft && u.token.category === m.vaultParams.vaultCategory).map((u) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis, commitment: u.token!.nft!.commitment })); }
  async syncShards() { this.shards.sync(await this.shardRefs()); return this.shards; }
  certificates = new Map<string, Certificate>();
  /** Certificates persisted by a PREVIOUS API session. The LOCAL mock chain is in-memory and resets on restart,
   *  so these are shown as history and cannot be re-verified against the current local chain. */
  restoredCertificates = new Map<string, Certificate>();
  readonly store: FuseStore;
  /** bid receive times (ms) for solver latency in the F32 ledger */
  bidReceivedAt = new Map<string, number>();
  events: FuseEvent[] = [];
  listeners = new Set<(e: FuseEvent) => void>();
  private seq = 0;
  readonly startedAt = Date.now();
  constructor(readonly root: string, readonly opts: { auctionWindowSeconds: number; store?: FuseStore }) {
    this.store = opts.store ?? new FuseStore(':memory:');
    for (const r of this.store.listCertificates<Certificate>()) if (r.restored) this.restoredCertificates.set(r.certificate.certificateId, r.certificate);
  }

  emit(type: string, detail: string, auctionId?: string) {
    const e = { id: ++this.seq, at: Date.now(), type, detail, auctionId };
    this.events.push(e); if (this.events.length > 500) this.events.shift();
    for (const l of this.listeners) l(e);
  }

  reset() { const solvers = [...this.engine.solvers.values()]; this.market = createLocalMarket(); this.shards = new ShardManager(this.market.vaultParams, [], { leaseTtlMs: 60_000, maxLeasesPerHolder: 4 }); this.engine = this.newEngine(); for (const s of solvers) this.engine.registerSolver(s.pubkey, s.strategy, s.name); this.certificates.clear(); this.emit('WORLD_RESET', 'local world reset to genesis fixture'); }

  evidence(name: 'cauldron' | 'paryon' | 'moria-replay') {
    const f = resolve(this.root, 'evidence', name === 'cauldron' ? 'cauldron-pool-verification.json' : name === 'paryon' ? 'paryon-deployment-verification.json' : 'moria-historical-replay.json');
    if (!existsSync(f)) return null;
    return JSON.parse(readFileSync(f, 'utf8'));
  }

  async vault() {
    const m = this.market;
    const shards = (await m.provider.getUtxos(m.vault.tokenAddress)).filter((u) => u.token?.nft);
    return {
      network: 'local', simulated: true, address: m.vault.tokenAddress, lockingBytecode: m.vault.lockingBytecode, params: m.vaultParams,
      shards: shards.map((s) => ({ outpoint: `${s.txid}:${s.vout}`, satoshis: s.satoshis, state: decodeVaultState(s.token!.nft!.commitment) })),
      totalSats: shards.reduce((x, s) => x + s.satoshis, 0n),
      cumulativeFees: shards.reduce((x, s) => x + decodeVaultState(s.token!.nft!.commitment).cumulativeFees, 0n),
      flashCount: shards.reduce((x, s) => x + decodeVaultState(s.token!.nft!.commitment).flashCount, 0n),
    };
  }

  async openSwap(minOut: bigint, maxIn: bigint, maxFee: bigint) {
    const m = this.market;
    const coins = (await utxosOf(m, m.user.address)).filter((c) => !c.token);
    const now = Math.floor(Date.now() / 1000);
    const body = { type: 'TOKEN_SWAP' as const, owner: { lockingBytecode: m.user.lockingBytecode, coins }, buyToken: m.token, minOut, maxIn, maxFee, deadline: now + 600 };
    const intentCommitment = commitment('intent/v1', { ...body, owner: { lockingBytecode: body.owner.lockingBytecode } });
    const intent = { ...body, intentId: 'intent_' + intentCommitment.slice(0, 16), intentCommitment };
    const a = this.engine.open(intent, await liveMarketView(m), this.opts.auctionWindowSeconds);
    this.store.putIntent({ id: intent.intentId, commitment: intentCommitment, type: 'TOKEN_SWAP', network: 'local', body: { minOut, maxIn, maxFee, deadline: body.deadline, owner: body.owner.lockingBytecode } });
    this.persistAuction(a);
    this.emit('AUCTION_OPENED', `buy ${minOut} FUSD for ≤ ${maxIn} sats`, a.auctionId);
    return a;
  }

  /** Close expired auctions, have the LOCAL demo wallet sign, and settle when all signatures are in. */
  async tick() {
    const now = Math.floor(Date.now() / 1000);
    for (const a of this.engine.auctions.values()) {
      if (a.status === 'OPEN' && a.closesAt <= now) {
        await this.syncShards();
        this.engine.close(a.auctionId);
        if (a.leases?.length) this.emit('SHARD_LEASED', `F30: ${a.leases.length} shard lease(s) held for the winner`, a.auctionId);
        for (const e of a.evaluated) if (e.reasons.some((r) => r.startsWith('F30'))) this.emit('BID_LEASE_CONFLICT', `${e.bid.strategy}: ${e.reasons.find((r) => r.startsWith('F30'))}`, a.auctionId);
        for (const e of a.evaluated) this.emit(e.valid ? 'BID_VERIFIED' : 'BID_REJECTED', `${e.bid.strategy}: ${e.valid ? `user net ${e.actual!.userNetSpendSats} sats` : e.reasons.join('; ')}`, a.auctionId);
        this.ledgerAfterClose(a);
        this.persistAuction(a);
        if (a.winner) { this.emit('WINNER_SELECTED', `${a.winner.bid.strategy} (${a.winner.bid.solverId})`, a.auctionId); this.userSign(a); }
        else this.emit('AUCTION_FAILED', a.error ?? 'no valid bids', a.auctionId);
      }
      if (a.status === 'AWAITING_SIGNATURES') {
        const missing = this.engine.requiredSigners(a.auctionId).filter((s) => !a.signatures.has(s));
        if (!missing.length) await this.settle(a);
        else if (a.closesAt + 20 < now) { const old = a.winner; this.engine.fallback(a.auctionId, `signers ${missing.join(',')} timed out`); if (old) this.store.appendLedger({ solverId: old.bid.solverId, auctionId: a.auctionId, outcome: 'FALLBACK', reason: `signers ${missing.join(',')} timed out`, at: Date.now() }); this.persistAuction(a); this.emit('FALLBACK', `promoted ${a.winner?.bid.strategy ?? 'none'}`, a.auctionId); if (a.winner) this.userSign(a); }
      }
    }
  }

  persistAuction(a: AuctionRecord) {
    this.store.putAuction({ id: a.auctionId, intentId: a.intent.intentId, status: a.status, winnerSolver: a.winner?.bid.solverId, txid: a.txid, summary: { status: a.status, error: a.error, minOut: a.intent.minOut, maxIn: a.intent.maxIn, bids: a.evaluated.length || a.bids.length, winner: a.winner?.bid.strategy, certificateId: a.certificate?.certificateId, openedAt: a.openedAt } });
  }
  private latency(a: AuctionRecord, solverId: string) { const t = this.bidReceivedAt.get(`${a.auctionId}:${solverId}`); return t ? Math.max(0, t - a.openedAt * 1000) : undefined; }
  /** Verified saving vs the next best valid bid (0 when the winner was the only valid bid). */
  private improvement(a: AuctionRecord) {
    const others = a.evaluated.filter((e) => e.valid && e !== a.winner && e.actual).map((e) => e.actual!.userNetSpendSats).sort((x, y) => (x < y ? -1 : 1));
    return others.length && a.winner?.actual ? others[0] - a.winner.actual.userNetSpendSats : 0n;
  }
  /** F32: one ledger row per evaluated bid, computed from the coordinator's own verification. */
  private ledgerAfterClose(a: AuctionRecord) {
    for (const e of a.evaluated) {
      if (e === a.winner) continue; // recorded at settlement (WIN / SETTLE_FAILED)
      const lease = e.reasons.find((r) => r.startsWith('F30'));
      this.store.appendLedger({ solverId: e.bid.solverId, auctionId: a.auctionId, outcome: lease ? 'LEASE_CONFLICT' : e.valid ? 'LOSS' : 'REJECTED', reason: lease ?? (e.valid ? `rank ${e.rank}` : e.reasons.join('; ')), userNetSpendSats: e.actual?.userNetSpendSats, latencyMs: this.latency(a, e.bid.solverId), at: Date.now() });
    }
  }

  private userSign(a: AuctionRecord) {
    // LOCAL demo wallet: a deterministic fixture key that holds only simulated coins. A real wallet signs
    // via WizardConnect in the Studio; this key never touches mainnet or chipnet.
    if (this.engine.requiredSigners(a.auctionId).includes('user')) {
      this.engine.addSignatures(a.auctionId, 'user', signInputs(a.winner!.bid.template, 'user', this.market.user.priv));
      this.emit('USER_SIGNED', 'LOCAL demo wallet signed its inputs (SIGHASH_ALL|FORKID|UTXOS)', a.auctionId);
    }
  }

  private async settle(a: AuctionRecord) {
    const r = await this.engine.settle(a.auctionId, (raw) => this.market.provider.sendRawTransaction(raw), { network: 'local', simulated: true, intentCommitment: a.intent.intentCommitment, policyCommitment: null });
    await this.syncShards();
    this.persistAuction(r);
    if (r.winner) this.store.appendLedger(r.status === 'SETTLED'
      ? { solverId: r.winner.bid.solverId, auctionId: r.auctionId, outcome: 'WIN', userNetSpendSats: r.winner.actual?.userNetSpendSats, improvementSats: this.improvement(r), revenueSats: r.winner.bid.claims.solverFeeSats, latencyMs: this.latency(r, r.winner.bid.solverId), at: Date.now() }
      : { solverId: r.winner.bid.solverId, auctionId: r.auctionId, outcome: 'SETTLE_FAILED', reason: r.error, at: Date.now() });
    if (r.status === 'SETTLED' && r.certificate) {
      this.certificates.set(r.certificate.certificateId, r.certificate);
      this.store.putCertificate(r.certificate);
      this.emit('TX_ACCEPTED', `LOCAL mock chain accepted ${r.txid}`, a.auctionId);
      this.emit('CERTIFICATE_ISSUED', r.certificate.certificateId, a.auctionId);
    } else this.emit('SETTLEMENT_FAILED', r.error ?? 'unknown', a.auctionId);
  }

  async verify(cert: unknown) { return verifyCertificate(JSON.parse(JSON.stringify(cert, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))), mockChainReader(this.market.provider)); }
  html(c: Certificate, v?: Awaited<ReturnType<FuseState['verify']>>) { return certificateToHtml(c, v); }

  async chainUtxos(address: string) { return utxosOf(this.market, address); }
  get demoAddresses() { const m = this.market; return { user: m.user.address, vault: m.vault.tokenAddress, poolA: m.pools.A.contract.tokenAddress, poolB: m.pools.B.contract.tokenAddress, solvers: Object.fromEntries(Object.entries(m.solvers).map(([k, s]) => [k, { address: s.address, pubkey: binToHex(s.pub) }])) }; }
}

export function serializeAuction(a: AuctionRecord) {
  return {
    auctionId: a.auctionId, status: a.status, openedAt: a.openedAt, closesAt: a.closesAt, intent: a.intent, error: a.error, txid: a.txid,
    certificateId: a.certificate?.certificateId, events: a.events,
    bids: a.evaluated.length
      ? a.evaluated.map((e) => ({ solverId: e.bid.solverId, strategy: e.bid.strategy, valid: e.valid, reasons: e.reasons, rank: e.rank, claims: e.bid.claims, actual: e.actual, explanation: e.bid.explanation, template: e.bid.template, templateHash: e.bid.templateHash, winner: a.winner?.bid === e.bid, verification: e.verification }))
      : a.bids.map((b) => ({ solverId: b.solverId, strategy: b.strategy, valid: null, claims: b.claims, explanation: b.explanation, templateHash: b.templateHash })),
    simulated: true, network: 'local',
  };
}
