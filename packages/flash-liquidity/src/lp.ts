// F33 deposits, F34 withdrawals, F36 split/merge, F39 emergency pause, via the FlashVault LP-owner path
// (withdraw(ownerPk, ownerSig) with a mandatory 0x61 signature). Templates are verified in the BCH VM.
// F35 fee allocation: pro-rata ledger over LP shares (off-chain accounting; on-chain the vault has one owner key).
import { encodeVaultState, decodeVaultState, type BchVaultParams, type VaultState } from '@fuse/contracts';
import { FuseError } from '@fuse/core';
import type { TxTemplate, TokenSpec } from '@fuse/transaction-composer';
import type { ShardRef } from './shards.js';

export interface LpCtx { params: BchVaultParams; vaultLockingBytecode: string; lpLockingBytecode: string; minerFee?: bigint }
export interface Coin { txid: string; vout: number; satoshis: bigint; token?: TokenSpec }
const nft = (params: BchVaultParams, s: VaultState): TokenSpec => ({ category: params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState(s) } });
const shardIn = (c: LpCtx, s: ShardRef): TxTemplate['inputs'][number] => ({ txid: s.txid, vout: s.vout, satoshis: s.satoshis, token: { category: c.params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: s.commitment } }, lockingBytecode: c.vaultLockingBytecode, role: 'vault', unlock: { kind: 'flashvault-bch-owner', params: c.params, signer: 'lp' } });
const lpIn = (c: LpCtx, coin: Coin): TxTemplate['inputs'][number] => ({ ...coin, lockingBytecode: c.lpLockingBytecode, role: 'counterparty', unlock: { kind: 'p2pkh', signer: 'lp' } });
const fee = (c: LpCtx) => c.minerFee ?? 2_000n;

export function buildDeposit(c: LpCtx, shard: ShardRef, funding: Coin, amount: bigint): TxTemplate {
  if (amount <= 0n || funding.satoshis < amount + fee(c) + 546n) throw new FuseError('INSUFFICIENT_FUNDS', 'funding coin too small', false);
  const st = decodeVaultState(shard.commitment);
  if (shard.satoshis + amount > c.params.maxExposure) throw new FuseError('EXPOSURE_CAP', `shard would exceed maxExposure ${c.params.maxExposure}`, false);
  return { version: 2, locktime: 0, inputs: [shardIn(c, shard), lpIn(c, funding)], outputs: [
    { lockingBytecode: c.vaultLockingBytecode, satoshis: shard.satoshis + amount, token: nft(c.params, st), role: 'vault-continuation', label: 'shard + deposit' },
    { lockingBytecode: c.lpLockingBytecode, satoshis: funding.satoshis - amount - fee(c), role: 'change' },
  ] };
}

export function buildWithdraw(c: LpCtx, shard: ShardRef, amount: bigint): TxTemplate {
  const st = decodeVaultState(shard.commitment);
  if (amount <= 0n || amount > shard.satoshis) throw new FuseError('BAD_AMOUNT', 'withdraw amount out of range', false);
  const remaining = shard.satoshis - amount;
  if (remaining === 0n) // full exit: identity NFT goes back to the LP (shard retired), value paid out
    return { version: 2, locktime: 0, inputs: [shardIn(c, shard)], outputs: [{ lockingBytecode: c.lpLockingBytecode, satoshis: shard.satoshis - fee(c), token: nft(c.params, st), role: 'counterparty', label: 'retired shard identity + principal' }] };
  if (remaining < 10_000n) throw new FuseError('BAD_AMOUNT', 'remaining shard below 10,000 sats; withdraw fully instead', false);
  return { version: 2, locktime: 0, inputs: [shardIn(c, shard)], outputs: [
    { lockingBytecode: c.vaultLockingBytecode, satoshis: remaining, token: nft(c.params, st), role: 'vault-continuation', label: 'shard after withdrawal' },
    { lockingBytecode: c.lpLockingBytecode, satoshis: amount - fee(c), role: 'counterparty', label: 'withdrawn' },
  ] };
}

export function buildMerge(c: LpCtx, shards: ShardRef[]): TxTemplate {
  if (shards.length < 2) throw new FuseError('BAD_INPUT', 'merge needs ≥ 2 shards', false);
  const states = shards.map((s) => decodeVaultState(s.commitment));
  const merged: VaultState = { flashCount: states.reduce((a, s) => a + s.flashCount, 0n), cumulativeFees: states.reduce((a, s) => a + s.cumulativeFees, 0n), paused: false };
  const total = shards.reduce((a, s) => a + s.satoshis, 0n) - fee(c);
  if (total > c.params.maxExposure) throw new FuseError('EXPOSURE_CAP', 'merged shard would exceed maxExposure', false);
  return { version: 2, locktime: 0, inputs: shards.map((s) => shardIn(c, s)), outputs: [{ lockingBytecode: c.vaultLockingBytecode, satoshis: total, token: nft(c.params, merged), role: 'vault-continuation', label: `merge of ${shards.length} shards (extra identity NFTs burned)` }] };
}

/** Split needs the LP's minting baton for the vault category (new identity NFTs are minted). */
export function buildSplit(c: LpCtx, shard: ShardRef, baton: Coin, into: bigint[]): TxTemplate {
  if (!baton.token?.nft || baton.token.nft.capability !== 'minting' || baton.token.category !== c.params.vaultCategory) throw new FuseError('NO_BATON', 'split requires the vault minting baton', false);
  const sum = into.reduce((a, x) => a + x, 0n);
  if (sum + fee(c) !== shard.satoshis) throw new FuseError('BAD_SPLIT', `parts ${sum} + fee ${fee(c)} must equal shard ${shard.satoshis}`, false);
  if (into.some((x) => x > c.params.maxExposure || x < 10_000n)) throw new FuseError('BAD_SPLIT', 'each part must be within [10,000, maxExposure]', false);
  const st = decodeVaultState(shard.commitment);
  return { version: 2, locktime: 0, inputs: [shardIn(c, shard), lpIn(c, baton)], outputs: [
    ...into.map((v, i) => ({ lockingBytecode: c.vaultLockingBytecode, satoshis: v, token: nft(c.params, i === 0 ? st : { flashCount: 0n, cumulativeFees: 0n, paused: false }), role: 'vault-continuation' as const, label: `shard part ${i + 1}` })),
    { lockingBytecode: c.lpLockingBytecode, satoshis: baton.satoshis, token: baton.token, role: 'counterparty', label: 'minting baton returned' },
  ] };
}

/** F39: pause/unpause a shard (flag byte); flash() refuses paused shards. Value unchanged minus miner fee. */
export function buildPause(c: LpCtx, shard: ShardRef, paused: boolean, funding: Coin): TxTemplate {
  const st = decodeVaultState(shard.commitment);
  return { version: 2, locktime: 0, inputs: [shardIn(c, shard), lpIn(c, funding)], outputs: [
    { lockingBytecode: c.vaultLockingBytecode, satoshis: shard.satoshis, token: nft(c.params, { ...st, paused }), role: 'vault-continuation', label: paused ? 'PAUSED' : 'active' },
    { lockingBytecode: c.lpLockingBytecode, satoshis: funding.satoshis - fee(c), role: 'change' },
  ] };
}

/** F35: allocate earned fees pro-rata by LP shares. Floor division; the remainder goes to the largest
 *  holder (deterministic) so Σ allocations == fees exactly. */
export function allocateFees(fees: bigint, shares: Record<string, bigint>): Record<string, bigint> {
  const total = Object.values(shares).reduce((a, s) => a + s, 0n);
  if (total <= 0n) throw new FuseError('NO_SHARES', 'no LP shares', false);
  const out: Record<string, bigint> = {};
  let used = 0n;
  for (const [k, s] of Object.entries(shares)) { out[k] = (fees * s) / total; used += out[k]; }
  const top = Object.entries(shares).sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : a[0] < b[0] ? -1 : 1))[0][0];
  out[top] += fees - used;
  return out;
}

/** F38 health snapshot. */
export function vaultHealth(shards: ShardRef[], leasedOutpoints: string[], maxExposure: bigint) {
  const st = shards.map((s) => ({ s, v: decodeVaultState(s.commitment) }));
  const total = shards.reduce((a, s) => a + s.satoshis, 0n);
  const leased = shards.filter((s) => leasedOutpoints.includes(`${s.txid}:${s.vout}`)).reduce((a, s) => a + s.satoshis, 0n);
  return {
    shards: shards.length, totalSats: total, leasedSats: leased, utilizationBps: total ? (leased * 10_000n) / total : 0n,
    paused: st.filter((x) => x.v.paused).length, overExposure: shards.filter((s) => s.satoshis > maxExposure).length,
    cumulativeFees: st.reduce((a, x) => a + x.v.cumulativeFees, 0n), flashCount: st.reduce((a, x) => a + x.v.flashCount, 0n),
    largestFreeSats: shards.filter((s) => !leasedOutpoints.includes(`${s.txid}:${s.vout}`)).reduce((m, s) => (s.satoshis > m ? s.satoshis : m), 0n),
  };
}

// ---- F40: LP risk history from persisted vault-health snapshots ----
export interface VaultSnapshot { totalSats: bigint; leasedSats: bigint; utilizationBps: bigint; cumulativeFees: bigint; flashCount: bigint; paused: number; shards: number; largestFreeSats: bigint }
/** Exact BigInt metrics over a snapshot series (oldest first). Drawdown is peak-to-trough decline of vault sats
 *  NET of LP deposits/withdrawals (pass `flows` as signed principal changes keyed by series index). */
export function lpRiskHistory(series: VaultSnapshot[], flows: Map<number, bigint> = new Map()) {
  if (!series.length) return { points: 0, peakUtilizationBps: 0n, avgUtilizationBps: 0n, maxDrawdownBps: 0n, feesEarned: 0n, flashes: 0n, pausedObservations: 0, minLargestFreeSats: 0n };
  let adj = 0n, peak = -1n, maxDd = 0n;
  const navs = series.map((s, i) => { adj += flows.get(i) ?? 0n; return s.totalSats - adj; });
  for (const v of navs) { if (v > peak) peak = v; if (peak > 0n) { const dd = ((peak - v) * 10_000n) / peak; if (dd > maxDd) maxDd = dd; } }
  const first = series[0], last = series[series.length - 1];
  return {
    points: series.length,
    peakUtilizationBps: series.reduce((m, s) => (s.utilizationBps > m ? s.utilizationBps : m), 0n),
    avgUtilizationBps: series.reduce((a, s) => a + s.utilizationBps, 0n) / BigInt(series.length),
    maxDrawdownBps: maxDd,
    feesEarned: last.cumulativeFees - first.cumulativeFees,
    flashes: last.flashCount - first.flashCount,
    pausedObservations: series.filter((s) => s.paused > 0).length,
    minLargestFreeSats: series.reduce((m, s) => (s.largestFreeSats < m ? s.largestFreeSats : m), first.largestFreeSats),
  };
}
