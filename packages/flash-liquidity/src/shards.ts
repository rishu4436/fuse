// F36 Adaptive liquidity sharding + F30 UTXO reservation coordinator + F37 exposure caps.
// A shard is one UTXO: two concurrent flash operations can never share a shard, so the manager leases
// shards exclusively (with TTL) and plans a shard layout that matches observed demand.
import { FuseError } from '@fuse/core';
import { decodeVaultState, flashFee, type BchVaultParams } from '@fuse/contracts';

export interface ShardRef { txid: string; vout: number; satoshis: bigint; commitment: string }
export interface Lease { id: string; outpoint: string; satoshis: bigint; holder: string; expiresAt: number; fee: bigint }
export const outpointOf = (s: { txid: string; vout: number }) => `${s.txid}:${s.vout}`;

export interface ShardManagerOptions { leaseTtlMs?: number; maxLeasesPerHolder?: number; maxHolderExposure?: bigint; now?: () => number }

export class ShardManager {
  private shards = new Map<string, ShardRef>();
  private leases = new Map<string, Lease>(); // outpoint -> lease
  private seq = 0;
  readonly demand: bigint[] = [];
  constructor(readonly params: BchVaultParams, shards: ShardRef[], private o: ShardManagerOptions = {}) { this.sync(shards); }

  private get now() { return (this.o.now ?? Date.now)(); }
  /** Replace the shard set with the current chain view (keeps leases on shards that still exist). */
  sync(shards: ShardRef[]) {
    this.shards = new Map(shards.map((s) => [outpointOf(s), s]));
    for (const k of [...this.leases.keys()]) if (!this.shards.has(k)) this.leases.delete(k);
  }
  private sweep() { const t = this.now; for (const [k, l] of this.leases) if (l.expiresAt <= t) this.leases.delete(k); }
  available() { this.sweep(); return [...this.shards.values()].filter((s) => !this.leases.has(outpointOf(s)) && !decodeVaultState(s.commitment).paused && s.satoshis <= this.params.maxExposure); }

  /** Exclusive lease of the SMALLEST eligible shard that covers `need` (minimises idle capital and fee).
   *  Synchronous critical section: safe under any interleaving of async callers in one process. */
  reserve(need: bigint, holder: string): Lease {
    this.sweep();
    this.demand.push(need);
    if (need <= 0n) throw new FuseError('BAD_AMOUNT', 'need must be positive', false);
    const mine = [...this.leases.values()].filter((l) => l.holder === holder);
    if (mine.length >= (this.o.maxLeasesPerHolder ?? 2)) throw new FuseError('LEASE_LIMIT', `${holder} already holds ${mine.length} leases`, true);
    const cap = this.o.maxHolderExposure;
    const c = this.available().filter((s) => s.satoshis >= need).sort((a, b) => (a.satoshis < b.satoshis ? -1 : a.satoshis > b.satoshis ? 1 : 0))[0];
    if (!c) throw new FuseError('NO_SHARD', `no free shard ≥ ${need} sats (≤ maxExposure ${this.params.maxExposure})`, true);
    if (cap !== undefined && mine.reduce((s, l) => s + l.satoshis, 0n) + c.satoshis > cap) throw new FuseError('EXPOSURE_CAP', `${holder} exposure would exceed ${cap}`, true);
    const lease: Lease = { id: `lease_${++this.seq}`, outpoint: outpointOf(c), satoshis: c.satoshis, holder, expiresAt: this.now + (this.o.leaseTtlMs ?? 30_000), fee: flashFee(c.satoshis, this.params.feeBps, this.params.minFee) };
    this.leases.set(lease.outpoint, lease);
    return lease;
  }
  /** Exclusive lease of a SPECIFIC shard (used by the auction coordinator for a winning template).
   *  A lease held by `transferFrom` (e.g. the solver that pre-reserved it) is handed over atomically. */
  reserveExact(outpoint: string, holder: string, opts: { transferFrom?: string; ttlMs?: number } = {}): Lease {
    this.sweep();
    const s = this.shards.get(outpoint);
    if (!s) throw new FuseError('UNKNOWN_SHARD', `shard ${outpoint.slice(0, 12)}… is not in the current chain view`, true);
    if (decodeVaultState(s.commitment).paused) throw new FuseError('SHARD_PAUSED', `shard ${outpoint.slice(0, 12)}… is paused`, false);
    const cur = this.leases.get(outpoint);
    if (cur && cur.holder !== holder && cur.holder !== opts.transferFrom) throw new FuseError('SHARD_LEASED', `shard ${outpoint.slice(0, 12)}… is leased by ${cur.holder}`, true);
    const lease: Lease = { id: `lease_${++this.seq}`, outpoint, satoshis: s.satoshis, holder, expiresAt: this.now + (opts.ttlMs ?? this.o.leaseTtlMs ?? 30_000), fee: flashFee(s.satoshis, this.params.feeBps, this.params.minFee) };
    this.leases.set(outpoint, lease);
    return lease;
  }
  leaseOf(outpoint: string) { this.sweep(); return this.leases.get(outpoint); }
  release(lease: Lease) { const l = this.leases.get(lease.outpoint); if (l?.id === lease.id) this.leases.delete(lease.outpoint); }
  /** Settlement observed: the leased shard was replaced by its continuation output. */
  commit(lease: Lease, continuation: ShardRef) {
    const l = this.leases.get(lease.outpoint);
    if (l?.id !== lease.id) throw new FuseError('LEASE_LOST', `lease ${lease.id} no longer held`, false);
    this.leases.delete(lease.outpoint); this.shards.delete(lease.outpoint); this.shards.set(outpointOf(continuation), continuation);
  }
  leased() { this.sweep(); return [...this.leases.values()]; }
  all() { return [...this.shards.values()]; }

  /** Target layout from demand: one shard per demand quantile (p50, p80, p95, max) sized with headroom,
   *  constrained by total liquidity and maxExposure. Returns the split/merge plan to reach it. */
  plan(opts: { headroomBps?: bigint; minShard?: bigint } = {}) { return planLayout(this.all(), this.demand, this.params.maxExposure, opts); }
}

export interface LayoutPlan { target: bigint[]; merge: string[][]; split: Array<{ outpoint: string; into: bigint[] }>; rationale: string }
export function planLayout(shards: ShardRef[], demand: bigint[], maxExposure: bigint, opts: { headroomBps?: bigint; minShard?: bigint } = {}): LayoutPlan {
  const total = shards.reduce((s, x) => s + x.satoshis, 0n);
  const minShard = opts.minShard ?? 1_000_000n;
  if (!demand.length) return { target: shards.map((s) => s.satoshis), merge: [], split: [], rationale: 'no demand observed; keep current layout' };
  const d = [...demand].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const q = (p: number) => d[Math.min(d.length - 1, Math.floor((d.length - 1) * p))];
  const head = opts.headroomBps ?? 1_000n;
  const want = [q(0.5), q(0.8), q(0.95), d[d.length - 1]].map((x) => { const v = x + (x * head) / 10_000n; return v > maxExposure ? maxExposure : v < minShard ? minShard : v; });
  const target: bigint[] = [];
  let left = total;
  for (const w of [...want].reverse()) { if (left >= w) { target.push(w); left -= w; } }
  while (left >= minShard) { const v = left > maxExposure ? maxExposure : left; target.push(v); left -= v; }
  if (left > 0n && target.length) target[target.length - 1] += left; // dust remainder stays in the last shard
  target.sort((a, b) => (a > b ? -1 : 1));
  // Plan: merge everything into one shard then split into the target (simple, always valid in 2 txs).
  const ops: LayoutPlan = { target, merge: shards.length > 1 ? [shards.map(outpointOf)] : [], split: [{ outpoint: shards.length > 1 ? 'merged' : outpointOf(shards[0]), into: target }], rationale: `demand p50=${q(0.5)} p80=${q(0.8)} p95=${q(0.95)} max=${d[d.length - 1]} (n=${d.length}); +${head} bps headroom` };
  const same = target.length === shards.length && [...shards].map((s) => s.satoshis).sort((a, b) => (a > b ? -1 : 1)).every((v, i) => v === target[i]);
  return same ? { ...ops, merge: [], split: [], rationale: ops.rationale + '; already optimal' } : ops;
}
