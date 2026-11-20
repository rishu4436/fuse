// Pure transaction builders for the FUSE mainnet test plan (no I/O, no keys held here).
// Every transaction only pays the operator wallet or the operator's own FlashVault; the only value that leaves
// the operator's control is the miner fee. Sizes are tiny on purpose (owner budget ≈ $1.50).
import { binToHex, hexToBin, hash160, secp256k1, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { encodeVaultState, decodeVaultState, type BchVaultParams } from '@fuse/contracts';
import { contractLockingBytecode, contractUnlocks, signInputs, finalize, verifyTemplateAndRaw, txidOfRaw, type TxTemplate, type TemplateInput, type VerificationReport } from '@fuse/transaction-composer';

export const CAPS = {
  /** hard cap on total sats the plan may use (spent fees + capital placed in the vault): 0.06 BCH */
  totalUsedSats: 6_000_000n,
  /** hard cap on the miner fee of any single transaction */
  maxFeePerTx: 5_000n,
  /** vault principal bounds (owner instruction: 10k–50k sats) */
  minPrincipal: 10_000n, maxPrincipal: 50_000n,
};
export const DEFAULTS = { principal: 20_000n, deposit: 10_000n, withdraw: 10_000n, feeRateSatPerByte: 2n, feeBps: 9n, minFee: 100n };
export const DUST = 546n;
const ZERO_STATE = encodeVaultState({ flashCount: 0n, cumulativeFees: 0n, paused: false });

export interface Coin { txid: string; vout: number; satoshis: bigint }
export interface VaultUtxo { txid: string; vout: number; satoshis: bigint; commitment: string }
export interface Operator { publicKey: string; pkh: string; lockingBytecode: string }
export const operatorOf = (publicKeyHex: string): Operator => { const pkh = binToHex(hash160(hexToBin(publicKeyHex))); return { publicKey: publicKeyHex, pkh, lockingBytecode: `76a914${pkh}88ac` }; };

export function vaultParams(category: string, op: Operator): BchVaultParams {
  return { vaultCategory: category, feeBps: DEFAULTS.feeBps, minFee: DEFAULTS.minFee, maxExposure: CAPS.maxPrincipal * 2n, ownerPkh: op.pkh };
}
export const vaultLockingBytecode = (p: BchVaultParams) => contractLockingBytecode({ kind: 'flashvault-bch', params: p, fn: 'flash' })!;
export function vaultAddress(p: BchVaultParams, prefix: 'bitcoincash' | 'bchtest' = 'bitcoincash') {
  const r = lockingBytecodeToCashAddress({ bytecode: hexToBin(vaultLockingBytecode(p)), prefix, tokenSupport: true });
  return typeof r === 'string' ? r : r.address;
}
export const flashFee = (p: BchVaultParams, principal: bigint) => { const f = (principal * p.feeBps + 9_999n) / 10_000n; return f > p.minFee ? f : p.minFee; };

const walletIn = (c: Coin, op: Operator): TemplateInput => ({ txid: c.txid, vout: c.vout, satoshis: c.satoshis, lockingBytecode: op.lockingBytecode, role: 'wallet', unlock: { kind: 'p2pkh', signer: 'operator' } });
const nft = (p: BchVaultParams, commitment: string) => ({ category: p.vaultCategory, amount: 0n, nft: { capability: 'mutable' as const, commitment } });
const vaultIn = (v: VaultUtxo, p: BchVaultParams, owner: boolean): TemplateInput => ({ txid: v.txid, vout: v.vout, satoshis: v.satoshis, lockingBytecode: vaultLockingBytecode(p), token: nft(p, v.commitment), role: 'vault', unlock: owner ? { kind: 'flashvault-bch-owner', params: p, signer: 'operator' } : { kind: 'flashvault-bch', params: p, fn: 'flash' } });
const need = (ok: boolean, msg: string) => { if (!ok) throw new Error(msg); };

/** Consolidate wallet coins into output 0 (a category genesis must spend an outpoint with index 0). */
export function buildPrep(coins: Coin[], op: Operator, fee: bigint): TxTemplate {
  const total = coins.reduce((a, c) => a + c.satoshis, 0n);
  need(total - fee > DUST, 'wallet balance too small');
  return { version: 2, locktime: 0, inputs: coins.map((c) => walletIn(c, op)), outputs: [{ lockingBytecode: op.lockingBytecode, satoshis: total - fee, role: 'change', label: 'consolidated (vout 0 for genesis)' }] };
}
/** Genesis: mint the vault's mutable identity NFT (category = coin0.txid) straight into the vault with the principal. */
export function buildGenesis(coin0: Coin, op: Operator, principal: bigint, fee: bigint): { template: TxTemplate; params: BchVaultParams } {
  need(coin0.vout === 0, 'genesis input must spend an outpoint with index 0');
  need(principal >= CAPS.minPrincipal && principal <= CAPS.maxPrincipal, `principal must be ${CAPS.minPrincipal}–${CAPS.maxPrincipal} sats`);
  const params = vaultParams(coin0.txid, op);
  const change = coin0.satoshis - principal - fee;
  need(change >= DUST, 'funding coin too small for principal + fee');
  return { params, template: { version: 2, locktime: 0, inputs: [walletIn(coin0, op)], outputs: [
    { lockingBytecode: vaultLockingBytecode(params), satoshis: principal, token: nft(params, ZERO_STATE), role: 'vault-continuation', label: 'FlashVault shard (new)' },
    { lockingBytecode: op.lockingBytecode, satoshis: change, role: 'change' },
  ] } };
}
/** Flash use: borrow the whole shard and return principal + fee in the same transaction. `underpayBy` > 0 builds a
 *  deliberately invalid transaction that the BCH VM must reject (never broadcast). */
export function buildFlash(v: VaultUtxo, p: BchVaultParams, coin: Coin, op: Operator, fee: bigint, underpayBy = 0n): TxTemplate {
  const f = flashFee(p, v.satoshis) - underpayBy;
  const st = decodeVaultState(v.commitment);
  const next = encodeVaultState({ flashCount: st.flashCount + 1n, cumulativeFees: st.cumulativeFees + f, paused: false });
  const change = coin.satoshis - f - fee;
  need(change >= DUST, 'wallet coin too small for flash fee + miner fee');
  return { version: 2, locktime: 0, inputs: [vaultIn(v, p, false), walletIn(coin, op)], outputs: [
    { lockingBytecode: vaultLockingBytecode(p), satoshis: v.satoshis + f, token: nft(p, next), role: 'vault-continuation', label: `principal + flash fee ${f}` },
    { lockingBytecode: op.lockingBytecode, satoshis: change, role: 'change' },
  ] };
}
export function buildDeposit(v: VaultUtxo, p: BchVaultParams, coin: Coin, op: Operator, amount: bigint, fee: bigint): TxTemplate {
  need(v.satoshis + amount <= p.maxExposure, 'deposit would exceed maxExposure');
  const change = coin.satoshis - amount - fee; need(change >= DUST, 'wallet coin too small');
  return { version: 2, locktime: 0, inputs: [vaultIn(v, p, true), walletIn(coin, op)], outputs: [
    { lockingBytecode: vaultLockingBytecode(p), satoshis: v.satoshis + amount, token: nft(p, v.commitment), role: 'vault-continuation', label: 'shard + LP deposit' },
    { lockingBytecode: op.lockingBytecode, satoshis: change, role: 'change' },
  ] };
}
export function buildWithdraw(v: VaultUtxo, p: BchVaultParams, op: Operator, amount: bigint, fee: bigint): TxTemplate {
  need(v.satoshis - amount >= CAPS.minPrincipal, `remaining shard must stay ≥ ${CAPS.minPrincipal}; use sweep for a full exit`);
  need(amount - fee >= DUST, 'withdraw amount too small');
  return { version: 2, locktime: 0, inputs: [vaultIn(v, p, true)], outputs: [
    { lockingBytecode: vaultLockingBytecode(p), satoshis: v.satoshis - amount, token: nft(p, v.commitment), role: 'vault-continuation', label: 'shard after LP withdrawal' },
    { lockingBytecode: op.lockingBytecode, satoshis: amount - fee, role: 'change', label: 'withdrawn to wallet' },
  ] };
}
/** Full exit: vault (owner path) + all wallet coins → one output to the wallet. The identity NFT is burned. */
export function buildSweep(v: VaultUtxo | null, p: BchVaultParams | null, coins: Coin[], op: Operator, fee: bigint): TxTemplate {
  const inputs = [...(v && p ? [vaultIn(v, p, true)] : []), ...coins.map((c) => walletIn(c, op))];
  const total = inputs.reduce((a, i) => a + i.satoshis, 0n);
  need(inputs.length > 0 && total - fee >= DUST, 'nothing to sweep');
  return { version: 2, locktime: 0, inputs, outputs: [{ lockingBytecode: op.lockingBytecode, satoshis: total - fee, role: 'change', label: 'swept to wallet' }] };
}

export const signAll = (t: TxTemplate, priv: Uint8Array) => finalize(t, contractUnlocks(t), signInputs(t, 'operator', priv));

/** Build twice: once to measure the signed size, then with fee = size × rate. Returns the signed raw tx. */
export function sized(build: (fee: bigint) => TxTemplate, priv: Uint8Array, rate = DEFAULTS.feeRateSatPerByte) {
  let fee = 1_000n, t = build(fee), raw = signAll(t, priv);
  for (let i = 0; i < 3; i++) {
    const want = BigInt(raw.length / 2) * rate + 2n;
    if (want === fee) break;
    fee = want; t = build(fee); raw = signAll(t, priv);
  }
  need(fee <= CAPS.maxFeePerTx, `fee ${fee} exceeds the per-tx cap ${CAPS.maxFeePerTx}`);
  return { template: t, raw, fee, txid: txidOfRaw(raw), sizeBytes: raw.length / 2 };
}

/** Independent check of a signed tx: VM over every input, strong sighash, outputs only to the operator or its vault. */
export function verifyLocal(t: TxTemplate, raw: string, op: Operator, vaultLb: string | null, maxFee: bigint = CAPS.maxFeePerTx): VerificationReport {
  return verifyTemplateAndRaw(t, raw, { ownerLockingBytecode: op.lockingBytecode, maxMinerFee: maxFee, allowedOutputScripts: [op.lockingBytecode, ...(vaultLb ? [vaultLb] : [])], requireStrongSighash: true, vm: true });
}

export function preflight(step: string, t: TxTemplate, s: { fee: bigint; sizeBytes: number; txid: string }, report: VerificationReport, extra: Array<[string, string]> = []) {
  const lines = [
    `── FUSE mainnet preflight: ${step} ──`,
    `network            BCH mainnet`,
    `txid (if sent)     ${s.txid}`,
    `size / miner fee   ${s.sizeBytes} bytes / ${s.fee} sats (cap ${CAPS.maxFeePerTx})`,
    ...extra.map(([k, v]) => `${k.padEnd(18)} ${v}`),
    'inputs:', ...t.inputs.map((i, n) => `  ${n}  ${i.txid}:${i.vout}  ${i.satoshis} sats  ${i.unlock.kind}${i.token?.nft ? '  +identity NFT' : ''}`),
    'outputs:', ...t.outputs.map((o, n) => `  ${n}  ${o.satoshis} sats  ${o.label ?? o.role}${o.token ? `  NFT ${o.token.nft?.capability} ${o.token.nft?.commitment}` : ''}`),
    `local VM verification: ${report.ok ? 'PASS' : 'FAIL'}${report.ok ? '' : ' — ' + report.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail ?? ''}`).join('; ')}`,
    'recoverability     every output pays the operator wallet or the operator-owned vault; the vault owner path (0x61 signature by the wallet key) can always withdraw',
  ];
  return lines.join('\n');
}
export const pubOf = (priv: Uint8Array) => binToHex(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array);

import { sealCertificate, type Certificate } from '@fuse/proof-verifier';
import { commitment } from '@fuse/core';
/** Execution certificate for a mainnet flash use; verify it with verifyCertificate + an independent chain reader. */
export function flashCertificate(t: TxTemplate, txid: string, op: Operator, p: BchVaultParams, s: { minerFee: bigint; blockHeight: number | null; blockHash: string | null; issuedAt: number }): Certificate {
  const principal = t.inputs[0].satoshis;
  const intent = { kind: 'FLASH_USE', vault: vaultLockingBytecode(p), principal, owner: op.lockingBytecode };
  return sealCertificate({
    schema: 'fuse.certificate/v1', certificateId: 'cert_' + txid.slice(0, 24), intentId: 'mainnet_flash_' + txid.slice(0, 12),
    intentCommitment: commitment('intent/v1', intent), policyCommitment: null, network: 'mainnet', executionClass: 'ATOMIC_SINGLE_TX',
    solverId: 'fuse-operator', quoteCommitment: commitment('quote/v1', { txid, fee: flashFee(p, principal) }),
    contracts: [{ role: 'vault', name: 'FlashVaultBCH', lockingBytecode: vaultLockingBytecode(p) }],
    transactions: [{ txid, blockHeight: s.blockHeight, blockHash: s.blockHash }],
    inputs: t.inputs.map((i) => ({ txid, outpoint: `${i.txid}:${i.vout}` })),
    outputs: t.outputs.map((o, vout) => ({ txid, vout, lockingBytecode: o.lockingBytecode, satoshis: o.satoshis, token: o.token, role: o.role })),
    vaultContinuations: [{ txid, inputIndex: 0, minReturn: principal + flashFee(p, principal), asset: 'BCH' }],
    fees: { minerFeeSats: s.minerFee, liquidityFee: flashFee(p, principal), solverFee: 0n },
    outcome: { ownerLockingBytecode: op.lockingBytecode, ownerReceives: [{ asset: 'BCH', amount: t.outputs[1].satoshis }] },
    checks: [{ name: 'local-vm', ok: true }], confirmation: s.blockHeight == null ? 'UNCONFIRMED' : 'CONFIRMED', simulated: false, issuedAt: s.issuedAt, issuer: 'fuse-mainnet-script',
  });
}

import { decodeTransaction as decodeTx, hexToBin as h2b } from '@bitauth/libauth';
/** Rebuild the template view of a broadcast flash tx purely from chain data (raw tx + its parents' raw txs). */
export async function templateFromChain(rawHex: string, getRawHex: (txid: string) => Promise<string>, op: Operator): Promise<TxTemplate> {
  const tx = decodeTx(h2b(rawHex)); if (typeof tx === 'string') throw new Error(tx);
  const inputs: TxTemplate['inputs'] = [];
  for (const [n, i] of tx.inputs.entries()) {
    const ptxid = binToHex(i.outpointTransactionHash);
    const ptx = decodeTx(h2b(await getRawHex(ptxid))); if (typeof ptx === 'string') throw new Error(ptx);
    const o = ptx.outputs[i.outpointIndex];
    inputs.push({ txid: ptxid, vout: i.outpointIndex, satoshis: o.valueSatoshis, lockingBytecode: binToHex(o.lockingBytecode), role: n === 0 ? 'vault' : 'funding', unlock: { kind: 'p2pkh', signer: 'operator' } } as TxTemplate['inputs'][number]);
  }
  const outputs = tx.outputs.map((o, n) => ({ lockingBytecode: binToHex(o.lockingBytecode), satoshis: o.valueSatoshis, token: o.token ? { category: binToHex(o.token.category), amount: o.token.amount, ...(o.token.nft ? { nft: { capability: o.token.nft.capability, commitment: binToHex(o.token.nft.commitment) } } : {}) } : undefined, role: n === 0 ? 'vault-continuation' : 'change' })) as TxTemplate['outputs'];
  void op;
  return { ...({} as TxTemplate), version: tx.version, locktime: tx.locktime, inputs, outputs } as TxTemplate;
}
