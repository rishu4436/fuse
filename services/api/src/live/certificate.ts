// Execution certificate for a LIVE FlashVault transaction, built purely from chain data and verified against an
// independent reader (bchexplorer.cash raw txs re-hashed locally). Pool routing (Cauldron legs) is recomputed from
// chain data as well.
import { binToHex } from '@bitauth/libauth';
import { sealCertificate, verifyCertificate, type ChainReader } from '@fuse/proof-verifier';
import { commitment } from '@fuse/core';
import { decodeVaultState, cauldronSwapIsValid } from '@fuse/contracts';
import { decoded, outputAt, rawTx, status, tip, EXPLORER_TX } from './chain.js';
import { paramsOfConfig, vaultLb, type VaultConfig } from './vault.js';
import { flashFee } from './execute.js';
import { PUSD } from './cauldron.js';
import { liveRederiver, intentBinder } from './verify.js';
import type { Authorization } from './authz.js';

export const esploraReader: ChainReader = {
  network: 'mainnet', tipHeight: tip,
  getRawTransaction: async (t) => { try { const [raw, s] = await Promise.all([rawTx(t), status(t)]); return { rawHex: raw, blockHeight: s.block_height ?? null, blockHash: s.block_hash ?? null }; } catch { return null; } },
};

export async function liveCertificate(configs: VaultConfig[], txid: string, bind: { authorization?: Authorization | null; userSignature?: { pubkey: string; sig: string } | null; trustedPubkey?: string | null; auction?: unknown } = {}) {
  const tx = await decoded(txid);
  const src = await Promise.all(tx.inputs.map((i) => outputAt(binToHex(i.outpointTransactionHash), i.outpointIndex)));
  const vi = src.findIndex((o) => o.token?.nft && configs.some((c) => c.category === o.token!.category));
  if (vi < 0) throw Object.assign(new Error('not a FUSE FlashVault transaction (no input carries a known vault identity NFT)'), { statusCode: 400 });
  const cfg = configs.find((c) => c.category === src[vi].token!.category)!; const p = paramsOfConfig(cfg); const lb = vaultLb(p);
  const outIdx = tx.outputs.findIndex((o) => o.token?.nft && binToHex(o.token.category) === cfg.category);
  const before = decodeVaultState(src[vi].token!.nft!.commitment);
  const after = outIdx >= 0 ? decodeVaultState(binToHex(tx.outputs[outIdx].token!.nft!.commitment)) : null;
  const isFlash = !!after && after.flashCount === before.flashCount + 1n;
  const pools = src.map((o, i) => ({ o, i })).filter(({ o }) => o.token?.category === PUSD && !o.token.nft);
  const routing = pools.map(({ o, i }) => { const out = tx.outputs[i]; const newSats = out.valueSatoshis; const newTok = out.token?.amount ?? 0n; return { inputIndex: i, outpoint: `${o.txid}:${o.vout}`, satsDelta: (newSats - o.satoshis).toString(), tokenDelta: (newTok - o.token!.amount).toString(), sameScriptContinuation: binToHex(out.lockingBytecode) === o.lockingBytecode, invariantHolds: cauldronSwapIsValid(o.satoshis, o.token!.amount, newSats, newTok) }; });
  const fee = isFlash ? flashFee(p, src[vi].satoshis) : 0n;
  const ownerIdx = tx.outputs.findIndex((o, i) => i !== outIdx && !o.token && binToHex(o.lockingBytecode).startsWith('76a914'));
  const owner = ownerIdx >= 0 ? binToHex(tx.outputs[ownerIdx].lockingBytecode) : '';
  const s = await status(txid);
  const minerFee = src.reduce((a, o) => a + o.satoshis, 0n) - tx.outputs.reduce((a, o) => a + o.valueSatoshis, 0n);
  const kind = isFlash ? (pools.length ? 'FLASH_VIA_CAULDRON' : 'FLASH_USE') : outIdx < 0 ? 'VAULT_CLOSE' : tx.outputs[outIdx].valueSatoshis > src[vi].satoshis ? 'LP_DEPOSIT' : 'LP_WITHDRAW';
  const cert = sealCertificate({
    schema: 'fuse.certificate/v1', certificateId: 'cert_' + txid.slice(0, 24), intentId: `mainnet_${kind.toLowerCase()}_${txid.slice(0, 12)}`,
    intentCommitment: commitment('intent/v1', { kind, vault: lb, principal: src[vi].satoshis, owner }), policyCommitment: null, network: 'mainnet', executionClass: 'ATOMIC_SINGLE_TX',
    solverId: 'fuse-live', quoteCommitment: commitment('quote/v1', { txid, fee }),
    contracts: [{ role: 'vault', name: 'FlashVaultBCH', lockingBytecode: lb }, ...pools.map(({ o }) => ({ role: 'pool', name: 'Cauldron V0 (unmodified)', lockingBytecode: o.lockingBytecode }))],
    transactions: [{ txid, blockHeight: s.block_height ?? null, blockHash: s.block_hash ?? null }],
    inputs: src.map((o) => ({ txid, outpoint: `${o.txid}:${o.vout}` })),
    outputs: tx.outputs.map((o, vout) => ({ txid, vout, lockingBytecode: binToHex(o.lockingBytecode), satoshis: o.valueSatoshis, ...(o.token ? { token: { category: binToHex(o.token.category), amount: o.token.amount, ...(o.token.nft ? { nft: { capability: o.token.nft.capability, commitment: binToHex(o.token.nft.commitment) } } : {}) } } : {}), role: vout === outIdx ? 'vault-continuation' : pools.some((x) => x.i === vout) ? 'pool' : binToHex(o.lockingBytecode) === owner ? 'owner' : 'other' })),
    vaultContinuations: outIdx >= 0 ? [{ txid, inputIndex: outIdx, minReturn: isFlash ? src[vi].satoshis + fee : tx.outputs[outIdx].valueSatoshis, asset: 'BCH' }] : [],
    fees: { minerFeeSats: minerFee, liquidityFee: fee, solverFee: 0n },
    outcome: { ownerLockingBytecode: owner, ownerReceives: [{ asset: 'BCH', amount: ownerIdx >= 0 ? tx.outputs[ownerIdx].valueSatoshis : 0n }] },
    // issuer claims; the verifier re-derives every one of them from chain data (they are not trusted)
    checks: [{ name: 'chain-derived', ok: true }, ...(outIdx < 0 ? [{ name: 'vault-close', ok: true }] : isFlash ? [{ name: 'vault-repayment', ok: true }, { name: 'vault-state-transition', ok: true }] : [{ name: 'lp-share-math', ok: true }]), { name: 'fee-accounting', ok: true }, ...routing.map((r) => ({ name: `cauldron-invariant:${r.inputIndex}`, ok: r.invariantHolds && r.sameScriptContinuation }))],
    confirmation: s.block_height ? 'CONFIRMED' : 'UNCONFIRMED', simulated: false, issuedAt: Math.floor(Date.now() / 1000), issuer: 'fuse-live-api',
  });
  const verification = await verifyCertificate(cert, esploraReader, { rederive: liveRederiver(configs), intent: intentBinder({ authorization: bind.authorization, userSignature: bind.userSignature, trustedPubkey: bind.trustedPubkey ?? null }) });
  return { kind, auction: bind.auction ?? null, authorization: bind.authorization ?? null, userSignature: bind.userSignature ?? null, vault: cfg.id, explorer: EXPLORER_TX + txid, vaultStateBefore: before, vaultStateAfter: after, routing, certificate: cert, verification };
}
