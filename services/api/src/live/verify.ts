// Live certificate rederivation (security review issue B). Every contract-specific fact is RE-DERIVED from raw chain data
// fetched through the independent reader; nothing in certificate.checks is taken on trust.
import { binToHex, hexToBin, decodeTransaction, hash256 } from '@bitauth/libauth';
import { decodeVaultState, cauldronSwapIsValid } from '@fuse/contracts';
import type { Rederiver, IntentBinder, ChainReader } from '@fuse/proof-verifier';
import { paramsOfConfig, vaultLb, type VaultConfig } from './vault.js';
import { flashFee } from './execute.js';
import { PUSD } from './cauldron.js';
import { openAuthorization, structureDiff, structureHashOfTemplate, strippedStructure, verifyUserSignature, type Authorization } from './authz.js';

async function parentOutput(reader: ChainReader, txid: string, vout: number) {
  const got = await reader.getRawTransaction(txid);
  if (!got) throw new Error(`parent ${txid.slice(0, 12)} not found`);
  if (binToHex(hash256(hexToBin(got.rawHex)).reverse()) !== txid) throw new Error(`parent ${txid.slice(0, 12)} hash mismatch`);
  const tx = decodeTransaction(hexToBin(got.rawHex)); if (typeof tx === 'string') throw new Error(tx);
  const o = tx.outputs[vout]; if (!o) throw new Error(`parent ${txid.slice(0, 12)} has no output ${vout}`);
  return o;
}

export function liveRederiver(configs: VaultConfig[]): Rederiver {
  return async (cert, txs, reader) => {
    const out: Array<{ name: string; ok: boolean; detail?: string; covers?: string[] }> = [];
    const [txid] = [...txs.keys()]; const tx = txs.get(txid)!;
    const src = await Promise.all(tx.inputs.map((i) => parentOutput(reader, binToHex(i.outpointTransactionHash), i.outpointIndex)));
    // the vault script commits to its parameters: find the configured vault whose rebuilt script equals the claimed contract
    const claimedLb = cert.contracts.find((c) => c.role === 'vault')?.lockingBytecode;
    const cfg = configs.find((c) => vaultLb(paramsOfConfig(c)) === claimedLb);
    out.push({ name: 'vault-params', ok: !!cfg, detail: cfg ? `script rebuilt from ${cfg.id} params (feeBps ${cfg.params.feeBps}, minFee ${cfg.params.minFee}) equals the claimed vault contract` : 'no known FlashVault parameters rebuild the claimed vault script', covers: ['chain-derived'] });
    if (!cfg) return out;
    const p = paramsOfConfig(cfg); const lb = vaultLb(p);
    const vi = src.findIndex((o) => binToHex(o.lockingBytecode) === lb && o.token?.nft && binToHex(o.token.category) === cfg.category);
    out.push({ name: 'vault-input', ok: vi >= 0, detail: vi >= 0 ? `input ${vi} spends the vault identity NFT ${cfg.category.slice(0, 8)}…` : 'no input spends the vault' });
    if (vi < 0) return out;
    const vin = src[vi]; const vo = tx.outputs[vi];
    const cont = !!vo && binToHex(vo.lockingBytecode) === lb && !!vo.token?.nft && binToHex(vo.token.category) === cfg.category && vo.token.nft.capability === vin.token!.nft!.capability;
    const before = decodeVaultState(binToHex(vin.token!.nft!.commitment));
    const after = cont ? decodeVaultState(binToHex(vo!.token!.nft!.commitment)) : null;
    const minerFee = src.reduce((a, o) => a + o.valueSatoshis, 0n) - tx.outputs.reduce((a, o) => a + o.valueSatoshis, 0n);
    const isFlash = !!after && after.flashCount === before.flashCount + 1n;
    const fee = isFlash ? flashFee(p, vin.valueSatoshis) : 0n;
    if (!cont) out.push({ name: 'vault-continuation', ok: tx.outputs.every((o) => !(o.token && binToHex(o.token.category) === cfg.category)) || false, detail: 'no same-index continuation (vault close: identity NFT burned)', covers: ['vault-close'] });
    else if (isFlash) {
      out.push({ name: 'vault-repayment', ok: vo!.valueSatoshis >= vin.valueSatoshis + fee, detail: `vault in ${vin.valueSatoshis}, out ${vo!.valueSatoshis}, required ≥ ${vin.valueSatoshis + fee} (fee = max(${p.minFee}, ⌈${vin.valueSatoshis}·${p.feeBps}/10⁴⌉) = ${fee})`, covers: ['vault-repayment'] });
      out.push({ name: 'vault-state-transition', ok: after!.cumulativeFees === before.cumulativeFees + fee && after!.paused === before.paused, detail: `flashCount ${before.flashCount}→${after!.flashCount}, cumulativeFees ${before.cumulativeFees}→${after!.cumulativeFees} (+${fee})`, covers: ['vault-state-transition'] });
    } else {
      const delta = vo!.valueSatoshis - vin.valueSatoshis;
      const ownerLb = `76a914${p.ownerPkh}88ac`;
      const ownerOut = tx.outputs.filter((o) => binToHex(o.lockingBytecode) === ownerLb).reduce((a, o) => a + o.valueSatoshis, 0n);
      const ownerIn = src.filter((o) => binToHex(o.lockingBytecode) === ownerLb).reduce((a, o) => a + o.valueSatoshis, 0n);
      const unchanged = after!.flashCount === before.flashCount && after!.cumulativeFees === before.cumulativeFees && after!.paused === before.paused;
      // single-owner vault (FlashVaultBCH v1): the owner holds 100% of the shares, so LP math is principal ± amount and the
      // owner's wallet must account for exactly that amount plus the miner fee
      const ok = unchanged && delta !== 0n && ownerIn - ownerOut === delta + minerFee;
      out.push({ name: 'lp-share-math', ok, detail: `${delta > 0n ? 'deposit' : 'withdraw'} ${delta > 0n ? delta : -delta} sats: vault ${vin.valueSatoshis}→${vo!.valueSatoshis}; owner wallet net ${ownerOut - ownerIn} = −(${delta}) − fee ${minerFee}; commitment ${unchanged ? 'unchanged' : 'CHANGED'}`, covers: ['lp-share-math'] });
    }
    tx.inputs.forEach((_, i) => {
      const o = src[i]; if (!o.token || o.token.nft || binToHex(o.token.category) !== PUSD) return;
      const n = tx.outputs[i];
      const ok = !!n && binToHex(n.lockingBytecode) === binToHex(o.lockingBytecode) && !!n.token && binToHex(n.token.category) === PUSD && cauldronSwapIsValid(o.valueSatoshis, o.token.amount, n.valueSatoshis, n.token.amount);
      out.push({ name: `cauldron-invariant:${i}`, ok, detail: `pool ${o.valueSatoshis}/${o.token.amount} → ${n?.valueSatoshis}/${n?.token?.amount}: same script, k-invariant with 0.3% fee ${ok ? 'holds' : 'VIOLATED'}`, covers: [`cauldron-invariant:${i}`] });
    });
    out.push({ name: 'fee-accounting', ok: cert.fees.minerFeeSats === minerFee && cert.fees.liquidityFee === fee, detail: `miner fee ${minerFee} (claimed ${cert.fees.minerFeeSats}), liquidity fee ${fee} (claimed ${cert.fees.liquidityFee})`, covers: ['fee-accounting'] });
    return out;
  };
}

/** INTENT_BOUND: the on-chain tx (scriptSigs stripped) equals an authorization signed by the deployment's published key. */
export function intentBinder(a: { authorization?: Authorization | null; userSignature?: { pubkey: string; sig: string } | null; trustedPubkey: string | null }): IntentBinder {
  return async (cert, txs) => {
    if (!a.authorization) return { present: false, ok: false, detail: 'no execution authorization for this transaction (it predates intent binding, or none was supplied)' };
    if (!a.trustedPubkey) return { present: true, ok: false, detail: 'no trusted attestation key to verify the authorization' };
    const p = openAuthorization(a.authorization, a.trustedPubkey, { ignoreExpiry: true });
    const tx = txs.get(cert.transactions[0].txid)!;
    const diff = structureDiff(p.template, tx);
    if (diff) return { present: true, ok: false, detail: `on-chain tx differs from the authorization: ${diff}` };
    const h = binToHex((await import('@bitauth/libauth')).sha256.hash(strippedStructure(tx)));
    if (h !== p.structureHash || h !== structureHashOfTemplate(p.template)) return { present: true, ok: false, detail: 'structure hash mismatch' };
    const us = verifyUserSignature(a.authorization.authHash, a.userSignature ?? undefined, p.constraints.userLockingBytecode);
    if (us.present && !us.ok) return { present: true, ok: false, detail: us.detail };
    return { present: true, ok: true, detail: `tx matches authorization ${p.intentId} (attestation key ${a.trustedPubkey.slice(0, 10)}…, Guardian ${p.guardian.level})${us.present ? `; ${us.detail}` : '; no user wallet signature over the auth hash'}${p.auction ? `; auction ${p.auction.auctionId} winner ${p.auction.winner}` : ''}` };
  };
}
