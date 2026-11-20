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

export type FuseEvent = { id: number; at: number; type: string; detail: string; auctionId?: string };

export class FuseState {
  market: LocalMarket = createLocalMarket();
  engine = new AuctionEngine({ bidRateLimiter: slidingWindowLimiter(20, 60_000) });
  certificates = new Map<string, Certificate>();
  events: FuseEvent[] = [];
  listeners = new Set<(e: FuseEvent) => void>();
  private seq = 0;
  readonly startedAt = Date.now();
  constructor(readonly root: string, readonly opts: { auctionWindowSeconds: number }) {}

  emit(type: string, detail: string, auctionId?: string) {
    const e = { id: ++this.seq, at: Date.now(), type, detail, auctionId };
    this.events.push(e); if (this.events.length > 500) this.events.shift();
    for (const l of this.listeners) l(e);
  }

  reset() { this.market = createLocalMarket(); this.engine = new AuctionEngine({ bidRateLimiter: slidingWindowLimiter(20, 60_000) }); this.certificates.clear(); this.emit('WORLD_RESET', 'local world reset to genesis fixture'); }

  evidence(name: 'cauldron' | 'paryon') {
    const f = resolve(this.root, 'evidence', name === 'cauldron' ? 'cauldron-pool-verification.json' : 'paryon-deployment-verification.json');
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
    this.emit('AUCTION_OPENED', `buy ${minOut} FUSD for ≤ ${maxIn} sats`, a.auctionId);
    return a;
  }

  /** Close expired auctions, have the LOCAL demo wallet sign, and settle when all signatures are in. */
  async tick() {
    const now = Math.floor(Date.now() / 1000);
    for (const a of this.engine.auctions.values()) {
      if (a.status === 'OPEN' && a.closesAt <= now) {
        this.engine.close(a.auctionId);
        for (const e of a.evaluated) this.emit(e.valid ? 'BID_VERIFIED' : 'BID_REJECTED', `${e.bid.strategy}: ${e.valid ? `user net ${e.actual!.userNetSpendSats} sats` : e.reasons.join('; ')}`, a.auctionId);
        if (a.winner) { this.emit('WINNER_SELECTED', `${a.winner.bid.strategy} (${a.winner.bid.solverId})`, a.auctionId); this.userSign(a); }
        else this.emit('AUCTION_FAILED', a.error ?? 'no valid bids', a.auctionId);
      }
      if (a.status === 'AWAITING_SIGNATURES') {
        const missing = this.engine.requiredSigners(a.auctionId).filter((s) => !a.signatures.has(s));
        if (!missing.length) await this.settle(a);
        else if (a.closesAt + 20 < now) { this.engine.fallback(a.auctionId, `signers ${missing.join(',')} timed out`); this.emit('FALLBACK', `promoted ${a.winner?.bid.strategy ?? 'none'}`, a.auctionId); if (a.winner) this.userSign(a); }
      }
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
    if (r.status === 'SETTLED' && r.certificate) {
      this.certificates.set(r.certificate.certificateId, r.certificate);
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
