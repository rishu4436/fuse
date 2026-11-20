import { Contract, type NetworkProvider, type Artifact } from 'cashscript';
import { hexToBin, binToHex } from '@bitauth/libauth';
import flashVaultBchArtifact from '../artifacts/FlashVaultBCH.json' with { type: 'json' };
import flashVaultTokenArtifact from '../artifacts/FlashVaultToken.json' with { type: 'json' };
import cauldronSwapArtifact from './third-party/cauldron-swap.artifact.json' with { type: 'json' };
import manifest from '../artifacts/manifest.json' with { type: 'json' };

export const artifacts = {
  FlashVaultBCH: flashVaultBchArtifact as unknown as Artifact,
  FlashVaultToken: flashVaultTokenArtifact as unknown as Artifact,
};
export const artifactManifest = manifest;

/** SIGHASH_ALL | SIGHASH_FORKID | SIGHASH_UTXOS — the only mode the vault owner path accepts. */
export const REQUIRED_SIGHASH = 0x61;
export const STATE_BYTES = 17;
export const BPS_DENOMINATOR = 10_000n;

/**
 * CashToken category ids are displayed (txid style) byte-reversed relative to how
 * transaction introspection returns them. Contracts compare against VM order.
 */
export function categoryToVmOrder(displayHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(displayHex)) throw new Error('category must be 32-byte lowercase hex');
  return binToHex(hexToBin(displayHex).reverse());
}

export interface VaultParams {
  feeBps: bigint;
  minFee: bigint;
  maxExposure: bigint;
  ownerPkh: string; // 20-byte hex
}

export interface BchVaultParams extends VaultParams {
  /** identity-NFT category, display (txid) order */
  vaultCategory: string;
}

export interface TokenVaultParams extends VaultParams {
  /** fungible asset category, display (txid) order */
  assetCategory: string;
}

/** Fee = max(minFee, ceil(principal * feeBps / 10000)) — identical to the on-chain formula. */
export function flashFee(principal: bigint, feeBps: bigint, minFee: bigint): bigint {
  if (principal < 0n || feeBps < 0n || minFee < 0n) throw new Error('negative fee input');
  const proportional = (principal * feeBps + (BPS_DENOMINATOR - 1n)) / BPS_DENOMINATOR;
  return proportional > minFee ? proportional : minFee;
}

export interface VaultState {
  flashCount: bigint;
  cumulativeFees: bigint;
  paused: boolean;
}

function toLe8(n: bigint): string {
  if (n < 0n || n > 0x7fffffffffffffffn) throw new Error('state counter out of range');
  let hex = '';
  let v = n;
  for (let i = 0; i < 8; i++) {
    hex += (v & 0xffn).toString(16).padStart(2, '0');
    v >>= 8n;
  }
  return hex;
}

function fromLe8(hex: string): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return v;
}

export function encodeVaultState(s: VaultState): string {
  return toLe8(s.flashCount) + toLe8(s.cumulativeFees) + (s.paused ? '01' : '00');
}

export function decodeVaultState(commitmentHex: string): VaultState {
  if (commitmentHex.length !== STATE_BYTES * 2) throw new Error('vault state must be 17 bytes');
  const flag = commitmentHex.slice(32, 34);
  if (flag !== '00' && flag !== '01') throw new Error('invalid vault flag byte');
  return { flashCount: fromLe8(commitmentHex.slice(0, 16)), cumulativeFees: fromLe8(commitmentHex.slice(16, 32)), paused: flag === '01' };
}

/** State after a successful flash that returned `surplus` sats above principal. */
export function nextVaultState(s: VaultState, surplus: bigint): VaultState {
  if (s.paused) throw new Error('vault paused');
  return { flashCount: s.flashCount + 1n, cumulativeFees: s.cumulativeFees + surplus, paused: false };
}

export function bchVaultContract(p: BchVaultParams, provider: NetworkProvider): Contract {
  return new Contract(
    artifacts.FlashVaultBCH,
    [hexToBin(categoryToVmOrder(p.vaultCategory)), p.feeBps, p.minFee, p.maxExposure, hexToBin(p.ownerPkh)],
    { provider, contractType: 'p2sh32' },
  );
}

export function tokenVaultContract(p: TokenVaultParams, provider: NetworkProvider): Contract {
  return new Contract(
    artifacts.FlashVaultToken,
    [hexToBin(categoryToVmOrder(p.assetCategory)), p.feeBps, p.minFee, p.maxExposure, hexToBin(p.ownerPkh)],
    { provider, contractType: 'p2sh32' },
  );
}

// ---------------------------------------------------------------------------
// Cauldron V0 pool (third-party, unmodified) — used for composition tests and
// for verifying live pool UTXOs correspond to the published script.
// ---------------------------------------------------------------------------

export function cauldronPoolArtifact(ownerPkhHex: string): Artifact {
  if (!/^[0-9a-f]{40}$/.test(ownerPkhHex)) throw new Error('pool owner pkh must be 20-byte hex');
  const a = JSON.parse(JSON.stringify(cauldronSwapArtifact).replace('<withdraw_pkh>', ownerPkhHex));
  a.contractName = `CauldronSwap_${ownerPkhHex}`;
  return a as Artifact;
}

export function cauldronPoolContract(ownerPkhHex: string, provider: NetworkProvider): Contract {
  return new Contract(cauldronPoolArtifact(ownerPkhHex), [], { provider, contractType: 'p2sh32' });
}

export const CAULDRON_FEE_NUM = 3n;
export const CAULDRON_FEE_DEN = 1000n;

/** Mirrors the on-chain pool rule: (newSats - fee) * newTokens >= sats * tokens, fee = |Δsats|*3/1000. */
export function cauldronSwapIsValid(sats: bigint, tokens: bigint, newSats: bigint, newTokens: bigint): boolean {
  const delta = newSats > sats ? newSats - sats : sats - newSats;
  const fee = (delta * CAULDRON_FEE_NUM) / CAULDRON_FEE_DEN;
  return (newSats - fee) * newTokens >= sats * tokens;
}

/** Sats the trader must add to a pool to receive `tokensOut` (exact output), with on-chain-valid rounding. */
export function cauldronBuyQuote(sats: bigint, tokens: bigint, tokensOut: bigint): { newSats: bigint; newTokens: bigint; satsIn: bigint } {
  if (tokensOut <= 0n || tokensOut >= tokens) throw new Error('tokensOut out of range');
  const newTokens = tokens - tokensOut;
  const k = sats * tokens;
  const exFee = (k + newTokens - 1n) / newTokens;
  const tradeValue = exFee - sats;
  let fee = (tradeValue * 3n + 996n) / 997n;
  let newSats = exFee + fee;
  while (!cauldronSwapIsValid(sats, tokens, newSats, newTokens)) { fee += 1n; newSats = exFee + fee; }
  return { newSats, newTokens, satsIn: newSats - sats };
}

/** Sats the trader receives for selling `tokensIn` (exact input), with on-chain-valid rounding. */
export function cauldronSellQuote(sats: bigint, tokens: bigint, tokensIn: bigint): { newSats: bigint; newTokens: bigint; satsOut: bigint } {
  if (tokensIn <= 0n) throw new Error('tokensIn must be positive');
  const newTokens = tokens + tokensIn;
  const k = sats * tokens;
  const exFee = (k + newTokens - 1n) / newTokens;
  const tradeValue = sats - exFee;
  const fee = (tradeValue * 3n + 999n) / 1000n;
  let newSats = exFee + fee;
  while (!cauldronSwapIsValid(sats, tokens, newSats, newTokens)) { newSats += 1n; }
  void fee;
  return { newSats, newTokens, satsOut: sats - newSats };
}
