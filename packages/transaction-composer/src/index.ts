// FUSE transaction composer: deterministic, JSON-serializable BCH transaction templates with explicit
// roles, multi-party signing (WizardConnect-compatible SIGHASH_ALL|FORKID|UTXOS), and an independent
// verifier that never trusts the planner, solver or router that produced a transaction.
import { MockNetworkProvider, SignatureTemplate, type Unlocker } from 'cashscript';
import {
  hexToBin, binToHex, hash160, encodeTransaction, decodeTransaction, hash256, createVirtualMachineBch2026,
  type TransactionCommon, type Output as LibauthOutput,
} from '@bitauth/libauth';
import { commitment, FuseError } from '@fuse/core';
import { bchVaultContract, tokenVaultContract, cauldronPoolContract, type BchVaultParams, type TokenVaultParams } from '@fuse/contracts';

export const REQUIRED_SIGHASH_BYTE = 0x61; // ALL | FORKID | UTXOS
export const P2PKH_DUST = 546n;
export const TOKEN_DUST = 1_000n;

export interface TokenSpec { category: string; amount: bigint; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } }

export type UnlockSpec =
  | { kind: 'p2pkh'; signer: string }
  | { kind: 'flashvault-bch'; params: BchVaultParams; fn: 'flash' }
  /** LP owner path (deposit top-up, withdraw, split, merge, pause). Needs the LP owner's 0x61 signature. */
  | { kind: 'flashvault-bch-owner'; params: BchVaultParams; signer: string }
  | { kind: 'flashvault-token'; params: TokenVaultParams; fn: 'flash' }
  | { kind: 'cauldron-pool'; ownerPkh: string };

export type InputRole = 'wallet' | 'solver' | 'vault' | 'pool' | 'counterparty';
export type OutputRole = 'vault-continuation' | 'pool' | 'user' | 'solver' | 'fee' | 'change' | 'counterparty';

export interface TemplateInput {
  txid: string; vout: number; satoshis: bigint; token?: TokenSpec; lockingBytecode: string;
  role: InputRole; unlock: UnlockSpec; sequence?: number;
}
export interface TemplateOutput { lockingBytecode: string; satoshis: bigint; token?: TokenSpec; role: OutputRole; label?: string }
export interface TxTemplate { version: 2; locktime: number; inputs: TemplateInput[]; outputs: TemplateOutput[] }

export const templateHash = (t: TxTemplate) => commitment('tx-template/v1', t);

const libToken = (t?: TokenSpec) => t ? {
  amount: t.amount, category: hexToBin(t.category),
  ...(t.nft ? { nft: { capability: t.nft.capability, commitment: hexToBin(t.nft.commitment) } } : {}),
} : undefined;

export function sourceOutputsOf(t: TxTemplate): LibauthOutput[] {
  return t.inputs.map((i) => ({ lockingBytecode: hexToBin(i.lockingBytecode), valueSatoshis: i.satoshis, token: libToken(i.token) }) as LibauthOutput);
}

export function toUnsignedTransaction(t: TxTemplate): TransactionCommon {
  return {
    version: t.version,
    locktime: t.locktime,
    inputs: t.inputs.map((i) => ({ outpointTransactionHash: hexToBin(i.txid), outpointIndex: i.vout, sequenceNumber: i.sequence ?? 0xffffffff, unlockingBytecode: new Uint8Array() })),
    outputs: t.outputs.map((o) => ({ lockingBytecode: hexToBin(o.lockingBytecode), valueSatoshis: o.satoshis, token: libToken(o.token) }) as TransactionCommon['outputs'][number]),
  };
}

const offline = new MockNetworkProvider();

function contractUnlocker(spec: UnlockSpec): Unlocker {
  switch (spec.kind) {
    case 'flashvault-bch': return bchVaultContract(spec.params, offline).unlock.flash();
    case 'flashvault-token': return tokenVaultContract(spec.params, offline).unlock.flash();
    case 'cauldron-pool': return cauldronPoolContract(spec.ownerPkh, offline).unlock.swap();
    default: throw new FuseError('NOT_CONTRACT', 'not a contract unlock');
  }
}

/** Expected locking bytecode for a contract input — lets the verifier detect a mislabeled input. */
export function contractLockingBytecode(spec: UnlockSpec): string | null {
  switch (spec.kind) {
    case 'flashvault-bch': case 'flashvault-bch-owner': return bchVaultContract(spec.params, offline).lockingBytecode;
    case 'flashvault-token': return tokenVaultContract(spec.params, offline).lockingBytecode;
    case 'cauldron-pool': return cauldronPoolContract(spec.ownerPkh, offline).lockingBytecode;
    default: return null;
  }
}

/** Unlocking bytecode for every covenant input (no keys involved). */
export function contractUnlocks(t: TxTemplate): Map<number, string> {
  const tx = toUnsignedTransaction(t);
  const sourceOutputs = sourceOutputsOf(t);
  const out = new Map<number, string>();
  t.inputs.forEach((inp, inputIndex) => {
    if (inp.unlock.kind === 'p2pkh' || inp.unlock.kind === 'flashvault-bch-owner') return;
    out.set(inputIndex, binToHex(contractUnlocker(inp.unlock).generateUnlockingBytecode({ transaction: tx as never, sourceOutputs, inputIndex })));
  });
  return out;
}

/**
 * Wallet-side signing (what a WizardConnect wallet does): sign only the inputs assigned to `signer`
 * with SIGHASH_ALL|FORKID|UTXOS Schnorr. Refuses to sign if any input of the template is assigned to
 * `signer` but its locking bytecode is not P2PKH of the key (wrong-path protection).
 */
export function signInputs(t: TxTemplate, signer: string, privateKey: Uint8Array): Map<number, string> {
  const template = new SignatureTemplate(privateKey); // default SIGHASH_ALL | SIGHASH_UTXOS (+FORKID)
  const unlocker = template.unlockP2PKH();
  const expectedLb = `76a914${binToHex(hash160(template.publicKey))}88ac`;
  const tx = toUnsignedTransaction(t);
  const sourceOutputs = sourceOutputsOf(t);
  const out = new Map<number, string>();
  t.inputs.forEach((inp, inputIndex) => {
    if (inp.unlock.kind === 'flashvault-bch-owner' && inp.unlock.signer === signer) {
      if (binToHex(hash160(template.publicKey)) !== inp.unlock.params.ownerPkh) throw new FuseError('WRONG_KEY', `input ${inputIndex}: signer ${signer} is not the vault owner`);
      const u = bchVaultContract(inp.unlock.params, offline).unlock.withdraw(template.publicKey, template);
      out.set(inputIndex, binToHex(u.generateUnlockingBytecode({ transaction: tx as never, sourceOutputs, inputIndex })));
      return;
    }
    if (inp.unlock.kind !== 'p2pkh' || inp.unlock.signer !== signer) return;
    if (inp.lockingBytecode !== expectedLb) throw new FuseError('WRONG_KEY', `input ${inputIndex} is not locked to signer ${signer}`);
    const unlocking = unlocker.generateUnlockingBytecode({ transaction: tx as never, sourceOutputs, inputIndex });
    out.set(inputIndex, binToHex(unlocking));
  });
  return out;
}

export function finalize(t: TxTemplate, ...unlockMaps: Map<number, string>[]): string {
  const tx = toUnsignedTransaction(t);
  const merged = new Map<number, string>();
  for (const m of unlockMaps) for (const [k, v] of m) {
    if (merged.has(k)) throw new FuseError('DUPLICATE_UNLOCK', `input ${k} unlocked twice`);
    merged.set(k, v);
  }
  tx.inputs.forEach((inp, i) => {
    const u = merged.get(i);
    if (!u) throw new FuseError('MISSING_UNLOCK', `input ${i} has no unlocking bytecode`);
    inp.unlockingBytecode = hexToBin(u);
  });
  return binToHex(encodeTransaction(tx));
}

export const txidOfRaw = (raw: string) => binToHex(hash256(hexToBin(raw)).reverse());

// ---------------------------------------------------------------------------
// Independent verification
// ---------------------------------------------------------------------------

export interface Expectations {
  /** Owner (user) locking bytecode; owner outputs are summed for minOutput checks. */
  ownerLockingBytecode?: string;
  minOwnerReceive?: { asset: 'BCH' | string; amount: bigint };
  maxOwnerSpend?: { asset: 'BCH' | string; amount: bigint };
  maxMinerFee?: bigint;
  /** If set, every output must pay one of these scripts (prevents hidden transfers). */
  allowedOutputScripts?: string[];
  /** FlashVault inputs that must be continued correctly (mirrors on-chain rules for early rejection). */
  vaultInputs?: Array<{ inputIndex: number; minReturn: bigint; asset: 'BCH' | string }>;
  /** Require every P2PKH signature to use SIGHASH_ALL|FORKID|UTXOS. */
  requireStrongSighash?: boolean;
  /** Run the BCH 2026 VM over every input. */
  vm?: boolean;
}

export interface Check { name: string; ok: boolean; detail?: string }
export interface VerificationReport { ok: boolean; txid: string; minerFee: bigint; checks: Check[] }

const assetOf = (o: { token?: { category: Uint8Array } }) => (o.token ? binToHex(o.token.category) : 'BCH');

/** Verify a raw transaction against the outputs it spends. Independent of whoever built it. */
export function verifyTransaction(rawHex: string, sourceOutputs: LibauthOutput[], exp: Expectations = {}): VerificationReport {
  const checks: Check[] = [];
  const decoded = decodeTransaction(hexToBin(rawHex));
  if (typeof decoded === 'string') return { ok: false, txid: '', minerFee: 0n, checks: [{ name: 'decode', ok: false, detail: decoded }] };
  const tx = decoded;
  const txid = txidOfRaw(rawHex);
  checks.push({ name: 'source-outputs-match-inputs', ok: sourceOutputs.length === tx.inputs.length, detail: `${sourceOutputs.length} source outputs for ${tx.inputs.length} inputs` });

  const inBch = sourceOutputs.reduce((s, o) => s + o.valueSatoshis, 0n);
  const outBch = tx.outputs.reduce((s, o) => s + o.valueSatoshis, 0n);
  const minerFee = inBch - outBch;
  checks.push({ name: 'bch-conservation', ok: minerFee >= 0n, detail: `in=${inBch} out=${outBch} fee=${minerFee}` });
  if (exp.maxMinerFee !== undefined) checks.push({ name: 'max-miner-fee', ok: minerFee <= exp.maxMinerFee, detail: `fee=${minerFee} max=${exp.maxMinerFee}` });

  // Fungible token conservation per category (no minting/burning allowed in FUSE operations).
  const ft = new Map<string, bigint>();
  for (const o of sourceOutputs) if (o.token && o.token.amount > 0n) ft.set(binToHex(o.token.category), (ft.get(binToHex(o.token.category)) ?? 0n) + o.token.amount);
  for (const o of tx.outputs) if (o.token && o.token.amount > 0n) ft.set(binToHex(o.token.category), (ft.get(binToHex(o.token.category)) ?? 0n) - o.token.amount);
  for (const [cat, diff] of ft) checks.push({ name: `token-conservation:${cat.slice(0, 8)}`, ok: diff === 0n, detail: `in-out=${diff}` });

  if (exp.ownerLockingBytecode) {
    const owner = exp.ownerLockingBytecode;
    const recv = (asset: string) => tx.outputs.filter((o) => binToHex(o.lockingBytecode) === owner).reduce((s, o) => s + (asset === 'BCH' ? o.valueSatoshis : assetOf(o) === asset ? (o.token?.amount ?? 0n) : 0n), 0n);
    const spent = (asset: string) => sourceOutputs.filter((o) => binToHex(o.lockingBytecode) === owner).reduce((s, o) => s + (asset === 'BCH' ? o.valueSatoshis : assetOf(o) === asset ? (o.token?.amount ?? 0n) : 0n), 0n);
    if (exp.minOwnerReceive) {
      const r = recv(exp.minOwnerReceive.asset);
      checks.push({ name: 'min-owner-receive', ok: r >= exp.minOwnerReceive.amount, detail: `receives ${r} ${exp.minOwnerReceive.asset}, min ${exp.minOwnerReceive.amount}` });
    }
    if (exp.maxOwnerSpend) {
      const a = exp.maxOwnerSpend.asset;
      const net = spent(a) - recv(a);
      checks.push({ name: 'max-owner-spend', ok: net <= exp.maxOwnerSpend.amount, detail: `net spend ${net} ${a}, max ${exp.maxOwnerSpend.amount}` });
    }
  }

  if (exp.allowedOutputScripts) {
    const allowed = new Set(exp.allowedOutputScripts);
    const bad = tx.outputs.map((o, i) => [i, binToHex(o.lockingBytecode)] as const).filter(([, s]) => !allowed.has(s));
    checks.push({ name: 'no-unauthorized-outputs', ok: bad.length === 0, detail: bad.length ? `unexpected outputs at ${bad.map(([i]) => i).join(',')}` : 'all outputs allowlisted' });
  }

  for (const v of exp.vaultInputs ?? []) {
    const src = sourceOutputs[v.inputIndex];
    const out = tx.outputs[v.inputIndex];
    const okScript = !!out && !!src && binToHex(out.lockingBytecode) === binToHex(src.lockingBytecode);
    const amountOut = !out ? 0n : v.asset === 'BCH' ? out.valueSatoshis : (out.token && binToHex(out.token.category) === v.asset ? out.token.amount : 0n);
    const sameIdentity = !src?.token || (!!out?.token && binToHex(out.token.category) === binToHex(src.token.category) && (out.token.nft?.capability ?? null) === (src.token.nft?.capability ?? null));
    checks.push({ name: `vault-continuation:${v.inputIndex}`, ok: okScript && sameIdentity && amountOut >= v.minReturn, detail: `script=${okScript} identity=${sameIdentity} returned=${amountOut} min=${v.minReturn}` });
  }

  if (exp.requireStrongSighash) {
    tx.inputs.forEach((inp, i) => {
      const lb = binToHex(sourceOutputs[i]?.lockingBytecode ?? new Uint8Array());
      if (!/^76a914[0-9a-f]{40}88ac$/.test(lb)) return;
      const u = inp.unlockingBytecode;
      // P2PKH unlocking: <push sig><push pubkey>; first byte is push length of sig (65 for Schnorr).
      const sigLen = u[0];
      const hashType = u[sigLen];
      checks.push({ name: `sighash:${i}`, ok: hashType === REQUIRED_SIGHASH_BYTE, detail: `hashtype=0x${(hashType ?? 0).toString(16)}` });
    });
  }

  if (exp.vm !== false) {
    const vm = createVirtualMachineBch2026();
    const result = vm.verify({ transaction: tx, sourceOutputs });
    checks.push({ name: 'bch-vm-2026', ok: result === true, detail: result === true ? 'all inputs valid' : String(result) });
  }

  return { ok: checks.every((c) => c.ok), txid, minerFee, checks };
}

export function verifyTemplateAndRaw(t: TxTemplate, raw: string, exp: Expectations = {}): VerificationReport {
  const report = verifyTransaction(raw, sourceOutputsOf(t), exp);
  // The raw tx must be exactly the template (no modification after review/signing).
  const unsigned = toUnsignedTransaction(t);
  const decoded = decodeTransaction(hexToBin(raw));
  if (typeof decoded !== 'string') {
    decoded.inputs.forEach((i) => { i.unlockingBytecode = new Uint8Array(); });
    const same = binToHex(encodeTransaction(decoded)) === binToHex(encodeTransaction(unsigned));
    report.checks.push({ name: 'matches-reviewed-template', ok: same });
  }
  t.inputs.forEach((inp, i) => {
    const expected = contractLockingBytecode(inp.unlock);
    if (expected) report.checks.push({ name: `contract-identity:${i}`, ok: expected === inp.lockingBytecode, detail: inp.unlock.kind });
  });
  report.ok = report.checks.every((c) => c.ok);
  return report;
}

// ---------------------------------------------------------------------------
// Fees, coin selection, conflicts
// ---------------------------------------------------------------------------

export function estimateSize(t: TxTemplate, unlockSizes: Map<number, number> = new Map()): number {
  const tx = toUnsignedTransaction(t);
  let size = encodeTransaction(tx).length;
  t.inputs.forEach((inp, i) => { size += unlockSizes.get(i) ?? (inp.unlock.kind === 'p2pkh' ? 100 : 0); });
  return size;
}

export interface SpendableCoin { txid: string; vout: number; satoshis: bigint; lockingBytecode: string; token?: TokenSpec }

/** Largest-first BCH coin selection that covers target + per-input fee; never selects token UTXOs. */
export function selectCoins(coins: SpendableCoin[], target: bigint, feePerInput = 150n): { selected: SpendableCoin[]; total: bigint } {
  const pure = coins.filter((c) => !c.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : b.satoshis < a.satoshis ? -1 : 0));
  const selected: SpendableCoin[] = [];
  let total = 0n;
  for (const c of pure) {
    if (total >= target + feePerInput * BigInt(selected.length)) break;
    selected.push(c); total += c.satoshis;
  }
  if (total < target + feePerInput * BigInt(selected.length)) throw new FuseError('INSUFFICIENT_FUNDS', `need ${target} sats + fees, have ${total}`, false);
  return { selected, total };
}

/** UTXO conflict detection across candidate plans. */
export function findConflicts(templates: Array<{ id: string; template: TxTemplate }>): Array<{ a: string; b: string; outpoints: string[] }> {
  const res: Array<{ a: string; b: string; outpoints: string[] }> = [];
  for (let i = 0; i < templates.length; i++) for (let j = i + 1; j < templates.length; j++) {
    const A = new Set(templates[i].template.inputs.map((x) => `${x.txid}:${x.vout}`));
    const shared = templates[j].template.inputs.map((x) => `${x.txid}:${x.vout}`).filter((o) => A.has(o));
    if (shared.length) res.push({ a: templates[i].id, b: templates[j].id, outpoints: shared });
  }
  return res;
}

/** Human-readable inspection of a raw transaction. */
export function inspectRaw(rawHex: string) {
  const tx = decodeTransaction(hexToBin(rawHex));
  if (typeof tx === 'string') throw new FuseError('DECODE', tx);
  return {
    txid: txidOfRaw(rawHex), version: tx.version, locktime: tx.locktime, sizeBytes: rawHex.length / 2,
    inputs: tx.inputs.map((i) => ({ outpoint: `${binToHex(i.outpointTransactionHash)}:${i.outpointIndex}`, unlockingBytes: i.unlockingBytecode.length, sequence: i.sequenceNumber })),
    outputs: tx.outputs.map((o, n) => ({ n, lockingBytecode: binToHex(o.lockingBytecode), satoshis: o.valueSatoshis.toString(), token: o.token ? { category: binToHex(o.token.category), amount: o.token.amount.toString(), nft: o.token.nft ? { capability: o.token.nft.capability, commitment: binToHex(o.token.nft.commitment) } : undefined } : undefined })),
  };
}
