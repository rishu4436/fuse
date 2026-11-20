// Wallet authorization layer: turns a FUSE TxTemplate into a WizardConnect (hdwalletv1 / bch-wc2) sign request,
// produces a mainnet preflight report, and independently verifies whatever the wallet returns before it can be
// used. This module NEVER broadcasts. Sign requests always set `broadcast: false`.
import { decodeTransactionUnsafe, hexToBin, lockingBytecodeToCashAddress, cashAddressToLockingBytecode, binToHex } from '@bitauth/libauth';
import {
  toUnsignedTransaction, sourceOutputsOf, verifyTemplateAndRaw, estimateSize, templateHash, REQUIRED_SIGHASH_BYTE, P2PKH_DUST,
  type TxTemplate, type VerificationReport,
} from '@fuse/transaction-composer';
import { FuseError } from '@fuse/core';

export type WcPathName = 'receive' | 'change' | 'defi';
export interface WalletCoin { txid: string; vout: number; satoshis: bigint; token?: unknown; addressIndex: number; path: WcPathName }

export function lockingBytecodeOf(address: string): string {
  const r = cashAddressToLockingBytecode(address);
  if (typeof r === 'string') throw new FuseError('BAD_ADDRESS', r);
  return binToHex(r.bytecode);
}
export function addressOf(lockingBytecode: string, prefix: 'bitcoincash' | 'bchtest' = 'bitcoincash'): string {
  const r = lockingBytecodeToCashAddress({ bytecode: hexToBin(lockingBytecode), prefix });
  if (typeof r === 'string') throw new FuseError('BAD_SCRIPT', r);
  return r.address;
}

/**
 * Mainnet preflight transaction: consolidates the wallet's own BCH-only coins back to its own receive address.
 * It is the smallest possible FUSE-built transaction (no third-party outputs, fully recoverable) and is used to
 * prove the WizardConnect signing path. Token-carrying coins are never included (no token burning).
 */
export function buildSelfConsolidation(coins: WalletCoin[], ownerLockingBytecode: string, feeRateSatPerByte = 1n, maxInputs = 10): { template: TxTemplate; inputPaths: Array<[number, WcPathName, number]>; fee: bigint } {
  const usable = coins.filter((c) => !c.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1)).slice(0, maxInputs);
  if (!usable.length) throw new FuseError('NO_COINS', 'wallet has no BCH-only coins to consolidate');
  const inputs = usable.map((c) => ({ txid: c.txid, vout: c.vout, satoshis: c.satoshis, lockingBytecode: ownerLockingBytecode, role: 'wallet' as const, unlock: { kind: 'p2pkh' as const, signer: 'user' } }));
  const draft: TxTemplate = { version: 2, locktime: 0, inputs, outputs: [{ lockingBytecode: ownerLockingBytecode, satoshis: 0n, role: 'change' }] };
  const size = BigInt(estimateSize(draft, new Map(inputs.map((_, i) => [i, 106]))));
  const fee = size * feeRateSatPerByte;
  const total = usable.reduce((s, c) => s + c.satoshis, 0n);
  if (total - fee < P2PKH_DUST) throw new FuseError('DUST', `coins (${total} sat) do not cover fee ${fee} + dust`);
  draft.outputs[0].satoshis = total - fee;
  return { template: draft, inputPaths: usable.map((c, i) => [i, c.path, c.addressIndex]), fee };
}

export interface PreflightItem { label: string; value: string }
export interface Preflight { network: 'mainnet' | 'chipnet' | 'local'; templateHash: string; items: PreflightItem[]; checks: Array<{ name: string; ok: boolean; detail: string }>; ok: boolean; broadcast: 'DISABLED' }

/** Spec §19 mainnet gate: everything the owner must see before any value-moving broadcast. */
export function preflight(t: TxTemplate, ctx: { network: Preflight['network']; ownerLockingBytecode: string; maxMinerFee: bigint; authorization: string; contractVerification: string }): Preflight {
  const inSats = t.inputs.reduce((s, i) => s + i.satoshis, 0n);
  const outSats = t.outputs.reduce((s, o) => s + o.satoshis, 0n);
  const fee = inSats - outSats;
  const foreign = t.outputs.filter((o) => o.lockingBytecode !== ctx.ownerLockingBytecode);
  const tokenIn = t.inputs.filter((i) => i.token).length, tokenOut = t.outputs.filter((o) => o.token).length;
  const checks = [
    { name: 'version-2', ok: t.version === 2, detail: `version ${t.version}` },
    { name: 'fee-within-max', ok: fee >= 0n && fee <= ctx.maxMinerFee, detail: `${fee} sat ≤ ${ctx.maxMinerFee}` },
    { name: 'no-foreign-outputs', ok: foreign.length === 0, detail: foreign.length ? `${foreign.length} output(s) to other scripts` : 'all outputs return to the funding wallet' },
    { name: 'no-token-burn', ok: tokenIn === 0 || tokenIn === tokenOut, detail: `${tokenIn} token inputs / ${tokenOut} token outputs` },
    { name: 'inputs-owned-by-wallet', ok: t.inputs.every((i) => i.lockingBytecode === ctx.ownerLockingBytecode), detail: `${t.inputs.length} inputs` },
    { name: 'outputs-above-dust', ok: t.outputs.every((o) => o.satoshis >= P2PKH_DUST), detail: `min ${P2PKH_DUST} sat` },
  ];
  const prefix = ctx.network === 'mainnet' ? 'bitcoincash' : 'bchtest';
  return {
    network: ctx.network, templateHash: templateHash(t), ok: checks.every((c) => c.ok), broadcast: 'DISABLED', checks,
    items: [
      { label: 'Chain / network', value: ctx.network === 'mainnet' ? 'Bitcoin Cash mainnet' : ctx.network },
      { label: 'Funding wallet', value: addressOf(ctx.ownerLockingBytecode, prefix) },
      { label: 'Contract script', value: 'none (P2PKH only)' },
      { label: 'Asset', value: 'BCH (no CashTokens)' },
      { label: 'Inputs', value: `${t.inputs.length} coin(s), ${inSats} sat` },
      { label: 'Expected outputs', value: t.outputs.map((o) => `${o.satoshis} sat → ${addressOf(o.lockingBytecode, prefix)}`).join('; ') },
      { label: 'Miner fee', value: `${fee} sat (max ${ctx.maxMinerFee})` },
      { label: 'Recoverability', value: foreign.length ? 'funds leave the wallet' : 'fully recoverable: every output returns to the funding wallet' },
      { label: 'Authorization method', value: ctx.authorization },
      { label: 'Sighash', value: `SIGHASH_ALL|FORKID|UTXOS (0x${REQUIRED_SIGHASH_BYTE.toString(16)})` },
      { label: 'Contract verification', value: ctx.contractVerification },
      { label: 'Broadcast', value: 'DISABLED: FUSE never broadcasts without explicit owner authorization' },
    ],
  };
}

/** bch-wc2 WcSignTransactionRequest for WizardConnect `signTransaction`. Always `broadcast: false`. */
export function wcSignRequest(t: TxTemplate, userPrompt: string) {
  const tx = toUnsignedTransaction(t);
  const src = sourceOutputsOf(t);
  return {
    transaction: tx,
    sourceOutputs: tx.inputs.map((inp, i) => ({ ...inp, ...src[i] })),
    broadcast: false as const,
    userPrompt,
  };
}

/** Independent verification of a wallet-returned signed transaction against the reviewed template. */
export function verifyWalletSigned(t: TxTemplate, signedHex: string, ctx: { ownerLockingBytecode: string; maxMinerFee: bigint }): VerificationReport {
  let decodedOk = true;
  try { decodeTransactionUnsafe(hexToBin(signedHex)); } catch { decodedOk = false; }
  if (!decodedOk) return { ok: false, txid: '', minerFee: 0n, checks: [{ name: 'decodes', ok: false, detail: 'wallet returned an undecodable transaction' }] };
  return verifyTemplateAndRaw(t, signedHex, { ownerLockingBytecode: ctx.ownerLockingBytecode, maxMinerFee: ctx.maxMinerFee, allowedOutputScripts: [ctx.ownerLockingBytecode], requireStrongSighash: true, vm: true });
}
