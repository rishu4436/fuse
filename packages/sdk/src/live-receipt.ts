import { binToHex, decodeAuthenticationInstructions } from '@bitauth/libauth';
import { decodeVaultState, cauldronSwapIsValid } from '@fuse/contracts';
import type { Rederiver } from '@fuse/proof-verifier';
import { contractLockingBytecode } from '@fuse/transaction-composer';
import type { LiveVaultIdentity } from './live.js';
import { MAINNET_PUSD_CATEGORY, readMainnetOutput, vaultScript } from './live-verification.js';

function flashFee(params: LiveVaultIdentity['params'], satoshis: bigint) {
  const proportional = (satoshis * params.feeBps + 9_999n) / 10_000n;
  return proportional > params.minFee ? proportional : params.minFee;
}

function isCauldronInput(unlockingBytecode: Uint8Array, lockingBytecode: Uint8Array) {
  const redeem = decodeAuthenticationInstructions(unlockingBytecode).at(-1);
  if (!redeem || !('data' in redeem) || !(redeem.data instanceof Uint8Array)) return false;
  const script = binToHex(lockingBytecode);
  return decodeAuthenticationInstructions(redeem.data).some(instruction =>
    'data' in instruction && instruction.data instanceof Uint8Array && instruction.data.length === 20 &&
    contractLockingBytecode({ kind: 'cauldron-pool', ownerPkh: binToHex(instruction.data) }) === script);
}

export function liveReceiptRederiver(configs: readonly LiveVaultIdentity[]): Rederiver {
  return async (cert, txs, reader) => {
    const out: Array<{ name: string; ok: boolean; detail?: string; covers?: string[] }> = [];
    if (txs.size !== 1) return [{ name: 'atomic-receipt', ok: false, detail: 'A live FlashVault receipt describes exactly one transaction.' }];
    const [txid] = [...txs.keys()]; const tx = txs.get(txid)!;
    const src = await Promise.all(tx.inputs.map((i) => readMainnetOutput(reader, binToHex(i.outpointTransactionHash), i.outpointIndex)));
    // the vault script commits to its parameters: find the configured vault whose rebuilt script equals the claimed contract
    const claimedLb = cert.contracts.find((c) => c.role === 'vault')?.lockingBytecode;
    const cfg = configs.find((c) => vaultScript(c) === claimedLb);
    out.push({ name: 'vault-params', ok: !!cfg, detail: cfg ? `script rebuilt from ${cfg.id} params (feeBps ${cfg.params.feeBps}, minFee ${cfg.params.minFee}) equals the claimed vault contract` : 'no known FlashVault parameters rebuild the claimed vault script', covers: ['chain-derived'] });
    if (!cfg) return out;
    const p = cfg.params; const lb = vaultScript(cfg);
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
    tx.inputs.forEach((input, i) => {
      const o = src[i]; if (!o.token || o.token.nft || binToHex(o.token.category) !== MAINNET_PUSD_CATEGORY) return;
      const n = tx.outputs[i];
      const ok = isCauldronInput(input.unlockingBytecode, o.lockingBytecode) && !!n &&
        binToHex(n.lockingBytecode) === binToHex(o.lockingBytecode) && !!n.token && !n.token.nft &&
        binToHex(n.token.category) === MAINNET_PUSD_CATEGORY && cauldronSwapIsValid(o.valueSatoshis, o.token.amount, n.valueSatoshis, n.token.amount);
      out.push({ name: `cauldron-invariant:${i}`, ok, detail: `pool ${o.valueSatoshis}/${o.token.amount} → ${n?.valueSatoshis}/${n?.token?.amount}: same script, k-invariant with 0.3% fee ${ok ? 'holds' : 'VIOLATED'}`, covers: [`cauldron-invariant:${i}`] });
    });
    out.push({ name: 'fee-accounting', ok: cert.fees.minerFeeSats === minerFee && cert.fees.liquidityFee === fee, detail: `miner fee ${minerFee} (claimed ${cert.fees.minerFeeSats}), liquidity fee ${fee} (claimed ${cert.fees.liquidityFee})`, covers: ['fee-accounting'] });
    return out;
  };
}
