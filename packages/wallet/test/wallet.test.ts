import { describe, it, expect } from 'vitest';
import { secp256k1, hash160, binToHex, sha256, utf8ToBin, encodeTransaction, decodeTransactionUnsafe, hexToBin, generateSigningSerializationBch, SigningSerializationFlag } from '@bitauth/libauth';
import { signInputs, finalize, sourceOutputsOf } from '@fuse/transaction-composer';
import { buildSelfConsolidation, preflight, wcSignRequest, verifyWalletSigned, addressOf } from '../src/index.js';

const priv = sha256.hash(utf8ToBin('fuse-wallet-test-only'));
const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
const lb = `76a914${binToHex(hash160(pub))}88ac`;
const txid = (n: number) => binToHex(sha256.hash(utf8ToBin(`coin-${n}`)));
const coins = [
  { txid: txid(1), vout: 0, satoshis: 150_000n, addressIndex: 0, path: 'receive' as const },
  { txid: txid(2), vout: 1, satoshis: 60_000n, addressIndex: 3, path: 'change' as const },
  { txid: txid(3), vout: 0, satoshis: 1_000n, addressIndex: 1, path: 'receive' as const, token: { category: txid(9), amount: 5n } },
];
const ctx = { ownerLockingBytecode: lb, maxMinerFee: 2_000n };

describe('@fuse/wallet — WizardConnect signing path (no broadcast)', () => {
  const { template, inputPaths, fee } = buildSelfConsolidation(coins, lb);
  it('builds a self-consolidation that excludes token coins and pays a bounded fee', () => {
    expect(template.inputs).toHaveLength(2);
    expect(inputPaths).toEqual([[0, 'receive', 0], [1, 'change', 3]]);
    expect(template.outputs[0].satoshis).toBe(210_000n - fee);
    expect(fee).toBeGreaterThan(0n); expect(fee).toBeLessThan(1_000n);
  });
  it('preflight lists the mainnet gate items and passes all checks; never enables broadcast', () => {
    const p = preflight(template, { ...ctx, network: 'mainnet', authorization: 'WizardConnect hdwalletv1', contractVerification: 'n/a' });
    expect(p.ok).toBe(true); expect(p.broadcast).toBe('DISABLED');
    expect(p.items.map((i) => i.label)).toEqual(expect.arrayContaining(['Chain / network', 'Funding wallet', 'Expected outputs', 'Miner fee', 'Recoverability', 'Authorization method', 'Contract verification']));
    expect(p.items.find((i) => i.label === 'Funding wallet')!.value).toBe(addressOf(lb));
  });
  it('preflight flags a template that pays a foreign script or overpays the fee', () => {
    const bad = structuredClone(template); bad.outputs[0].lockingBytecode = '76a914' + '11'.repeat(20) + '88ac';
    expect(preflight(bad, { ...ctx, network: 'mainnet', authorization: 'x', contractVerification: 'x' }).checks.find((c) => c.name === 'no-foreign-outputs')!.ok).toBe(false);
    const greedy = structuredClone(template); greedy.outputs[0].satoshis -= 50_000n;
    expect(preflight(greedy, { ...ctx, network: 'mainnet', authorization: 'x', contractVerification: 'x' }).ok).toBe(false);
  });
  it('sign request: broadcast=false, encodes exactly the reviewed template with source outputs', () => {
    const r = wcSignRequest(template, 'FUSE preflight');
    expect(r.broadcast).toBe(false);
    expect(r.sourceOutputs).toHaveLength(2);
    expect(binToHex(r.sourceOutputs[0].lockingBytecode)).toBe(lb);
    expect(r.sourceOutputs[1].valueSatoshis).toBe(60_000n);
  });
  it('accepts a correct 0x61-signed response (VM-verified) from the "wallet"', () => {
    const signed = finalize(template, signInputs(template, 'user', priv));
    const v = verifyWalletSigned(template, signed, ctx);
    expect(v.ok).toBe(true);
  });
  it('rejects a wallet response whose outputs were changed', () => {
    const t2 = structuredClone(template); t2.outputs[0].lockingBytecode = '76a914' + '22'.repeat(20) + '88ac';
    // the evil "wallet" signs a different transaction than the one reviewed
    const evil = finalize(t2, new Map([...signInputs({ ...t2, outputs: t2.outputs.map((o) => ({ ...o })) }, 'user', priv)]));
    expect(verifyWalletSigned(template, evil, ctx).ok).toBe(false);
  });
  it('rejects a response signed with SIGHASH_ALL|FORKID only (no UTXOS)', () => {
    const tx = decodeTransactionUnsafe(hexToBin(finalize(template, signInputs(template, 'user', priv))));
    const src = sourceOutputsOf(template);
    const flags = SigningSerializationFlag.allOutputs | SigningSerializationFlag.forkId;
    tx.inputs.forEach((_, i) => {
      const ser = generateSigningSerializationBch({ inputIndex: i, sourceOutputs: src, transaction: tx }, { coveredBytecode: src[i].lockingBytecode, signingSerializationType: new Uint8Array([flags]) });
      const sig = secp256k1.signMessageHashSchnorr(priv, sha256.hash(sha256.hash(ser))) as Uint8Array;
      const full = new Uint8Array([...sig, flags]);
      tx.inputs[i].unlockingBytecode = new Uint8Array([full.length, ...full, pub.length, ...pub]);
    });
    const v = verifyWalletSigned(template, binToHex(encodeTransaction(tx)), ctx);
    expect(v.ok).toBe(false);
    expect(v.checks.some((c) => c.name.startsWith('sighash') && !c.ok)).toBe(true);
  });
  it('rejects garbage', () => { expect(verifyWalletSigned(template, 'deadbeef', ctx).ok).toBe(false); });
});
